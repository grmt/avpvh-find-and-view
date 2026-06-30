<?php declare( strict_types = 1 );

namespace Avpvh\FindAndView\Observer;

use Avpvh\FindAndView\Queue\SyncQueue;

final class PostObserver {
	/** @param list<string> $post_types */
	public function __construct( private readonly array $post_types ) {}

	public function register(): void {
		add_action( 'save_post',   [ $this, 'on_save'   ], 10, 2 );
		add_action( 'delete_post', [ $this, 'on_delete' ] );
	}

	public function on_save( int $post_id, \WP_Post $post ): void {
		if ( wp_is_post_revision( $post_id ) ) return;
		if ( ! in_array( $post->post_type, $this->post_types, true ) ) return;
		SyncQueue::schedule_sync( 'post', $post_id );
	}

	public function on_delete( int $post_id ): void {
		$post = get_post( $post_id );
		if ( ! $post || ! in_array( $post->post_type, $this->post_types, true ) ) return;
		SyncQueue::schedule_delete( 'post', $post_id );
	}
}
