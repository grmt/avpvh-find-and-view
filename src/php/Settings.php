<?php declare( strict_types = 1 );

namespace Avpvh\FindAndView;

final class Settings {
	const OPTION = 'fav_settings';

	public static function get(): array {
		return wp_parse_args( get_option( self::OPTION, [] ), [
			'meili_url'     => '',
			'meili_key'     => '',
			'index_prefix'  => 'fav',
			'post_types'    => [ 'post', 'page' ],
			'storage'       => [ 'local' ],
			'require_login' => false,
			'search_group' => '',
			'include_protected_content' => false,
		] );
	}

	public static function search_group(): string {
		$group = self::get()['search_group'];
		return is_string( $group ) ? $group : '__invalid_search_group__';
	}

	public static function private_search(): bool {
		$s = self::get();
		return ! empty( $s['require_login'] ) || self::search_group() !== '' || ! empty( $s['include_protected_content'] );
	}

	/** Explicitly allow member-marked content only behind a mandatory group. */
	public static function includes_protected_content(): bool {
		return self::search_group() !== '' && ! empty( self::get()['include_protected_content'] );
	}

	/** Send private-search cache headers before the theme starts output. */
	public static function protect_search_page_cache(): void {
		if ( ! self::private_search() ) return;
		$post = get_queried_object();
		if ( ! $post instanceof \WP_Post ) return;
		if ( has_shortcode( $post->post_content, 'avpvh_find_and_view' ) || has_shortcode( $post->post_content, 'avpvh_ecli_index' ) ) {
			self::disable_page_cache();
		}
	}

	private static function disable_page_cache(): void {
		if ( ! defined( 'DONOTCACHEPAGE' ) ) define( 'DONOTCACHEPAGE', true );
		// Shortcodes can also run in widgets or templates after output began.
		if ( ! headers_sent() ) nocache_headers();
	}

	/**
	 * When the site requires login and the visitor is not logged in, the HTML
	 * to show instead of a search shortcode; otherwise null.
	 *
	 * Gated shortcodes emit session-bound proxy configuration and must never
	 * render for anonymous visitors or be stored in a shared page cache.
	 */
	public static function login_gate(): ?string {
		if ( self::private_search() ) {
			self::disable_page_cache();
		}
		if ( ! self::private_search() || Access\SearchProxy::can_search() ) {
			return null;
		}
		if ( is_user_logged_in() ) {
			return '<p class="fav-login-required">' . esc_html__( 'Zoeken is alleen beschikbaar voor bevoegde leden.', 'avpvh-find-and-view' ) . '</p>';
		}
		$url = wp_login_url( (string) get_permalink() );
		return '<p class="fav-login-required">'
			. esc_html__( 'Zoeken is alleen beschikbaar voor ingelogde gebruikers.', 'avpvh-find-and-view' )
			. ' <a href="' . esc_url( $url ) . '">' . esc_html__( 'Inloggen', 'avpvh-find-and-view' ) . '</a></p>';
	}

	public static function content_index(): string {
		$s = self::get();
		return ($s['content_index'] ?? '') ?: $s['index_prefix'] . '_content';
	}

	public static function media_index(): string {
		return self::get()['index_prefix'] . '_media';
	}

	public static function ecli_index(): string {
		return self::get()['index_prefix'] . '_ecli';
	}

	public static function admin_key(): string {
		// Each site must receive a scoped key. Never read the shared master key.
		$key_file = '/run/secrets/meilisearch_admin_key';
		if ( is_readable( $key_file ) ) {
			return trim( (string) file_get_contents( $key_file ) );
		}
		return (string) ( self::get()['meili_admin_key'] ?? '' );
	}

	/** Credentials must never be sent to an option-controlled destination. */
	public static function server_url(): string {
		$url = defined( 'AVPVH_FAV_MEILI_SERVER_URL' ) ? (string) AVPVH_FAV_MEILI_SERVER_URL : 'http://meilisearch:7700';
		$parts = parse_url( $url );
		if ( ! $parts || ! in_array( $parts['scheme'] ?? '', [ 'http', 'https' ], true ) || empty( $parts['host'] )
			|| isset( $parts['user'] ) || isset( $parts['pass'] ) || isset( $parts['query'] ) || isset( $parts['fragment'] ) ) {
			throw new \RuntimeException( 'Invalid AVPVH_FAV_MEILI_SERVER_URL' );
		}
		return rtrim( $url, '/' );
	}

	public static function indexes(): array {
		return array_values( array_filter( array_unique( [ self::media_index(), self::content_index(), self::ecli_index() ] ),
			static fn( string $index ): bool => preg_match( '/^[A-Za-z0-9_-]+$/D', $index ) === 1 ) );
	}

	public static function valid_index( mixed $index ): bool {
		return is_string( $index ) && preg_match( '/^[A-Za-z0-9_-]+$/D', $index ) === 1 && in_array( $index, self::indexes(), true );
	}
}
