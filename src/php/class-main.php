<?php declare( strict_types = 1 );

namespace Avpvh\FindAndView;

use Avpvh\FindAndView\Observer\PostObserver;
use Avpvh\FindAndView\Queue\SyncQueue;

final class Main {
	public static function init( string $plugin_file ): void {
		add_action( 'init', [ self::class, 'boot' ] );
	}

	public static function boot(): void {
		SyncQueue::register_handlers();

		$settings   = get_option( 'fav_settings', [] );
		$post_types = $settings['post_types'] ?? [ 'post', 'page' ];

		( new PostObserver( $post_types ) )->register();

		// TODO: register shortcode, admin UI, CLI commands
	}
}
