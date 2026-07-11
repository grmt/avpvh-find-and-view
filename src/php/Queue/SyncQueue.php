<?php declare( strict_types = 1 );

namespace Avpvh\FindAndView\Queue;

final class SyncQueue {
	const SYNC_ACTION   = 'fav_queue_sync';
	const DELETE_ACTION = 'fav_queue_delete';
	const DEBOUNCE      = 5;

	// Uses WP-Cron rather than Action Scheduler: the latter is only present
	// when some other active plugin happens to bundle it, which left sync
	// silently disabled on sites without such a plugin (function_exists()
	// guard was a no-op there). WP-Cron is core, so it's always available.
	public static function schedule_sync( string $type, int|string $id ): void {
		$args = [ $type, $id ];
		wp_clear_scheduled_hook( self::SYNC_ACTION, $args );
		wp_clear_scheduled_hook( self::DELETE_ACTION, $args );
		wp_schedule_single_event( time() + self::DEBOUNCE, self::SYNC_ACTION, $args );
	}

	public static function schedule_delete( string $type, int|string $id ): void {
		$args = [ $type, $id ];
		wp_clear_scheduled_hook( self::SYNC_ACTION, $args );
		wp_clear_scheduled_hook( self::DELETE_ACTION, $args );
		wp_schedule_single_event( time(), self::DELETE_ACTION, $args );
	}

	public static function register_handlers(): void {
		add_action( self::SYNC_ACTION,   [ SyncHandler::class, 'handle_sync'   ], 10, 2 );
		add_action( self::DELETE_ACTION, [ SyncHandler::class, 'handle_delete' ], 10, 2 );
	}
}
