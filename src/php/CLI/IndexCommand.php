<?php declare( strict_types = 1 );

namespace Avpvh\FindAndView\CLI;

use Avpvh\FindAndView\Index\MeilisearchClient;
use Avpvh\FindAndView\Index\PdfIndexer;
use Avpvh\FindAndView\Index\PostIndexer;
use Avpvh\FindAndView\Settings;

final class IndexCommand {
	public static function register(): void {
		if ( ! defined( 'WP_CLI' ) || ! WP_CLI ) return;
		\WP_CLI::add_command( 'fav index', [ self::class, 'run' ] );
		\WP_CLI::add_command( 'fav reindex', [ self::class, 'reindex' ] );
	}

	/**
	 * Core reindex logic, shared between the WP-CLI command and the admin
	 * "Reindex WordPress content" REST endpoint. Always uses PostIndexer, so
	 * every entry point produces documents with the same id scheme, content
	 * filtering, and collection field.
	 *
	 * @param ?list<string> $post_types Defaults to the configured post types.
	 */
	public static function reindex_posts( ?array $post_types = null ): int {
		$s      = Settings::get();
		$client = new MeilisearchClient( Settings::server_url(), Settings::admin_key() );
		$types  = $post_types ?? $s['post_types'];

		$posts = get_posts( [
			'post_type'      => $types,
			'post_status'    => 'publish',
			'has_password'   => Settings::includes_protected_content() ? null : false,
			'posts_per_page' => -1,
		] );

		$index = Settings::content_index();

		// The page/post filter tree (search.ts) filters by exact url, so the
		// content index must have it filterable — otherwise Meilisearch rejects
		// any query that includes a url filter.
		$client->ensure_settings( $index, [
			'filterableAttributes' => [ 'url', 'type', 'date' ],
			'sortableAttributes'   => [ 'date' ],
		] );

		$batch = [];
		$current_ids = [];
		foreach ( $posts as $post ) {
			$item = PostIndexer::from_post( $post );
			if ( $item ) { $batch[] = $item; $current_ids[ $item->id ] = true; }

			foreach ( PdfIndexer::attachments_of( $post ) as $attachment ) {
				$pdf_item = PdfIndexer::from_attachment( $attachment, $post );
				if ( $pdf_item ) { $batch[] = $pdf_item; $current_ids[ $pdf_item->id ] = true; }
			}

			if ( count( $batch ) >= 100 ) {
				$client->upsert( $index, ...$batch );
				$batch = [];
			}
		}
		if ( $batch ) $client->upsert( $index, ...$batch );

		// Remove previously indexed protected/unpublished posts and their PDFs.
		$stale = [];
		foreach ( $client->fetch_all_documents( $index, [ 'id', 'type' ] ) as $doc ) {
			if ( in_array( $doc['type'] ?? '', $types, true ) && ! isset( $current_ids[ $doc['id'] ] ) ) $stale[] = (string) $doc['id'];
		}
		foreach ( array_chunk( $stale, 1000 ) as $ids ) $client->delete( $index, ...$ids );

		return count( $posts );
	}

	/**
	 * Remove password-protected posts and their PDFs from the content index.
	 * Runs when member content is no longer included in search, so the index
	 * follows the setting without a full reindex. A no-op while it is included.
	 *
	 * @return int The number of documents removed.
	 */
	public static function purge_protected(): int {
		if ( Settings::includes_protected_content() ) return 0;
		$protected = get_posts( [
			'post_type'      => array_values( get_post_types() ),
			'post_status'    => 'any',
			'has_password'   => true,
			'posts_per_page' => -1,
			'fields'         => 'ids',
		] );
		if ( ! $protected ) return 0;
		$protected = array_flip( array_map( 'intval', $protected ) );

		$client = new MeilisearchClient( Settings::server_url(), Settings::admin_key() );
		$index  = Settings::content_index();
		$stale  = [];
		foreach ( $client->fetch_all_documents( $index, [ 'id' ] ) as $doc ) {
			$id = (string) ( $doc['id'] ?? '' );
			if ( preg_match( '/^(pdf_)?([0-9]+)$/D', $id, $m ) !== 1 ) continue;
			$post_id = (int) $m[2];
			// A PDF is protected by its own password or by its parent's.
			$parent = $m[1] === '' ? 0 : (int) wp_get_post_parent_id( $post_id );
			if ( isset( $protected[ $post_id ] ) || isset( $protected[ $parent ] ) ) $stale[] = $id;
		}
		foreach ( array_chunk( $stale, 1000 ) as $ids ) $client->delete( $index, ...$ids );
		return count( $stale );
	}

	public static function run( array $args, array $assoc ): void {
		$s     = Settings::get();
		$types = $assoc['post-type'] ?? implode( ',', $s['post_types'] );
		$types = array_map( 'trim', explode( ',', $types ) );

		$count = self::reindex_posts( $types );
		\WP_CLI::success( sprintf( 'Indexed %d posts into %s.', $count, Settings::content_index() ) );
	}

	public static function reindex( array $args, array $assoc ): void {
		$s      = Settings::get();
		$client = new MeilisearchClient( Settings::server_url(), Settings::admin_key() );
		$index  = Settings::content_index();
		$client->delete_all( $index );
		\WP_CLI::log( 'Cleared index ' . $index );
		self::run( $args, $assoc );
	}
}
