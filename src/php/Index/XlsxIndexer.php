<?php declare( strict_types = 1 );

namespace Avpvh\FindAndView\Index;

/** Converts XLSX worksheets into small, searchable text documents. */
final class XlsxIndexer {
	private const ROWS_PER_DOCUMENT            = 100;
	private const MAX_ZIP_FILE_BYTES           = 20971520;  // 20 MiB
	private const MAX_ENTRY_BYTES              = 16777216;  // 16 MiB per XML member
	private const MAX_TOTAL_UNCOMPRESSED_BYTES = 52428800;  // 50 MiB total across parsed XML members
	private const MAX_SHEETS                   = 50;
	private const MAX_SHARED_STRINGS           = 100000;
	private const MAX_ROWS_PER_SHEET           = 20000;
	private const MAX_COLUMNS_PER_ROW          = 100;

	/** @return list<array<string,mixed>> */
	public static function from_file( \SplFileInfo $file, string $root, string $base_url ): array {
		if ( ! class_exists( \ZipArchive::class ) ) {
			throw new \RuntimeException( 'The PHP zip extension is required to index XLSX files.' );
		}
		if ( $file->isLink() ) {
			throw new \RuntimeException( 'Refusing to index symlinked XLSX file.' );
		}
		$file_size = $file->getSize();
		if ( $file_size === false || $file_size > self::MAX_ZIP_FILE_BYTES ) {
			throw new \RuntimeException( 'XLSX file exceeds maximum allowed size.' );
		}

		$zip = new \ZipArchive();
		if ( $zip->open( $file->getPathname() ) !== true ) {
			throw new \RuntimeException( 'Could not open XLSX file: ' . esc_html( $file->getFilename() ) );
		}

		try {
			$total_bytes = 0;
			$shared      = self::shared_strings( $zip, $total_bytes );
			$sheets      = self::sheets( $zip, $total_bytes );
			$date_styles = self::date_styles( $zip, $total_bytes );
			$date_1904   = self::uses_1904_dates( $zip, $total_bytes );
			$rel_dir = ltrim( str_replace( $root, '', $file->getPath() ), '/' );
			$book    = $file->getBasename( '.' . $file->getExtension() );
			$url     = $base_url . ( $rel_dir !== '' ? '/' . $rel_dir : '' ) . '/' . rawurlencode( $file->getFilename() );
			$docs    = [];

			foreach ( $sheets as $sheet_index => $sheet ) {
				$xml = self::read_zip_entry( $zip, $sheet['path'], $total_bytes );
				if ( ! is_string( $xml ) ) continue;

				$rows = self::rows( $xml, $shared, $date_styles, $date_1904 );
				foreach ( array_chunk( $rows, self::ROWS_PER_DOCUMENT, true ) as $chunk_index => $chunk ) {
					if ( $chunk === [] ) continue;
					$first_row  = (int) array_key_first( $chunk );
					$last_row   = (int) array_key_last( $chunk );
					$collection = implode( '/', array_filter( [ $rel_dir, $book, $sheet['name'] ], static fn( string $part ): bool => $part !== '' ) );
					$label      = 'sheet_' . ( $sheet_index + 1 ) . '_part_' . ( $chunk_index + 1 );
					$docs[]     = [
						'id'          => self::sanitize_id( str_replace( '/', '__', $collection ) . '__' . $label ),
						'type'        => 'spreadsheet',
						'title'       => sprintf( '%s - %s (rows %d-%d)', $book, $sheet['name'], $first_row, $last_row ),
						'collection'  => $collection,
						'page_number' => $chunk_index + 1,
						'text'        => self::markdown( $book, $sheet['name'], $chunk ),
						'text_format' => 'md',
						'has_image'   => false,
						'url'         => $url,
						'thumb_url'   => null,
						'tags'        => self::collection_tags( $collection ),
						'date'        => null,
					];
				}
			}

			return $docs;
		} finally {
			$zip->close();
		}
	}

	/**
	 * Reads a single XML member from the archive after checking its declared
	 * uncompressed size against per-entry and cumulative limits (size guard).
	 */
	private static function read_zip_entry( \ZipArchive $zip, string $name, int &$total_bytes ): ?string {
		$stat = $zip->statName( $name );
		if ( ! is_array( $stat ) ) return null;
		$size = (int) ( $stat['size'] ?? 0 );
		if ( $size < 0 || $size > self::MAX_ENTRY_BYTES ) {
			throw new \RuntimeException( 'XLSX XML entry exceeds maximum uncompressed size.' );
		}
		if ( $total_bytes + $size > self::MAX_TOTAL_UNCOMPRESSED_BYTES ) {
			throw new \RuntimeException( 'XLSX archive exceeds maximum total uncompressed size.' );
		}
		$xml = $zip->getFromName( $name, self::MAX_ENTRY_BYTES + 1 );
		if ( ! is_string( $xml ) ) return null;
		$actual = strlen( $xml );
		if ( $actual > self::MAX_ENTRY_BYTES || $total_bytes + $actual > self::MAX_TOTAL_UNCOMPRESSED_BYTES ) {
			throw new \RuntimeException( 'XLSX XML entry exceeded allowed uncompressed size.' );
		}
		$total_bytes += $actual;
		return $xml;
	}

