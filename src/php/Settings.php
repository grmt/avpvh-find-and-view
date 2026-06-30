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
		] );
	}

	public static function content_index(): string {
		return self::get()['index_prefix'] . '_content';
	}

	public static function media_index(): string {
		return self::get()['index_prefix'] . '_media';
	}
}
