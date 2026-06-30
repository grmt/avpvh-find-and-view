<?php declare( strict_types = 1 );

namespace Avpvh\FindAndView\Storage;

final class StorageLocation {
	public function __construct(
		public readonly string $provider, // 'local' | 'drive' | 's3' | 'fileshare'
		public readonly string $id,       // path, Drive file_id, S3 key, UNC path
	) {}

	public function to_array(): array {
		return [ 'provider' => $this->provider, 'id' => $this->id ];
	}

	public static function from_array( array $data ): self {
		return new self( $data['provider'], $data['id'] );
	}
}