	/** @return list<string> */
	private static function shared_strings( \ZipArchive $zip, int &$total_bytes ): array {
		$xml = self::read_zip_entry( $zip, 'xl/sharedStrings.xml', $total_bytes );
		if ( ! is_string( $xml ) ) return [];
		$doc = new \DOMDocument();
		if ( ! @$doc->loadXML( $xml, LIBXML_NONET | LIBXML_COMPACT ) ) return [];
		$result = [];
		foreach ( $doc->getElementsByTagName( 'si' ) as $item ) {
			if ( count( $result ) >= self::MAX_SHARED_STRINGS ) {
				throw new \RuntimeException( 'XLSX exceeds maximum shared string count.' );
			}
			$value = '';
			foreach ( $item->getElementsByTagName( 't' ) as $text ) $value .= $text->textContent;
			$result[] = $value;
		}
		return $result;
	}

	/** @return list<array{name:string,path:string}> */
	private static function sheets( \ZipArchive $zip, int &$total_bytes ): array {
		$workbook_xml = self::read_zip_entry( $zip, 'xl/workbook.xml', $total_bytes );
		$rels_xml     = self::read_zip_entry( $zip, 'xl/_rels/workbook.xml.rels', $total_bytes );
		if ( ! is_string( $workbook_xml ) || ! is_string( $rels_xml ) ) return [];

		$rels_doc = new \DOMDocument();
		if ( ! @$rels_doc->loadXML( $rels_xml, LIBXML_NONET | LIBXML_COMPACT ) ) return [];
		$rels = [];
		foreach ( $rels_doc->getElementsByTagName( 'Relationship' ) as $rel ) {
			if ( strcasecmp( $rel->getAttribute( 'TargetMode' ), 'External' ) === 0 ) continue;
			$target = ltrim( $rel->getAttribute( 'Target' ), '/' );
			if ( $target === '' || str_contains( $target, "\0" ) || str_contains( $target, '\\' ) || in_array( '..', explode( '/', $target ), true ) ) {
				continue;
			}
			$rels[ $rel->getAttribute( 'Id' ) ] = str_starts_with( $target, 'xl/' ) ? $target : 'xl/' . $target;
		}

		$doc = new \DOMDocument();
		if ( ! @$doc->loadXML( $workbook_xml, LIBXML_NONET | LIBXML_COMPACT ) ) return [];
		$result = [];
		foreach ( $doc->getElementsByTagName( 'sheet' ) as $sheet ) {
			if ( count( $result ) >= self::MAX_SHEETS ) {
				throw new \RuntimeException( 'XLSX exceeds maximum worksheet count.' );
			}
			$rel_id = $sheet->getAttributeNS( 'http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id' );
			if ( isset( $rels[ $rel_id ] ) ) $result[] = [ 'name' => $sheet->getAttribute( 'name' ), 'path' => $rels[ $rel_id ] ];
		}
		return $result;
	}

	/** @return array<int,true> Cell style indexes that represent dates or times. */
	private static function date_styles( \ZipArchive $zip, int &$total_bytes ): array {
		$xml = self::read_zip_entry( $zip, 'xl/styles.xml', $total_bytes );
		if ( ! is_string( $xml ) ) return [];
		$doc = new \DOMDocument();
		if ( ! @$doc->loadXML( $xml, LIBXML_NONET | LIBXML_COMPACT ) ) return [];

		$custom = [];
		foreach ( $doc->getElementsByTagName( 'numFmt' ) as $format ) {
			$code = preg_replace( '/"[^"]*"|\\\\./', '', $format->getAttribute( 'formatCode' ) ) ?? '';
			if ( preg_match( '/[ymdhis]/i', $code ) ) $custom[ (int) $format->getAttribute( 'numFmtId' ) ] = true;
		}

		$built_in = array_fill_keys( array_merge( range( 14, 22 ), range( 27, 36 ), range( 45, 47 ), range( 50, 58 ) ), true );
		$result   = [];
		$cell_xfs = $doc->getElementsByTagName( 'cellXfs' )->item( 0 );
		if ( ! $cell_xfs ) return [];
		$index = 0;
		foreach ( $cell_xfs->childNodes as $xf ) {
			if ( ! $xf instanceof \DOMElement || $xf->localName !== 'xf' ) continue;
			$num_fmt = (int) $xf->getAttribute( 'numFmtId' );
			if ( isset( $built_in[ $num_fmt ] ) || isset( $custom[ $num_fmt ] ) ) $result[ $index ] = true;
			++$index;
		}
		return $result;
	}

	private static function uses_1904_dates( \ZipArchive $zip, int &$total_bytes ): bool {
		$xml = self::read_zip_entry( $zip, 'xl/workbook.xml', $total_bytes );
		if ( ! is_string( $xml ) ) return false;
		$doc = new \DOMDocument();
		if ( ! @$doc->loadXML( $xml, LIBXML_NONET | LIBXML_COMPACT ) ) return false;
		$properties = $doc->getElementsByTagName( 'workbookPr' )->item( 0 );
		return $properties instanceof \DOMElement && in_array( strtolower( $properties->getAttribute( 'date1904' ) ), [ '1', 'true' ], true );
	}

