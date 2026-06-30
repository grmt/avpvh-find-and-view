<?php declare( strict_types = 1 );

namespace Avpvh\FindAndView\Queue;

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
		$client->delete( $index, (string) $id );
	}

	private static function sync_post( int $post_id, MeilisearchClient $client ): void {
		$post = get_post( $post_id );
		if ( ! $post ) return;

		$index  = Settings::content_index();
		$item   = PostIndexer::from_post( $post );
		if ( $item === null ) return;

		$client->upsert( $index, $item );
	}

	private static function client(): MeilisearchClient {
		$s = Settings::get();
		return new MeilisearchClient( $s['meili_url'], $s['meili_key'] );
	}
}
