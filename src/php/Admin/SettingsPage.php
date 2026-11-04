<?php declare( strict_types = 1 );

namespace Avpvh\FindAndView\Admin;

use Avpvh\FindAndView\Settings;

final class SettingsPage {
	public function register(): void {
		add_action( 'admin_menu', [ $this, 'add_menu' ] );
		add_action( 'admin_init', [ $this, 'register_settings' ] );
		add_action( 'admin_enqueue_scripts', [ $this, 'enqueue_tree' ] );
	}

	public function enqueue_tree( string $hook ): void {
		if ( $hook !== 'settings_page_avpvh-find-and-view' ) return;
		$dir  = dirname( __DIR__, 3 );
		$base = plugin_dir_url( $dir . '/avpvh-find-and-view.php' );
		// File mtime as version, like the search and ECLI assets, so a deploy
		// busts the browser cache.
		$css = $dir . '/dist/css/tree.css';
		$js  = $dir . '/dist/js/tree.iife.js';
		wp_enqueue_style( 'fav-tree', $base . 'dist/css/tree.css', [], file_exists( $css ) ? (string) filemtime( $css ) : false );
		wp_enqueue_script( 'fav-tree', $base . 'dist/js/tree.iife.js', [], file_exists( $js ) ? (string) filemtime( $js ) : false, true );
		wp_localize_script( 'fav-tree', 'favTree', [
			'root'  => rest_url( 'avpvh-fav/v1/' ),
			'nonce' => wp_create_nonce( 'wp_rest' ),
		] );
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
		if ( isset( $input['meili_key'] ) )       $s['meili_key']       = sanitize_text_field( $input['meili_key'] );
		if ( isset( $input['meili_admin_key'] ) ) $s['meili_admin_key'] = sanitize_text_field( $input['meili_admin_key'] );
		if ( isset( $input['index_prefix'] ) )   $s['index_prefix']   = sanitize_key( $input['index_prefix'] );
		if ( isset( $input['content_index'] ) )  $s['content_index']  = sanitize_text_field( $input['content_index'] );
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
						<th><?php esc_html_e( 'Meilisearch search key', 'avpvh-find-and-view' ); ?></th>
						<td><input type="password" name="fav_settings[meili_key]"
							value="<?php echo esc_attr( $s['meili_key'] ); ?>" class="regular-text">
							<p class="description"><?php esc_html_e( 'Read-only key voor de zoekpagina (publiek).', 'avpvh-find-and-view' ); ?></p>
						</td>
					</tr>
					<tr>
						<th><?php esc_html_e( 'Meilisearch admin key', 'avpvh-find-and-view' ); ?></th>
						<td><input type="password" name="fav_settings[meili_admin_key]"
							value="<?php echo esc_attr( $s['meili_admin_key'] ?? '' ); ?>" class="regular-text">
							<p class="description"><?php esc_html_e( 'Master/admin key voor herindexeren. Alleen zichtbaar voor beheerders.', 'avpvh-find-and-view' ); ?></p>
						</td>
					</tr>
					<tr>
						<th><?php esc_html_e( 'Index prefix', 'avpvh-find-and-view' ); ?></th>
						<td>
							<input type="text" name="fav_settings[index_prefix]"
								value="<?php echo esc_attr( $s['index_prefix'] ); ?>" class="small-text">
							<p class="description">
								<?php printf(
									/* translators: %s: index prefix */
									esc_html__( 'Media index: %s_media', 'avpvh-find-and-view' ),
									esc_html( $s['index_prefix'] )
								); ?>
							</p>
						</td>
					</tr>
					<tr>
						<th><?php esc_html_e( 'Content index name', 'avpvh-find-and-view' ); ?></th>
						<td>
							<input type="text" name="fav_settings[content_index]"
								value="<?php echo esc_attr( $s['content_index'] ?? '' ); ?>" class="regular-text"
								placeholder="<?php echo esc_attr( $s['index_prefix'] . '_content' ); ?>">
							<p class="description"><?php esc_html_e( 'Naam van de Meilisearch index voor pagina\'s en berichten. Leeg = {prefix}_content.', 'avpvh-find-and-view' ); ?></p>
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

			<hr>
			<h2><?php esc_html_e( 'Index-overzicht', 'avpvh-find-and-view' ); ?></h2>
			<div id="fav-index-stats" style="max-width:600px">
				<p><em><?php esc_html_e( 'Laden…', 'avpvh-find-and-view' ); ?></em></p>
			</div>
			<p><button id="fav-stats-refresh" class="button"><?php esc_html_e( 'Vernieuwen', 'avpvh-find-and-view' ); ?></button></p>

			<hr>
			<h2><?php esc_html_e( 'Index-instellingen', 'avpvh-find-and-view' ); ?></h2>
			<p class="description"><?php esc_html_e( 'Worden direct naar Meilisearch gestuurd via de admin-sleutel.', 'avpvh-find-and-view' ); ?></p>
			<table class="form-table" style="max-width:600px">
				<tr>
					<th><?php esc_html_e( 'Index', 'avpvh-find-and-view' ); ?></th>
					<td><input type="text" id="fav-idx-name" value="<?php echo esc_attr( ( $s['index_prefix'] ?? 'fav' ) . '_media' ); ?>" class="regular-text"></td>
				</tr>
				<tr>
					<th><?php esc_html_e( 'Typofout-tolerantie', 'avpvh-find-and-view' ); ?></th>
					<td>
						<label><input type="checkbox" id="fav-typo-on" checked> <?php esc_html_e( 'Ingeschakeld', 'avpvh-find-and-view' ); ?></label><br><br>
						<label><?php esc_html_e( '1 typofout vanaf', 'avpvh-find-and-view' ); ?> <input type="number" id="fav-one-typo" value="5" class="small-text" min="1" max="30"> <?php esc_html_e( 'tekens', 'avpvh-find-and-view' ); ?></label><br>
						<label><?php esc_html_e( '2 typefouten vanaf', 'avpvh-find-and-view' ); ?> <input type="number" id="fav-two-typos" value="9" class="small-text" min="1" max="30"> <?php esc_html_e( 'tekens', 'avpvh-find-and-view' ); ?></label>
					</td>
				</tr>
				<tr>
					<th><?php esc_html_e( 'Extra scheidingstekens', 'avpvh-find-and-view' ); ?></th>
					<td>
						<input type="text" id="fav-separators" class="regular-text" placeholder="/ , .">
						<p class="description"><?php esc_html_e( 'Kommagescheiden tekens waarmee woorden worden gesplitst.', 'avpvh-find-and-view' ); ?></p>
					</td>
				</tr>
			</table>
			<p><button id="fav-idx-apply" class="button button-secondary"><?php esc_html_e( 'Toepassen op index', 'avpvh-find-and-view' ); ?></button>
			<span id="fav-idx-msg" style="margin-left:1em;color:#555"></span></p>

			<hr>
			<h2><?php esc_html_e( 'Document bewerken', 'avpvh-find-and-view' ); ?></h2>
			<p class="description"><?php esc_html_e( 'Zoek een geïndexeerde pagina op tekst of plak de afbeelding-URL als anker.', 'avpvh-find-and-view' ); ?></p>
			<table class="form-table" style="max-width:600px">
				<tr>
					<th><?php esc_html_e( 'Index', 'avpvh-find-and-view' ); ?></th>
					<td><input type="text" id="fav-doc-idx" value="<?php echo esc_attr( ( $s['index_prefix'] ?? 'fav' ) . '_media' ); ?>" class="regular-text"></td>
				</tr>
				<tr>
					<th><?php esc_html_e( 'Zoek document', 'avpvh-find-and-view' ); ?></th>
					<td>
						<input type="text" id="fav-doc-q" class="regular-text" placeholder="<?php esc_attr_e( 'Tekst, document-ID of afbeelding-URL', 'avpvh-find-and-view' ); ?>">
						<button id="fav-doc-search" class="button"><?php esc_html_e( 'Zoeken', 'avpvh-find-and-view' ); ?></button>
					</td>
				</tr>
			</table>
			<div id="fav-doc-results" style="display:none;margin:.5em 0;max-width:700px"></div>
			<div id="fav-doc-editor" style="display:none;margin:.5em 0;max-width:700px;padding:1em;background:#f6f7f7;border:1px solid #ccd0d4;border-radius:4px">
				<strong id="fav-doc-title"></strong>
				<br><br>
				<textarea id="fav-doc-text" rows="8" style="width:100%;font-size:.85em;font-family:monospace"></textarea>
				<br>
				<button id="fav-doc-save" class="button button-primary"><?php esc_html_e( 'Opslaan', 'avpvh-find-and-view' ); ?></button>
				<span id="fav-doc-save-msg" style="margin-left:1em;color:#555"></span>
				<input type="hidden" id="fav-doc-id">
			</div>

			<hr>
			<h2><?php esc_html_e( 'Bestandsbeheer (scans)', 'avpvh-find-and-view' ); ?></h2>
			<p class="description">
				<?php esc_html_e( 'Sleep mappen om ze te verplaatsen. Dubbelklik op een naam om te hernoemen. + maakt een submap aan.', 'avpvh-find-and-view' ); ?>
			</p>
			<div id="fav-normalize-panel" style="display:none;margin:.5em 0;padding:.7em 1em;background:#f6f7f7;border:1px solid #ccd0d4;border-radius:4px;max-width:600px">
				<strong><?php esc_html_e( 'Preview hernoemen:', 'avpvh-find-and-view' ); ?></strong>
				<ul id="fav-normalize-list" style="margin:.5em 0 .7em;padding-left:1.5em"></ul>
				<button id="fav-normalize-apply" class="button button-primary button-small">
					<?php esc_html_e( 'Uitvoeren', 'avpvh-find-and-view' ); ?>
				</button>
				<button class="button button-small" onclick="document.getElementById('fav-normalize-panel').style.display='none'">
					<?php esc_html_e( 'Annuleren', 'avpvh-find-and-view' ); ?>
				</button>
			</div>
			<p style="display:flex;gap:.5em;flex-wrap:wrap">
				<button id="fav-tree-normalize" class="button">
					<?php esc_html_e( '0→01 Normaliseer nummering', 'avpvh-find-and-view' ); ?>
				</button>
				<button id="fav-tree-remap" class="button button-primary">
					<?php esc_html_e( 'Hernoem index…', 'avpvh-find-and-view' ); ?>
				</button>
				<button id="fav-tree-reindex" class="button">
					<?php esc_html_e( 'Herindex scans en spreadsheets', 'avpvh-find-and-view' ); ?>
				</button>
				<button id="fav-tree-reindex-content" class="button">
					<?php esc_html_e( 'Herindex pagina\'s', 'avpvh-find-and-view' ); ?>
				</button>
			</p>
			<div id="fav-remap-panel" style="display:none;margin:.5em 0;padding:.7em 1em;background:#f6f7f7;border:1px solid #ccd0d4;border-radius:4px;max-width:700px">
				<strong><?php esc_html_e( 'Preview hernoemen index:', 'avpvh-find-and-view' ); ?></strong>
				<div id="fav-remap-list" style="margin:.5em 0"></div>
				<button id="fav-remap-apply" class="button button-primary button-small">
					<?php esc_html_e( 'Uitvoeren', 'avpvh-find-and-view' ); ?>
				</button>
				<button class="button button-small" onclick="document.getElementById('fav-remap-panel').style.display='none'">
					<?php esc_html_e( 'Annuleren', 'avpvh-find-and-view' ); ?>
				</button>
			</div>
			<div id="fav-tree-selbar" style="margin:.5em 0;padding:.5em .7em;background:#fff3cd;border:1px solid #ffc107;border-radius:4px;max-width:600px;align-items:center;gap:.7em">
				<span id="fav-sel-count"></span>
				<button id="fav-sel-move" class="button button-primary button-small"><?php esc_html_e( 'Verplaats naar…', 'avpvh-find-and-view' ); ?></button>
				<button id="fav-sel-clear" class="button button-small"><?php esc_html_e( 'Deselecteer', 'avpvh-find-and-view' ); ?></button>
			</div>
			<div id="fav-tree-root" style="margin-top:.5em;max-width:600px;background:#fff;border:1px solid #ccd0d4;border-radius:4px;padding:1em;">
				<p><?php esc_html_e( 'Laden…', 'avpvh-find-and-view' ); ?></p>
			</div>
		</div>
		<?php
	}
}
