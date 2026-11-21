<?php declare( strict_types = 1 );

namespace Avpvh\FindAndView;

use Avpvh\FindAndView\Admin\SettingsPage;
use Avpvh\FindAndView\Access\SearchProxy;
use Avpvh\FindAndView\Admin\TreeController;
use Avpvh\FindAndView\CLI\EcliIndexCommand;
use Avpvh\FindAndView\CLI\IndexCommand;
use Avpvh\FindAndView\Observer\PostObserver;
use Avpvh\FindAndView\Queue\SyncQueue;
use Avpvh\FindAndView\Shortcode\EcliShortcode;
use Avpvh\FindAndView\Shortcode\FindAndViewShortcode;

final class Main {
	public static function init( string $plugin_file ): void {
		add_action( 'init', [ self::class, 'boot' ] );
		add_filter(
			'plugin_action_links_' . plugin_basename( $plugin_file ),
			static fn( array $links ) => array_merge(
				[ 'settings' => '<a href="' . admin_url( 'options-general.php?page=avpvh-find-and-view' ) . '">' . __( 'Settings', 'default' ) . '</a>' ],
				$links
			)
		);
	}

	public static function boot(): void {
		SyncQueue::register_handlers();
		add_action( 'template_redirect', [ Settings::class, 'protect_search_page_cache' ], 0 );

		$s          = Settings::get();
		$post_types = $s['post_types'];

		( new PostObserver( $post_types ) )->register();
		( new FindAndViewShortcode() )->register();
		( new EcliShortcode() )->register();
		( new SettingsPage() )->register();
		( new TreeController() )->register();
		( new SearchProxy() )->register();

		IndexCommand::register();
		EcliIndexCommand::register();
	}
}
