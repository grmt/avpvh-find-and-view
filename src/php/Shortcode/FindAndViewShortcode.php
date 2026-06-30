<?php declare( strict_types = 1 );

namespace Avpvh\FindAndView\Shortcode;

use Avpvh\FindAndView\Settings;

final class FindAndViewShortcode {
	private static int $instance_count = 0;

	public function register(): void {
		add_shortcode( 'avpvh_find_and_view', [ $this, 'render' ] );
		add_action( 'wp_footer', [ $this, 'footer_scripts' ] );
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

		$uid = 'fav-' . ( ++self::$instance_count );

		// Store instance config for footer scripts
		global $fav_instances;
		$fav_instances[] = compact( 'uid', 'atts', 's' );

		$show_media   = $atts['show_media']   === 'true';
		$show_content = $atts['show_content'] === 'true';

		ob_start();
		?>
		<div class="fav-wrap" id="<?php echo esc_attr( $uid ); ?>">
			<div id="<?php echo esc_attr( $uid ); ?>-searchbox"></div>

			<div class="fav-layout">
				<!-- Sidebar filters -->
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

				<!-- Results -->
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

	public function footer_scripts(): void {
		global $fav_instances;
		if ( empty( $fav_instances ) ) return;

		wp_enqueue_script(
			'instant-meilisearch',
			'https://cdn.jsdelivr.net/npm/@meilisearch/instant-meilisearch/dist/instant-meilisearch.umd.min.js',
			[],
			null,
			true
		);
		wp_enqueue_script(
			'instantsearch',
			'https://cdn.jsdelivr.net/npm/instantsearch.js@4/dist/instantsearch.production.min.js',
			[],
			null,
			true
		);

		foreach ( $fav_instances as $inst ) {
			[ 'uid' => $uid, 'atts' => $atts, 's' => $s ] = $inst;
			$this->output_instance_script( $uid, $atts, $s );
		}
	}

	private function output_instance_script( string $uid, array $atts, array $s ): void {
		$media_index   = Settings::media_index();
		$content_index = Settings::content_index();
		$per_page      = (int) $atts['per_page'];
		$snippet_len   = (int) $atts['snippet_len'];
		$show_media    = $atts['show_media']   === 'true';
		$show_content  = $atts['show_content'] === 'true';
		?>
<style>
.fav-wrap { max-width: 1100px; margin: 0 auto; }
.fav-layout { display: flex; gap: 1.5em; align-items: flex-start; margin-top: 1em; }
.fav-filters { width: 180px; flex-shrink: 0; display: flex; flex-direction: column; gap: .8em; }
.fav-filter-panel { border: 1px solid #e0e0e0; border-radius: 6px; padding: .8em 1em; background: #fafafa; }
.fav-filter-panel h4 { margin: 0 0 .6em; font-size: .85em; text-transform: uppercase; letter-spacing: .05em; color: #888; }
.fav-source-toggle { display: block; font-size: .9em; margin: .3em 0; cursor: pointer; }
.fav-source-toggle input { margin-right: .4em; }
.fav-results { flex: 1; min-width: 0; }
.fav-section-header { font-weight: 600; font-size: .95em; color: #444; border-bottom: 2px solid #e0e0e0; padding-bottom: .3em; margin: 1.2em 0 .8em; cursor: pointer; user-select: none; }
.fav-section-header:first-child { margin-top: 0; }
.fav-section-header.collapsed .fav-collapse-icon { display: inline-block; transform: rotate(-90deg); }
.fav-refine-wrap { margin-bottom: .8em; }
.fav-refine-input { width: 100%; padding: .35em .6em; font-size: .88em; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box; }
.fav-collection-list { list-style: none; margin: 0; padding: 0; }
.fav-collection-list li { margin: .3em 0; font-size: .85em; }
.fav-collection-list label { cursor: pointer; }
.fav-wrap .ais-Hits-item { align-items: flex-start !important; gap: 1.2em !important; border: 1px solid #e0e0e0 !important; border-radius: 6px !important; padding: 1em !important; background: #fff !important; }
.fav-wrap .ais-Hits-item img { width: 120px !important; max-width: 120px !important; height: auto !important; border: 1px solid #ddd; border-radius: 3px; object-fit: contain; flex-shrink: 0; display: block !important; }
.fav-wrap .ais-Hits-item a.fav-thumb { flex-shrink: 0 !important; display: block !important; width: 120px !important; }
.fav-wrap .ais-Hits-item a.fav-thumb:hover { opacity: .85; }
.fav-wrap .ais-Hits-item .fav-body { flex: 1 !important; min-width: 0 !important; }
.fav-wrap .ais-Hits-item .fav-body a { text-decoration: none; color: #333; }
.fav-wrap .ais-Hits-item .fav-body a:hover { text-decoration: underline; }
.fav-wrap .ais-Hits-item h3 { margin: 0 0 .4em !important; font-size: 1em !important; }
.fav-wrap .ais-Hits-item p { margin: 0 !important; font-size: .88em; color: #555; line-height: 1.6; }
.fav-wrap .ais-Hits-item em { background: #fff3b0; font-style: normal; padding: 0 2px; border-radius: 2px; }
/* Lightbox */
.fav-lb { position: fixed; inset: 0; z-index: 99999; background: rgba(0,0,0,.92); display: flex; flex-direction: column; }
.fav-lb-toolbar { display: flex; align-items: center; justify-content: space-between; padding: .35em .8em; background: rgba(0,0,0,.65); flex-shrink: 0; gap: .5em; }
.fav-lb-caption { color: #ccc; font-size: .82em; margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fav-lb-counter { color: #888; font-size: .78em; white-space: nowrap; }
.fav-lb-body { display: flex; flex: 1; min-height: 0; }
@media (orientation:landscape) { .fav-lb-body { flex-direction: row; } }
@media (orientation:portrait)  { .fav-lb-body { flex-direction: column; } }
.fav-lb-nav { display: flex; align-items: center; flex-shrink: 0; }
.fav-lb-img-wrap { flex: 1; position: relative; display: flex; align-items: center; justify-content: center; min-width: 0; overflow: hidden; }
.fav-lb-img { max-width: 100%; max-height: 100%; object-fit: contain; box-shadow: 0 4px 32px rgba(0,0,0,.6); transform-origin: center; transition: transform .15s; }
.fav-lb-text-wrap { display: flex; flex-direction: column; background: #fff; border-left: 1px solid #ddd; }
@media (orientation:landscape) { .fav-lb-text-wrap { width: 36%; min-width: 220px; } }
@media (orientation:portrait)  { .fav-lb-text-wrap { height: 42%; border-left: none; border-top: 1px solid #ddd; } }
.fav-lb-text-bar { display: flex; align-items: center; gap: .4em; padding: .3em .6em; background: #f5f5f5; border-bottom: 1px solid #e0e0e0; flex-shrink: 0; font-size: .75em; color: #666; }
.fav-lb-text-content { overflow-y: auto; padding: .8em 1em; font-size: .72em; line-height: 1.75; color: #333; flex: 1; min-height: 0; }
.fav-lb-text-content em { background: #fff3b0; font-style: normal; padding: 0 2px; border-radius: 2px; }
.fav-lb-text-empty { color: #aaa; font-style: italic; }
.fav-lb-btn { background: rgba(255,255,255,.12); border: none; color: #fff; cursor: pointer; font-size: 1.6em; line-height: 1; padding: .5em .65em; transition: background .15s; }
.fav-lb-btn:hover { background: rgba(255,255,255,.22); }
.fav-lb-btn:disabled { opacity: .2; cursor: default; }
.fav-lb-close { font-size: 1em; padding: .35em .55em; }
.fav-lb-zbtn { border: 1px solid #ccc; background: #fff; color: #444; cursor: pointer; font-size: .95em; width: 1.7em; height: 1.7em; border-radius: 3px; line-height: 1; display: flex; align-items: center; justify-content: center; }
.fav-lb-zbtn:hover { background: #eee; }
.fav-lb-iz { position: absolute; bottom: .5em; right: .5em; display: flex; gap: .3em; }
</style>
<script>
(function () {
  var uid          = <?php echo wp_json_encode( $uid ); ?>;
  var meiliUrl     = <?php echo wp_json_encode( $s['meili_url'] ); ?>;
  var meiliKey     = <?php echo wp_json_encode( $s['meili_key'] ); ?>;
  var mediaIndex   = <?php echo wp_json_encode( $media_index ); ?>;
  var contentIndex = <?php echo wp_json_encode( $content_index ); ?>;
  var perPage      = <?php echo $per_page; ?>;
  var snippetLen   = <?php echo $snippet_len; ?>;
  var showMedia    = <?php echo $show_media ? 'true' : 'false'; ?>;
  var showContent  = <?php echo $show_content ? 'true' : 'false'; ?>;

  if (!document.getElementById(uid + '-searchbox')) return;

  var substringMode      = false;
  var collectionFilter   = null;
  var currentFilter      = '';

  function rebuildFilter() {
    currentFilter = collectionFilter ? '(' + collectionFilter + ')' : '';
    search.mainIndex.getHelper().search();
  }

  function parseContains(q) {
    q = q.trim();
    if (!q) return '';
    return q.split(/\s+OR\s+/i).map(function(op) {
      return op.trim().split(/\s+AND\s+/i).map(function(ap) {
        ap = ap.trim();
        var neg  = /^NOT\s+/i.test(ap);
        var term = ap.replace(/^NOT\s+/i,'').replace(/"/g,'').trim();
        if (!term) return null;
        return (neg ? 'NOT ' : '') + 'text CONTAINS "' + term + '"';
      }).filter(Boolean).join(' AND ');
    }).filter(Boolean).join(' OR ');
  }

  var baseClient = instantMeiliSearch(meiliUrl, meiliKey, { placeholderSearch: false }).searchClient;

  var searchClient = {
    search: function(requests) {
      return baseClient.search(requests.map(function(req) {
        if (req.indexName !== mediaIndex) {
          return Object.assign({}, req, { params: Object.assign({}, req.params, { filters: '' }) });
        }
        var q = (req.params.query || '').trim();
        if (substringMode) {
          var expr = q ? parseContains(q) : '';
          var fp   = currentFilter && expr ? '(' + currentFilter + ') AND (' + expr + ')'
                   : currentFilter || expr;
          return Object.assign({}, req, { params: Object.assign({}, req.params, { query: '', filters: fp }) });
        }
        return Object.assign({}, req, { params: Object.assign({}, req.params, { filters: currentFilter }) });
      }));
    },
  };

  var search = instantsearch({ indexName: mediaIndex, searchClient: searchClient });

  function mediaTemplate(hit) {
    var title = hit.title || hit.collection || hit.id;
    if (hit.page_number) title += ' — pagina ' + hit.page_number;
    var snip  = hit._snippetResult && hit._snippetResult.text
      ? hit._snippetResult.text.value
      : (hit.text ? hit.text.substring(0, 200) + '…' : '');
    var thumb = hit.thumb_url || hit.url || '';
    var url   = hit.url || thumb;
    if (thumb) {
      return '<a class="fav-thumb" href="' + url + '" data-id="' + hit.id + '">'
        + '<img src="' + thumb + '" alt="" loading="lazy"></a>'
        + '<div class="fav-body"><h3>' + title + '</h3><p>' + snip + '</p></div>';
    }
    return '<div class="fav-body"><h3>' + title + '</h3><p>' + snip + '</p></div>';
  }

  function contentTemplate(hit) {
    var title = hit.title || hit.id;
    var url   = hit.url || '';
    var snip  = hit._snippetResult && hit._snippetResult.text
      ? hit._snippetResult.text.value
      : (hit.text ? hit.text.substring(0, 200) + '…' : '');
    var thumb = hit.thumb_url || '';
    var img   = thumb ? '<a class="fav-thumb" href="' + url + '"><img src="' + thumb + '" alt="" loading="lazy"></a>' : '';
    return img + '<div class="fav-body"><h3><a href="' + url + '">' + title + '</a></h3><p>' + snip + '</p></div>';
  }

  var widgets = [
    instantsearch.widgets.searchBox({
      container: '#' + uid + '-searchbox',
      placeholder: <?php echo wp_json_encode( $atts['placeholder'] ); ?>,
      showReset: true,
    }),
    instantsearch.widgets.configure({
      hitsPerPage: perPage,
      attributesToSnippet: ['text:' + snippetLen],
      snippetEllipsisText: '…',
    }),
  ];

  if (showMedia) {
    widgets.push(
      instantsearch.widgets.hits({
        container: '#' + uid + '-hits-media',
        templates: { item: mediaTemplate, empty: function(){ return ''; } },
      }),
      instantsearch.widgets.pagination({ container: '#' + uid + '-pag-media' })
    );
  }

  if (showContent) {
    widgets.push(
      instantsearch.widgets.index({ indexName: contentIndex }).addWidgets([
        instantsearch.widgets.hits({
          container: '#' + uid + '-hits-content',
          templates: { item: contentTemplate, empty: function(){ return ''; } },
        }),
        instantsearch.widgets.configure({
          hitsPerPage: perPage,
          attributesToSnippet: ['text:' + snippetLen],
          snippetEllipsisText: '…',
        }),
        instantsearch.widgets.pagination({ container: '#' + uid + '-pag-content' }),
      ])
    );
  }

  search.addWidgets(widgets);
  search.start();

  // Section collapse
  document.querySelectorAll('#' + uid + ' .fav-section-header').forEach(function(hdr) {
    hdr.addEventListener('click', function() {
      var body = document.getElementById(hdr.dataset.target);
      var collapsed = hdr.classList.toggle('collapsed');
      body.style.display = collapsed ? 'none' : '';
    });
  });

  // Source toggles
  ['media','content'].forEach(function(src) {
    var cb = document.getElementById(uid + '-src-' + src);
    if (!cb) return;
    cb.addEventListener('change', function() {
      var section = document.getElementById(uid + '-section-' + src);
      if (section) section.style.display = cb.checked ? '' : 'none';
      var filters = document.getElementById(uid + '-collection-filter');
      if (filters && src === 'media') filters.style.display = cb.checked ? '' : 'none';
    });
  });

  // Collection checkboxes — loaded from facets
  fetch(meiliUrl + '/indexes/' + mediaIndex + '/search', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + meiliKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: '', limit: 0, facets: ['collection'] }),
  })
  .then(function(r) { return r.json(); })
  .then(function(data) {
    var cols = data.facetDistribution && data.facetDistribution.collection;
    if (!cols) return;
    var list = document.getElementById(uid + '-collection-list');
    Object.keys(cols).sort().forEach(function(name) {
      var li  = document.createElement('li');
      var cid = uid + '-col-' + name.replace(/\W/g,'_');
      li.innerHTML = '<label><input type="checkbox" id="' + cid + '" checked> '
        + name + ' <span style="color:#aaa;font-size:.8em">(' + cols[name] + ')</span></label>';
      li.querySelector('input').addEventListener('change', applyCollectionFilter);
      list.appendChild(li);
    });
  });

  function applyCollectionFilter() {
    var checked = [];
    document.querySelectorAll('#' + uid + '-collection-list input:checked').forEach(function(cb) {
      checked.push(cb.closest('label').textContent.trim().replace(/\s*\(\d+\)$/,''));
    });
    collectionFilter = checked.length
      ? checked.map(function(c){ return 'collection = "' + c + '"'; }).join(' OR ')
      : null;
    rebuildFilter();
  }

  document.getElementById(uid + '-refine-collection').addEventListener('input', function() {
    var term = this.value.toLowerCase();
    document.querySelectorAll('#' + uid + '-collection-list li').forEach(function(li) {
      li.style.display = li.textContent.toLowerCase().includes(term) ? '' : 'none';
    });
  });

  document.getElementById(uid + '-substr').addEventListener('change', function() {
    substringMode = this.checked;
    rebuildFilter();
  });

  // Lightbox
  (function() {
    var lbEl    = null;
    var lbItems = [];
    var lbIdx   = 0;
    var imgZoom = 1;
    var txtZoom = 1;

    function setImgZoom(z) {
      imgZoom = Math.max(0.2, Math.min(8, z));
      lbEl.querySelector('.fav-lb-img').style.transform = 'scale(' + imgZoom + ')';
    }
    function setTxtZoom(z) {
      txtZoom = Math.max(0.5, Math.min(3, z));
      lbEl.querySelector('.fav-lb-text-content').style.fontSize = (txtZoom * 0.72) + 'em';
    }

    function lbShow(idx) {
      lbIdx = Math.max(0, Math.min(lbItems.length - 1, idx));
      var item = lbItems[lbIdx];
      lbEl.querySelector('.fav-lb-img').src            = item.url;
      lbEl.querySelector('.fav-lb-caption').textContent = item.caption;
      lbEl.querySelector('.fav-lb-counter').textContent = (lbIdx + 1) + ' / ' + lbItems.length;
      lbEl.querySelector('.fav-lb-prev').disabled       = lbIdx === 0;
      lbEl.querySelector('.fav-lb-next').disabled       = lbIdx === lbItems.length - 1;
      var content = lbEl.querySelector('.fav-lb-text-content');
      content.innerHTML = item.text || '<span class="fav-lb-text-empty">Geen tekst beschikbaar.</span>';
      content.scrollTop = 0;
    }

    function lbOpen(items, startIdx) {
      if (lbEl) document.body.removeChild(lbEl);
      lbItems = items;
      imgZoom = 1;
      txtZoom = 1;
      lbEl = document.createElement('div');
      lbEl.className = 'fav-lb';
      lbEl.innerHTML =
        '<div class="fav-lb-toolbar">'
          + '<p class="fav-lb-caption"></p>'
          + '<div style="display:flex;gap:.5em;align-items:center">'
            + '<span class="fav-lb-counter"></span>'
            + '<button class="fav-lb-btn fav-lb-close" title="Sluiten (Esc)">&#x2715;</button>'
          + '</div>'
        + '</div>'
        + '<div class="fav-lb-body">'
          + '<div class="fav-lb-nav"><button class="fav-lb-btn fav-lb-prev">&#x2039;</button></div>'
          + '<div class="fav-lb-img-wrap">'
            + '<img class="fav-lb-img" alt="">'
            + '<div class="fav-lb-iz">'
              + '<button class="fav-lb-zbtn">&#x2212;</button>'
              + '<button class="fav-lb-zbtn">1:1</button>'
              + '<button class="fav-lb-zbtn">+</button>'
            + '</div>'
          + '</div>'
          + '<div class="fav-lb-text-wrap">'
            + '<div class="fav-lb-text-bar">Tekst &nbsp;'
              + '<button class="fav-lb-zbtn">&#x2212;</button>'
              + '<button class="fav-lb-zbtn">A</button>'
              + '<button class="fav-lb-zbtn">+</button>'
            + '</div>'
            + '<div class="fav-lb-text-content"></div>'
          + '</div>'
          + '<div class="fav-lb-nav"><button class="fav-lb-btn fav-lb-next">&#x203A;</button></div>'
        + '</div>';
      document.body.appendChild(lbEl);

      lbEl.querySelector('.fav-lb-close').onclick = lbClose;
      lbEl.querySelector('.fav-lb-prev').onclick  = function() { lbShow(lbIdx - 1); };
      lbEl.querySelector('.fav-lb-next').onclick  = function() { lbShow(lbIdx + 1); };

      var izBtns = lbEl.querySelectorAll('.fav-lb-iz .fav-lb-zbtn');
      izBtns[0].onclick = function() { setImgZoom(imgZoom / 1.3); };
      izBtns[1].onclick = function() { setImgZoom(1); };
      izBtns[2].onclick = function() { setImgZoom(imgZoom * 1.3); };

      var tzBtns = lbEl.querySelectorAll('.fav-lb-text-bar .fav-lb-zbtn');
      tzBtns[0].onclick = function() { setTxtZoom(txtZoom / 1.2); };
      tzBtns[1].onclick = function() { setTxtZoom(1); };
      tzBtns[2].onclick = function() { setTxtZoom(txtZoom * 1.2); };

      lbEl.querySelector('.fav-lb-img-wrap').addEventListener('wheel', function(e) {
        if (!e.ctrlKey) return;
        e.preventDefault();
        setImgZoom(imgZoom * (e.deltaY < 0 ? 1.1 : 0.9));
      }, { passive: false });

      lbEl.querySelector('.fav-lb-text-content').addEventListener('wheel', function(e) {
        if (!e.ctrlKey) return;
        e.preventDefault();
        setTxtZoom(txtZoom * (e.deltaY < 0 ? 1.1 : 0.9));
      }, { passive: false });

      lbShow(startIdx);
    }

    function lbClose() {
      if (lbEl) { document.body.removeChild(lbEl); lbEl = null; }
      var sb = document.querySelector('#' + uid + '-searchbox .ais-SearchBox-input');
      if (sb) sb.focus();
    }

    document.addEventListener('keydown', function(e) {
      if (!lbEl) return;
      if (e.key === 'ArrowLeft')  lbShow(lbIdx - 1);
      if (e.key === 'ArrowRight') lbShow(lbIdx + 1);
      if (e.key === 'Escape')     lbClose();
    });

    // Click handler on media hits — fetches full collection and opens lightbox
    var hitsEl = document.getElementById(uid + '-hits-media');
    if (hitsEl) {
      hitsEl.addEventListener('click', function(e) {
        var link = e.target.closest('a.fav-thumb');
        if (!link) return;
        e.preventDefault();

        var hitId     = link.dataset.id || '';
        var collection = hitId.split('__')[0] || '';
        if (!collection) return;

        lbOpen([{ url: '', caption: 'Laden…', text: '' }], 0);

        var sbEl = document.querySelector('#' + uid + '-searchbox .ais-SearchBox-input');
        var q    = sbEl ? sbEl.value.trim() : '';

        fetch(meiliUrl + '/indexes/' + mediaIndex + '/search', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + meiliKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            q: q,
            filter: 'collection = "' + collection + '"',
            limit: 5000,
            attributesToRetrieve: ['id', 'url', 'title', 'page_number', 'text', 'collection'],
            attributesToHighlight: ['text'],
            highlightPreTag: '<em>',
            highlightPostTag: '</em>',
          }),
        })
        .then(function(r) { return r.json(); })
        .then(function(data) {
          var hits = (data.hits || []).filter(function(h) { return h.url; });
          hits.sort(function(a, b) { return (a.page_number || 0) - (b.page_number || 0); });
          if (!hits.length) { lbClose(); return; }
          var items = hits.map(function(h) {
            var highlighted = h._formatted && h._formatted.text ? h._formatted.text : (h.text || '');
            var html = highlighted.split(/\n\n+/).map(function(p) {
              return '<p style="margin:0 0 .8em">' + p.replace(/\n/g,'<br>') + '</p>';
            }).join('');
            var caption = (h.collection || '') + (h.page_number ? ' — pagina ' + h.page_number : (h.title ? ' — ' + h.title : ''));
            return { url: h.url, caption: caption, text: html };
          });
          var startIdx = hits.findIndex(function(h) { return h.id === hitId; });
          lbOpen(items, startIdx < 0 ? 0 : startIdx);
        })
        .catch(lbClose);
      });
    }
  })();
})();
</script>
		<?php
	}
}
