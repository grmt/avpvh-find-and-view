<?php declare( strict_types = 1 );

namespace Avpvh\FindAndView\Admin;

use Avpvh\FindAndView\Access\ScanEditPermission;
use Avpvh\FindAndView\CLI\IndexCommand;
use Avpvh\FindAndView\Index\XlsxIndexer;
use Avpvh\FindAndView\Ocr\DocumentAiClient;
use Avpvh\FindAndView\Ocr\TesseractClient;
use Avpvh\FindAndView\Settings;
use Meilisearch\Contracts\DocumentsQuery;

final class TreeController {
	private const MAX_SCAN_TEXT_BYTES     = 524288;   // 512 KiB per page
	private const MAX_REPLACE_QUERY_BYTES = 500;
	private const MAX_REPLACE_VALUE_BYTES = 10000;
	private const MAX_OCR_IMAGE_BYTES     = 26214400; // 25 MiB
	private const REGEX_BACKTRACK_LIMIT   = '10000';
	private const RATE_LIMIT_WINDOW       = 600;      // 10 minutes
	private const RATE_LIMIT_DOCAI        = 30;
	private const RATE_LIMIT_TESSERACT    = 60;
	private const RATE_LIMIT_DELETE       = 30;

	public function register(): void {
		add_action( 'rest_api_init', [ $this, 'register_routes' ] );
	}

	public function register_routes(): void {
		register_rest_route( 'avpvh-fav/v1', '/tree', [
			'methods'             => 'GET',
			'callback'            => [ $this, 'get_tree' ],
			'permission_callback' => fn() => current_user_can( 'manage_options' ),
		] );
		register_rest_route( 'avpvh-fav/v1', '/tree/move', [
			'methods'             => 'POST',
			'callback'            => [ $this, 'move_node' ],
			'permission_callback' => fn() => current_user_can( 'manage_options' ),
			'args'                => [
				'from' => [ 'required' => true, 'type' => 'string' ],
				'to'   => [ 'required' => true, 'type' => 'string' ],
			],
		] );
		register_rest_route( 'avpvh-fav/v1', '/tree/normalize', [
			'methods'             => 'POST',
			'callback'            => [ $this, 'normalize_numbers' ],
			'permission_callback' => fn() => current_user_can( 'manage_options' ),
			'args'                => [
				'dry_run' => [ 'type' => 'boolean', 'default' => true ],
			],
		] );
		register_rest_route( 'avpvh-fav/v1', '/tree/reindex', [
			'methods'             => 'POST',
			'callback'            => [ $this, 'reindex_scans' ],
			'permission_callback' => fn() => current_user_can( 'manage_options' ),
		] );
		register_rest_route( 'avpvh-fav/v1', '/tree/remap', [
			'methods'             => 'POST',
			'callback'            => [ $this, 'remap_index' ],
			'permission_callback' => fn() => current_user_can( 'manage_options' ),
			'args'                => [
				'dry_run' => [ 'type' => 'boolean', 'default' => true ],
			],
		] );
		register_rest_route( 'avpvh-fav/v1', '/tree/reindex-content', [
			'methods'             => 'POST',
			'callback'            => [ $this, 'reindex_content' ],
			'permission_callback' => fn() => current_user_can( 'manage_options' ),
		] );
		register_rest_route( 'avpvh-fav/v1', '/tree/index-stats', [
			'methods'             => 'GET',
			'callback'            => [ $this, 'index_stats' ],
			'permission_callback' => fn() => current_user_can( 'manage_options' ),
		] );
		register_rest_route( 'avpvh-fav/v1', '/tree/index-settings', [
			'methods'             => 'POST',
			'callback'            => [ $this, 'apply_index_settings' ],
			'permission_callback' => fn() => current_user_can( 'manage_options' ),
		] );
		register_rest_route( 'avpvh-fav/v1', '/tree/doc-search', [
			'methods'             => 'POST',
			'callback'            => [ $this, 'doc_search' ],
			'permission_callback' => fn() => current_user_can( 'manage_options' ),
		] );
		register_rest_route( 'avpvh-fav/v1', '/tree/doc-save', [
			'methods'             => 'POST',
			'callback'            => [ $this, 'doc_save' ],
			'permission_callback' => fn() => current_user_can( 'manage_options' ),
		] );
		register_rest_route( 'avpvh-fav/v1', '/scan/edit', [
			'methods'             => 'POST',
			'callback'            => [ $this, 'edit_scan_page' ],
			'permission_callback' => [ ScanEditPermission::class, 'check' ],
			'args'                => [
				'collection'  => [ 'required' => true, 'type' => 'string', 'sanitize_callback' => 'sanitize_text_field' ],
				'page_number' => [ 'required' => true, 'type' => 'integer' ],
				'text'        => [ 'required' => true, 'type' => 'string' ],
			],
		] );
		register_rest_route( 'avpvh-fav/v1', '/scan/ocr', [
			'methods'             => 'POST',
			'callback'            => [ $this, 'ocr_scan_page' ],
			'permission_callback' => [ ScanEditPermission::class, 'check' ],
			'args'                => [
				'collection'  => [ 'required' => true, 'type' => 'string', 'sanitize_callback' => 'sanitize_text_field' ],
				'page_number' => [ 'required' => true, 'type' => 'integer' ],
				'engine'      => [ 'type' => 'string', 'default' => 'docai', 'enum' => [ 'docai', 'tesseract' ] ],
			],
		] );
		register_rest_route( 'avpvh-fav/v1', '/scan/crop-ocr', [
			'methods'             => 'POST',
			'callback'            => [ $this, 'crop_ocr_scan_page' ],
			'permission_callback' => [ ScanEditPermission::class, 'check' ],
			'args'                => [
				'collection'  => [ 'required' => true, 'type' => 'string', 'sanitize_callback' => 'sanitize_text_field' ],
				'page_number' => [ 'required' => true, 'type' => 'integer' ],
				'crop'        => [ 'required' => true, 'type' => 'object' ],
				'engine'      => [ 'type' => 'string', 'default' => 'docai', 'enum' => [ 'docai', 'tesseract' ] ],
			],
		] );
		register_rest_route( 'avpvh-fav/v1', '/scan/history', [
			'methods'             => 'POST',
			'callback'            => [ $this, 'scan_history' ],
			'permission_callback' => [ ScanEditPermission::class, 'check' ],
			'args'                => [
				'collection'  => [ 'required' => true, 'type' => 'string', 'sanitize_callback' => 'sanitize_text_field' ],
				'page_number' => [ 'required' => true, 'type' => 'integer' ],
			],
		] );
		register_rest_route( 'avpvh-fav/v1', '/scan/diff', [
			'methods'             => 'POST',
			'callback'            => [ $this, 'scan_diff' ],
			'permission_callback' => [ ScanEditPermission::class, 'check' ],
			'args'                => [
				'collection'  => [ 'required' => true, 'type' => 'string', 'sanitize_callback' => 'sanitize_text_field' ],
				'page_number' => [ 'required' => true, 'type' => 'integer' ],
				'version'     => [ 'required' => true, 'type' => 'integer', 'minimum' => 1, 'maximum' => 3 ],
			],
		] );
		register_rest_route( 'avpvh-fav/v1', '/scan/delete', [
			'methods'             => 'POST',
			'callback'            => [ $this, 'delete_scan_page' ],
			'permission_callback' => [ ScanEditPermission::class, 'check' ],
			'args'                => [
				'collection'  => [ 'required' => true, 'type' => 'string', 'sanitize_callback' => 'sanitize_text_field' ],
				'page_number' => [ 'required' => true, 'type' => 'integer' ],
			],
		] );
		register_rest_route( 'avpvh-fav/v1', '/scan/consolidate', [
			'methods'             => 'POST',
			'callback'            => [ $this, 'consolidate_scan_collection' ],
			'permission_callback' => [ ScanEditPermission::class, 'check' ],
			'args'                => [
				'collection' => [ 'required' => true, 'type' => 'string', 'sanitize_callback' => 'sanitize_text_field' ],
			],
		] );
		register_rest_route( 'avpvh-fav/v1', '/scan/replace', [
			'methods'             => 'POST',
			'callback'            => [ $this, 'replace_scan_collection' ],
			'permission_callback' => [ ScanEditPermission::class, 'check' ],
			'args'                => [
				'collection'     => [ 'required' => true, 'type' => 'string', 'sanitize_callback' => 'sanitize_text_field' ],
				'query'          => [ 'required' => true, 'type' => 'string' ],
				'replacement'    => [ 'type' => 'string', 'default' => '' ],
				'regex'          => [ 'type' => 'boolean', 'default' => false ],
				'case_sensitive' => [ 'type' => 'boolean', 'default' => false ],
				'whole_word'     => [ 'type' => 'boolean', 'default' => false ],
			],
		] );
		register_rest_route( 'avpvh-fav/v1', '/tree/mkdir', [
			'methods'             => 'POST',
			'callback'            => [ $this, 'make_dir' ],
			'permission_callback' => fn() => current_user_can( 'manage_options' ),
			'args'                => [
				'path' => [ 'required' => true, 'type' => 'string' ],
			],
		] );
	}

