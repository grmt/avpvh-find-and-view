<?php declare( strict_types = 1 );

namespace Avpvh\FindAndView\Index;

final class MeilisearchClient {
	private \Meilisearch\Client $client;

	public function __construct( string $url, string $api_key ) {
		$this->client = new \Meilisearch\Client( $url, $api_key );
	}

	public function upsert( string $index, IndexItem ...$items ): void {
		$docs = array_map( fn( $i ) => $i->to_document(), $items );
		$this->client->index( $index )->addDocuments( $docs );
	}

	public function delete( string $index, string ...$ids ): void {
		$this->client->index( $index )->deleteDocuments( $ids );
	}

	public function ensure_settings( string $index, array $settings ): void {
		$this->client->index( $index )->updateSettings( $settings );
	}
}
