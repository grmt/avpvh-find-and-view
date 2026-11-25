<?php declare( strict_types = 1 );

// Standalone regression tests. WordPress and Meilisearch I/O are simulated;
// filesystem operations use real files and symlinks under a temporary root.
namespace Meilisearch\Contracts {
	class DocumentsQuery {
		public int $offset = 0;
		public int $limit = 1000;
		public function setOffset( int $n ): self { $this->offset = $n; return $this; }
		public function setLimit( int $n ): self { $this->limit = $n; return $this; }
		public function setFields( array $fields ): self { return $this; }
		public array $filter = [];
		public function setFilter( array $filter ): self { $this->filter = $filter; return $this; }
	}
}
namespace Meilisearch {
	class Client {
		public static array $indexes = [];
		public function __construct( string $url, string $key ) {}
		public function index( string $name ): \FakeIndex { return self::$indexes[$name] ??= new \FakeIndex(); }
		public function waitForTask( mixed ...$args ): void {}
	}
}
namespace Smalot\PdfParser {
	class Parser {
		public function parseFile( string $path ): object {
			return new class {
				public function getText(): string { return 'Published member PDF fixture with enough searchable text.'; }
			};
		}
	}
}
namespace {
	use Avpvh\FindAndView\Access\ScanEditPermission;
	use Avpvh\FindAndView\Access\SearchProxy;
	use Avpvh\FindAndView\Admin\SettingsPage;
	use Avpvh\FindAndView\Admin\TreeController;
	use Avpvh\FindAndView\CLI\IndexCommand;
	use Avpvh\FindAndView\Index\PdfIndexer;
	use Avpvh\FindAndView\Index\PostIndexer;
	use Avpvh\FindAndView\Index\XlsxIndexer;
	use Avpvh\FindAndView\Ocr\TesseractClient;
	use Avpvh\FindAndView\Queue\SyncHandler;
	use Avpvh\FindAndView\Queue\SyncQueue;
	use Avpvh\FindAndView\Settings;
	use Avpvh\FindAndView\Shortcode\EcliShortcode;
	use Avpvh\FindAndView\Shortcode\FindAndViewShortcode;
	use Avpvh\FindAndView\Storage\LocalProvider;
	use Avpvh\FindAndView\Storage\StorageLocation;

	class WP_Error {
		public function __construct( public string $code, public string $message, public array $data = [] ) {}
		public function get_error_message(): string { return $this->message; }
	}
	class WP_REST_Request extends ArrayObject {
		public function get_param( string $key ): mixed { return $this[$key] ?? null; }
		public function get_json_params(): array { return $this->getArrayCopy(); }
		public function get_body(): string { return json_encode( $this->getArrayCopy() ); }
	}
	class WP_REST_Response {
		public function __construct( public mixed $data, public int $status = 200, public array $headers = [] ) {}
	}
	class WP_Post {
		public int $ID = 1;
		public string $post_status = 'publish';
		public string $post_password = '';
		public string $post_type = 'page';
		public string $post_mime_type = 'application/pdf';
		public string $post_title = 'Public page';
		public string $post_content = '<p>Public content long enough to be indexed in search.</p>';
	}
	class WP_Filesystem_Direct {
		public function __construct( mixed $args ) {}
		public function move( string $from, string $to, bool $overwrite ): bool { return rename( $from, $to ); }
	}
	class AVPVH_Directory {
		public static array $groups = ['boek'];
		public static function get_user_groups( string $uid ): array { return self::$groups; }
		public static function cached_user_groups( string $uid ): array { return self::$groups; }
	}
	class FakeIndex {
		public array $docs = [];
		public int $add_calls = 0;
		public function updateFilterableAttributes( array $args ): void {}
		public function updateSettings( array $args ): void {}
		public function addDocuments( array $docs ): array {
			$this->add_calls++;
			foreach ( $docs as $doc ) $this->docs[$doc['id']] = $doc;
			return ['taskUid' => 1];
		}
		public function deleteDocuments( array $ids ): array {
			foreach ( $ids as $id ) unset( $this->docs[$id] );
			return ['taskUid' => 1];
		}
		public function getDocuments( object $query ): object {
			if ( $GLOBALS['meili_down'] ?? false ) throw new RuntimeException( 'Meilisearch unreachable' );
			$all = array_values( $this->docs );
			// Only the scoped filter is modelled: type = scan AND collection = "…".
			if ( preg_match( '/^type = scan AND collection = "((?:[^"\\\\]|\\\\.)*)"$/', $query->filter[0] ?? '', $m ) === 1 ) {
				$collection = stripcslashes( $m[1] );
				$all = array_values( array_filter( $all, static fn( array $d ): bool => ( $d['type'] ?? '' ) === 'scan' && ( $d['collection'] ?? null ) === $collection ) );
			}
			$docs = array_slice( $all, $query->offset, $query->limit );
			return new class( $docs, count( $all ) ) {
				public function __construct( private array $docs, private int $total ) {}
				public function getResults(): array { return $this->docs; }
				public function getTotal(): int { return $this->total; }
			};
		}
	}

