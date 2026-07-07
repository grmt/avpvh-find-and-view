<?php declare( strict_types = 1 );

namespace Avpvh\FindAndView\Storage;

final class CompositeProvider {
	/** @param list<StorageProvider> $providers */
	public function __construct( private readonly array $providers ) {}

	public function store( string $local_path, string $collection, string $filename ): StorageFile {
		$locations = array_map(
			fn( $p ) => $p->store( $local_path, $collection, $filename ),
			$this->providers
		);
		return new StorageFile( $locations );
	}

	public function url( StorageFile $file ): string {
		foreach ( $file->locations as $loc ) {
			$provider = $this->find( $loc->provider );
			if ( $provider !== null ) {
				return $provider->url( $loc );
			}
		}
		return '';
	}

	public function thumbnail_url( StorageFile $file, int $width = 240 ): string {
		foreach ( $file->locations as $loc ) {
			$provider = $this->find( $loc->provider );
			if ( $provider !== null ) {
				return $provider->thumbnail_url( $loc, $width );
			}
		}
		return '';
	}

	private function find( string $provider_id ): ?StorageProvider {
		foreach ( $this->providers as $p ) {
			if ( $p->provider_id() === $provider_id ) {
				return $p;
			}
		}
		return null;
	}
}
