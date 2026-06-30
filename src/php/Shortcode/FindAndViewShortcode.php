<?php declare( strict_types = 1 );

namespace Avpvh\FindAndView\Shortcode;

use Avpvh\FindAndView\Settings;

final class FindAndViewShortcode {
	private static int $instance_count = 0;
	/** @var list<array<string,mixed>> */
	private static array $instances = [];

	public function register(): void {
		add_shortcode( 'avpvh_find_and_view', [ $this, 'render' ] );
		add_action( 'wp_footer', [ self::class, 'enqueue_assets' ] );
	}

	public function render( array|string $atts ): string {
		$s    = Settings::get();
		$atts = shortcode_atts( [
			'placeholder'  => __( 'Zoeken…', 'avpvh-find-and-view' ),
			'per_page'     => 10,
			'snippet_len'  => 30,
			'show_media'   => 'true',
			'show_content' => 'true',
		], $atts );

		if ( empty( $s['meili_url'] ) || empty( $s['meili_key'] ) ) {
			return '<p>' . esc_html__( 'Meilisearch niet geconfigureerd.', 'avpvh-find-and-view' ) . '</p>';
		}

		$uid          = 'fav-' . ( ++self::$instance_count );
		$show_media   = $atts['show_media']   === 'true';
		$show_content = $atts['show_content'] === 'true';

		self::$instances[] = [
			'uid'          => $uid,
			'meiliUrl'     => $s['meili_url'],
			'meiliKey'     => $s['meili_key'],
			'mediaIndex'   => Settings::media_index(),
			'contentIndex' => Settings::content_index(),
			'perPage'      => (int) $atts['per_page'],
			'snippetLen'   => (int) $atts['snippet_len'],
			'showMedia'    => $show_media,
			'showContent'  => $show_content,
			'placeholder'  => $atts['placeholder'],
		];

		ob_start();
		?>
		<div class="fav-wrap" id="<?php echo esc_attr( $uid ); ?>">
			<div id="<?php echo esc_attr( $uid ); ?>-searchbox"></div>

			<div class="fav-layout">
				<div class="fav-filters">
					<div class="fav-filter-panel">
						<h4><?php esc_html_e( 'Bronnen', 'avpvh-find-and-view' ); ?></h4>
						<?php if ( $show_media ): ?>
						<label class="fav-source-toggle">
							<input type="checkbox" id="<?php echo esc_attr( $uid ); ?>-src-media" checked>
							<?php esc_html_e( 'Media', 'avpvh-find-and-view' ); ?>
						</label>
						<?php endif; ?>
						<?php if ( $show_content ): ?>
						<label class="fav-source-toggle">
							<input type="checkbox" id="<?php echo esc_attr( $uid ); ?>-src-content" checked>
							<?php esc_html_e( 'Pagina\'s', 'avpvh-find-and-view' ); ?>
						</label>
						<?php endif; ?>
					</div>

					<div class="fav-filter-panel" id="<?php echo esc_attr( $uid ); ?>-collection-filter">
						<h4><?php esc_html_e( 'Collecties', 'avpvh-find-and-view' ); ?></h4>
						<div class="fav-refine-wrap">
							<input type="search" class="fav-refine-input"
								id="<?php echo esc_attr( $uid ); ?>-refine-collection"
								placeholder="<?php esc_attr_e( 'Verfijn…', 'avpvh-find-and-view' ); ?>">
						</div>
						<ul class="fav-collection-list" id="<?php echo esc_attr( $uid ); ?>-collection-list"></ul>
					</div>

					<div class="fav-filter-panel">
						<h4><?php esc_html_e( 'Opties', 'avpvh-find-and-view' ); ?></h4>
						<label class="fav-source-toggle">
							<input type="checkbox" id="<?php echo esc_attr( $uid ); ?>-substr">
							<?php esc_html_e( 'Woorddelen', 'avpvh-find-and-view' ); ?>
						</label>
					</div>
				</div>

				<div class="fav-results">
					<?php if ( $show_media ): ?>
					<div id="<?php echo esc_attr( $uid ); ?>-section-media">
						<h3 class="fav-section-header" data-target="<?php echo esc_attr( $uid ); ?>-hits-media">
							<span class="fav-collapse-icon">▾</span>
							<?php esc_html_e( 'Media', 'avpvh-find-and-view' ); ?>
						</h3>
						<div id="<?php echo esc_attr( $uid ); ?>-hits-media"></div>
						<div id="<?php echo esc_attr( $uid ); ?>-pag-media"></div>
					</div>
					<?php endif; ?>

					<?php if ( $show_content ): ?>
					<div id="<?php echo esc_attr( $uid ); ?>-section-content">
						<h3 class="fav-section-header" data-target="<?php echo esc_attr( $uid ); ?>-hits-content">
							<span class="fav-collapse-icon">▾</span>
							<?php esc_html_e( 'Pagina\'s en berichten', 'avpvh-find-and-view' ); ?>
						</h3>
						<div id="<?php echo esc_attr( $uid ); ?>-hits-content"></div>
						<div id="<?php echo esc_attr( $uid ); ?>-pag-content"></div>
					</div>
					<?php endif; ?>
				</div>
			</div>
		</div>
		<?php
		return ob_get_clean();
	}

	public static function enqueue_assets(): void {
		if ( empty( self::$instances ) ) return;

		$plugin_url = plugin_dir_url( dirname( __DIR__, 2 ) . '/avpvh-find-and-view.php' );

		wp_enqueue_style(
			'fav-search',
			$plugin_url . 'dist/css/search.css',
			[],
			'0.1.0',
		);

		wp_enqueue_script(
			'fav-search',
			$plugin_url . 'dist/js/search.iife.js',
			[],
			'0.1.0',
			true,
		);

		wp_localize_script( 'fav-search', 'favInstances', self::$instances );
	}
}
