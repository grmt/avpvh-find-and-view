<?php declare( strict_types = 1 );

namespace Avpvh\FindAndView\CLI;

use Avpvh\FindAndView\Index\MeilisearchClient;
use Avpvh\FindAndView\Index\PostIndexer;
use Avpvh\FindAndView\Settings;

final class IndexCommand {
	public static function register(): void {
		if ( ! defined( 'WP_CLI' ) || ! WP_CLI ) return;
		\WP_CLI::add_command( 'fav index', [ self::class, 'run' ] );
		\WP_CLI::add_command( 'fav reindex', [ self::class, 'reindex' ] );
	}

	public static function run( array $args, array $assoc ): void {
		$s      = Settings::get();
		$client = new MeilisearchClient( $s['meili_url'], $s['meili_key'] );
		$types  = $assoc['post-type'] ?? implode( ',', $s['post_types'] );
		$types  = array_map( 'trim', explode( ',', $types ) );

		$posts = get_posts( [
			'post_type'      => $types,
			'post_status'    => 'publish',
			'posts_per_page' => -1,
			'suppress_filters' => true,
		] );

		$index = Settings::content_index();
		$bar   = \WP_CLI\Utils\make_progress_bar( 'Indexing', count( $posts ) );

		$batch = [];
		foreach ( $posts as $post ) {
			$item = PostIndexer::from_post( $post );
			if ( $item ) $batch[] = $item;
			if ( count( $batch ) >= 100 ) {
				$client->upsert( $index, ...$batch );
				$batch = [];
			}
			$bar->tick();
		}
		if ( $batch ) $client->upsert( $index, ...$batch );
		$bar->finish();

		\WP_CLI::success( sprintf( 'Indexed %d posts into %s.', count( $posts ), $index ) );
	}

	public static function reindex( array $args, array $assoc ): void {
		$s      = Settings::get();
		$client = new MeilisearchClient( $s['meili_url'], $s['meili_key'] );
		$index  = Settings::content_index();
		$client->delete_all( $index );
		\WP_CLI::log( 'Cleared index ' . $index );
		self::run( $args, $assoc );
	}
}
