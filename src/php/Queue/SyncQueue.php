<?php declare( strict_types = 1 );

namespace Avpvh\FindAndView\Queue;

final class SyncQueue {
	const GROUP        = 'fav';
	const SYNC_ACTION  = 'fav_queue_sync';
	const DELETE_ACTION = 'fav_queue_delete';
	const DEBOUNCE     = 5;

	public static function schedule_sync( string $type, int|string $id ): void {
		if ( ! function_exists( 'as_schedule_single_action' ) ) {
			return;
		}
		$args = [ 'type' => $type, 'id' => $id ];
		as_unschedule_all_actions( self::SYNC_ACTION, $args, self::GROUP );
		as_schedule_single_action( time() + self::DEBOUNCE, self::SYNC_ACTION, $args, self::GROUP );
	}

	public static function schedule_delete( string $type, int|string $id ): void {
		if ( ! function_exists( 'as_enqueue_async_action' ) ) {
			return;
		}
		$args = [ 'type' => $type, 'id' => $id ];
		as_unschedule_all_actions( self::SYNC_ACTION, $args, self::GROUP );
		as_enqueue_async_action( self::DELETE_ACTION, $args, self::GROUP );
	}

	public static function register_handlers(): void {
		add_action( self::SYNC_ACTION,   [ SyncHandler::class, 'handle_sync'   ], 10, 2 );
		add_action( self::DELETE_ACTION, [ SyncHandler::class, 'handle_delete' ], 10, 2 );
	}
}
