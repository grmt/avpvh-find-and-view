<?php declare( strict_types = 1 );

namespace Avpvh\FindAndView\Admin;

use Avpvh\FindAndView\CLI\IndexCommand;
use Avpvh\FindAndView\Index\XlsxIndexer;
use Avpvh\FindAndView\Ocr\DocumentAiClient;
use Avpvh\FindAndView\Settings;
use Meilisearch\Contracts\DocumentsQuery;

final class TreeController {

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
				'from' => [ 'required' => true, 'type' => 'string', 'sanitize_callback' => 'sanitize_text_field' ],
				'to'   => [ 'required' => true, 'type' => 'string', 'sanitize_callback' => 'sanitize_text_field' ],
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
			'permission_callback' => fn() => current_user_can( 'edit_posts' ),
			'args'                => [
				'collection'  => [ 'required' => true, 'type' => 'string', 'sanitize_callback' => 'sanitize_text_field' ],
				'page_number' => [ 'required' => true, 'type' => 'integer' ],
				'text'        => [ 'required' => true, 'type' => 'string' ],
			],
		] );
		register_rest_route( 'avpvh-fav/v1', '/scan/ocr', [
			'methods'             => 'POST',
			'callback'            => [ $this, 'ocr_scan_page' ],
			'permission_callback' => fn() => current_user_can( 'edit_posts' ),
			'args'                => [
				'collection'  => [ 'required' => true, 'type' => 'string', 'sanitize_callback' => 'sanitize_text_field' ],
				'page_number' => [ 'required' => true, 'type' => 'integer' ],
			],
		] );
		register_rest_route( 'avpvh-fav/v1', '/scan/history', [
			'methods'             => 'POST',
			'callback'            => [ $this, 'scan_history' ],
			'permission_callback' => fn() => current_user_can( 'edit_posts' ),
			'args'                => [
				'collection'  => [ 'required' => true, 'type' => 'string', 'sanitize_callback' => 'sanitize_text_field' ],
				'page_number' => [ 'required' => true, 'type' => 'integer' ],
			],
		] );
		register_rest_route( 'avpvh-fav/v1', '/scan/diff', [
			'methods'             => 'POST',
			'callback'            => [ $this, 'scan_diff' ],
			'permission_callback' => fn() => current_user_can( 'edit_posts' ),
			'args'                => [
				'collection'  => [ 'required' => true, 'type' => 'string', 'sanitize_callback' => 'sanitize_text_field' ],
				'page_number' => [ 'required' => true, 'type' => 'integer' ],
				'version'     => [ 'required' => true, 'type' => 'integer' ],
			],
		] );
		register_rest_route( 'avpvh-fav/v1', '/scan/delete', [
			'methods'             => 'POST',
			'callback'            => [ $this, 'delete_scan_page' ],
			'permission_callback' => fn() => current_user_can( 'edit_posts' ),
			'args'                => [
				'collection'  => [ 'required' => true, 'type' => 'string', 'sanitize_callback' => 'sanitize_text_field' ],
				'page_number' => [ 'required' => true, 'type' => 'integer' ],
			],
		] );
		register_rest_route( 'avpvh-fav/v1', '/scan/consolidate', [
			'methods'             => 'POST',
			'callback'            => [ $this, 'consolidate_scan_collection' ],
			'permission_callback' => fn() => current_user_can( 'edit_posts' ),
			'args'                => [
				'collection' => [ 'required' => true, 'type' => 'string', 'sanitize_callback' => 'sanitize_text_field' ],
			],
		] );
		register_rest_route( 'avpvh-fav/v1', '/scan/replace', [
			'methods'             => 'POST',
			'callback'            => [ $this, 'replace_scan_collection' ],
			'permission_callback' => fn() => current_user_can( 'edit_posts' ),
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
				'path' => [ 'required' => true, 'type' => 'string', 'sanitize_callback' => 'sanitize_text_field' ],
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

	private function safe_path( string $rel ): string|false {
		$root = realpath( $this->scan_root() );
		if ( ! $root ) return false;
		$abs  = realpath( $root . '/' . $rel );
		if ( ! $abs || ! str_starts_with( $abs, $root ) ) return false;
		return $abs;
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

	private function rotate_backups( string $file ): void {
		for ( $n = 3; $n > 1; $n-- ) {
			$src = "{$file}.bak" . ( $n - 1 );
			if ( is_file( $src ) ) rename( $src, "{$file}.bak{$n}" );
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
			if ( $entry[0] === '.' ) continue;
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
		$to_rel   = trim( $req['to'], '/' );
		$root     = realpath( $this->scan_root() );

		if ( ! $from_abs || ! $root ) return new \WP_Error( 'invalid', 'Invalid path', [ 'status' => 400 ] );

		$to_abs = realpath( $root ) . '/' . $to_rel;
		if ( ! str_starts_with( $to_abs, $root . '/' ) ) return new \WP_Error( 'invalid', 'Invalid destination', [ 'status' => 400 ] );
		$to_dir = dirname( $to_abs );

		if ( ! is_dir( $to_dir ) ) wp_mkdir_p( $to_dir );
		if ( file_exists( $to_abs ) ) return new \WP_Error( 'exists', 'Destination exists', [ 'status' => 409 ] );

		if ( ! rename( $from_abs, $to_abs ) ) return new \WP_Error( 'rename', 'Move failed', [ 'status' => 500 ] );

		return new \WP_REST_Response( [ 'ok' => true ] );
	}

	public function make_dir( \WP_REST_Request $req ): \WP_REST_Response|\WP_Error {
		$root    = realpath( $this->scan_root() );
		$rel     = trim( $req['path'], '/' );
		$abs     = $root . '/' . $rel;

		if ( ! $root ) return new \WP_Error( 'invalid', 'Invalid root', [ 'status' => 400 ] );
		if ( ! str_starts_with( $abs, $root ) ) return new \WP_Error( 'invalid', 'Invalid path', [ 'status' => 400 ] );
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

			$index->updateFilterableAttributes( [ 'collection', 'page_number', 'type', 'tags' ] );

			$docs = [];
			$it   = new \RecursiveIteratorIterator(
				new \RecursiveDirectoryIterator( $root, \FilesystemIterator::SKIP_DOTS )
			);

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
			return new \WP_Error( 'meili_error', $e->getMessage(), [ 'status' => 500 ] );
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

		$dir = $this->safe_path( $collection );
		if ( ! $dir || ! is_dir( $dir ) ) return new \WP_Error( 'bad_collection', 'Onbekende collectie', [ 'status' => 404 ] );

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

		return new \WP_REST_Response( [ 'ok' => true, 'text' => $doc['text'], 'text_format' => $doc['text_format'] ] );
	}

	/** Lists .bak1-3 backup versions for a page, newest first. */
	public function scan_history( \WP_REST_Request $req ): \WP_REST_Response|\WP_Error {
		$collection  = (string) $req->get_param( 'collection' );
		$page_number = (int) $req->get_param( 'page_number' );

		$dir = $this->safe_path( $collection );
		if ( ! $dir || ! is_dir( $dir ) ) return new \WP_Error( 'bad_collection', 'Onbekende collectie', [ 'status' => 404 ] );
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

		$dir = $this->safe_path( $collection );
		if ( ! $dir || ! is_dir( $dir ) ) return new \WP_Error( 'bad_collection', 'Onbekende collectie', [ 'status' => 404 ] );
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
	 * local review tool. Reindexes the whole collection afterwards via the
	 * existing, already-proven reindex_scans() rather than hand-rolling
	 * renumbered Meilisearch upserts.
	 */
	public function delete_scan_page( \WP_REST_Request $req ): \WP_REST_Response|\WP_Error {
		$collection  = (string) $req->get_param( 'collection' );
		$page_number = (int) $req->get_param( 'page_number' );

		$dir = $this->safe_path( $collection );
		if ( ! $dir || ! is_dir( $dir ) ) return new \WP_Error( 'bad_collection', 'Onbekende collectie', [ 'status' => 404 ] );
		$file = $this->resolve_page_file( $dir, $page_number, 'txt|md|png|jpe?g' );
		if ( $file === null ) return new \WP_Error( 'no_page', 'Pagina niet gevonden', [ 'status' => 404 ] );
		$label = pathinfo( $file, PATHINFO_FILENAME );
		$width = strlen( (string) $page_number );
		if ( preg_match( '/^page_(\d+)$/', $label, $lm ) === 1 ) $width = strlen( $lm[1] );

		$removed_dir = $dir . '/verwijderd';
		if ( ! is_dir( $removed_dir ) ) mkdir( $removed_dir );

		foreach ( $this->related_page_files( $dir, $label ) as $f ) {
			$dest = "{$removed_dir}/{$f}";
			if ( is_file( $dest ) ) unlink( $dest );
			rename( "{$dir}/{$f}", $dest );
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
				rename( "{$dir}/{$f}", "{$dir}/{$new_name}" );
			}
		}

		$result = $this->reindex_scans();
		if ( is_wp_error( $result ) ) return $result;

		return new \WP_REST_Response( [ 'ok' => true ] );
	}

	/** Regenerates consolidated_extracted_text.txt from every page's current text. */
	public function consolidate_scan_collection( \WP_REST_Request $req ): \WP_REST_Response|\WP_Error {
		$collection = (string) $req->get_param( 'collection' );
		$dir = $this->safe_path( $collection );
		if ( ! $dir || ! is_dir( $dir ) ) return new \WP_Error( 'bad_collection', 'Onbekende collectie', [ 'status' => 404 ] );

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
		return new \WP_REST_Response( [ 'ok' => true, 'pages' => count( $texts ) ] );
	}

	/**
	 * Finds/replaces across every page's text file in a collection, with the
	 * same rotating backup as a normal edit, then re-indexes each changed
	 * page individually (filenames/numbering never change here).
	 */
	public function replace_scan_collection( \WP_REST_Request $req ): \WP_REST_Response|\WP_Error {
		$collection     = (string) $req->get_param( 'collection' );
		$query          = (string) $req->get_param( 'query' );
		$replacement    = (string) $req->get_param( 'replacement' );
		$use_regex      = (bool) $req->get_param( 'regex' );
		$case_sensitive = (bool) $req->get_param( 'case_sensitive' );
		$whole_word     = (bool) $req->get_param( 'whole_word' );

		if ( $query === '' ) return new \WP_Error( 'no_query', 'Zoekterm is verplicht', [ 'status' => 400 ] );

		$dir = $this->safe_path( $collection );
		if ( ! $dir || ! is_dir( $dir ) ) return new \WP_Error( 'bad_collection', 'Onbekende collectie', [ 'status' => 404 ] );

		$pattern = $use_regex ? $query : preg_quote( $query, '/' );
		if ( $whole_word ) $pattern = '\b(?:' . $pattern . ')\b';
		$flags = $case_sensitive ? '' : 'i';
		$regex = "/{$pattern}/u{$flags}";
		if ( @preg_match( $regex, '' ) === false ) return new \WP_Error( 'bad_regex', 'Ongeldige regex', [ 'status' => 400 ] );

		$total = 0;
		$pages_changed = [];
		foreach ( scandir( $dir ) as $entry ) {
			if ( preg_match( '/^page_\d+\.(?:txt|md)$/i', $entry ) !== 1 ) continue;
			$file = "{$dir}/{$entry}";
			$text = (string) file_get_contents( $file );
			$new_text = preg_replace( $regex, str_replace( '$', '\$', $replacement ), $text, -1, $count );
			if ( ! $count ) continue;

			$this->rotate_backups( $file );
			file_put_contents( $file, $new_text );
			$err = $this->reindex_one_page( $file );
			if ( is_wp_error( $err ) ) return $err;

			$total += $count;
			$pages_changed[] = $entry;
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

		$dir = $this->safe_path( $collection );
		if ( ! $dir || ! is_dir( $dir ) ) return new \WP_Error( 'bad_collection', 'Onbekende collectie', [ 'status' => 404 ] );

		$image = $this->resolve_page_file( $dir, $page_number, 'png|jpe?g' );
		if ( $image === null ) return new \WP_Error( 'no_image', 'Paginabeeld niet gevonden', [ 'status' => 404 ] );

		$mime = strtolower( (string) pathinfo( $image, PATHINFO_EXTENSION ) ) === 'png' ? 'image/png' : 'image/jpeg';
		$text = DocumentAiClient::ocr_image( (string) file_get_contents( $image ), $mime );
		if ( is_wp_error( $text ) ) return $text;

		return new \WP_REST_Response( [ 'text' => $text ] );
	}

	public function reindex_content(): \WP_REST_Response|\WP_Error {
		try {
			$count = IndexCommand::reindex_posts();
			return new \WP_REST_Response( [ 'indexed' => $count ] );
		} catch ( \Exception $e ) {
			return new \WP_Error( 'meili_error', $e->getMessage(), [ 'status' => 500 ] );
		}
	}

	private function meili_client_and_index(): array|\WP_Error {
		return self::meili_client_and_index_for( 'media' );
	}

	public function index_stats(): \WP_REST_Response|\WP_Error {
		$s         = Settings::get();
		$meili_url = $s['meili_url'] ?? '';
		$key_file  = '/run/secrets/meilisearch_master_key';
		$key       = is_readable( $key_file ) ? trim( (string) file_get_contents( $key_file ) ) : (string) ( $s['meili_admin_key'] ?? '' );
		if ( ! $meili_url || ! $key ) return new \WP_Error( 'no_config', 'No config', [ 'status' => 400 ] );

		$resp = wp_remote_get( "{$meili_url}/indexes?limit=50", [
			'headers' => [ 'Authorization' => "Bearer {$key}" ],
			'timeout' => 10,
		] );
		if ( is_wp_error( $resp ) ) return $resp;
		$indexes = json_decode( wp_remote_retrieve_body( $resp ), true )['results'] ?? [];

		$result = [];
		foreach ( $indexes as $idx ) {
			$uid   = $idx['uid'];
			$stats = wp_remote_get( "{$meili_url}/indexes/{$uid}/stats", [
				'headers' => [ 'Authorization' => "Bearer {$key}" ],
				'timeout' => 10,
			] );
			$s_body = is_wp_error( $stats ) ? [] : ( json_decode( wp_remote_retrieve_body( $stats ), true ) ?? [] );
			$result[] = [
				'uid'        => $uid,
				'docs'       => $s_body['numberOfDocuments'] ?? '?',
				'indexing'   => $s_body['isIndexing'] ?? false,
				'primaryKey' => $idx['primaryKey'] ?? null,
			];
		}
		return new \WP_REST_Response( $result );
	}

	public function apply_index_settings( \WP_REST_Request $req ): \WP_REST_Response|\WP_Error {
		$s         = Settings::get();
		$meili_url = $s['meili_url'] ?? '';
		$key_file  = '/run/secrets/meilisearch_master_key';
		$key       = is_readable( $key_file ) ? trim( (string) file_get_contents( $key_file ) ) : (string) ( $s['meili_admin_key'] ?? '' );
		if ( ! $meili_url || ! $key ) return new \WP_Error( 'no_config', 'No Meilisearch config', [ 'status' => 400 ] );

		$index      = sanitize_text_field( $req->get_param( 'index' ) ?? '' );
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
			'method'  => 'PATCH',
			'headers' => [ 'Authorization' => "Bearer {$key}", 'Content-Type' => 'application/json' ],
			'body'    => wp_json_encode( $settings ),
			'timeout' => 15,
		] );
		if ( is_wp_error( $resp ) ) return $resp;
		$body = json_decode( wp_remote_retrieve_body( $resp ), true );
		return new \WP_REST_Response( $body );
	}

	public function doc_search( \WP_REST_Request $req ): \WP_REST_Response|\WP_Error {
		$s         = Settings::get();
		$meili_url = $s['meili_url'] ?? '';
		$key_file  = '/run/secrets/meilisearch_master_key';
		$key       = is_readable( $key_file ) ? trim( (string) file_get_contents( $key_file ) ) : (string) ( $s['meili_admin_key'] ?? '' );
		if ( ! $meili_url || ! $key ) return new \WP_Error( 'no_config', 'No Meilisearch config', [ 'status' => 400 ] );

		$index = sanitize_text_field( $req->get_param( 'index' ) ?? '' );
		$query = sanitize_text_field( $req->get_param( 'query' ) ?? '' );

		$resp = wp_remote_post( "{$meili_url}/indexes/{$index}/search", [
			'headers' => [ 'Authorization' => "Bearer {$key}", 'Content-Type' => 'application/json' ],
			'body'    => wp_json_encode( [ 'q' => $query, 'limit' => 20, 'attributesToRetrieve' => [ 'id', 'text', 'url', 'title', 'collection', 'page_number' ] ] ),
			'timeout' => 15,
		] );
		if ( is_wp_error( $resp ) ) return $resp;
		$body = json_decode( wp_remote_retrieve_body( $resp ), true );
		return new \WP_REST_Response( $body['hits'] ?? [] );
	}

	public function doc_save( \WP_REST_Request $req ): \WP_REST_Response|\WP_Error {
		$s         = Settings::get();
		$meili_url = $s['meili_url'] ?? '';
		$key_file  = '/run/secrets/meilisearch_master_key';
		$key       = is_readable( $key_file ) ? trim( (string) file_get_contents( $key_file ) ) : (string) ( $s['meili_admin_key'] ?? '' );
		if ( ! $meili_url || ! $key ) return new \WP_Error( 'no_config', 'No Meilisearch config', [ 'status' => 400 ] );

		$index = sanitize_text_field( $req->get_param( 'index' ) ?? '' );
		$id    = sanitize_text_field( $req->get_param( 'id' ) ?? '' );
		$text  = sanitize_textarea_field( $req->get_param( 'text' ) ?? '' );
		if ( ! $id ) return new \WP_Error( 'no_id', 'No document ID', [ 'status' => 400 ] );

		$resp = wp_remote_request( "{$meili_url}/indexes/{$index}/documents", [
			'method'  => 'PUT',
			'headers' => [ 'Authorization' => "Bearer {$key}", 'Content-Type' => 'application/json' ],
			'body'    => wp_json_encode( [ [ 'id' => $id, 'text' => $text ] ] ),
			'timeout' => 15,
		] );
		if ( is_wp_error( $resp ) ) return $resp;
		$body = json_decode( wp_remote_retrieve_body( $resp ), true );
		return new \WP_REST_Response( $body );
	}

	public static function meili_client_and_index_for( string $type ): array|\WP_Error {
		$s         = Settings::get();
		$meili_url = $s['meili_url'] ?? '';
		$key_file  = '/run/secrets/meilisearch_master_key';
		$key       = is_readable( $key_file )
			? trim( (string) file_get_contents( $key_file ) )
			: (string) ( $s['meili_admin_key'] ?? '' );
		if ( ! $meili_url || ! $key ) return new \WP_Error( 'no_config', 'Meilisearch admin key not configured', [ 'status' => 400 ] );
		$client = new \Meilisearch\Client( $meili_url, $key );
		$index_name = $type === 'content'
			? Settings::content_index()
			: ( $s['index_prefix'] ?? 'fav' ) . '_media';
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
			$it = new \RecursiveIteratorIterator(
				new \RecursiveDirectoryIterator( $root, \FilesystemIterator::SKIP_DOTS )
			);
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
			return new \WP_Error( 'meili_error', $e->getMessage(), [ 'status' => 500 ] );
		}
	}

	public function normalize_numbers( \WP_REST_Request $req ): \WP_REST_Response {
		$root     = realpath( $this->scan_root() );
		$dry_run  = (bool) ( $req['dry_run'] ?? true );
		$renamed  = [];

		if ( ! $root ) return new \WP_REST_Response( [ 'renamed' => [], 'dry_run' => $dry_run ] );

		$dirs = [];
		$it   = new \RecursiveIteratorIterator(
			new \RecursiveDirectoryIterator( $root, \FilesystemIterator::SKIP_DOTS ),
			\RecursiveIteratorIterator::CHILD_FIRST
		);
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

			if ( ! $dry_run ) rename( $abs, $new_abs );
		}

		return new \WP_REST_Response( [ 'renamed' => $renamed, 'dry_run' => $dry_run ] );
	}
}
