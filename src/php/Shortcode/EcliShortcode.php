<?php declare( strict_types = 1 );

namespace Avpvh\FindAndView\Shortcode;

use Avpvh\FindAndView\Settings;
use Avpvh\FindAndView\Access\SearchProxy;

final class EcliShortcode {
	private static int $instance_count = 0;
	/** @var list<array<string,mixed>> */
	private static array $instances = [];

	public function register(): void {
		add_shortcode( 'avpvh_ecli_index', [ $this, 'render' ] );
		add_action( 'wp_footer', [ self::class, 'enqueue_assets' ] );
	}

	public function render( array|string $atts ): string {
		$s    = Settings::get();
		$atts = shortcode_atts( [
			'placeholder' => __( 'ECLI zoeken…', 'avpvh-find-and-view' ),
		], $atts );

		$gate = Settings::login_gate();
		if ( $gate !== null ) {
			return $gate;
		}

		if ( empty( $s['meili_url'] ) || empty( $s['meili_key'] ) ) {
			return '<p>' . esc_html__( 'Meilisearch niet geconfigureerd.', 'avpvh-find-and-view' ) . '</p>';
		}

		$uid = 'fav-ecli-' . ( ++self::$instance_count );
		$private = Settings::private_search();

		self::$instances[] = [
			'uid'         => $uid,
			'meiliUrl'    => $private ? home_url() : $s['meili_url'],
			'meiliKey'    => $private ? '' : $s['meili_key'],
			'searchProxy' => $private ? SearchProxy::config( [ Settings::ecli_index() ] ) : null,
			'ecliIndex'   => Settings::ecli_index(),
			'placeholder' => $atts['placeholder'],
		];

		ob_start();
		?>
		<div class="fav-ecli-wrap" id="<?php echo esc_attr( $uid ); ?>">
			<input type="search" class="fav-ecli-search-input"
				placeholder="<?php echo esc_attr( $atts['placeholder'] ); ?>">
			<p class="fav-ecli-hint"><?php esc_html_e( 'Standaard getoond: meest geciteerde ECLI\'s.', 'avpvh-find-and-view' ); ?></p>
			<div class="fav-ecli-results"></div>
		</div>
		<?php
		return ob_get_clean();
	}

	public static function enqueue_assets(): void {
		if ( empty( self::$instances ) ) return;

		$plugin_dir  = dirname( __DIR__, 3 );
		$plugin_file = $plugin_dir . '/avpvh-find-and-view.php';
		$plugin_url  = plugin_dir_url( $plugin_file );

		$css_path = $plugin_dir . '/dist/css/ecli.css';
		$js_path  = $plugin_dir . '/dist/js/ecli.iife.js';

		wp_enqueue_style(
			'fav-ecli',
			$plugin_url . 'dist/css/ecli.css',
			[],
			file_exists( $css_path ) ? (string) filemtime( $css_path ) : false,
		);

		wp_enqueue_script(
			'fav-ecli',
			$plugin_url . 'dist/js/ecli.iife.js',
			[],
			file_exists( $js_path ) ? (string) filemtime( $js_path ) : false,
			true,
		);

		wp_localize_script( 'fav-ecli', 'favEcliInstances', self::$instances );
	}
}