	/** @return array<int,array<string,string>> Rows keyed by source row number. */
	private static function rows( string $xml, array $shared, array $date_styles, bool $date_1904 ): array {
		$reader = new \XMLReader();
		if ( ! $reader->XML( $xml, null, LIBXML_NONET | LIBXML_COMPACT ) ) return [];
		$rows = [];
		$row_number = 0;
		while ( $reader->read() ) {
			if ( $reader->nodeType === \XMLReader::ELEMENT && $reader->localName === 'row' ) {
				if ( count( $rows ) >= self::MAX_ROWS_PER_SHEET ) {
					$reader->close();
					throw new \RuntimeException( 'XLSX worksheet exceeds maximum row count.' );
				}
				$row_number = (int) ( $reader->getAttribute( 'r' ) ?: $row_number + 1 );
			}
			if ( $reader->nodeType !== \XMLReader::ELEMENT || $reader->localName !== 'c' ) continue;

			$ref    = (string) $reader->getAttribute( 'r' );
			$type   = (string) $reader->getAttribute( 't' );
			$style  = (int) ( $reader->getAttribute( 's' ) ?: 0 );
			$column = preg_replace( '/\d+/', '', $ref ) ?: '?';
			$value  = '';
			$depth  = $reader->depth;
			if ( ! $reader->isEmptyElement ) {
				while ( $reader->read() ) {
					if ( $reader->nodeType === \XMLReader::ELEMENT && ( $reader->localName === 'v' || $reader->localName === 't' ) ) {
						$value .= $reader->readString();
					}
					if ( $reader->nodeType === \XMLReader::END_ELEMENT && $reader->localName === 'c' && $reader->depth === $depth ) break;
				}
			}
			if ( $type === 's' && ctype_digit( $value ) ) $value = $shared[ (int) $value ] ?? $value;
			if ( isset( $date_styles[ $style ] ) && is_numeric( $value ) ) $value = self::excel_date( (float) $value, $date_1904 );
			$value = trim( $value );
			if ( $value !== '' ) {
				if ( isset( $rows[ $row_number ] ) && count( $rows[ $row_number ] ) >= self::MAX_COLUMNS_PER_ROW ) continue;
				$rows[ $row_number ][ $column ] = $value;
			}
		}
		$reader->close();
		return $rows;
	}

	private static function excel_date( float $serial, bool $date_1904 ): string {
		$base    = new \DateTimeImmutable( $date_1904 ? '1904-01-01 00:00:00' : '1899-12-30 00:00:00', new \DateTimeZone( 'UTC' ) );
		$date    = $base->modify( sprintf( '+%d seconds', (int) round( $serial * 86400 ) ) );
		$has_day = $serial >= 1;
		$has_time = abs( $serial - floor( $serial ) ) > 0.000001;
		if ( ! $has_day ) return $date->format( 'H:i:s' );
		return $date->format( $has_time ? 'Y-m-d H:i:s' : 'Y-m-d' );
	}

	/** @param array<int,array<string,string>> $rows */
	private static function markdown( string $book, string $sheet, array $rows ): string {
		$columns = [];
		foreach ( $rows as $cells ) $columns = array_values( array_unique( array_merge( $columns, array_keys( $cells ) ) ) );
		usort( $columns, static fn( string $a, string $b ): int => self::column_number( $a ) <=> self::column_number( $b ) );

		$escape = static fn( string $value ): string => str_replace( [ '\\', '|', "\r\n", "\r", "\n" ], [ '\\\\', '\\|', '<br>', '<br>', '<br>' ], $value );
		$lines  = [ '## ' . $escape( $book ) . ' - ' . $escape( $sheet ), '', '| Row | ' . implode( ' | ', $columns ) . ' |', '| ---: | ' . implode( ' | ', array_fill( 0, count( $columns ), '---' ) ) . ' |' ];
		foreach ( $rows as $number => $cells ) {
			$values  = array_map( static fn( string $column ): string => $escape( $cells[ $column ] ?? '' ), $columns );
			$lines[] = '| ' . $number . ' | ' . implode( ' | ', $values ) . ' |';
		}
		return implode( "\n", $lines );
	}

	private static function column_number( string $column ): int {
		$result = 0;
		foreach ( str_split( strtoupper( $column ) ) as $char ) $result = $result * 26 + ord( $char ) - 64;
		return $result;
	}

	private static function sanitize_id( string $raw ): string {
		return preg_replace( '/[^A-Za-z0-9_-]/', '_', $raw ) ?? $raw;
	}

	/** @return list<string> */
	private static function collection_tags( string $collection ): array {
		$parts = explode( '/', $collection );
		return array_map( static fn( int $index ): string => implode( '/', array_slice( $parts, 0, $index + 1 ) ), array_keys( $parts ) );
	}
}
