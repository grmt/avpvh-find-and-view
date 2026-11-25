<?php declare( strict_types = 1 );

namespace Avpvh\FindAndView\Queue;

use Avpvh\FindAndView\CLI\IndexCommand;
use Avpvh\FindAndView\Index\PdfIndexer;
use Avpvh\FindAndView\Index\PostIndexer;
use Avpvh\FindAndView\Index\MeilisearchClient;
use Avpvh\FindAndView\Settings;

final class SyncHandler {
	public static function handle_sync( string $type, int|string $id ): void {
		$client = self::client();
		match ( $type ) {
			'post' => self::sync_post( (int) $id, $client ),
			default => null,
		};
	}

	public static function handle_delete( string $type, int|string $id ): void {
		$client = self::client();
		$index  = Settings::content_index();
		match ( $type ) {
			// A PDF attachment's own doc id is prefixed (see PdfIndexer) —
			// deleting it directly here doesn't wait for its parent post to
			// resave, unlike the reconciliation in sync_post() below.
			'pdf'   => $client->delete( $index, 'pdf_' . $id ),
			default => $client->delete( $index, (string) $id ),
		};
	}

	/** Keep retrying until protected content is out of the index. */
	public static function handle_purge_protected(): void {
		try {
			IndexCommand::purge_protected();
		} catch ( \Throwable ) {
			SyncQueue::schedule_purge_protected();
		}
	}

	private static function sync_post( int $post_id, MeilisearchClient $client ): void {
		$post = get_post( $post_id );
		if ( ! $post ) return;

		$index = Settings::content_index();
		$item  = PostIndexer::from_post( $post );
		if ( $item === null ) {
			$client->delete( $index, (string) $post_id );
		} else {
			$client->upsert( $index, $item );
		}

		self::sync_attached_pdfs( $post, $client, $index );
	}

	// Reconciles every PDF currently attached to $post against its publish
	// status — re-indexes them while the post is published, removes them the
	// moment it isn't (draft, trash, ...), so an attached PDF never stays
	// publicly searchable after its parent page does.
	private static function sync_attached_pdfs( \WP_Post $post, MeilisearchClient $client, string $index ): void {
		foreach ( PdfIndexer::attachments_of( $post ) as $attachment ) {
			$item = $post->post_status === 'publish' ? PdfIndexer::from_attachment( $attachment, $post ) : null;
			if ( $item ) {
				$client->upsert( $index, $item );
			} else {
				$client->delete( $index, 'pdf_' . $attachment->ID );
			}
		}
	}

	private static function client(): MeilisearchClient {
		$s = Settings::get();
		return new MeilisearchClient( Settings::server_url(), Settings::admin_key() );
	}
}
