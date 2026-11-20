<?php declare( strict_types = 1 );

namespace Avpvh\FindAndView\Storage;

final class LocalProvider implements StorageProvider {
	public function __construct( private readonly string $uploads_subdir = 'fav' ) {
		if ( ! self::valid_relative_path( $this->uploads_subdir ) ) {
			throw new \InvalidArgumentException( 'Invalid uploads subdirectory' );
		}
	}

	public function provider_id(): string { return 'local'; }

	public function store( string $local_path, string $collection, string $filename ): StorageLocation {
		if ( ! self::valid_relative_path( $collection ) || ! self::valid_filename( $filename ) ) {
			throw new \InvalidArgumentException( 'Invalid storage destination' );
		}
		if ( ! is_file( $local_path ) || is_link( $local_path ) ) {
			throw new \InvalidArgumentException( 'Invalid source file' );
		}
		$root     = $this->root_dir( true );
		$dest_dir = $this->confined_dir( $root, $collection );
		wp_mkdir_p( $dest_dir );
		$real_dir = realpath( $dest_dir );
		if ( ! $real_dir || ( $real_dir !== $root && ! str_starts_with( $real_dir, $root . '/' ) ) ) {
			throw new \RuntimeException( 'Storage destination escapes root' );
		}
		$dest = $real_dir . '/' . $filename;
		if ( is_link( $dest ) ) {
			throw new \RuntimeException( 'Refusing to overwrite symlink' );
		}
		if ( ! copy( $local_path, $dest ) ) {
			throw new \RuntimeException( 'Failed to store file' );
		}
		$id = $this->uploads_subdir . '/' . $collection . '/' . $filename;
		return new StorageLocation( 'local', $id );
	}

	public function url( StorageLocation $loc ): string {
		$upload_dir = wp_upload_dir();
		return trailingslashit( $upload_dir['baseurl'] ) . ltrim( $loc->id, '/' );
	}

	public function thumbnail_url( StorageLocation $loc, int $width = 240 ): string {
		// TODO: WP intermediate image sizes
		return $this->url( $loc );
	}

	public function delete( StorageLocation $loc ): void {
		$prefix = $this->uploads_subdir . '/';
		if ( ! str_starts_with( $loc->id, $prefix ) ) {
			throw new \InvalidArgumentException( 'Storage location outside provider root' );
		}
		$rel = substr( $loc->id, strlen( $prefix ) );
		if ( ! self::valid_relative_path( $rel ) ) {
			throw new \InvalidArgumentException( 'Invalid storage location path' );
		}
		$root = $this->root_dir( false );
		if ( ! $root ) return;
		$candidate = $root . '/' . $rel;
		if ( is_link( $candidate ) ) {
			throw new \InvalidArgumentException( 'Refusing to delete symlink' );
		}
		$real = realpath( $candidate );
		if ( ! $real || ! is_file( $real ) || ! str_starts_with( $real, $root . '/' ) ) {
			return;
		}
		wp_delete_file( $real );
	}

	private function root_dir( bool $create ): ?string {
		$upload_dir = wp_upload_dir();
		$base       = realpath( (string) ( $upload_dir['basedir'] ?? '' ) );
		if ( ! $base ) {
			if ( $create ) throw new \RuntimeException( 'Uploads base directory unavailable' );
			return null;
		}
		$root = $base . '/' . $this->uploads_subdir;
		if ( $create && ! is_dir( $root ) ) wp_mkdir_p( $root );
		$real = realpath( $root );
		if ( ! $real || ! is_dir( $real ) || ! str_starts_with( $real, $base . '/' ) ) {
			if ( $create ) throw new \RuntimeException( 'Storage root escapes uploads directory' );
			return null;
		}
		return $real;
	}

	private function confined_dir( string $root, string $rel ): string {
		$path = $root;
		foreach ( explode( '/', $rel ) as $segment ) {
			$path .= '/' . $segment;
			if ( is_link( $path ) ) {
				throw new \InvalidArgumentException( 'Symlink not allowed in storage path' );
			}
			if ( file_exists( $path ) ) {
				$real = realpath( $path );
				if ( ! $real || ! is_dir( $real ) || ! str_starts_with( $real, $root . '/' ) ) {
					throw new \InvalidArgumentException( 'Storage path escapes root' );
				}
			}
		}
		return $path;
	}

	private static function valid_relative_path( string $rel ): bool {
		if ( $rel === '' || str_contains( $rel, "\0" ) || str_contains( $rel, '\\' ) ) return false;
		foreach ( explode( '/', $rel ) as $segment ) {
			if ( in_array( $segment, [ '', '.', '..' ], true ) ) return false;
		}
		return true;
	}

	private static function valid_filename( string $filename ): bool {
		if ( $filename === '' || $filename === '.' || $filename === '..' ) return false;
		if ( str_contains( $filename, "\0" ) || str_contains( $filename, '/' ) || str_contains( $filename, '\\' ) ) return false;
		return basename( $filename ) === $filename;
	}
}
