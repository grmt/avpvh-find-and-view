<?php declare( strict_types = 1 );

namespace Avpvh\FindAndView\Storage;

final class LocalProvider implements StorageProvider {
	public function __construct( private readonly string $uploads_subdir = 'fav' ) {}

	public function provider_id(): string { return 'local'; }

	public function store( string $local_path, string $collection, string $filename ): StorageLocation {
		$upload_dir = wp_upload_dir();
		$dest_dir   = trailingslashit( $upload_dir['basedir'] ) . $this->uploads_subdir . '/' . $collection;
		wp_mkdir_p( $dest_dir );
		$dest = $dest_dir . '/' . $filename;
		copy( $local_path, $dest );
		$id = $this->uploads_subdir . '/' . $collection . '/' . $filename;
		return new StorageLocation( 'local', $id );
	}

	public function url( StorageLocation $loc ): string {
		$upload_dir = wp_upload_dir();
		return trailingslashit( $upload_dir['baseurl'] ) . $loc->id;
	}

	public function thumbnail_url( StorageLocation $loc, int $width = 240 ): string {
		// TODO: WP intermediate image sizes
		return $this->url( $loc );
	}

	public function delete( StorageLocation $loc ): void {
		$upload_dir = wp_upload_dir();
		$path       = trailingslashit( $upload_dir['basedir'] ) . $loc->id;
		if ( file_exists( $path ) ) {
			unlink( $path );
		}
	}
}
