<?php declare( strict_types = 1 );

namespace Avpvh\FindAndView\Index;

final class PostIndexer {
	public static function from_post( \WP_Post $post ): ?IndexItem {
		if ( $post->post_status !== 'publish' ) return null;

		// Insert whitespace at block-level tag boundaries before stripping tags,
		// otherwise adjacent elements with no text between them (e.g. one <p>
		// per PDF line) get glued into a single unsearchable word.
		$html     = preg_replace( '/<\/?(?:p|div|br|li|h[1-6]|tr|td|th|blockquote|section|article|ul|ol)\b[^>]*>/i', ' ', strip_shortcodes( $post->post_content ) );
		$own_text = trim( preg_replace( '/\s+/u', ' ', wp_strip_all_tags( $html ) ) );
		if ( mb_strlen( $own_text ) < 20 ) return null;

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
			text:        $own_text,
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