	// A site-level media-privacy plugin (avpvh-members) buckets uploads into
	// wp-content/uploads/private or /public via a subdir/path/url filter, but
	// leaves wp_upload_dir()['basedir'] itself pointing at the plain uploads
	// root. Scans are deliberately kept private, so /scans normally lives
	// under the private bucket -- fall back there when the plain path (what
	// the unfiltered basedir naively implies) doesn't actually exist.
	private function scan_root(): string {
		$base = wp_upload_dir()['basedir'] . '/scans';
		if ( is_dir( $base ) ) return $base;
		$private = wp_upload_dir()['basedir'] . '/private/scans';
		return is_dir( $private ) ? $private : $base;
	}

	// Matches whichever bucket scan_root() resolved to, so generated
	// url/thumb_url fields actually point at the scans that are there.
	private function scan_base_url(): string {
		$dirs = wp_upload_dir();
		$rel  = substr( $this->scan_root(), strlen( $dirs['basedir'] ) );
		return $dirs['baseurl'] . $rel;
	}

	private function resolve_collection_dir( string $collection ): string|false {
		if ( $collection === '' ) return false;
		$root = realpath( $this->scan_root() );
		$dir  = $this->safe_path( $collection );
		if ( ! $root || ! $dir || $dir === $root || ! is_dir( $dir ) ) return false;
		return $dir;
	}

	private static function escape_regex_delimiter( string $pattern ): string {
		return preg_replace( '/(?<!\\\\)((?:\\\\\\\\)*)\//', '$1\\/', $pattern ) ?? $pattern;
	}

	private static function check_rate_limit( string $bucket, int $max_requests, int $window_seconds = self::RATE_LIMIT_WINDOW ): ?\WP_Error {
		$user_id = function_exists( 'get_current_user_id' ) ? get_current_user_id() : 0;
		$key     = 'fav_rl_' . $bucket . '_' . $user_id;
		$now     = time();
		$state   = get_transient( $key );
		if ( ! is_array( $state ) || ! isset( $state['count'], $state['reset'] ) || $now >= (int) $state['reset'] ) {
			$state = [ 'count' => 0, 'reset' => $now + $window_seconds ];
		}
		if ( (int) $state['count'] >= $max_requests ) {
			return new \WP_Error( 'rate_limited', 'Te veel verzoeken. Probeer het later opnieuw.', [ 'status' => 429 ] );
		}
		$state['count'] = (int) $state['count'] + 1;
		set_transient( $key, $state, max( 1, (int) $state['reset'] - $now ) );
		return null;
	}

	private static function audit_log( string $action, array $context = [] ): void {
		$entry = [
			'action'  => $action,
			'user_id' => function_exists( 'get_current_user_id' ) ? get_current_user_id() : 0,
			'time'    => gmdate( 'c' ),
			'context' => $context,
		];
		if ( function_exists( 'do_action' ) ) {
			do_action( 'avpvh_fav_audit', $action, $entry );
		}
		error_log( '[avpvh-fav-audit] ' . wp_json_encode( $entry ) );
	}

	private static function meili_error( string $log_context, string $detail, string $user_message, int $status = 500 ): \WP_Error {
		error_log( '[avpvh-fav] ' . $log_context . ': ' . $detail );
		return new \WP_Error( 'meili_error', $user_message, [ 'status' => $status ] );
	}

	private function safe_path( string $rel ): string|false {
		if ( $rel !== '' && ! self::valid_relative_path( $rel ) ) return false;
		$root = realpath( $this->scan_root() );
		if ( ! $root ) return false;
		$abs  = realpath( $root . '/' . $rel );
		// The root itself, or something below it -- not a sibling like scans-old/.
		if ( ! $abs || ( $abs !== $root && ! str_starts_with( $abs, $root . '/' ) ) ) return false;
		return $abs;
	}

	private static function valid_relative_path( string $rel ): bool {
		if ( $rel === '' || str_contains( $rel, "\0" ) || str_contains( $rel, '\\' ) ) return false;
		foreach ( explode( '/', $rel ) as $segment ) {
			if ( in_array( $segment, [ '', '.', '..' ], true ) ) return false;
		}
		return ! self::is_deleted_collection( $rel );
	}

	/** Validate non-existing destinations, including every existing ancestor. */
	private function destination_path( string $rel ): string|false {
		$root = realpath( $this->scan_root() );
		if ( ! $root || ! self::valid_relative_path( $rel ) ) return false;
		$path = $root;
		foreach ( explode( '/', $rel ) as $segment ) {
			$path .= '/' . $segment;
			// Reject dangling links as well as links whose targets escape the root.
			if ( is_link( $path ) ) return false;
			if ( file_exists( $path ) ) {
				$real = realpath( $path );
				if ( ! $real || ! is_dir( $real ) || ! str_starts_with( $real, $root . '/' ) ) return false;
			}
		}
		return $path;
	}

	private static function is_deleted_collection( string $rel ): bool {
		return in_array( 'verwijderd', explode( '/', strtolower( $rel ) ), true );
	}

	/** Prune backups and links before descending, for every scans walker. */
	private static function scan_iterator( string $root, int $mode = \RecursiveIteratorIterator::LEAVES_ONLY ): \RecursiveIteratorIterator {
		$filter = new \RecursiveCallbackFilterIterator(
			new \RecursiveDirectoryIterator( $root, \FilesystemIterator::SKIP_DOTS ),
			static fn( \SplFileInfo $file ): bool => ! $file->isLink() && strtolower( $file->getFilename() ) !== 'verwijderd'
		);
		return new \RecursiveIteratorIterator( $filter, $mode );
	}

	/**
	 * Finds an existing page_N.<ext> file by number, without guessing its
	 * zero-padding width. $ext_pattern is a regex alternation, e.g.
	 * 'txt|md' (prefers .md when both exist) or 'png|jpe?g'.
	 */
	private function resolve_page_file( string $dir, int $page_number, string $ext_pattern ): ?string {
		$found = null;
		foreach ( scandir( $dir ) as $entry ) {
			if ( preg_match( "/^page_(\\d+)\\.({$ext_pattern})$/i", $entry, $m ) !== 1 ) continue;
			if ( (int) $m[1] !== $page_number ) continue;
			if ( $found === null || strtolower( $m[2] ) === 'md' ) $found = $dir . '/' . $entry;
		}
		return $found;
	}

	/** All files belonging to one page: its own extensions plus any .bak*. */
	private function related_page_files( string $dir, string $label ): array {
		$files = [];
		foreach ( scandir( $dir ) as $entry ) {
			if ( preg_match( '/^' . preg_quote( $label, '/' ) . '\.(png|jpe?g|txt|md)(\.bak\d)?$/i', $entry ) === 1 ) {
				$files[] = $entry;
			}
		}
		return $files;
	}

	/**
	 * Move a file or directory, as rename() does, through WP_Filesystem_Direct.
	 *
	 * The scans live on local disk, so the direct method is always the right one;
	 * WP_Filesystem() could ask for FTP credentials in a REST request.
	 */
	private function move_path( string $from, string $to, bool $overwrite = true ): bool {
		require_once ABSPATH . 'wp-admin/includes/class-wp-filesystem-base.php';
		require_once ABSPATH . 'wp-admin/includes/class-wp-filesystem-direct.php';
		return ( new \WP_Filesystem_Direct( null ) )->move( $from, $to, $overwrite );
	}

	private function rotate_backups( string $file ): void {
		for ( $n = 3; $n > 1; $n-- ) {
			$src = "{$file}.bak" . ( $n - 1 );
			if ( is_file( $src ) ) $this->move_path( $src, "{$file}.bak{$n}" );
		}
		if ( is_file( $file ) ) copy( $file, "{$file}.bak1" );
	}

