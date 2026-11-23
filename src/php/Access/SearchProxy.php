<?php declare( strict_types = 1 );

namespace Avpvh\FindAndView\Access;

use Avpvh\FindAndView\Settings;

/** Session-checked search; no reusable Meilisearch credential reaches a browser. */
final class SearchProxy {
	public function register(): void {
		add_action( 'rest_api_init', static function (): void {
			register_rest_route( 'avpvh-fav/v1', '/search', [
				'methods' => 'POST',
				'permission_callback' => [ self::class, 'can_search' ],
				'callback' => [ self::class, 'search' ],
			] );
		} );
		// Search only reads, although it is a POST. avpvh-members otherwise
		// blocks it for admins whose session has no 2FA.
		add_filter( 'avpvh_mbrs_2fa_exempt_rest_routes', [ self::class, 'exempt_from_2fa_step_up' ] );
	}

	public static function exempt_from_2fa_step_up( mixed $routes ): array {
		$routes = is_array( $routes ) ? $routes : [];
		if ( ! in_array( '/avpvh-fav/v1/search', $routes, true ) ) $routes[] = '/avpvh-fav/v1/search';
		return $routes;
	}

	/** Apply the site policy on every request, including old signed scopes. */
	public static function can_search(): bool {
		if ( ! is_user_logged_in() ) return false;
		$group = Settings::search_group();
		if ( $group === '' && ! empty( Settings::get()['include_protected_content'] ) ) return false;
		return $group === '' || self::in_group( $group );
	}

	public static function config( array $indexes ): array {
		$indexes = array_values( array_unique( array_filter( $indexes, [ Settings::class, 'valid_index' ] ) ) );
		// Mirror the existing document-search page's directory-group gate.
		$group = Settings::search_group();
		if ( $group === '' && class_exists( \AVPVH_Nav_Auth::class ) && get_queried_object_id() === \AVPVH_Nav_Auth::DOC_SEARCH_PAGE_ID ) $group = 'boek';
		$group = (string) apply_filters( 'avpvh_fav_search_group', $group, $indexes );
		return [
			'url' => rest_url( 'avpvh-fav/v1/search' ),
			'nonce' => wp_create_nonce( 'wp_rest' ),
			'indexes' => $indexes,
			'group' => $group,
			'scopeNonce' => wp_create_nonce( 'fav_search:' . implode( ',', $indexes ) . ':' . $group ),
		];
	}

	public static function search( \WP_REST_Request $req ): \WP_REST_Response|\WP_Error {
		nocache_headers();
		if ( ! is_user_logged_in() ) return new \WP_Error( 'forbidden', 'Login required', [ 'status' => 401 ] );
		if ( ! self::can_search() ) return new \WP_Error( 'forbidden', 'Search access denied', [ 'status' => 403 ] );
		if ( strlen( $req->get_body() ) > 131072 ) return new \WP_Error( 'too_large', 'Search request too large', [ 'status' => 413 ] );
		$data = $req->get_json_params();
		$scope = $data['indexes'] ?? null;
		if ( ! is_array( $scope ) || ! array_is_list( $scope ) || ! $scope || count( $scope ) > 3 ) return self::invalid();
		foreach ( $scope as $index ) if ( ! Settings::valid_index( $index ) ) return self::invalid();
		$group = $data['group'] ?? '';
		if ( ! is_string( $group ) || ( $group !== '' && preg_match( '/^[a-z0-9_-]+$/D', $group ) !== 1 ) ) return self::invalid();
		if ( ! is_string( $data['scopeNonce'] ?? null ) || ! wp_verify_nonce( $data['scopeNonce'], 'fav_search:' . implode( ',', $scope ) . ':' . $group ) ) {
			return new \WP_Error( 'forbidden', 'Invalid search scope', [ 'status' => 403 ] );
		}
		if ( $group !== '' && ! self::in_group( $group ) ) return new \WP_Error( 'forbidden', 'Search access revoked', [ 'status' => 403 ] );
		$queries = $data['queries'] ?? null;
		if ( ! is_array( $queries ) || ! array_is_list( $queries ) || ! $queries || count( $queries ) > 10 ) return self::invalid();
		$allowed = array_flip( [ 'indexUid', 'q', 'filter', 'facets', 'offset', 'limit', 'page', 'hitsPerPage', 'sort',
			'attributesToRetrieve', 'attributesToCrop', 'cropLength', 'cropMarker', 'attributesToHighlight',
			'highlightPreTag', 'highlightPostTag', 'showMatchesPosition', 'matchingStrategy', 'attributesToSearchOn' ] );
		foreach ( $queries as &$query ) {
			if ( ! is_array( $query ) || ! in_array( $query['indexUid'] ?? null, $scope, true ) ) return self::invalid();
			$query = array_intersect_key( $query, $allowed );
			foreach ( [ 'limit', 'offset', 'page', 'hitsPerPage', 'cropLength' ] as $field ) {
				if ( isset( $query[ $field ] ) && ( ! is_int( $query[ $field ] ) || $query[ $field ] < 0 || $query[ $field ] > 5000 ) ) return self::invalid();
			}
			if ( ! isset( $query['limit'] ) && ! isset( $query['hitsPerPage'] ) ) $query['limit'] = 20;
		}
		unset( $query );
		$key = (string) Settings::get()['meili_key'];
		if ( $key === '' ) return new \WP_Error( 'no_config', 'Search unavailable', [ 'status' => 503 ] );
		$resp = wp_remote_post( Settings::server_url() . '/multi-search', [
			'headers' => [ 'Authorization' => 'Bearer ' . $key, 'Content-Type' => 'application/json' ],
			'body' => wp_json_encode( [ 'queries' => $queries ] ),
			'timeout' => 15,
			'redirection' => 0,
			'limit_response_size' => 16777216,
		] );
		if ( is_wp_error( $resp ) || wp_remote_retrieve_response_code( $resp ) !== 200 ) {
			return new \WP_Error( 'search_unavailable', 'Search unavailable', [ 'status' => 502 ] );
		}
		return new \WP_REST_Response( json_decode( wp_remote_retrieve_body( $resp ), true ), 200, [ 'Cache-Control' => 'private, no-store' ] );
	}

	private static function invalid(): \WP_Error {
		return new \WP_Error( 'invalid_search', 'Invalid search request', [ 'status' => 400 ] );
	}

	private static function in_group( string $group ): bool {
		if ( preg_match( '/^[a-z0-9_-]+$/D', $group ) !== 1 ) return false;
		if ( current_user_can( 'manage_options' ) ) return true;
		if ( ! function_exists( 'avpvh_get_member_by_wp_user' ) || ! class_exists( \AVPVH_Directory::class ) ) return false;
		$member = avpvh_get_member_by_wp_user( get_current_user_id() );
		if ( ! is_object( $member ) || empty( $member->user_id ) || ( isset( $member->status ) && $member->status !== 'active' ) ) return false;
		// The directory's normal cache lasts 15 minutes. Use a separate one
		// minute cache here so revocation also takes effect in already open tabs.
		$cache_key = 'fav_search_groups_' . hash( 'sha256', (string) $member->user_id );
		$groups = get_transient( $cache_key );
		if ( ! is_array( $groups ) ) {
			$groups = \AVPVH_Directory::get_user_groups( (string) $member->user_id );
			if ( is_wp_error( $groups ) ) return false;
			set_transient( $cache_key, $groups, 60 );
		}
		return in_array( $group, array_map( 'strtolower', $groups ), true );
	}
}
