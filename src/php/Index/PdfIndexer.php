<?php declare( strict_types = 1 );

namespace Avpvh\FindAndView\Index;

final class PdfIndexer {

	/**
	 * Extracted text of a born-digital PDF attached to (uploaded into) a
	 * published post, indexed as its own content-index document. The url
	 * points at the parent post/page, not the raw PDF file — these PDFs are
	 * read through the page that displays them (via a separate gallery
	 * plugin), not a standalone PDF viewer, so a search match should land
	 * the visitor on that page.
	 */
	public static function from_attachment( \WP_Post $attachment, \WP_Post $parent ): ?IndexItem {
		if ( $attachment->post_mime_type !== 'application/pdf' ) return null;

		$path = get_attached_file( $attachment->ID );
		if ( ! $path || ! is_readable( $path ) ) return null;

		try {
			$text = ( new \Smalot\PdfParser\Parser() )->parseFile( $path )->getText();
		} catch ( \Throwable $e ) {
			return null;
		}

		// A scanned (image-only) PDF with no embedded text layer parses to
		// empty or near-empty text — skip it rather than index a blank
		// document. Those belong in the page_N.* scan pipeline instead.
		$text = trim( (string) preg_replace( '/\s+/u', ' ', $text ) );
		if ( mb_strlen( $text ) < 20 ) return null;

		$post_type_obj = get_post_type_object( $parent->post_type );
		$collection    = $post_type_obj ? $post_type_obj->labels->name : $parent->post_type;
		$pdf_title     = $attachment->post_title !== '' ? $attachment->post_title : pathinfo( $path, PATHINFO_FILENAME );

		return new IndexItem(
			id:          'pdf_' . $attachment->ID,
			type:        $parent->post_type,
			title:       $parent->post_title . ' — ' . $pdf_title,
			text:        $text,
			collection:  $collection,
			url:         get_permalink( $parent ) ?: '',
			thumb_url:   (string) get_the_post_thumbnail_url( $parent, 'medium' ),
			file:        null,
			tags:        [],
			date:        get_the_date( 'Y-m-d', $parent ) ?: null,
			page_number: null,
		);
	}

	/**
	 * PDF attachments currently uploaded into the given post — the set this
	 * indexer treats as "this post's PDFs" wherever it needs to enumerate
	 * them (bulk reindex, publish/unpublish reconciliation).
	 *
	 * @return list<\WP_Post>
	 */
	public static function attachments_of( \WP_Post $post ): array {
		return get_posts( [
			'post_type'        => 'attachment',
			'post_mime_type'   => 'application/pdf',
			'post_parent'      => $post->ID,
			'posts_per_page'   => -1,
			'suppress_filters' => true,
		] );
	}
}