	/** Re-indexes one page file's current on-disk content as a single doc. */
	private function reindex_one_page( string $file ): \WP_Error|null {
		$result = $this->meili_client_and_index();
		if ( is_wp_error( $result ) ) return $result;
		[ $client, $index ] = $result;
		$doc = self::build_source_document( new \SplFileInfo( $file ), $this->scan_root(), $this->scan_base_url() );
		if ( $doc === null ) return null;
		$task = $index->addDocuments( [ $doc ] );
		$client->waitForTask( $task['taskUid'], 30000 );
		return null;
	}

	private function build_tree( string $dir, string $root ): array {
		$rel      = ltrim( str_replace( $root, '', $dir ), '/' );
		$name     = basename( $dir );
		$children = [];
		$is_leaf  = false;

		foreach ( scandir( $dir ) as $entry ) {
			if ( $entry[0] === '.' || strtolower( $entry ) === 'verwijderd' || is_link( $dir . '/' . $entry ) ) continue;
			$full = $dir . '/' . $entry;
			if ( is_dir( $full ) ) {
				$children[] = $this->build_tree( $full, $root );
			} elseif ( self::is_indexable_source( $entry, $rel ) ) {
				$is_leaf = true;
			}
		}

		return [ 'name' => $name, 'path' => $rel, 'leaf' => $is_leaf, 'children' => $children ];
	}

	public function get_tree(): \WP_REST_Response {
		$root = $this->scan_root();
		if ( ! is_dir( $root ) ) {
			return new \WP_REST_Response( [ 'name' => 'scans', 'path' => '', 'leaf' => false, 'children' => [] ] );
		}
		$tree = $this->build_tree( $root, $root );
		$tree['name'] = 'scans';
		return new \WP_REST_Response( $tree );
	}

	public function move_node( \WP_REST_Request $req ): \WP_REST_Response|\WP_Error {
		$from_abs = $this->safe_path( $req['from'] );
		$to_rel   = (string) $req['to'];
		$root     = realpath( $this->scan_root() );

		if ( ! $from_abs || ! $root || $from_abs === $root || ! is_dir( $from_abs ) ) return new \WP_Error( 'invalid', 'Invalid folder', [ 'status' => 400 ] );

		$to_abs = $this->destination_path( $to_rel );
		if ( ! $to_abs || $to_abs === $from_abs || str_starts_with( $to_abs, $from_abs . '/' ) ) return new \WP_Error( 'invalid', 'Invalid destination', [ 'status' => 400 ] );
		$to_dir = dirname( $to_abs );

		if ( ! is_dir( $to_dir ) && ! wp_mkdir_p( $to_dir ) ) return new \WP_Error( 'mkdir', 'Create failed', [ 'status' => 500 ] );
		if ( $this->destination_path( $to_rel ) === false ) return new \WP_Error( 'invalid', 'Invalid destination', [ 'status' => 400 ] );
		if ( file_exists( $to_abs ) ) return new \WP_Error( 'exists', 'Destination exists', [ 'status' => 409 ] );

		if ( ! $this->move_path( $from_abs, $to_abs, false ) ) return new \WP_Error( 'rename', 'Move failed', [ 'status' => 500 ] );

		return new \WP_REST_Response( [ 'ok' => true ] );
	}

	public function make_dir( \WP_REST_Request $req ): \WP_REST_Response|\WP_Error {
		$abs = $this->destination_path( (string) $req['path'] );
		if ( ! $abs ) return new \WP_Error( 'invalid', 'Invalid path', [ 'status' => 400 ] );
		if ( ! wp_mkdir_p( $abs ) ) return new \WP_Error( 'mkdir', 'Create failed', [ 'status' => 500 ] );

		return new \WP_REST_Response( [ 'ok' => true ] );
	}

	public function reindex_scans(): \WP_REST_Response|\WP_Error {
		$root = realpath( $this->scan_root() );
		if ( ! $root ) return new \WP_Error( 'no_root', 'Scans directory not found', [ 'status' => 404 ] );

		$result = $this->meili_client_and_index();
		if ( is_wp_error( $result ) ) return $result;
		[ $client, $index,, $s ] = $result;
		$base_url = $this->scan_base_url();

		try {

			// 'text' must stay filterable: the "Woorddelen" option filters on
			// text CONTAINS …, and this call replaces the whole list.
			$index->updateFilterableAttributes( [ 'collection', 'page_number', 'type', 'text', 'tags' ] );

			$docs = [];
			$it   = self::scan_iterator( $root );

			foreach ( $it as $file ) {
				if ( strtolower( $file->getExtension() ) === 'xlsx' ) {
					foreach ( XlsxIndexer::from_file( $file, $root, $base_url ) as $document ) {
						$docs[ $document['id'] ] = $document;
					}
					continue;
				}
				$document = self::build_source_document( $file, $root, $base_url );
				if ( $document === null ) continue;

				$id      = $document['id'];
				$src_ext = $file->getExtension();

				// A page_N.txt and page_N.md in the same folder share this id.
				// Prefer the .md — it's the deliberately-authored transcript —
				// over the .txt, regardless of which one the directory
				// iterator happens to visit last.
				if ( isset( $docs[ $id ] ) && $docs[ $id ]['text_format'] === 'md' && $src_ext !== 'md' ) continue;

				$docs[ $id ] = $document;
			}

			$docs = array_values( $docs );

			if ( $docs ) {
				$task = $index->addDocuments( $docs );
				$client->waitForTask( $task['taskUid'], 60000 );
			}

			// This index also holds 'photo' and 'find' docs from a separate
			// indexer, so only scan docs no longer found on disk (a page
			// deleted or a whole collection moved/removed) are candidates
			// for pruning — otherwise a scan doc from before this reindex
			// run would never get dropped when its source file goes away.
			$current_ids = array_column( $docs, 'id' );
			$existing_ids = [];
			$offset = 0;
			do {
				$page = $index->getDocuments(
					( new DocumentsQuery() )
						->setFilter( [ 'type = scan OR type = spreadsheet' ] )
						->setFields( [ 'id' ] )
						->setLimit( 1000 )
						->setOffset( $offset )
				);
				foreach ( $page->getResults() as $doc ) $existing_ids[] = $doc['id'];
				$offset += 1000;
			} while ( $offset < $page->getTotal() );

			$stale_ids = array_values( array_diff( $existing_ids, $current_ids ) );
			if ( $stale_ids ) {
				$del_task = $index->deleteDocuments( $stale_ids );
				$client->waitForTask( $del_task['taskUid'], 60000 );
			}

			return new \WP_REST_Response( [ 'indexed' => count( $docs ), 'pruned' => count( $stale_ids ) ] );

		} catch ( \Exception $e ) {
			return self::meili_error( 'reindex_scans', $e->getMessage(), 'Herindexeren van scans mislukt.' );
		}
	}

	/**
	 * Saves an edit made through the lightbox's Edit button: writes the new
	 * text straight to the page's file on disk (so it survives the next
	 * reindex_scans() run, unlike an edit that only touched Meilisearch)
	 * with a rotating .bak1-3 backup, then upserts just that one document.
	 */
	public function edit_scan_page( \WP_REST_Request $req ): \WP_REST_Response|\WP_Error {
		$collection  = (string) $req->get_param( 'collection' );
		$page_number = (int) $req->get_param( 'page_number' );
		$text        = (string) $req->get_param( 'text' );

		if ( trim( $text ) === '' ) return new \WP_Error( 'empty', 'Tekst mag niet leeg zijn', [ 'status' => 400 ] );
		if ( strlen( $text ) > self::MAX_SCAN_TEXT_BYTES ) return new \WP_Error( 'too_large', 'Tekst is te groot', [ 'status' => 413 ] );

		$dir = $this->resolve_collection_dir( $collection );
		if ( ! $dir ) return new \WP_Error( 'bad_collection', 'Onbekende collectie', [ 'status' => 404 ] );

		// The page's zero-padding width lives only on disk — never guessed,
		// editing only ever touches a page that already exists there.
		$file = $this->resolve_page_file( $dir, $page_number, 'txt|md' );
		if ( $file === null ) return new \WP_Error( 'no_page', 'Pagina niet gevonden', [ 'status' => 404 ] );

		// Rotating .bak1 (latest) .. .bak3 (oldest), same convention as the
		// local review tool, before overwriting the file.
		$this->rotate_backups( $file );
		file_put_contents( $file, $text );

		$err = $this->reindex_one_page( $file );
		if ( is_wp_error( $err ) ) return $err;

		$doc = self::build_source_document( new \SplFileInfo( $file ), $this->scan_root(), $this->scan_base_url() );
		if ( $doc === null ) return new \WP_Error( 'empty', 'Tekst mag niet leeg zijn', [ 'status' => 400 ] );

		self::audit_log( 'scan_edit', [ 'collection' => $collection, 'page_number' => $page_number, 'bytes' => strlen( $text ) ] );

		return new \WP_REST_Response( [ 'ok' => true, 'text' => $doc['text'], 'text_format' => $doc['text_format'] ] );
	}

