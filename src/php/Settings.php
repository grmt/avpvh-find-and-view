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
		] );
	}

	/**
	 * When the site requires login and the visitor is not logged in, the HTML
	 * to show instead of a search shortcode; otherwise null.
	 *
	 * The shortcodes put the Meilisearch search key in the page, and that key
	 * can query every index, so they must not render at all for anonymous
	 * visitors when the documents themselves are members-only.
	 */
	public static function login_gate(): ?string {
		if ( empty( self::get()['require_login'] ) || is_user_logged_in() ) {
			return null;
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
		$key_file = '/run/secrets/meilisearch_master_key';
		if ( is_readable( $key_file ) ) {
			return trim( (string) file_get_contents( $key_file ) );
		}
		return (string) ( self::get()['meili_admin_key'] ?? '' );
	}
}
