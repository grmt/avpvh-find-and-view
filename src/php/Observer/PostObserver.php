<?php declare( strict_types = 1 );

namespace Avpvh\FindAndView\Observer;

use Avpvh\FindAndView\Queue\SyncQueue;

final class PostObserver {
	/** @param list<string> $post_types */
	public function __construct( private readonly array $post_types ) {}

	public function register(): void {
		add_action( 'save_post',   [ $this, 'on_save'   ], 10, 2 );
		add_action( 'delete_post', [ $this, 'on_delete' ] );

		// A PDF uploaded into (or removed from) a post doesn't fire save_post
		// on the post itself, so its own doc would otherwise only refresh the
		// next time the post is resaved — re-sync the parent right away.
		add_action( 'add_attachment',    [ $this, 'on_attachment_change' ] );
		add_action( 'edit_attachment',   [ $this, 'on_attachment_change' ] );
		add_action( 'delete_attachment', [ $this, 'on_attachment_delete' ] );
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

	public function on_attachment_change( int $attachment_id ): void {
		$parent = $this->pdf_attachment_parent( $attachment_id );
		if ( $parent ) SyncQueue::schedule_sync( 'post', $parent->ID );
	}

	public function on_attachment_delete( int $attachment_id ): void {
		$attachment = get_post( $attachment_id );
		if ( $attachment?->post_mime_type !== 'application/pdf' ) return;
		SyncQueue::schedule_delete( 'pdf', $attachment_id );
	}

	private function pdf_attachment_parent( int $attachment_id ): ?\WP_Post {
		$attachment = get_post( $attachment_id );
		if ( ! $attachment || $attachment->post_mime_type !== 'application/pdf' || ! $attachment->post_parent ) return null;
		$parent = get_post( $attachment->post_parent );
		if ( ! $parent || ! in_array( $parent->post_type, $this->post_types, true ) ) return null;
		return $parent;
	}
}