	/** Lists .bak1-3 backup versions for a page, newest first. */
	public function scan_history( \WP_REST_Request $req ): \WP_REST_Response|\WP_Error {
		$collection  = (string) $req->get_param( 'collection' );
		$page_number = (int) $req->get_param( 'page_number' );

		$dir = $this->resolve_collection_dir( $collection );
		if ( ! $dir ) return new \WP_Error( 'bad_collection', 'Onbekende collectie', [ 'status' => 404 ] );
		$file = $this->resolve_page_file( $dir, $page_number, 'txt|md' );
		if ( $file === null ) return new \WP_Error( 'no_page', 'Pagina niet gevonden', [ 'status' => 404 ] );

		$versions = [];
		for ( $n = 1; $n <= 3; $n++ ) {
			$bak = "{$file}.bak{$n}";
			$versions[] = [
				'version' => $n,
				'exists'  => is_file( $bak ),
				'mtime'   => is_file( $bak ) ? wp_date( 'Y-m-d H:i:s', filemtime( $bak ) ) : null,
			];
		}
		return new \WP_REST_Response( [ 'versions' => $versions ] );
	}

	/** Returns a backup version's text alongside the current text, for a client-side diff. */
	public function scan_diff( \WP_REST_Request $req ): \WP_REST_Response|\WP_Error {
		$collection  = (string) $req->get_param( 'collection' );
		$page_number = (int) $req->get_param( 'page_number' );
		$version     = (int) $req->get_param( 'version' );

		if ( $version < 1 || $version > 3 ) return new \WP_Error( 'bad_version', 'Ongeldige back-upversie', [ 'status' => 400 ] );

		$dir = $this->resolve_collection_dir( $collection );
		if ( ! $dir ) return new \WP_Error( 'bad_collection', 'Onbekende collectie', [ 'status' => 404 ] );
		$file = $this->resolve_page_file( $dir, $page_number, 'txt|md' );
		if ( $file === null ) return new \WP_Error( 'no_page', 'Pagina niet gevonden', [ 'status' => 404 ] );
		$bak = "{$file}.bak{$version}";
		if ( ! is_file( $bak ) ) return new \WP_Error( 'no_backup', 'Geen back-up gevonden', [ 'status' => 404 ] );

		return new \WP_REST_Response( [
			'old_text' => (string) file_get_contents( $bak ),
			'new_text' => is_file( $file ) ? (string) file_get_contents( $file ) : '',
		] );
	}

	/**
	 * Moves a page's files (all extensions + backups) to a "verwijderd"
	 * subfolder and shifts every later page down by one, mirroring the
	 * local review tool. Earlier deletions in verwijderd/ are never
	 * overwritten, and only this collection is reindexed afterwards: a full
	 * reindex_scans() would also prune scan docs of unrelated collections.
	 */
	public function delete_scan_page( \WP_REST_Request $req ): \WP_REST_Response|\WP_Error {
		$rate_err = self::check_rate_limit( 'delete', self::RATE_LIMIT_DELETE );
		if ( $rate_err !== null ) return $rate_err;

		$collection  = (string) $req->get_param( 'collection' );
		$page_number = (int) $req->get_param( 'page_number' );

		$dir = $this->resolve_collection_dir( $collection );
		if ( ! $dir ) return new \WP_Error( 'bad_collection', 'Onbekende collectie', [ 'status' => 404 ] );
		$file = $this->resolve_page_file( $dir, $page_number, 'txt|md|png|jpe?g' );
		if ( $file === null ) return new \WP_Error( 'no_page', 'Pagina niet gevonden', [ 'status' => 404 ] );
		$label = pathinfo( $file, PATHINFO_FILENAME );
		$width = strlen( (string) $page_number );
		if ( preg_match( '/^page_(\d+)$/', $label, $lm ) === 1 ) $width = strlen( $lm[1] );

		$removed_dir = $dir . '/verwijderd';
		if ( ! is_dir( $removed_dir ) && ! wp_mkdir_p( $removed_dir ) ) {
			return new \WP_Error( 'move_failed', 'Map voor verwijderde pagina\'s kon niet worden gemaakt', [ 'status' => 500 ] );
		}

		$files  = $this->related_page_files( $dir, $label );
		$suffix = self::free_removed_suffix( $removed_dir, $label, $files );
		foreach ( $files as $f ) {
			$dest = "{$removed_dir}/" . self::with_suffix( $f, $label, $suffix );
			// Stop before renumbering: a later page would otherwise be renamed
			// over a file that was never moved away.
			if ( ! $this->move_path( "{$dir}/{$f}", $dest, false ) ) {
				return new \WP_Error( 'move_failed', 'Pagina kon niet naar verwijderd/ worden verplaatst', [ 'status' => 500 ] );
			}
		}

		// Shift every later page down by one, ascending so renames never collide.
		$pages = [];
		foreach ( scandir( $dir ) as $entry ) {
			if ( preg_match( '/^page_(\d+)\.(?:png|jpe?g|txt|md)$/i', $entry, $m ) === 1 && (int) $m[1] > $page_number ) {
				$pages[ (int) $m[1] ] = true;
			}
		}
		$nums = array_keys( $pages );
		sort( $nums );
		foreach ( $nums as $num ) {
			$old_label = 'page_' . str_pad( (string) $num, $width, '0', STR_PAD_LEFT );
			$new_label = 'page_' . str_pad( (string) ( $num - 1 ), $width, '0', STR_PAD_LEFT );
			foreach ( $this->related_page_files( $dir, $old_label ) as $f ) {
				$new_name = $new_label . substr( $f, strlen( $old_label ) );
				$this->move_path( "{$dir}/{$f}", "{$dir}/{$new_name}" );
			}
		}

		$result = $this->reindex_collection( $dir );
		if ( is_wp_error( $result ) ) return $result;

		self::audit_log( 'scan_delete', [ 'collection' => $collection, 'page_number' => $page_number ] );

		return new \WP_REST_Response( [ 'ok' => true ] );
	}

	/**
	 * Returns '' when none of $files exists in $removed_dir yet, else a
	 * "~<timestamp>[-n]" suffix that is free for all of them, so one deleted
	 * page keeps a single shared name and an earlier deletion survives.
	 */
	private static function free_removed_suffix( string $removed_dir, string $label, array $files ): string {
		$base = '~' . gmdate( 'Ymd-His' );
		for ( $n = 0; $n < 100; $n++ ) {
			$suffix = $n === 0 ? '' : ( $n === 1 ? $base : "{$base}-{$n}" );
			$taken  = false;
			foreach ( $files as $f ) {
				if ( file_exists( "{$removed_dir}/" . self::with_suffix( $f, $label, $suffix ) ) ) {
					$taken = true;
					break;
				}
			}
			if ( ! $taken ) return $suffix;
		}
		return $base . '-' . bin2hex( random_bytes( 4 ) );
	}

	/** page_01.png.bak1 + "~x" -> page_01~x.png.bak1 */
	private static function with_suffix( string $file, string $label, string $suffix ): string {
		return $label . $suffix . substr( $file, strlen( $label ) );
	}

