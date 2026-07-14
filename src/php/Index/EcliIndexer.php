<?php declare( strict_types = 1 );

namespace Avpvh\FindAndView\Index;

final class EcliIndexer {
	private const ECLI_PATTERN = '/ECLI:[A-Z]{2}:[A-Z0-9.]+:\d{4}:[A-Z0-9]+/';

	public function __construct(
		private readonly MeilisearchClient $client,
		private readonly string $media_index,
		private readonly string $ecli_index,
	) {}

	/**
	 * Scans every document in the media index for ECLI citations and rebuilds
	 * the derived ECLI citation index: one document per ECLI, listing every
	 * page that mentions it plus a citation count for ranking "most cited".
	 *
	 * @return int Number of distinct ECLIs indexed.
	 */
	public function rebuild(): int {
		/** @var array<string, array{ecli: string, citation_count: int, references: list<array<string, mixed>>}> */
		$citations = [];

		$docs = $this->client->fetch_all_documents(
			$this->media_index,
			[ 'text', 'collection', 'title', 'url', 'page_number' ],
		);

		foreach ( $docs as $doc ) {
			$text = $doc['text'] ?? '';
			if ( ! is_string( $text ) || $text === '' ) continue;

			preg_match_all( self::ECLI_PATTERN, $text, $matches );
			$found = array_unique( $matches[0] );
			foreach ( $found as $ecli ) {
				$citations[ $ecli ] ??= [
					'ecli'           => $ecli,
					'citation_count' => 0,
					'references'     => [],
				];
				$citations[ $ecli ]['citation_count']++;
				$citations[ $ecli ]['references'][] = [
					'collection'  => $doc['collection'] ?? '',
					'title'       => $doc['title'] ?? '',
					'url'         => $doc['url'] ?? '',
					'page_number' => $doc['page_number'] ?? null,
				];
			}
		}

		$this->client->ensure_settings( $this->ecli_index, [
			'searchableAttributes' => [ 'ecli' ],
			'sortableAttributes'   => [ 'citation_count' ],
			'filterableAttributes' => [ 'citation_count', 'ecli' ],
			// ECLIs are precise identifiers; typo-tolerant fuzzy matching does
			// more harm than good here (e.g. AG4186 vs AG4169 are unrelated
			// cases that otherwise rank as near-matches of each other).
			'typoTolerance'        => [ 'enabled' => false ],
		] );

		$this->client->delete_all( $this->ecli_index );

		$batch = [];
		foreach ( $citations as $ecli => $data ) {
			$batch[] = array_merge( $data, [ 'id' => self::sanitize_id( $ecli ) ] );
			if ( count( $batch ) >= 500 ) {
				$this->client->upsert_raw( $this->ecli_index, ...$batch );
				$batch = [];
			}
		}
		if ( $batch ) $this->client->upsert_raw( $this->ecli_index, ...$batch );

		return count( $citations );
	}

	private static function sanitize_id( string $ecli ): string {
		return preg_replace( '/[^A-Za-z0-9_-]/', '_', $ecli ) ?? $ecli;
	}
}
