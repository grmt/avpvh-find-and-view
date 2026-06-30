<?php declare( strict_types = 1 );

namespace Avpvh\FindAndView\Admin;

use Avpvh\FindAndView\Settings;

final class SettingsPage {
	public function register(): void {
		add_action( 'admin_menu', [ $this, 'add_menu' ] );
		add_action( 'admin_init', [ $this, 'register_settings' ] );
	}

	public function add_menu(): void {
		add_options_page(
			__( 'Find and View', 'avpvh-find-and-view' ),
			__( 'Find and View', 'avpvh-find-and-view' ),
			'manage_options',
			'avpvh-find-and-view',
			[ $this, 'render' ]
		);
	}

	public function register_settings(): void {
		register_setting( 'fav_settings_group', Settings::OPTION, [
			'sanitize_callback' => [ $this, 'sanitize' ],
		] );
	}

	public function sanitize( mixed $input ): array {
		$s = Settings::get();
		if ( isset( $input['meili_url'] ) )    $s['meili_url']    = esc_url_raw( $input['meili_url'] );
		if ( isset( $input['meili_key'] ) )    $s['meili_key']    = sanitize_text_field( $input['meili_key'] );
		if ( isset( $input['index_prefix'] ) ) $s['index_prefix'] = sanitize_key( $input['index_prefix'] );
		if ( isset( $input['post_types'] ) )   $s['post_types']   = array_map( 'sanitize_key', (array) $input['post_types'] );
		if ( isset( $input['storage'] ) )      $s['storage']      = array_map( 'sanitize_key', (array) $input['storage'] );
		return $s;
	}

	public function render(): void {
		$s          = Settings::get();
		$post_types = get_post_types( [ 'public' => true ], 'objects' );
		?>
		<div class="wrap">
			<h1><?php esc_html_e( 'Find and View', 'avpvh-find-and-view' ); ?></h1>
			<form method="post" action="options.php">
				<?php settings_fields( 'fav_settings_group' ); ?>
				<table class="form-table">
					<tr>
						<th><?php esc_html_e( 'Meilisearch URL', 'avpvh-find-and-view' ); ?></th>
						<td><input type="url" name="fav_settings[meili_url]"
							value="<?php echo esc_attr( $s['meili_url'] ); ?>" class="regular-text"></td>
					</tr>
					<tr>
						<th><?php esc_html_e( 'Meilisearch API key', 'avpvh-find-and-view' ); ?></th>
						<td><input type="password" name="fav_settings[meili_key]"
							value="<?php echo esc_attr( $s['meili_key'] ); ?>" class="regular-text"></td>
					</tr>
					<tr>
						<th><?php esc_html_e( 'Index prefix', 'avpvh-find-and-view' ); ?></th>
						<td>
							<input type="text" name="fav_settings[index_prefix]"
								value="<?php echo esc_attr( $s['index_prefix'] ); ?>" class="small-text">
							<p class="description">
								<?php printf(
									esc_html__( 'Indexes: %s_content, %s_media', 'avpvh-find-and-view' ),
									esc_html( $s['index_prefix'] ),
									esc_html( $s['index_prefix'] )
								); ?>
							</p>
						</td>
					</tr>
					<tr>
						<th><?php esc_html_e( 'Post types to index', 'avpvh-find-and-view' ); ?></th>
						<td>
							<?php foreach ( $post_types as $pt ): ?>
								<label style="display:block;margin:.2em 0">
									<input type="checkbox" name="fav_settings[post_types][]"
										value="<?php echo esc_attr( $pt->name ); ?>"
										<?php checked( in_array( $pt->name, $s['post_types'], true ) ); ?>>
									<?php echo esc_html( $pt->labels->name ); ?>
									<code style="font-size:.85em">(<?php echo esc_html( $pt->name ); ?>)</code>
								</label>
							<?php endforeach; ?>
						</td>
					</tr>
					<tr>
						<th><?php esc_html_e( 'Storage backends', 'avpvh-find-and-view' ); ?></th>
						<td>
							<?php foreach ( [ 'local' => 'WP uploads', 'drive' => 'Google Drive', 's3' => 'S3', 'fileshare' => 'File share' ] as $id => $label ): ?>
								<label style="display:block;margin:.2em 0">
									<input type="checkbox" name="fav_settings[storage][]"
										value="<?php echo esc_attr( $id ); ?>"
										<?php checked( in_array( $id, $s['storage'], true ) ); ?>>
									<?php echo esc_html( $label ); ?>
								</label>
							<?php endforeach; ?>
						</td>
					</tr>
				</table>
				<?php submit_button(); ?>
			</form>
		</div>
		<?php
	}
}