	/**
	 * Re-indexes the page and chat documents directly in one collection
	 * folder and removes that collection's scan docs that no longer exist,
	 * without touching any other collection.
	 */
	private function reindex_collection( string $dir ): \WP_Error|null {
		$root = realpath( $this->scan_root() );
		if ( ! $root ) return new \WP_Error( 'no_root', 'Scans directory not found', [ 'status' => 404 ] );
		$result = $this->meili_client_and_index();
		if ( is_wp_error( $result ) ) return $result;
		[ $client, $index ] = $result;

		$base_url   = $this->scan_base_url();
		$collection = ltrim( substr( $dir, strlen( $root ) ), '/' );
		$docs       = [];
		foreach ( scandir( $dir ) as $entry ) {
			$path = "{$dir}/{$entry}";
			if ( ! is_file( $path ) || is_link( $path ) ) continue;
			$doc = self::build_source_document( new \SplFileInfo( $path ), $root, $base_url );
			if ( $doc === null ) continue;
			// Same rule as reindex_scans(): page_N.md wins over page_N.txt.
			if ( isset( $docs[ $doc['id'] ] ) && $docs[ $doc['id'] ]['text_format'] === 'md' && $doc['text_format'] !== 'md' ) continue;
			$docs[ $doc['id'] ] = $doc;
		}

		try {
			if ( $docs ) {
				$task = $index->addDocuments( array_values( $docs ) );
				$client->waitForTask( $task['taskUid'], 60000 );
			}

			$quoted   = '"' . addcslashes( $collection, '"\\' ) . '"';
			$existing = [];
			$offset   = 0;
			do {
				$page = $index->getDocuments(
					( new DocumentsQuery() )
						->setFilter( [ "type = scan AND collection = {$quoted}" ] )
						->setFields( [ 'id' ] )
						->setLimit( 1000 )
						->setOffset( $offset )
				);
				foreach ( $page->getResults() as $doc ) $existing[] = $doc['id'];
				$offset += 1000;
			} while ( $offset < $page->getTotal() );

			$stale = array_values( array_diff( $existing, array_keys( $docs ) ) );
			if ( $stale ) {
				$task = $index->deleteDocuments( $stale );
				$client->waitForTask( $task['taskUid'], 60000 );
			}
		} catch ( \Exception $e ) {
			return self::meili_error( 'reindex_collection', $e->getMessage(), 'Herindexeren van de collectie mislukt.' );
		}
		return null;
	}

	/** Regenerates consolidated_extracted_text.txt from every page's current text. */
	public function consolidate_scan_collection( \WP_REST_Request $req ): \WP_REST_Response|\WP_Error {
		$collection = (string) $req->get_param( 'collection' );
		$dir = $this->resolve_collection_dir( $collection );
		if ( ! $dir ) return new \WP_Error( 'bad_collection', 'Onbekende collectie', [ 'status' => 404 ] );

		$texts = [];
		$labels = [];
		foreach ( scandir( $dir ) as $entry ) {
			if ( preg_match( '/^page_(\d+)\.(png|jpe?g)$/i', $entry, $m ) !== 1 ) continue;
			$labels[ (int) $m[1] ] = pathinfo( $entry, PATHINFO_FILENAME );
		}
		ksort( $labels );
		foreach ( $labels as $label ) {
			$file = $this->resolve_page_file( $dir, (int) preg_replace( '/^page_0*/', '', $label ), 'txt|md' );
			$texts[] = $file !== null ? trim( (string) file_get_contents( $file ) ) : '';
		}
		if ( ! $texts ) return new \WP_Error( 'empty', 'Geen pagina\'s in deze collectie', [ 'status' => 400 ] );

		file_put_contents( "{$dir}/consolidated_extracted_text.txt", implode( "\n\n--- PAGE SEPARATOR ---\n\n", $texts ) );
		self::audit_log( 'scan_consolidate', [ 'collection' => $collection, 'pages' => count( $texts ) ] );
		return new \WP_REST_Response( [ 'ok' => true, 'pages' => count( $texts ) ] );
	}

	/**
	 * Finds/replaces across every page's text file in a collection, with the
	 * same rotating backup as a normal edit, then re-indexes all changed pages
	 * in one Meilisearch batch.
	 */
	public function replace_scan_collection( \WP_REST_Request $req ): \WP_REST_Response|\WP_Error {
		$collection     = (string) $req->get_param( 'collection' );
		$query          = (string) $req->get_param( 'query' );
		$replacement    = (string) $req->get_param( 'replacement' );
		$use_regex      = (bool) $req->get_param( 'regex' );
		$case_sensitive = (bool) $req->get_param( 'case_sensitive' );
		$whole_word     = (bool) $req->get_param( 'whole_word' );

		if ( $query === '' ) return new \WP_Error( 'no_query', 'Zoekterm is verplicht', [ 'status' => 400 ] );
		if ( strlen( $query ) > self::MAX_REPLACE_QUERY_BYTES ) return new \WP_Error( 'query_too_long', 'Zoekterm is te lang', [ 'status' => 400 ] );
		if ( strlen( $replacement ) > self::MAX_REPLACE_VALUE_BYTES ) return new \WP_Error( 'replacement_too_long', 'Vervangende tekst is te lang', [ 'status' => 400 ] );

		$dir = $this->resolve_collection_dir( $collection );
		if ( ! $dir ) return new \WP_Error( 'bad_collection', 'Onbekende collectie', [ 'status' => 404 ] );

		$pattern = $use_regex ? self::escape_regex_delimiter( $query ) : preg_quote( $query, '/' );
		if ( $whole_word ) $pattern = '\b(?:' . $pattern . ')\b';
		$flags = $case_sensitive ? '' : 'i';
		$regex = "/{$pattern}/u{$flags}";

		$prev_limit = ini_set( 'pcre.backtrack_limit', self::REGEX_BACKTRACK_LIMIT );
		$pending    = [];
		$total      = 0;
		try {
			if ( @preg_match( $regex, '' ) === false ) {
				return new \WP_Error( 'bad_regex', 'Ongeldige regex', [ 'status' => 400 ] );
			}

			foreach ( scandir( $dir ) as $entry ) {
				if ( preg_match( '/^page_\d+\.(?:txt|md)$/i', $entry ) !== 1 ) continue;
				$file = "{$dir}/{$entry}";
				if ( is_link( $file ) ) continue;
				$text     = (string) file_get_contents( $file );
				$count    = 0;
				$new_text = @preg_replace_callback( $regex, static fn(): string => $replacement, $text, -1, $count );
				if ( $new_text === null || preg_last_error() !== PREG_NO_ERROR ) {
					return new \WP_Error( 'regex_limit', 'Regex-verwerking afgebroken (patroon te complex)', [ 'status' => 400 ] );
				}
				if ( ! $count ) continue;
				if ( trim( $new_text ) === '' ) {
					return new \WP_Error( 'empty', 'Vervanging zou een lege pagina opleveren', [ 'status' => 400 ] );
				}
				if ( strlen( $new_text ) > self::MAX_SCAN_TEXT_BYTES ) {
					return new \WP_Error( 'too_large', 'Vervanging levert een te grote pagina op', [ 'status' => 413 ] );
				}
				$pending[] = [ 'entry' => $entry, 'file' => $file, 'text' => $new_text, 'count' => $count ];
				$total    += $count;
			}
		} finally {
			if ( $prev_limit !== false ) ini_set( 'pcre.backtrack_limit', $prev_limit );
		}

		$pages_changed = [];
		$docs          = [];
		$root          = $this->scan_root();
		$base_url      = $this->scan_base_url();
		foreach ( $pending as $change ) {
			$this->rotate_backups( $change['file'] );
			file_put_contents( $change['file'], $change['text'] );
			$doc = self::build_source_document( new \SplFileInfo( $change['file'] ), $root, $base_url );
			if ( $doc !== null ) $docs[] = $doc;
			$pages_changed[] = $change['entry'];
		}

		if ( $docs ) {
			$result = $this->meili_client_and_index();
			if ( is_wp_error( $result ) ) return $result;
			[ $client, $index ] = $result;
			try {
				$task = $index->addDocuments( $docs );
				$client->waitForTask( $task['taskUid'], 60000 );
			} catch ( \Exception $e ) {
				return self::meili_error( 'replace_scan_collection', $e->getMessage(), 'Herindexeren na vervangen mislukt.' );
			}
		}

		if ( $pages_changed ) {
			self::audit_log( 'scan_replace', [
				'collection'         => $collection,
				'pages_changed'      => count( $pages_changed ),
				'total_replacements' => $total,
				'regex'              => $use_regex,
			] );
		}

		return new \WP_REST_Response( [ 'ok' => true, 'total_replacements' => $total, 'pages_changed' => $pages_changed ] );
	}