	$options = ['index_prefix' => 'fav', 'meili_url' => 'https://other.invalid', 'meili_key' => 'search-secret', 'meili_admin_key' => 'admin-secret', 'require_login' => true];
	$logged_in = true;
	$is_admin = false;
	$http = [];
	$transients = [];
	$posts = [];
	$attachments = [];
	$nocache = 0;
	$actions = [];
	$queried_post = null;
	$member_status = 'active';
	$attachment_file = false;
	$audit_events = [];
	$http_response = null;
	function add_action( string $hook, callable $callback, int $priority = 10, int $accepted_args = 1 ): void { $GLOBALS['actions'][$hook][$priority][] = $callback; }
	function do_action( string $hook, mixed ...$args ): void { if ( $hook === 'avpvh_fav_audit' ) $GLOBALS['audit_events'][] = $args; }
	function trailingslashit( string $s ): string { return rtrim( $s, '/\\' ) . '/'; }
	function add_shortcode( string $tag, callable $callback ): void {}
	function get_queried_object(): ?WP_Post { return $GLOBALS['queried_post']; }
	function has_shortcode( string $content, string $tag ): bool { return preg_match( '/\[' . preg_quote( $tag, '/' ) . '(?:\s|\])/', $content ) === 1; }
	function wp_parse_args( array $a, array $b ): array { return array_merge( $b, $a ); }
	function wp_parse_url( string $url, int $component = -1 ): mixed { return parse_url( $url, $component ); }
	function get_option( string $name, mixed $fallback = null ): array { return $GLOBALS['options']; }
	function is_wp_error( mixed $value ): bool { return $value instanceof WP_Error; }
	function wp_upload_dir(): array { return ['basedir' => $GLOBALS['tmp'], 'baseurl' => 'https://site.invalid/uploads']; }
	function wp_mkdir_p( string $dir ): bool { return is_dir( $dir ) || mkdir( $dir, 0777, true ); }
	function wp_delete_file( string $file ): bool { return unlink( $file ); }
	function sanitize_text_field( string $value ): string { return strip_tags( $value ); }
	function sanitize_textarea_field( string $value ): string { return strip_tags( $value ); }
	function sanitize_key( string $value ): string { return preg_replace( '/[^a-z0-9_-]/', '', strtolower( $value ) ); }
	function is_user_logged_in(): bool { return $GLOBALS['logged_in']; }
	function current_user_can( string $cap ): bool { return $GLOBALS['is_admin']; }
	function get_current_user_id(): int { return 42; }
	function avpvh_get_member_by_wp_user( int $id ): object { return (object) ['user_id' => 'reader', 'status' => $GLOBALS['member_status']]; }
	function get_attached_file( int $id ): string|false { return $GLOBALS['attachment_file']; }
	function get_transient( string $key ): mixed { return $GLOBALS['transients'][$key] ?? false; }
	function set_transient( string $key, mixed $value, int $ttl ): void { $GLOBALS['transients'][$key] = $value; }
	function wp_create_nonce( string $action ): string { return hash( 'sha256', 'user-42-session:' . $action ); }
	function wp_verify_nonce( string $nonce, string $action ): bool { return hash_equals( wp_create_nonce( $action ), $nonce ); }
	function rest_url( string $path ): string { return 'https://site.invalid/wp-json/' . $path; }
	function home_url(): string { return 'https://site.invalid'; }
	function get_queried_object_id(): int { return 100; }
	function apply_filters( string $name, mixed $value, mixed ...$args ): mixed { return $value; }
	function add_filter( string $hook, callable $callback, int $priority = 10, int $accepted_args = 1 ): void { $GLOBALS['filters'][$hook][] = $callback; }
	function nocache_headers(): void {
		if ( headers_sent() ) throw new RuntimeException( 'Cache headers attempted after output' );
		$GLOBALS['nocache']++;
	}
	function wp_json_encode( mixed $value ): string { return json_encode( $value ); }
	function wp_remote_post( string $url, array $args ): array|WP_Error { return wp_remote_request( $url, $args ); }
	function wp_remote_get( string $url, array $args ): array|WP_Error { return wp_remote_request( $url, $args ); }
	function wp_remote_request( string $url, array $args ): array|WP_Error {
		$GLOBALS['http'][] = [$url, $args];
		if ( $GLOBALS['http_response'] !== null ) return $GLOBALS['http_response'];
		return ['code' => 200, 'body' => json_encode( ['results' => [['hits' => []]], 'hits' => [], 'numberOfDocuments' => 10] )];
	}
	function wp_remote_retrieve_body( array $resp ): string { return $resp['body']; }
	function wp_remote_retrieve_response_code( array $resp ): int { return $resp['code']; }
	function get_posts( array $args ): array {
		if ( $args['post_type'] === 'attachment' ) return $GLOBALS['attachments'][$args['post_parent']] ?? [];
		if ( ( $args['fields'] ?? '' ) === 'ids' && ( $args['has_password'] ?? null ) === true ) {
			return array_keys( array_filter( $GLOBALS['posts'], static fn( WP_Post $p ): bool => $p->post_password !== '' ) );
		}
		$GLOBALS['post_query'] = $args;
		return array_values( array_filter( $GLOBALS['posts'], static fn( WP_Post $p ): bool => $p->post_status === 'publish' && ( ( $args['has_password'] ?? null ) === null || $p->post_password === '' ) ) );
	}
	function get_post( int $id ): ?WP_Post { return $GLOBALS['posts'][$id] ?? null; }
	function get_post_types(): array { return ['post' => 'post', 'page' => 'page', 'attachment' => 'attachment']; }
	function wp_get_post_parent_id( int $id ): int|false { return $GLOBALS['parents'][$id] ?? false; }
	function wp_next_scheduled( string $hook ): int|false { return $GLOBALS['scheduled'][$hook] ?? false; }
	function wp_schedule_single_event( int $time, string $hook, array $args = [] ): bool { $GLOBALS['scheduled'][$hook] = $time; return true; }
	function add_settings_error( string $setting, string $code, string $message ): void { $GLOBALS['settings_errors'][] = $code; }
	function strip_shortcodes( string $s ): string { return $s; }
	function wp_strip_all_tags( string $s ): string { return strip_tags( $s ); }
	function get_object_taxonomies( mixed ...$args ): array { return []; }
	function get_post_type_object( string $type ): ?object { return null; }
	function get_permalink( mixed $post = null ): string { return 'https://site.invalid/page/'; }
	function get_the_post_thumbnail_url( mixed ...$args ): string { return ''; }
	function get_the_date( mixed ...$args ): string { return '2026-11-20'; }
	function __( string $text, string $domain ): string { return $text; }
	function esc_html__( string $text, string $domain ): string { return htmlspecialchars( $text, ENT_QUOTES ); }
	function esc_html_e( string $text, string $domain ): void { echo esc_html__( $text, $domain ); }
	function esc_attr_e( string $text, string $domain ): void { echo esc_html__( $text, $domain ); }
	function esc_attr( string $text ): string { return htmlspecialchars( $text, ENT_QUOTES ); }
	function shortcode_atts( array $defaults, array|string $atts ): array { return array_merge( $defaults, (array) $atts ); }
	function wp_login_url( string $url ): string { return 'https://site.invalid/login'; }
	function esc_url( string $url ): string { return esc_attr( $url ); }

