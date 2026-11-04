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
			'placeholder'       => __( 'Zoeken…', 'avpvh-find-and-view' ),
			'per_page'          => 10,
			'snippet_len'       => 30,
			'show_media'        => 'true',
			'show_content'      => 'true',
			'browse_mode'       => 'true',
			'browse_root_label' => __( 'Galerij', 'avpvh-find-and-view' ),
		], $atts );

		$gate = Settings::login_gate();
		if ( $gate !== null ) {
			return $gate;
		}

		if ( empty( $s['meili_url'] ) || empty( $s['meili_key'] ) ) {
			return '<p>' . esc_html__( 'Meilisearch niet geconfigureerd.', 'avpvh-find-and-view' ) . '</p>';
		}

		$uid          = 'fav-' . ( ++self::$instance_count );
		$show_media   = $atts['show_media']   === 'true';
		$show_content = $atts['show_content'] === 'true';
		$browse_mode  = $atts['browse_mode']  === 'true';

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
			'browseMode'       => $browse_mode,
			'browseRootLabel'  => $atts['browse_root_label'],
			'placeholder'      => $atts['placeholder'],
			'canEdit'          => current_user_can( 'edit_posts' ),
			'restRoot'         => rest_url( 'avpvh-fav/v1/' ),
			'editNonce'        => wp_create_nonce( 'wp_rest' ),
		];

		ob_start();
		?>
		<div class="fav-wrap" id="<?php echo esc_attr( $uid ); ?>">
			<div class="fav-searchbar">
				<div id="<?php echo esc_attr( $uid ); ?>-searchbox"></div>
				<label class="fav-source-toggle">
					<input type="checkbox" id="<?php echo esc_attr( $uid ); ?>-substr">
					<?php esc_html_e( 'Woorddelen', 'avpvh-find-and-view' ); ?>
				</label>
			</div>

			<div class="fav-layout">
				<div class="fav-filters">

					<?php if ( $show_media || $show_content ): ?>
					<h3 class="fav-section-header fav-filter-toggle"
						data-target="<?php echo esc_attr( $uid ); ?>-filter-panel" data-collapse-mobile="1">
						<span class="fav-collapse-icon">▾</span>
						<?php esc_html_e( 'Filters', 'avpvh-find-and-view' ); ?>
					</h3>
					<div class="fav-filter-panel" id="<?php echo esc_attr( $uid ); ?>-filter-panel">
						<div class="fav-refine-wrap">
							<input type="search" class="fav-refine-input"
								id="<?php echo esc_attr( $uid ); ?>-refine-filter"
								placeholder="<?php esc_attr_e( 'Verfijn...', 'avpvh-find-and-view' ); ?>">
						</div>
						<ul class="fav-collection-list" id="<?php echo esc_attr( $uid ); ?>-filter-tree"></ul>
					</div>
					<?php endif; ?>
				</div>

				<?php if ( $browse_mode && $show_media ): ?>
				<div class="fav-browse">
					<nav class="fav-breadcrumb" aria-label="<?php esc_attr_e( 'Navigatie', 'avpvh-find-and-view' ); ?>"></nav>
					<div class="fav-browse-grid"></div>
				</div>
				<?php endif; ?>

				<?php if ( $browse_mode && $show_content ): ?>
				<div class="fav-browse" id="<?php echo esc_attr( $uid ); ?>-page-browse">
					<nav class="fav-breadcrumb" id="<?php echo esc_attr( $uid ); ?>-page-breadcrumb" aria-label="<?php esc_attr_e( 'Navigatie', 'avpvh-find-and-view' ); ?>"></nav>
					<div class="fav-browse-grid" id="<?php echo esc_attr( $uid ); ?>-page-browse-grid"></div>
				</div>
				<?php endif; ?>

				<div class="fav-results">
					<?php if ( $show_media ): ?>
					<div id="<?php echo esc_attr( $uid ); ?>-section-media">
						<h3 class="fav-section-header" data-target="<?php echo esc_attr( $uid ); ?>-body-media">
							<span class="fav-collapse-icon">▾</span>
							<?php esc_html_e( 'Media', 'avpvh-find-and-view' ); ?>
						</h3>
						<div id="<?php echo esc_attr( $uid ); ?>-body-media">
							<div id="<?php echo esc_attr( $uid ); ?>-hits-media"></div>
							<div id="<?php echo esc_attr( $uid ); ?>-pag-media"></div>
						</div>
					</div>
					<?php endif; ?>

					<?php if ( $show_content ): ?>
					<div id="<?php echo esc_attr( $uid ); ?>-section-content">
						<h3 class="fav-section-header" data-target="<?php echo esc_attr( $uid ); ?>-body-content">
							<span class="fav-collapse-icon">▾</span>
							<?php esc_html_e( 'Pagina\'s en berichten', 'avpvh-find-and-view' ); ?>
						</h3>
						<div id="<?php echo esc_attr( $uid ); ?>-body-content">
							<div id="<?php echo esc_attr( $uid ); ?>-hits-content"></div>
							<div id="<?php echo esc_attr( $uid ); ?>-pag-content"></div>
						</div>
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

		$plugin_dir  = dirname( __DIR__, 3 );
		$plugin_file = $plugin_dir . '/avpvh-find-and-view.php';
		$plugin_url  = plugin_dir_url( $plugin_file );

		$css_path = $plugin_dir . '/dist/css/search.css';
		$js_path  = $plugin_dir . '/dist/js/search.iife.js';

		wp_enqueue_style(
			'fav-search',
			$plugin_url . 'dist/css/search.css',
			[],
			file_exists( $css_path ) ? (string) filemtime( $css_path ) : false,
		);

		wp_enqueue_script(
			'fav-search',
			$plugin_url . 'dist/js/search.iife.js',
			[],
			file_exists( $js_path ) ? (string) filemtime( $js_path ) : false,
			true,
		);

		wp_localize_script( 'fav-search', 'favInstances', self::$instances );
	}
}
