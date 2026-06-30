<?php declare( strict_types = 1 );

namespace Avpvh\FindAndView;

use Avpvh\FindAndView\Admin\SettingsPage;
use Avpvh\FindAndView\CLI\IndexCommand;
use Avpvh\FindAndView\Observer\PostObserver;
use Avpvh\FindAndView\Queue\SyncQueue;
use Avpvh\FindAndView\Shortcode\FindAndViewShortcode;

final class Main {
	public static function init( string $plugin_file ): void {
		add_action( 'init', [ self::class, 'boot' ] );
	}

	public static function boot(): void {
		SyncQueue::register_handlers();

		$s          = Settings::get();
		$post_types = $s['post_types'];

		( new PostObserver( $post_types ) )->register();
		( new FindAndViewShortcode() )->register();
		( new SettingsPage() )->register();

		IndexCommand::register();
	}
}
