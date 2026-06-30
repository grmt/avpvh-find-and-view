<?php declare( strict_types = 1 );

namespace Avpvh\FindAndView\Storage;

final class StorageFile {
	/** @param list<StorageLocation> $locations */
	public function __construct(
		public readonly array $locations,
	) {}

	public function primary(): ?StorageLocation {
		return $this->locations[0] ?? null;
	}

	/** @return list<array{provider:string,id:string}> */
	public function to_array(): array {
		return array_map( fn( $l ) => $l->to_array(), $this->locations );
	}

	public static function from_array( array $data ): self {
		return new self( array_map( [ StorageLocation::class, 'from_array' ], $data ) );
	}
}
