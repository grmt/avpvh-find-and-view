<?php declare( strict_types = 1 );

namespace Avpvh\FindAndView\Index;

use Avpvh\FindAndView\Storage\StorageFile;

final class IndexItem {
	public function __construct(
		public readonly string       $id,
		public readonly string       $type,        // 'post' | 'page' | 'photo' | 'find' | 'scan'
		public readonly string       $title,
		public readonly string       $text,        // OCR, EXIF description, post content
		public readonly string       $collection,  // album, productie, post_type label
		public readonly string       $url,         // permalink for WP content, empty for media
		public readonly string       $thumb_url,   // thumbnail URL (resolved at index time)
		public readonly ?StorageFile $file,        // null for WP content
		public readonly array        $tags,
		public readonly ?string      $date,
		public readonly ?int         $page_number, // for scans
	) {}

	public function to_document(): array {
		return array_filter( [
			'id'          => $this->id,
			'type'        => $this->type,
			'title'       => $this->title,
			'text'        => $this->text,
			'collection'  => $this->collection,
			'url'         => $this->url ?: null,
			'thumb_url'   => $this->thumb_url ?: null,
			'locations'   => $this->file?->to_array() ?? [],
			'tags'        => $this->tags,
			'date'        => $this->date,
			'page_number' => $this->page_number,
		], fn( $v ) => $v !== null );
	}
}