	/**
	 * Re-OCRs one page's scan image via Document AI and returns the text for
	 * review in the edit textarea — it does NOT touch the page's text file
	 * or Meilisearch itself; the user still has to click Save afterwards,
	 * same as any other edit.
	 */
	public function ocr_scan_page( \WP_REST_Request $req ): \WP_REST_Response|\WP_Error {
		$collection  = (string) $req->get_param( 'collection' );
		$page_number = (int) $req->get_param( 'page_number' );
		$engine      = (string) ( $req->get_param( 'engine' ) ?: 'docai' );
		if ( ! in_array( $engine, [ 'docai', 'tesseract' ], true ) ) {
			return new \WP_Error( 'bad_engine', 'Ongeldige OCR-engine', [ 'status' => 400 ] );
		}

		$rate_err = self::check_rate_limit( 'ocr_' . $engine, $engine === 'tesseract' ? self::RATE_LIMIT_TESSERACT : self::RATE_LIMIT_DOCAI );
		if ( $rate_err !== null ) return $rate_err;

		$dir = $this->resolve_collection_dir( $collection );
		if ( ! $dir ) return new \WP_Error( 'bad_collection', 'Onbekende collectie', [ 'status' => 404 ] );

		$image = $this->resolve_page_file( $dir, $page_number, 'png|jpe?g' );
		if ( $image === null ) return new \WP_Error( 'no_image', 'Paginabeeld niet gevonden', [ 'status' => 404 ] );
		$size = filesize( $image );
		if ( $size === false || $size > self::MAX_OCR_IMAGE_BYTES ) {
			return new \WP_Error( 'image_too_large', 'Paginabeeld is te groot voor OCR', [ 'status' => 413 ] );
		}

		$mime = strtolower( (string) pathinfo( $image, PATHINFO_EXTENSION ) ) === 'png' ? 'image/png' : 'image/jpeg';
		$text = $engine === 'tesseract'
			? TesseractClient::ocr_image( (string) file_get_contents( $image ) )
			: DocumentAiClient::ocr_image( (string) file_get_contents( $image ), $mime );
		if ( is_wp_error( $text ) ) return $text;

		self::audit_log( 'scan_ocr', [ 'collection' => $collection, 'page_number' => $page_number, 'engine' => $engine ] );

		return new \WP_REST_Response( [ 'text' => $text ] );
	}

	/**
	 * Crops a page image to a normalized {x,y,w,h} rectangle (fractions of
	 * the full image, 0-1) and OCRs just that region via Document AI's
	 * multi-column line-sorted extraction. Returns the text plus a data-URL
	 * preview of exactly what was sent, for the editor to confirm before
	 * inserting it — never touches the page's text file itself.
	 */
	public function crop_ocr_scan_page( \WP_REST_Request $req ): \WP_REST_Response|\WP_Error {
		$collection  = (string) $req->get_param( 'collection' );
		$page_number = (int) $req->get_param( 'page_number' );
		$crop        = (array) $req->get_param( 'crop' );
		$engine      = (string) ( $req->get_param( 'engine' ) ?: 'docai' );
		if ( ! in_array( $engine, [ 'docai', 'tesseract' ], true ) ) {
			return new \WP_Error( 'bad_engine', 'Ongeldige OCR-engine', [ 'status' => 400 ] );
		}

		$rate_err = self::check_rate_limit( 'ocr_' . $engine, $engine === 'tesseract' ? self::RATE_LIMIT_TESSERACT : self::RATE_LIMIT_DOCAI );
		if ( $rate_err !== null ) return $rate_err;

		$dir = $this->resolve_collection_dir( $collection );
		if ( ! $dir ) return new \WP_Error( 'bad_collection', 'Onbekende collectie', [ 'status' => 404 ] );
		$image_path = $this->resolve_page_file( $dir, $page_number, 'png|jpe?g' );
		if ( $image_path === null ) return new \WP_Error( 'no_image', 'Paginabeeld niet gevonden', [ 'status' => 404 ] );
		$size = filesize( $image_path );
		if ( $size === false || $size > self::MAX_OCR_IMAGE_BYTES ) {
			return new \WP_Error( 'image_too_large', 'Paginabeeld is te groot voor OCR', [ 'status' => 413 ] );
		}

		$x = (float) ( $crop['x'] ?? 0 );
		$y = (float) ( $crop['y'] ?? 0 );
		$w = (float) ( $crop['w'] ?? 0 );
		$h = (float) ( $crop['h'] ?? 0 );
		if ( ! is_finite( $x ) || ! is_finite( $y ) || ! is_finite( $w ) || ! is_finite( $h ) || $w <= 0 || $h <= 0 ) {
			return new \WP_Error( 'bad_crop', 'Ongeldige selectie', [ 'status' => 400 ] );
		}

		$src = @imagecreatefromstring( (string) file_get_contents( $image_path ) );
		if ( ! $src ) return new \WP_Error( 'bad_image', 'Kon paginabeeld niet lezen', [ 'status' => 500 ] );

		$img_w = imagesx( $src );
		$img_h = imagesy( $src );
		$x1 = (int) max( 0, $x * $img_w );
		$y1 = (int) max( 0, $y * $img_h );
		$x2 = (int) min( $img_w, ( $x + $w ) * $img_w );
		$y2 = (int) min( $img_h, ( $y + $h ) * $img_h );
		$crop_w = $x2 - $x1;
		$crop_h = $y2 - $y1;
		if ( $crop_w < 10 || $crop_h < 10 ) {
			imagedestroy( $src );
			return new \WP_Error( 'crop_too_small', 'Selectie is te klein', [ 'status' => 400 ] );
		}

		$cropped = imagecrop( $src, [ 'x' => $x1, 'y' => $y1, 'width' => $crop_w, 'height' => $crop_h ] );
		imagedestroy( $src );
		if ( ! $cropped ) return new \WP_Error( 'crop_failed', 'Uitsnijden mislukt', [ 'status' => 500 ] );

		ob_start();
		imagepng( $cropped );
		$png_bytes = (string) ob_get_clean();
		imagedestroy( $cropped );

		$text = $engine === 'tesseract'
			? TesseractClient::ocr_image( $png_bytes )
			: DocumentAiClient::ocr_image_sorted( $png_bytes, 'image/png' );
		if ( is_wp_error( $text ) ) return $text;

		self::audit_log( 'scan_crop_ocr', [ 'collection' => $collection, 'page_number' => $page_number, 'engine' => $engine ] );

		return new \WP_REST_Response( [
			'text'         => $text,
			'engine'       => $engine,
			'crop_img_url' => 'data:image/png;base64,' . base64_encode( $png_bytes ),
		] );
	}

	public function reindex_content(): \WP_REST_Response|\WP_Error {
		try {
			$count = IndexCommand::reindex_posts();
			return new \WP_REST_Response( [ 'indexed' => $count ] );
		} catch ( \Exception $e ) {
			return self::meili_error( 'reindex_content', $e->getMessage(), 'Herindexeren van pagina\'s mislukt.' );
		}
	}

	private function meili_client_and_index(): array|\WP_Error {
		return self::meili_client_and_index_for( 'media' );
	}

	public function index_stats(): \WP_REST_Response|\WP_Error {
		$meili_url = Settings::server_url();
		$key       = Settings::admin_key();
		if ( ! $meili_url || ! $key ) return new \WP_Error( 'no_config', 'No config', [ 'status' => 400 ] );

		$result = [];
		foreach ( Settings::indexes() as $uid ) {
			$stats = wp_remote_get( "{$meili_url}/indexes/{$uid}/stats", [
				'headers' => [ 'Authorization' => "Bearer {$key}" ],
				'redirection' => 0,
				'timeout' => 10,
			] );
			$s_body = is_wp_error( $stats ) ? [] : ( json_decode( wp_remote_retrieve_body( $stats ), true ) ?? [] );
			$result[] = [
				'uid'        => $uid,
				'docs'       => $s_body['numberOfDocuments'] ?? '?',
				'indexing'   => $s_body['isIndexing'] ?? false,
				'primaryKey' => null,
			];
		}
		return new \WP_REST_Response( $result );
	}

	public function apply_index_settings( \WP_REST_Request $req ): \WP_REST_Response|\WP_Error {
		$meili_url = Settings::server_url();
		$key       = Settings::admin_key();
		if ( ! $meili_url || ! $key ) return new \WP_Error( 'no_config', 'No Meilisearch config', [ 'status' => 400 ] );

		$index      = $req->get_param( 'index' );
		if ( ! Settings::valid_index( $index ) ) return new \WP_Error( 'invalid_index', 'Invalid site index', [ 'status' => 400 ] );
		$settings   = [];

		$settings['typoTolerance'] = [
			'enabled'    => (bool) $req->get_param( 'typo_enabled' ),
			'minWordSizeForTypos' => [
				'oneTypo'  => (int) ( $req->get_param( 'one_typo' ) ?? 5 ),
				'twoTypos' => (int) ( $req->get_param( 'two_typos' ) ?? 9 ),
			],
		];

		$sep_raw = trim( (string) ( $req->get_param( 'separators' ) ?? '' ) );
		if ( $sep_raw ) {
			$chars = array_values( array_unique( preg_split( '/[\s,]+/u', $sep_raw, -1, PREG_SPLIT_NO_EMPTY ) ) );
			if ( $chars ) $settings['separatorTokens'] = $chars;
		}

		$resp = wp_remote_request( "{$meili_url}/indexes/{$index}/settings", [
			'redirection' => 0,
			'method'  => 'PATCH',
			'headers' => [ 'Authorization' => "Bearer {$key}", 'Content-Type' => 'application/json' ],
			'body'    => wp_json_encode( $settings ),
			'timeout' => 15,
		] );
		if ( is_wp_error( $resp ) ) return self::meili_error( 'apply_index_settings', $resp->get_error_message(), 'Meilisearch niet bereikbaar.', 502 );
		$body = json_decode( wp_remote_retrieve_body( $resp ), true );
		return new \WP_REST_Response( $body );
	}

