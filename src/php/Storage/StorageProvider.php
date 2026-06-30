<?php declare( strict_types = 1 );

namespace Avpvh\FindAndView\Storage;

interface StorageProvider {
	public function store( string $local_path, string $collection, string $filename ): StorageLocation;
	public function url( StorageLocation $loc ): string;
	public function thumbnail_url( StorageLocation $loc, int $width = 240 ): string;
	public function delete( StorageLocation $loc ): void;
	public function provider_id(): string;
}
