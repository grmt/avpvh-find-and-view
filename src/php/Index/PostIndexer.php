<?php declare( strict_types = 1 );

namespace Avpvh\FindAndView\Index;

final class PostIndexer {
	public static function from_post( \WP_Post $post ): ?IndexItem {
		$content = wp_strip_all_tags(
			apply_filters( 'the_content', $post->post_content )
		);

		$tags = [];
		foreach ( get_object_taxonomies( $post->post_type, 'objects' ) as $tax ) {
			$terms = wp_get_object_terms( $post->ID, $tax->name, [ 'fields' => 'names' ] );
			if ( is_array( $terms ) ) {
				$tags = array_merge( $tags, $terms );
			}
		}

		$post_type_obj = get_post_type_object( $post->post_type );
		$collection    = $post_type_obj ? $post_type_obj->labels->name : $post->post_type;

		return new IndexItem(
			id:          (string) $post->ID,
			type:        $post->post_type,
			title:       $post->post_title,
			text:        $content,
			collection:  $collection,
			url:         get_permalink( $post ) ?: '',
			thumb_url:   (string) get_the_post_thumbnail_url( $post, 'medium' ),
			file:        null,
			tags:        $tags,
			date:        get_the_date( 'Y-m-d', $post ) ?: null,
			page_number: null,
		);
	}
}
