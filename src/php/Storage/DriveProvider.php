<?php declare( strict_types = 1 );

namespace Avpvh\FindAndView\Storage;

final class DriveProvider implements StorageProvider {
	public function __construct( private readonly string $folder_id ) {}

	public function provider_id(): string { return 'drive'; }

	public function store( string $local_path, string $collection, string $filename ): StorageLocation {
		// TODO: upload via Google Drive API to subfolder $collection under $this->folder_id
		throw new \RuntimeException( 'DriveProvider::store() not yet implemented' );
	}

	public function url( StorageLocation $loc ): string {
		return 'https://drive.google.com/uc?export=view&id=' . urlencode( $loc->id );
	}

	public function thumbnail_url( StorageLocation $loc, int $width = 240 ): string {
		return 'https://drive.google.com/thumbnail?id=' . urlencode( $loc->id ) . '&sz=w' . $width;
	}

	public function delete( StorageLocation $loc ): void {
		// TODO: delete via Google Drive API
		throw new \RuntimeException( 'DriveProvider::delete() not yet implemented' );
	}

	public static function is_available(): bool {
		return class_exists( \Google\Client::class );
	}
}