	public function doc_search( \WP_REST_Request $req ): \WP_REST_Response|\WP_Error {
		$meili_url = Settings::server_url();
		$key       = Settings::admin_key();
		if ( ! $meili_url || ! $key ) return new \WP_Error( 'no_config', 'No Meilisearch config', [ 'status' => 400 ] );

		$index = $req->get_param( 'index' );
		if ( ! Settings::valid_index( $index ) ) return new \WP_Error( 'invalid_index', 'Invalid site index', [ 'status' => 400 ] );
		$query = sanitize_text_field( $req->get_param( 'query' ) ?? '' );

		$resp = wp_remote_post( "{$meili_url}/indexes/{$index}/search", [
			'redirection' => 0,
			'headers' => [ 'Authorization' => "Bearer {$key}", 'Content-Type' => 'application/json' ],
			'body'    => wp_json_encode( [ 'q' => $query, 'limit' => 20, 'attributesToRetrieve' => [ 'id', 'text', 'url', 'title', 'collection', 'page_number' ] ] ),
			'timeout' => 15,
		] );
		if ( is_wp_error( $resp ) ) return self::meili_error( 'doc_search', $resp->get_error_message(), 'Meilisearch niet bereikbaar.', 502 );
		$body = json_decode( wp_remote_retrieve_body( $resp ), true );
		return new \WP_REST_Response( $body['hits'] ?? [] );
	}

	public function doc_save( \WP_REST_Request $req ): \WP_REST_Response|\WP_Error {
		$meili_url = Settings::server_url();
		$key       = Settings::admin_key();
		if ( ! $meili_url || ! $key ) return new \WP_Error( 'no_config', 'No Meilisearch config', [ 'status' => 400 ] );

		$index = $req->get_param( 'index' );
		if ( ! Settings::valid_index( $index ) ) return new \WP_Error( 'invalid_index', 'Invalid site index', [ 'status' => 400 ] );
		$id    = sanitize_text_field( $req->get_param( 'id' ) ?? '' );
		$text  = sanitize_textarea_field( $req->get_param( 'text' ) ?? '' );
		if ( ! $id ) return new \WP_Error( 'no_id', 'No document ID', [ 'status' => 400 ] );

		$resp = wp_remote_request( "{$meili_url}/indexes/{$index}/documents", [
			'redirection' => 0,
			'method'  => 'PUT',
			'headers' => [ 'Authorization' => "Bearer {$key}", 'Content-Type' => 'application/json' ],
			'body'    => wp_json_encode( [ [ 'id' => $id, 'text' => $text ] ] ),
			'timeout' => 15,
		] );
		if ( is_wp_error( $resp ) ) return self::meili_error( 'doc_save', $resp->get_error_message(), 'Meilisearch niet bereikbaar.', 502 );
		$body = json_decode( wp_remote_retrieve_body( $resp ), true );
		return new \WP_REST_Response( $body );
	}

	public static function meili_client_and_index_for( string $type ): array|\WP_Error {
		$s         = Settings::get();
		$meili_url = Settings::server_url();
		$key       = Settings::admin_key();
		if ( ! $meili_url || ! $key ) return new \WP_Error( 'no_config', 'Meilisearch admin key not configured', [ 'status' => 400 ] );
		$client = new \Meilisearch\Client( $meili_url, $key );
		$index_name = $type === 'content'
			? Settings::content_index()
			: ( $s['index_prefix'] ?? 'fav' ) . '_media';
		if ( ! Settings::valid_index( $index_name ) ) return new \WP_Error( 'invalid_index', 'Invalid site index', [ 'status' => 400 ] );
		return [ $client, $client->index( $index_name ), $meili_url, $s ];
	}

	/**
	 * Meilisearch document IDs allow only [A-Za-z0-9_-]. Folder/file names
	 * routinely contain accents (José, Café) or spaces, so anything else
	 * gets replaced with an underscore rather than rejecting the whole batch.
	 */
	private static function sanitize_id( string $raw ): string {
		return preg_replace( '/[^A-Za-z0-9_-]/', '_', $raw ) ?? $raw;
	}

	private static function is_indexable_source( string $filename, string $relative_directory ): bool {
		if ( preg_match( '/\.xlsx$/i', $filename ) ) return true;
		if ( preg_match( '/^page_\d+\.(?:png|jpg|txt|md)$/i', $filename ) ) return true;
		// A long conversation gets split across several files by the chat
		// exporter, suffixed "--part-001-of-002" etc. — not to be confused
		// with the page_N.* scans' single trailing "--N" counter.
		return self::is_chat_collection( $relative_directory )
			&& preg_match( '/^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}--\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}(?:--part-\d+-of-\d+)?\.md$/', $filename ) === 1;
	}

	// A bare str_starts_with( $collection, 'chats' ) would also match an
	// unrelated folder like "chats-archive" — require "chats" as its own
	// path segment (either the collection itself, or its first component).
	private static function is_chat_collection( string $collection ): bool {
		$dir = trim( $collection, '/' );
		return $dir === 'chats' || str_starts_with( $dir, 'chats/' );
	}

	private static function collection_tags( string $collection ): array {
		$parts = $collection !== '' ? explode( '/', $collection ) : [];
		return array_map(
			static fn( int $index ): string => implode( '/', array_slice( $parts, 0, $index + 1 ) ),
			array_keys( $parts )
		);
	}

	private static function source_date( string $label, bool $is_chat ): ?string {
		if ( ! $is_chat || preg_match( '/^(\d{4}-\d{2}-\d{2})_(\d{2})-(\d{2})-(\d{2})/', $label, $matches ) !== 1 ) return null;
		return $matches[1] . 'T' . $matches[2] . ':' . $matches[3] . ':' . $matches[4];
	}

	private static function build_source_document( \SplFileInfo $file, string $root, string $base_url ): ?array {
		$src_ext   = strtolower( $file->getExtension() );
		$dir       = $file->getPath();
		$collection = ltrim( str_replace( $root, '', $dir ), '/' );
		if ( self::is_deleted_collection( $collection ) || $file->isLink() ) return null;
		if ( ! self::is_indexable_source( $file->getFilename(), $collection ) || ( $src_ext !== 'txt' && $src_ext !== 'md' ) ) return null;

		$text = trim( (string) file_get_contents( $file->getPathname() ) );
		if ( $text === '' ) return null;

		$label      = $file->getBasename( '.' . $src_ext );
		$is_chat    = self::is_chat_collection( $collection );
		$page       = preg_match( '/^page_(\d+)$/i', $label, $matches ) === 1 ? (int) $matches[1] : null;
		$img_ext    = $is_chat ? null : self::image_extension( $dir, $label );
		$has_image  = $img_ext !== null;
		$asset      = $has_image ? $label . '.' . $img_ext : $file->getFilename();
		// A long chat gets split into several same-titled files ("--part-001-
		// of-002" etc.) — without a suffix they'd be indistinguishable in
		// search results and the lightbox caption/title.
		$title = $is_chat ? basename( $collection ) : $collection;
		if ( $is_chat && preg_match( '/--part-(\d+)-of-(\d+)$/', $label, $part_matches ) === 1 ) {
			$title .= sprintf( ' (deel %d/%d)', (int) $part_matches[1], (int) $part_matches[2] );
		}

		return [
			'id'          => self::sanitize_id( str_replace( '/', '__', $collection ) . '__' . $label ),
			'type'        => 'scan',
			'title'       => $title,
			'collection'  => $collection,
			'page_number' => $page,
			'text'        => $text,
			'text_format' => $src_ext === 'md' ? 'md' : 'text',
			'has_image'   => $has_image,
			'url'         => $base_url . '/' . $collection . '/' . $asset,
			'thumb_url'   => $has_image ? $base_url . '/' . $collection . '/' . $asset : null,
			'tags'        => self::collection_tags( $collection ),
			'date'        => self::source_date( $label, $is_chat ),
		];
	}

