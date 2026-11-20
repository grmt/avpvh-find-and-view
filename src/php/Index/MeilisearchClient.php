<?php declare( strict_types = 1 );

namespace Avpvh\FindAndView\Index;

final class MeilisearchClient {
	private \Meilisearch\Client $client;

	public function __construct( string $url, string $api_key ) {
		if ( $api_key === '' ) throw new \RuntimeException( 'Site-scoped Meilisearch admin key not configured' );
		$this->client = new \Meilisearch\Client( $url, $api_key );
	}

	public function upsert( string $index, IndexItem ...$items ): void {
		$this->validate_index( $index );
		$docs = array_map( fn( $i ) => $i->to_document(), $items );
		$this->client->index( $index )->addDocuments( $docs );
	}

	/** For indices with a document shape that doesn't fit IndexItem (e.g. derived/aggregate indices). */
	public function upsert_raw( string $index, array ...$docs ): void {
		$this->validate_index( $index );
		$this->client->index( $index )->addDocuments( $docs );
	}

	/**
	 * Fetches every document in an index via offset pagination, using the
	 * /documents listing endpoint (not /search, which is relevance-ranked
	 * and capped) — for bulk export/scanning of a whole index.
	 *
	 * @param list<string> $fields
	 * @return iterable<array<string, mixed>>
	 */
	public function fetch_all_documents( string $index, array $fields, int $page_size = 1000 ): iterable {
		$this->validate_index( $index );
		$offset = 0;
		do {
			$query = ( new \Meilisearch\Contracts\DocumentsQuery() )
				->setOffset( $offset )
				->setLimit( $page_size )
				->setFields( $fields );
			$results = $this->client->index( $index )->getDocuments( $query )->getResults();
			foreach ( $results as $doc ) yield $doc;
			$offset += $page_size;
		} while ( count( $results ) === $page_size );
	}

	public function delete( string $index, string ...$ids ): void {
		$this->validate_index( $index );
		$this->client->index( $index )->deleteDocuments( $ids );
	}

	public function delete_all( string $index ): void {
		$this->validate_index( $index );
		$this->client->index( $index )->deleteAllDocuments();
	}

	public function ensure_settings( string $index, array $settings ): void {
		$this->validate_index( $index );
		$this->client->index( $index )->updateSettings( $settings );
	}

	private function validate_index( string $index ): void {
		if ( ! \Avpvh\FindAndView\Settings::valid_index( $index ) ) throw new \InvalidArgumentException( 'Invalid site index' );
	}
}
