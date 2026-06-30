<?php declare( strict_types = 1 );

namespace Avpvh\FindAndView\Index;

use Avpvh\FindAndView\Storage\CompositeProvider;
use Avpvh\FindAndView\Storage\StorageFile;

final class MediaIndexer {
	public function __construct( private readonly CompositeProvider $storage ) {}

	/**
	 * Build an IndexItem for a photo or archaeological find.
	 *
	 * @param array{
	 *   id: string,
	 *   type: 'photo'|'find',
	 *   title: string,
	 *   text: string,
	 *   collection: string,
	 *   file: StorageFile,
	 *   tags?: list<string>,
	 *   date?: string,
	 * } $data
	 */
	public function from_media( array $data ): IndexItem {
		$file = $data['file'];
		return new IndexItem(
			id:          $data['id'],
			type:        $data['type'],
			title:       $data['title'],
			text:        $data['text'],
			collection:  $data['collection'],
			url:         $this->storage->url( $file ),
			thumb_url:   $this->storage->thumbnail_url( $file, 240 ),
			file:        $file,
			tags:        $data['tags'] ?? [],
			date:        $data['date'] ?? null,
			page_number: null,
		);
	}

	/**
	 * Build an IndexItem for a scanned document page.
	 *
	 * @param array{
	 *   collection: string,
	 *   page_number: int,
	 *   text: string,
	 *   file: StorageFile,
	 *   tags?: list<string>,
	 *   date?: string,
	 * } $data
	 */
	public function from_scan( array $data ): IndexItem {
		$file      = $data['file'];
		$page      = $data['page_number'];
		$label     = sprintf( 'page_%02d', $page );
		$id        = $data['collection'] . '__' . $label;
		return new IndexItem(
			id:          $id,
			type:        'scan',
			title:       $data['collection'],
			text:        $data['text'],
			collection:  $data['collection'],
			url:         $this->storage->url( $file ),
			thumb_url:   $this->storage->thumbnail_url( $file, 240 ),
			file:        $file,
			tags:        $data['tags'] ?? [],
			date:        $data['date'] ?? null,
			page_number: $page,
		);
	}
}