	/**
	 * Page images aren't always PNG (Document AI/pdftoppm output is, but
	 * plain photo scans like photo scans are JPG). Detect whichever
	 * extension actually exists next to the page's text file instead of
	 * assuming PNG and producing a 404'ing url/thumb_url. Returns null when
	 * no image exists at all (e.g. a born-digital .md transcript with no
	 * scan) so the caller can fall back to the source file instead.
	 */
	private static function image_extension( string $dir, string $label ): ?string {
		foreach ( [ 'png', 'jpg', 'jpeg' ] as $ext ) {
			if ( file_exists( $dir . '/' . $label . '.' . $ext ) ) {
				return $ext;
			}
		}
		return null;
	}

	/**
	 * Returns a match key: [text_skeleton, [int, int, ...]]
	 * e.g. "Archive-Box-03b" → ["archive-box-b", [3]]
	 *      "Letters-01-05" → ["letters--",   [1, 5]]
	 */
	private static function collection_signature( string $col ): array {
		$leaf    = strtolower( basename( $col ) );
		$numbers = [];
		preg_match_all( '/\d+/', $leaf, $m );
		foreach ( $m[0] as $n ) $numbers[] = (int) $n;
		$skeleton = (string) preg_replace( '/\d+/', '', $leaf );
		return [ $skeleton, $numbers ];
	}

	public function remap_index( \WP_REST_Request $req ): \WP_REST_Response|\WP_Error {
		$root = realpath( $this->scan_root() );
		if ( ! $root ) return new \WP_Error( 'no_root', 'Scans directory not found', [ 'status' => 404 ] );

		$result = $this->meili_client_and_index();
		if ( is_wp_error( $result ) ) return $result;
		[ $client, $index, $meili_url, $s ] = $result;
		$dry_run  = (bool) ( $req['dry_run'] ?? true );
		$base_url = $this->scan_base_url();

		try {
			// 1. Build new structure from server PNGs: normalized_leaf → [collection, page_count]
			$new_cols = [];
			$it = self::scan_iterator( $root );
			foreach ( $it as $file ) {
				if ( $file->getExtension() !== 'png' ) continue;
				if ( ! preg_match( '/^page_\d+\.png$/', $file->getFilename() ) ) continue;
				$col = ltrim( str_replace( $root, '', $file->getPath() ), '/' );
				if ( ! isset( $new_cols[ $col ] ) ) $new_cols[ $col ] = 0;
				$new_cols[ $col ]++;
			}

			// 2. Fetch all existing Meilisearch docs (paginated)
			$old_docs = [];
			$offset   = 0;
			$limit    = 1000;
			$fields   = [ 'id', 'collection', 'page_number', 'text', 'url', 'thumb_url', 'title', 'type', 'tags', 'date' ];
			do {
				$query = ( new \Meilisearch\Contracts\DocumentsQuery() )
					->setLimit( $limit )
					->setOffset( $offset )
					->setFields( $fields );
				$res  = $index->getDocuments( $query );
				$hits = $res->getResults();
				foreach ( $hits as $doc ) {
					$old_docs[ $doc['id'] ] = $doc;
				}
				$offset += $limit;
			} while ( count( $hits ) === $limit );

			// Group old docs by collection
			$old_cols = [];
			foreach ( $old_docs as $doc ) {
				if ( self::is_deleted_collection( (string) $doc['collection'] ) ) continue;
				$old_cols[ $doc['collection'] ][] = $doc;
			}

			// 3. Match new → old by signature (text skeleton + number sequence)
			// Build signature index for old collections
			$old_sig = [];
			foreach ( $old_cols as $old_col => $docs ) {
				[ $skel, $nums ] = self::collection_signature( $old_col );
				$sig_key = $skel . '|' . implode( ',', $nums );
				$old_sig[ $sig_key ][] = [ 'col' => $old_col, 'count' => count( $docs ) ];
			}

			$mappings    = [];
			$unmatched   = [];
			$used        = [];

			foreach ( $new_cols as $new_col => $png_count ) {
				[ $skel, $nums ] = self::collection_signature( $new_col );
				$sig_key  = $skel . '|' . implode( ',', $nums );
				$candidates = $old_sig[ $sig_key ] ?? [];
				// Remove already-used matches
				$candidates = array_filter( $candidates, static fn( $c ) => ! in_array( $c['col'], $used, true ) );

				if ( empty( $candidates ) ) {
					$unmatched[] = [ 'new' => $new_col, 'pages' => $png_count, 'norm' => $sig_key ];
					continue;
				}

				// Pick best candidate: closest page count to PNGs on server
				usort( $candidates, static fn( $a, $b ) => abs( $a['count'] - $png_count ) - abs( $b['count'] - $png_count ) );
				$best    = array_values( $candidates )[0];
				$used[]  = $best['col'];
				$mappings[] = [ 'old' => $best['col'], 'new' => $new_col, 'pages' => $best['count'] ];
			}

			if ( $dry_run ) {
				$unmatched_old = array_values( array_filter(
					array_keys( $old_cols ),
					static fn( $col ) => ! in_array( $col, array_column( $mappings, 'old' ), true )
				) );
				return new \WP_REST_Response( [
					'dry_run'       => true,
					'mappings'      => $mappings,
					'unmatched'     => $unmatched,
					'unmatched_old' => $unmatched_old,
				] );
			}

			// 4. Apply: delete old docs, insert new docs with updated paths
			$inserted  = 0;
			$deleted   = [];
			foreach ( $mappings as $map ) {
				$parts = $map['new'] !== '' ? explode( '/', $map['new'] ) : [];
				$tags  = array_map(
					static fn( $i ) => implode( '/', array_slice( $parts, 0, $i + 1 ) ),
					array_keys( $parts )
				);

				$new_docs = [];
				foreach ( $old_cols[ $map['old'] ] as $doc ) {
					$label      = 'page_' . str_pad( (string) $doc['page_number'], strlen( (string) $map['pages'] ) > 2 ? 3 : 2, '0', STR_PAD_LEFT );
					$new_id     = self::sanitize_id( str_replace( '/', '__', $map['new'] ) . '__' . $label );
					$new_docs[] = array_merge( $doc, [
						'id'         => $new_id,
						'collection' => $map['new'],
						'title'      => $map['new'],
						'tags'       => $tags,
						'url'        => $base_url . '/' . $map['new'] . '/' . $label . '.png',
						'thumb_url'  => $base_url . '/' . $map['new'] . '/' . $label . '.png',
					] );
					$deleted[] = $doc['id'];
				}

				$task = $index->addDocuments( $new_docs );
				$client->waitForTask( $task['taskUid'] );
				$inserted += count( $new_docs );
			}

			if ( $deleted ) {
				$task = $index->deleteDocuments( array_unique( $deleted ) );
				$client->waitForTask( $task['taskUid'] );
			}

			return new \WP_REST_Response( [
				'dry_run'   => false,
				'mapped'    => count( $mappings ),
				'inserted'  => $inserted,
				'deleted'   => count( array_unique( $deleted ) ),
				'unmatched' => $unmatched,
			] );

		} catch ( \Exception $e ) {
			return self::meili_error( 'remap_index', $e->getMessage(), 'Hernoemen van index mislukt.' );
		}
	}

	public function normalize_numbers( \WP_REST_Request $req ): \WP_REST_Response {
		$root     = realpath( $this->scan_root() );
		$dry_run  = (bool) ( $req['dry_run'] ?? true );
		$renamed  = [];

		if ( ! $root ) return new \WP_REST_Response( [ 'renamed' => [], 'dry_run' => $dry_run ] );

		$dirs = [];
		$it   = self::scan_iterator( $root, \RecursiveIteratorIterator::CHILD_FIRST );
		foreach ( $it as $item ) {
			if ( $item->isDir() ) $dirs[] = $item->getPathname();
		}

		foreach ( $dirs as $abs ) {
			$name    = basename( $abs );
			$new     = preg_replace_callback( '/\d+/', static fn( $m ) => str_pad( $m[0], 2, '0', STR_PAD_LEFT ), $name );
			if ( $new === $name ) continue;

			$new_abs = dirname( $abs ) . '/' . $new;
			if ( file_exists( $new_abs ) ) continue;

			$renamed[] = [
				'from' => ltrim( str_replace( $root, '', $abs ), '/' ),
				'to'   => ltrim( str_replace( $root, '', $new_abs ), '/' ),
			];

			if ( ! $dry_run ) $this->move_path( $abs, $new_abs, false );
		}

		return new \WP_REST_Response( [ 'renamed' => $renamed, 'dry_run' => $dry_run ] );
	}
}