	spl_autoload_register( static function ( string $class ): void {
		$prefix = 'Avpvh\\FindAndView\\';
		if ( str_starts_with( $class, $prefix ) ) require dirname( __DIR__ ) . '/src/php/' . str_replace( '\\', '/', substr( $class, strlen( $prefix ) ) ) . '.php';
	} );
	$checks = 0;
	function check( bool $ok, string $message ): void {
		if ( ! $ok ) throw new RuntimeException( $message );
		$GLOBALS['checks']++;
	}
	function remove_fixture( string $path ): void {
		if ( is_link( $path ) || ! is_dir( $path ) ) { unlink( $path ); return; }
		foreach ( new DirectoryIterator( $path ) as $file ) if ( ! $file->isDot() ) remove_fixture( $file->getPathname() );
		rmdir( $path );
	}
	$tmp = sys_get_temp_dir() . '/fav-checks-' . bin2hex( random_bytes( 6 ) );
	mkdir( $tmp );
	ini_set( 'error_log', "$tmp/error.log" );
	define( 'ABSPATH', $tmp . '/wp/' );
	try {
		require dirname( __DIR__ ) . '/src/php/class-main.php';
		\Avpvh\FindAndView\Main::boot();
		$early_cache_hooks = $actions['template_redirect'][0] ?? [];
		check( count( $early_cache_hooks ) === 1, 'Cache protection hook missing before template output' );
		$protect_cache = $early_cache_hooks[0];
		$options['require_login'] = false;
		$queried_post = new WP_Post();
		$queried_post->post_content = '[avpvh_find_and_view]';
		$protect_cache();
		check( $nocache === 0 && ! defined( 'DONOTCACHEPAGE' ), 'Public search page lost cacheability' );
		$options['require_login'] = true;
		$queried_post->post_content = 'Unrelated public page';
		$protect_cache();
		check( $nocache === 0 && ! defined( 'DONOTCACHEPAGE' ), 'Unrelated page lost cacheability' );
		$queried_post = null;
		$protect_cache();
		check( $nocache === 0, 'Non-post response lost cacheability' );
		$queried_post = new WP_Post();
		foreach ( ['[avpvh_find_and_view show_media="false"]', '[avpvh_ecli_index]'] as $shortcode ) {
			$queried_post->post_content = $shortcode;
			foreach ( [true, false] as $login_state ) {
				$logged_in = $login_state;
				$before = $nocache;
				$protect_cache();
				check( $nocache === $before + 1 && DONOTCACHEPAGE, 'Gated search lacks early no-cache protection' );
			}
		}
		$logged_in = true;
		wp_mkdir_p( ABSPATH . 'wp-admin/includes' );
		foreach ( ['base', 'direct'] as $type ) file_put_contents( ABSPATH . "wp-admin/includes/class-wp-filesystem-{$type}.php", '<?php' );
		foreach ( ['scans/book1/verwijderd/sub2', 'scans/verwijderd/other3', 'outside'] as $dir ) wp_mkdir_p( "$tmp/$dir" );
		file_put_contents( "$tmp/scans/book1/page_01.txt", 'Visible page' );
		file_put_contents( "$tmp/scans/book1/verwijderd/sub2/page_02.txt", 'Deleted private content' );
		file_put_contents( "$tmp/scans/verwijderd/other3/ignored.xlsx", 'must never be parsed' );
		symlink( "$tmp/outside", "$tmp/scans/escape" );
		symlink( "$tmp/missing", "$tmp/scans/dangling" );
		$tree = new TreeController();
		foreach ( ['../escape', 'a/../../escape', '/absolute', 'a//b', 'a/./b', 'a/../b', 'a\\b', "a\0b", '', 'a/', 'escape/new', 'dangling/new'] as $dest ) {
			check( is_wp_error( $tree->move_node( new WP_REST_Request( ['from' => 'book1', 'to' => $dest] ) ) ), "Unsafe move accepted: $dest" );
			check( is_wp_error( $tree->make_dir( new WP_REST_Request( ['path' => $dest] ) ) ), "Unsafe mkdir accepted: $dest" );
		}
		foreach ( ['', '.', 'book1/page_01.txt'] as $from ) check( is_wp_error( $tree->move_node( new WP_REST_Request( ['from' => $from, 'to' => 'new.php'] ) ) ), 'Root or file move accepted' );
		check( is_wp_error( $tree->move_node( new WP_REST_Request( ['from' => 'book1', 'to' => 'book1/nested'] ) ) ), 'Self-descendant move accepted' );
		check( $tree->move_node( new WP_REST_Request( ['from' => 'book1', 'to' => 'parent/book1'] ) ) instanceof WP_REST_Response, 'Valid move failed' );
		check( $tree->make_dir( new WP_REST_Request( ['path' => 'new/deep'] ) ) instanceof WP_REST_Response, 'Valid mkdir failed' );
		check( ! str_contains( json_encode( $tree->get_tree()->data ), 'verwijderd' ), 'Deleted directories in tree' );
		check( ! str_contains( json_encode( $tree->normalize_numbers( new WP_REST_Request() )->data ), 'verwijderd' ), 'Deleted directories normalized' );
		$index = ( new Meilisearch\Client( '', '' ) )->index( Settings::media_index() );
		$index->docs['stale_deleted'] = ['id' => 'stale_deleted', 'type' => 'scan'];
		check( $tree->reindex_scans()->data['indexed'] === 1, 'Deleted pages indexed' );
		check( ! isset( $index->docs['stale_deleted'] ), 'Stale deleted document retained' );
		check( $tree->delete_scan_page( new WP_REST_Request( ['collection' => 'parent/book1', 'page_number' => 1] ) ) instanceof WP_REST_Response, 'Delete failed' );
		check( $index->docs === [], 'Deleted page was immediately reindexed' );

		// Deleting the same page number twice keeps both copies, and only the
		// affected collection is reindexed.
		wp_mkdir_p( "$tmp/scans/book2" );
		foreach ( [1, 2, 3] as $n ) {
			file_put_contents( "$tmp/scans/book2/page_0$n.txt", "Text of page $n" );
			file_put_contents( "$tmp/scans/book2/page_0$n.png", "png $n" );
		}
		file_put_contents( "$tmp/scans/book2/page_01.txt.bak1", 'Older text of page 1' );
		$index->docs['unrelated'] = ['id' => 'unrelated', 'type' => 'scan', 'collection' => 'elsewhere'];
		$index->docs['book2__page_03'] = ['id' => 'book2__page_03', 'type' => 'scan', 'collection' => 'book2'];
		check( $tree->delete_scan_page( new WP_REST_Request( ['collection' => 'book2', 'page_number' => 1] ) ) instanceof WP_REST_Response, 'First delete failed' );
		check( $tree->delete_scan_page( new WP_REST_Request( ['collection' => 'book2', 'page_number' => 1] ) ) instanceof WP_REST_Response, 'Second delete failed' );
		check( file_get_contents( "$tmp/scans/book2/verwijderd/page_01.txt" ) === 'Text of page 1', 'First deleted page lost' );
		check( file_get_contents( "$tmp/scans/book2/verwijderd/page_01.txt.bak1" ) === 'Older text of page 1', 'Backup of deleted page lost' );
		$second = glob( "$tmp/scans/book2/verwijderd/page_01~*" );
		sort( $second );
		check( count( $second ) === 2 && str_ends_with( $second[0], '.png' ) && file_get_contents( $second[1] ) === 'Text of page 2', 'Second deletion overwrote the first' );
		check( file_get_contents( "$tmp/scans/book2/page_01.txt" ) === 'Text of page 3' && ! file_exists( "$tmp/scans/book2/page_02.txt" ), 'Pages not renumbered' );
		check( isset( $index->docs['unrelated'] ), 'Delete pruned another collection' );
		check( ! isset( $index->docs['book2__page_03'] ) && ! isset( $index->docs['book2__page_02'] ), 'Stale page docs kept after delete' );
		check( ( $index->docs['book2__page_01']['text'] ?? '' ) === 'Text of page 3', 'Renumbered page not reindexed' );
		unset( $index->docs['unrelated'] );

		foreach ( ['../keys', 'fav_media/../../keys', 'fav_media?x', 'fav_media#x', 'other_media', 'fav_media%2Fkeys', ['fav_media']] as $bad ) {
			foreach ( ['doc_search', 'doc_save', 'apply_index_settings'] as $method ) check( is_wp_error( $tree->$method( new WP_REST_Request( ['index' => $bad, 'id' => '1', 'text' => 'test'] ) ) ), "Invalid index accepted by $method" );
		}
		check( $http === [], 'Rejected requests reached Meilisearch' );
		$tree->index_stats();
		check( count( $http ) === 3, 'Stats enumerated other tenants' );
		foreach ( $http as [$url, $args] ) {
			check( str_starts_with( $url, 'http://meilisearch:7700/indexes/fav_' ), 'Credential destination came from options' );
			check( $args['redirection'] === 0, 'Credential request follows redirects' );
		}
		check( ( new SettingsPage() )->sanitize( ['meili_admin_key' => ''] )['meili_admin_key'] === 'admin-secret', 'Blank secret erased saved key' );
		check( ( new SettingsPage() )->sanitize( ['docai_processor_id' => 'abc123def456'] )['docai_processor_id'] === 'abc123def456', 'Processor ID not saved' );
		check( ( new SettingsPage() )->sanitize( ['docai_processor_id' => '../x?y'] )['docai_processor_id'] === '', 'Invalid processor ID accepted' );
		check( is_wp_error( $docai = \Avpvh\FindAndView\Ocr\DocumentAiClient::ocr_image( 'x', 'image/png' ) ) && in_array( $docai->code, ['no_key', 'docai_not_configured'], true ), 'Unconfigured OCR did not fail cleanly' );

		$post = new WP_Post();
		$post->post_password = '0';
		check( PostIndexer::from_post( $post ) === null, 'Password-protected post indexed' );
		$attachment = new WP_Post(); $attachment->ID = 9;
		check( PdfIndexer::from_attachment( $attachment, $post ) === null, 'Protected parent PDF indexed' );
		$post->post_password = ''; $post->post_status = 'draft';
		check( PdfIndexer::from_attachment( $attachment, $post ) === null, 'Unpublished parent PDF indexed' );
		$post->post_status = 'publish'; $posts[1] = $post;
		$content = ( new Meilisearch\Client( '', '' ) )->index( Settings::content_index() );
		$content->docs = ['2' => ['id' => '2', 'type' => 'page'], 'pdf_2' => ['id' => 'pdf_2', 'type' => 'page']];
		IndexCommand::reindex_posts();
		check( $post_query['has_password'] === false, 'Bulk query includes password posts' );
		check( array_keys( $content->docs ) === [1], 'Bulk reindex failed to prune protected documents' );
		$attachments[1] = [$attachment];
		$content->docs['pdf_9'] = ['id' => 'pdf_9', 'type' => 'page'];
		$post->post_password = 'secret';
		SyncHandler::handle_sync( 'post', 1 );
		check( $content->docs === [], 'Password change did not remove post and PDFs' );

		$options['include_protected_content'] = true;
		$options['require_login'] = false;
		check( ! Settings::includes_protected_content(), 'Protected content enabled without mandatory group' );
		check( Settings::private_search() && ! SearchProxy::can_search(), 'Incomplete protected-content policy fell back to public search' );
		$options['search_group'] = 'boek';
		check( Settings::private_search() && Settings::includes_protected_content(), 'Mandatory group did not force private search' );
		check( PostIndexer::from_post( $post ) !== null, 'Published member blog missing from group-protected index' );
		$attachment_file = "$tmp/member.pdf"; file_put_contents( $attachment_file, 'PDF fixture' );
		check( PdfIndexer::from_attachment( $attachment, $post ) !== null, 'Member PDF missing from group-protected index' );
		$post->post_status = 'draft';
		check( PostIndexer::from_post( $post ) === null && PdfIndexer::from_attachment( $attachment, $post ) === null, 'Draft content entered the member index' );
		$post->post_status = 'publish';
		IndexCommand::reindex_posts();
		check( $post_query['has_password'] === null && isset( $content->docs[1], $content->docs['pdf_9'] ), 'Bulk member reindex excluded published protected content' );
		SyncHandler::handle_sync( 'post', 1 );
		check( isset( $content->docs[1], $content->docs['pdf_9'] ), 'Observer removed allowed member content' );
		$attachment_file = false;
		$options['include_protected_content'] = false;
		$options['search_group'] = '';
		$options['require_login'] = true;
		IndexCommand::reindex_posts();
		check( $content->docs === [], 'Public reindex retained protected content' );

		// Switching member content off updates the index without a full reindex.
		$saved_posts = $posts;
		$open = new WP_Post(); $open->ID = 5;
		$locked = new WP_Post(); $locked->ID = 6; $locked->post_password = 'secret';
		$posts = [5 => $open, 6 => $locked];
		$parents = [15 => 5, 16 => 6];
		$content->docs = ['5' => ['id' => '5'], 'pdf_15' => ['id' => 'pdf_15'], '6' => ['id' => '6'], 'pdf_16' => ['id' => 'pdf_16'], 'ecli_x' => ['id' => 'ecli_x']];
		$allowed = ['search_group' => 'boek', 'include_protected_content' => true];
		$options['search_group'] = 'boek'; $options['include_protected_content'] = true;
		( new SettingsPage() )->on_settings_updated( ['search_group' => 'boek', 'include_protected_content' => false], $allowed );
		check( count( $content->docs ) === 5, 'Allowing protected content purged documents' );
		$options['include_protected_content'] = false;
		( new SettingsPage() )->on_settings_updated( $allowed, ['search_group' => 'boek', 'include_protected_content' => false] );
		check( array_keys( $content->docs ) === [5, 'pdf_15', 'ecli_x'], 'Disabling protected content left protected posts or PDFs indexed' );
		$content->docs['6'] = ['id' => '6'];
		$options['search_group'] = '';
		( new SettingsPage() )->on_settings_updated( $allowed, ['search_group' => '', 'include_protected_content' => true] );
		check( ! isset( $content->docs['6'] ), 'Removing the search group left protected posts indexed' );
		$meili_down = true; $scheduled = []; $settings_errors = [];
		$options['search_group'] = 'boek';
		( new SettingsPage() )->on_settings_updated( $allowed, ['search_group' => 'boek', 'include_protected_content' => false] );
		check( isset( $scheduled[SyncQueue::PURGE_ACTION] ) && $settings_errors === ['fav_purge_retry'], 'Failed purge was not retried or reported' );
		$scheduled = [];
		SyncHandler::handle_purge_protected();
		check( isset( $scheduled[SyncQueue::PURGE_ACTION] ), 'Failed background purge was not rescheduled' );
		$meili_down = false; $options['search_group'] = '';
		$posts = $saved_posts; $parents = [];
		$content->docs = [];

		// The key field: blank keeps the saved key, the checkbox clears it.
		$form = new SettingsPage();
		check( $form->sanitize( ['meili_key' => ''] )['meili_key'] === 'search-secret', 'Blank search key erased saved key' );
		check( $form->sanitize( ['meili_key' => 'new-key'] )['meili_key'] === 'new-key', 'New search key not saved' );
		check( $form->sanitize( ['meili_key' => '', 'meili_key_clear' => '1'] )['meili_key'] === '', 'Search key could not be cleared' );

		( new SearchProxy() )->register();
		$exempt = array_reduce( $GLOBALS['filters']['avpvh_mbrs_2fa_exempt_rest_routes'] ?? [], static fn( mixed $r, callable $f ): mixed => $f( $r ), ['/other/v1/x'] );
		check( $exempt === ['/other/v1/x', '/avpvh-fav/v1/search'], 'Search route not exempted from the 2FA step-up, or other routes dropped' );
		check( ! array_filter( $exempt, static fn( string $r ): bool => str_contains( $r, '/scan' ) ), 'A writing route was exempted from 2FA' );
		$old_scope = SearchProxy::config( [Settings::content_index()] );
		$old_payload = array_merge( $old_scope, ['queries' => [['indexUid' => Settings::content_index()]]] );
		$options['require_login'] = false;
		$options['search_group'] = 'boek';
		$options['include_protected_content'] = true;
		AVPVH_Directory::$groups = []; $transients = [];
		$before_http = count( $http );
		check( ! SearchProxy::can_search() && Settings::login_gate() !== null, 'Logged-in non-book member passed the site-wide gate' );
		check( is_wp_error( SearchProxy::search( new WP_REST_Request( $old_payload ) ) ) && count( $http ) === $before_http, 'Old ungrouped scope bypassed current site policy' );
		check( ! str_contains( ( new FindAndViewShortcode() )->render( [] ), 'fav-wrap' ) && ! str_contains( ( new EcliShortcode() )->render( [] ), 'fav-ecli-wrap' ), 'Non-book member received a search interface' );
		AVPVH_Directory::$groups = ['boek']; $transients = [];
		check( SearchProxy::can_search() && Settings::login_gate() === null, 'Active book member denied search' );
		check( SearchProxy::config( [Settings::content_index()] )['group'] === 'boek', 'Required group depended on shortcode page ID' );
		check( SearchProxy::search( new WP_REST_Request( $old_payload ) ) instanceof WP_REST_Response, 'Authorized book member could not use existing scope' );
		$member_status = 'inactive';
		check( ! SearchProxy::can_search(), 'Inactive book member retained search access' );
		$member_status = 'active';
		$logged_in = false;
		check( Settings::login_gate() !== null && ! SearchProxy::can_search(), 'Anonymous reader could access group-protected search' );
		$logged_in = true;
		$options['search_group'] = '';
		$options['include_protected_content'] = false;
		$options['require_login'] = true;

		$scope = SearchProxy::config( [Settings::content_index()] );
		$payload = array_merge( $scope, ['queries' => [['indexUid' => Settings::content_index(), 'q' => 'test']]] );
		check( SearchProxy::search( new WP_REST_Request( $payload ) ) instanceof WP_REST_Response, 'Valid scoped search failed' );
		check( end( $http )[0] === 'http://meilisearch:7700/multi-search', 'Search credentials sent to option URL' );
		check( end( $http )[1]['headers']['Authorization'] === 'Bearer admin-secret', 'Proxy did not use the site key' );
		$payload['queries'][0]['indexUid'] = Settings::media_index();
		check( is_wp_error( SearchProxy::search( new WP_REST_Request( $payload ) ) ), 'Content-only scope could search media' );
		$payload['indexes'][] = Settings::media_index();
		check( is_wp_error( SearchProxy::search( new WP_REST_Request( $payload ) ) ), 'Tampered scope signature accepted' );
		$payload = array_merge( $scope, ['group' => 'boek', 'scopeNonce' => wp_create_nonce( 'fav_search:fav_content:boek' ), 'queries' => [['indexUid' => Settings::content_index()]]] );
		check( SearchProxy::search( new WP_REST_Request( $payload ) ) instanceof WP_REST_Response, 'Book group search failed' );
		AVPVH_Directory::$groups = []; $transients = [];
		check( is_wp_error( SearchProxy::search( new WP_REST_Request( $payload ) ) ), 'Revoked group retained access after cache expiry' );
		$payload['group'] = '';
		check( is_wp_error( SearchProxy::search( new WP_REST_Request( $payload ) ) ), 'Group requirement removed without a signature' );
		$logged_in = false;
		check( is_wp_error( SearchProxy::search( new WP_REST_Request( $payload ) ) ), 'Logged-out reader retained access' );
		$logged_in = true;
		( new FindAndViewShortcode() )->render( ['show_media' => 'false'] );
		( new EcliShortcode() )->render( [] );
		foreach ( [FindAndViewShortcode::class, EcliShortcode::class] as $class ) {
			$instances = ( new ReflectionProperty( $class, 'instances' ) )->getValue();
			check( ! str_contains( json_encode( $instances ), 'search-secret' ), 'Private shortcode leaked static search key' );
			check( ! str_contains( json_encode( $instances ), 'admin-secret' ), 'Private shortcode leaked admin key' );
		}
		// Login-only search works without a page key.
		$options['meili_key'] = '';
		check( ! str_contains( ( new EcliShortcode() )->render( [] ), 'niet geconfigureerd' ), 'Private search required the page search key' );
		$options['meili_key'] = 'search-secret';
		$config = ( new ReflectionProperty( FindAndViewShortcode::class, 'instances' ) )->getValue()[0];
		check( $config['editNonce'] === '' && $config['canEdit'] === false, 'Read-only reader received edit credentials' );
		check( $config['searchProxy']['indexes'] === ['fav_content'], 'Hidden media included in search scope' );
		check( defined( 'DONOTCACHEPAGE' ) && DONOTCACHEPAGE && $nocache > 0, 'Gated page may be cached' );

		// ScanEditPermission status + short cache.
		AVPVH_Directory::$groups = ['boek']; $transients = []; $member_status = 'active';
		check( ScanEditPermission::check(), 'Active book member denied scan edit' );
		$member_status = 'inactive';
		check( ! ScanEditPermission::check(), 'Inactive book member retained scan edit' );
		$member_status = 'active';
		AVPVH_Directory::$groups = []; $transients = [];
		check( ! ScanEditPermission::check(), 'Revoked book member retained scan edit after cache expiry' );
		AVPVH_Directory::$groups = ['boek']; $transients = [];

		// edit_scan_page: reject empty/oversized/root before mutating disk, audit on valid save.
		wp_mkdir_p( "$tmp/scans/col1" );
		file_put_contents( "$tmp/scans/col1/page_01.txt", 'Original alpha beta text' );
		file_put_contents( "$tmp/scans/col1/page_02.txt", 'Second alpha beta text' );
		$audit_events = [];
		check( is_wp_error( $tree->edit_scan_page( new WP_REST_Request( ['collection' => 'col1', 'page_number' => 1, 'text' => "   \n  "] ) ) ), 'Empty scan edit accepted' );
		check( file_get_contents( "$tmp/scans/col1/page_01.txt" ) === 'Original alpha beta text' && ! file_exists( "$tmp/scans/col1/page_01.txt.bak1" ), 'Rejected empty edit mutated file or backup' );
		check( is_wp_error( $tree->edit_scan_page( new WP_REST_Request( ['collection' => 'col1', 'page_number' => 1, 'text' => str_repeat( 'a', 600000 )] ) ) ), 'Oversized scan edit accepted' );
		check( is_wp_error( $tree->edit_scan_page( new WP_REST_Request( ['collection' => '', 'page_number' => 1, 'text' => 'valid'] ) ) ), 'Root collection edit accepted' );
		check( is_wp_error( $tree->scan_diff( new WP_REST_Request( ['collection' => 'col1', 'page_number' => 1, 'version' => 4] ) ) ), 'Out-of-range backup version accepted' );
		check( $tree->edit_scan_page( new WP_REST_Request( ['collection' => 'col1', 'page_number' => 1, 'text' => 'Updated alpha beta text'] ) ) instanceof WP_REST_Response, 'Valid scan edit failed' );
		check( count( $audit_events ) === 1 && $audit_events[0][0] === 'scan_edit', 'Scan edit was not logged' );

		// replace_scan_collection: delimiter escape, literal $/\ replacement, backtrack limit, single batch upsert.
		$before_adds = $index->add_calls;
		$rep = $tree->replace_scan_collection( new WP_REST_Request( ['collection' => 'col1', 'query' => 'alpha', 'replacement' => '$0 \\1 \\\\$', 'regex' => true] ) );
		check( $rep instanceof WP_REST_Response && $rep->data['total_replacements'] === 2, 'Batch replace failed' );
		check( $index->add_calls === $before_adds + 1, 'Batch replace did not coalesce Meilisearch upserts' );
		check( str_contains( file_get_contents( "$tmp/scans/col1/page_01.txt" ), '$0 \\1 \\\\$' ), 'Backreference was expanded in replacement' );
		file_put_contents( "$tmp/scans/col1/page_01.txt", 'path/with/slash and ' . str_repeat( 'a', 40 ) . '!b' );
		$slash_rep = $tree->replace_scan_collection( new WP_REST_Request( ['collection' => 'col1', 'query' => 'path/with', 'replacement' => 'dir/sub', 'regex' => true] ) );
		check( $slash_rep instanceof WP_REST_Response && str_starts_with( file_get_contents( "$tmp/scans/col1/page_01.txt" ), 'dir/sub/slash' ), 'Slash in regex broke delimiter' );
		$complex = $tree->replace_scan_collection( new WP_REST_Request( ['collection' => 'col1', 'query' => '(?:a|aa)+b', 'replacement' => 'x', 'regex' => true] ) );
		check( is_wp_error( $complex ) && $complex->code === 'regex_limit', 'Complex regex did not stop at backtrack limit' );

		// Links inside a collection are never followed when writing.
		file_put_contents( "$tmp/outside/target.txt", 'outside original' );
		symlink( "$tmp/outside/target.txt", "$tmp/scans/col1/page_03.txt" );
		check( is_wp_error( $tree->edit_scan_page( new WP_REST_Request( ['collection' => 'col1', 'page_number' => 3, 'text' => 'overwrite'] ) ) ), 'Edit followed a linked page file' );
		unlink( "$tmp/scans/col1/page_03.txt" );
		symlink( "$tmp/outside/target.txt", "$tmp/scans/col1/page_02.txt.bak1" );
		check( $tree->edit_scan_page( new WP_REST_Request( ['collection' => 'col1', 'page_number' => 2, 'text' => 'Second edited text'] ) ) instanceof WP_REST_Response, 'Edit with a linked backup failed' );
		check( file_get_contents( "$tmp/outside/target.txt" ) === 'outside original' && ! is_link( "$tmp/scans/col1/page_02.txt.bak1" ), 'Backup rotation wrote through a link' );
		symlink( "$tmp/outside/target.txt", "$tmp/scans/col1/page_02.txt.bak3" );
		check( is_wp_error( $tree->scan_diff( new WP_REST_Request( ['collection' => 'col1', 'page_number' => 2, 'version' => 3] ) ) ), 'Diff read a linked backup' );
		unlink( "$tmp/scans/col1/page_02.txt.bak3" );
		file_put_contents( "$tmp/scans/col1/page_01.png", 'image' );
		symlink( "$tmp/outside/target.txt", "$tmp/scans/col1/consolidated_extracted_text.txt" );
		$consolidated = $tree->consolidate_scan_collection( new WP_REST_Request( ['collection' => 'col1'] ) );
		check( is_wp_error( $consolidated ) && $consolidated->code === 'write_failed' && file_get_contents( "$tmp/outside/target.txt" ) === 'outside original', 'Consolidation wrote through a link' );
		unlink( "$tmp/scans/col1/consolidated_extracted_text.txt" );

		// Bulk operations share one per-user limit.
		$transients = [];
		for ( $i = 0; $i < 20; $i++ ) $tree->consolidate_scan_collection( new WP_REST_Request( ['collection' => 'col1'] ) );
		$bulk = $tree->replace_scan_collection( new WP_REST_Request( ['collection' => 'col1', 'query' => 'nothing-matches'] ) );
		check( is_wp_error( $bulk ) && $bulk->code === 'rate_limited', 'Bulk rate limit did not enforce cap' );
		$transients = [];

		// OCR engine validation, rate limiting, redirection=0, generic upstream errors.
		file_put_contents( "$tmp/scans/col1/page_01.png", base64_decode( 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=' ) );
		check( is_wp_error( $tree->ocr_scan_page( new WP_REST_Request( ['collection' => 'col1', 'page_number' => 1, 'engine' => 'invalid'] ) ) ), 'Invalid OCR engine accepted' );
		$http_response = ['code' => 500, 'body' => json_encode( ['error' => 'internal detail trace'] )];
		$tess_err = TesseractClient::ocr_image( 'bytes' );
		check( is_wp_error( $tess_err ) && ! str_contains( $tess_err->message, 'trace' ), 'Tesseract client exposed upstream error detail' );
		check( end( $http )[1]['redirection'] === 0, 'Tesseract client did not disable redirects' );
		$http_response = ['code' => 200, 'body' => json_encode( ['text' => 'ocr ok'] )];
		$transients = [];
		for ( $i = 0; $i < 60; $i++ ) {
			check( $tree->ocr_scan_page( new WP_REST_Request( ['collection' => 'col1', 'page_number' => 1, 'engine' => 'tesseract'] ) ) instanceof WP_REST_Response, 'OCR rate limit tripped early' );
		}
		$limited = $tree->ocr_scan_page( new WP_REST_Request( ['collection' => 'col1', 'page_number' => 1, 'engine' => 'tesseract'] ) );
		check( is_wp_error( $limited ) && $limited->code === 'rate_limited', 'OCR rate limit did not enforce cap' );
		$http_response = null;

		// Generic error hiding for wp_remote_* errors.
		$http_response = new WP_Error( 'http_request_failed', 'cURL error 7: Failed to connect to internal.host port 7700' );
		$doc_err = $tree->doc_search( new WP_REST_Request( ['index' => 'fav_media', 'query' => 'x'] ) );
		check( is_wp_error( $doc_err ) && ! str_contains( $doc_err->message, 'internal.host' ), 'doc_search exposed internal network error' );
		$http_response = null;

		// XlsxIndexer size limits & External rels guard.
		if ( class_exists( ZipArchive::class ) ) {
			$oversized = "$tmp/oversized.xlsx";
			$z = new ZipArchive();
			$z->open( $oversized, ZipArchive::CREATE | ZipArchive::OVERWRITE );
			$z->addFromString( 'xl/workbook.xml', '<?xml version="1.0"?><workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="S1" r:id="rId1"/></sheets></workbook>' );
			$z->addFromString( 'xl/_rels/workbook.xml.rels', '<?xml version="1.0"?><Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>' );
			$z->addFromString( 'xl/worksheets/sheet1.xml', str_repeat( ' ', 17000000 ) );
			$z->close();
			$size_blocked = false;
			try { XlsxIndexer::from_file( new SplFileInfo( $oversized ), $tmp, 'https://site.invalid/uploads/scans' ); } catch ( RuntimeException $e ) { $size_blocked = true; }
			check( $size_blocked, 'XlsxIndexer accepted oversized uncompressed XML entry' );

			$ext_xlsx = "$tmp/ext.xlsx";
			$z = new ZipArchive();
			$z->open( $ext_xlsx, ZipArchive::CREATE | ZipArchive::OVERWRITE );
			$z->addFromString( 'xl/workbook.xml', '<?xml version="1.0"?><workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Bad" r:id="rId1"/></sheets></workbook>' );
			$z->addFromString( 'xl/_rels/workbook.xml.rels', '<?xml version="1.0"?><Relationships><Relationship Id="rId1" Target="../outside.xml" TargetMode="External"/></Relationships>' );
			$z->close();
			check( XlsxIndexer::from_file( new SplFileInfo( $ext_xlsx ), $tmp, 'https://site.invalid/uploads/scans' ) === [], 'XlsxIndexer followed external/traversal sheet target' );
		}

		// LocalProvider path confinement.
		$lp = new LocalProvider( 'fav' );
		$src_file = "$tmp/src.txt";
		file_put_contents( $src_file, 'hello' );
		$stored = $lp->store( $src_file, 'album/sub', 'photo.txt' );
		check( is_file( "$tmp/fav/album/sub/photo.txt" ), 'LocalProvider valid store failed' );
		$lp_blocked = 0;
		foreach ( [['../escape', 'a.txt'], ['album', '../a.txt'], ['album', 'a/b.txt']] as [$c, $f] ) {
			try { $lp->store( $src_file, $c, $f ); } catch ( InvalidArgumentException ) { $lp_blocked++; }
		}
		check( $lp_blocked === 3, 'LocalProvider allowed traversal on store' );
		$del_blocked = false;
		try { $lp->delete( new StorageLocation( 'local', 'fav/../src.txt' ) ); } catch ( InvalidArgumentException ) { $del_blocked = true; }
		check( $del_blocked && is_file( $src_file ), 'LocalProvider allowed traversal on delete' );
		$lp->delete( $stored );
		check( ! file_exists( "$tmp/fav/album/sub/photo.txt" ), 'LocalProvider valid delete failed' );

		// Exercise actual late rendering, with PHP's real headers_sent() state.
		echo 'PASS: ';
		check( headers_sent(), 'Late-render test did not send output' );
		$before = $nocache;
		Settings::login_gate();
		( new FindAndViewShortcode() )->render( [] );
		( new EcliShortcode() )->render( [] );
		check( $nocache === $before && DONOTCACHEPAGE, 'Late shortcode rendering tried to send HTTP headers' );
		echo "$checks regression checks\n";
	} finally {
		remove_fixture( $tmp );
	}
}
