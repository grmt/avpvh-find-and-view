import '../css/search.css';
import instantsearch from 'instantsearch.js';
import { searchBox, hits, pagination, configure, index } from 'instantsearch.js/es/widgets';
import { instantMeiliSearch } from '@meilisearch/instant-meilisearch';
import { Lightbox, type LightboxItem } from './lightbox';
import type { FavConfig, MeiliHit } from './types';

function parseContains(q: string): string {
  return q
    .trim()
    .split(/\s+OR\s+/i)
    .map(op =>
      op
        .trim()
        .split(/\s+AND\s+/i)
        .map(ap => {
          ap = ap.trim();
          const neg = /^NOT\s+/i.test(ap);
          const term = ap.replace(/^NOT\s+/i, '').replace(/"/g, '').trim();
          if (!term) return null;
          return (neg ? 'NOT ' : '') + `text CONTAINS "${term}"`;
        })
        .filter(Boolean)
        .join(' AND '),
    )
    .filter(Boolean)
    .join(' OR ');
}

function buildFilter(collectionFilter: string | null, substringMode: boolean, query: string): string {
  const colPart = collectionFilter ?? '';
  if (!substringMode) return colPart;
  const subPart = query ? parseContains(query) : '';
  if (colPart && subPart) return `(${colPart}) AND (${subPart})`;
  return colPart || subPart;
}

function hitToHtml(hit: MeiliHit, withLink: boolean): string {
  const snip = hit._snippetResult?.text?.value ?? hit.text.substring(0, 200) + '…';
  const title = hit.page_number != null
    ? `${hit.title || hit.collection} — pagina ${hit.page_number}`
    : (hit.title || hit.collection || hit.id);

  if (hit.thumb_url && !withLink) {
    return `<a class="fav-thumb" href="${hit.url}" data-id="${hit.id}">
      <img src="${hit.thumb_url}" alt="" loading="lazy"></a>
      <div class="fav-body"><h3>${title}</h3><p>${snip}</p></div>`;
  }
  const img = hit.thumb_url
    ? `<a class="fav-thumb" href="${hit.url}"><img src="${hit.thumb_url}" alt="" loading="lazy"></a>`
    : '';
  return `${img}<div class="fav-body">
    <h3><a href="${hit.url}">${title}</a></h3><p>${snip}</p></div>`;
}

function initInstance(cfg: FavConfig): void {
  const root = document.getElementById(cfg.uid);
  if (!root) return;

  let substringMode = false;
  let collectionFilter: string | null = null;

  const { searchClient: baseClient } = instantMeiliSearch(cfg.meiliUrl, cfg.meiliKey, {
    placeholderSearch: false,
  });

  const client = {
    search: (requests: Parameters<typeof baseClient.search>[0]) => {
      const sbInput = root.querySelector<HTMLInputElement>('.ais-SearchBox-input');
      const q = sbInput?.value.trim() ?? '';
      return baseClient.search(
        requests.map(req => {
          const isMedia = (req as { indexName: string }).indexName === cfg.mediaIndex;
          const filter = isMedia
            ? buildFilter(collectionFilter, substringMode, q)
            : '';
          return { ...req, params: { ...(req as { params: object }).params, filters: filter } };
        }),
      );
    },
  };

  const search = instantsearch({ indexName: cfg.mediaIndex, searchClient: client as Parameters<typeof instantsearch>[0]['searchClient'] });

  const widgets = [
    searchBox({ container: `#${cfg.uid}-searchbox`, placeholder: cfg.placeholder, showReset: true }),
    configure({ hitsPerPage: cfg.perPage, attributesToSnippet: [`text:${cfg.snippetLen}`], snippetEllipsisText: '…' }),
  ];

  if (cfg.showMedia) {
    widgets.push(
      hits({ container: `#${cfg.uid}-hits-media`, templates: { item: (hit: MeiliHit) => hitToHtml(hit, false), empty: () => '' } }),
      pagination({ container: `#${cfg.uid}-pag-media` }),
    );
  }

  if (cfg.showContent) {
    widgets.push(
      index({ indexName: cfg.contentIndex }).addWidgets([
        hits({ container: `#${cfg.uid}-hits-content`, templates: { item: (hit: MeiliHit) => hitToHtml(hit, true), empty: () => '' } }),
        configure({ hitsPerPage: cfg.perPage, attributesToSnippet: [`text:${cfg.snippetLen}`], snippetEllipsisText: '…' }),
        pagination({ container: `#${cfg.uid}-pag-content` }),
      ]),
    );
  }

  search.addWidgets(widgets);
  search.start();

  // Section collapse
  root.querySelectorAll<HTMLElement>('.fav-section-header').forEach(hdr => {
    hdr.addEventListener('click', () => {
      const target = hdr.dataset['target'];
      const body = target ? document.getElementById(target) : null;
      const collapsed = hdr.classList.toggle('collapsed');
      if (body) body.style.display = collapsed ? 'none' : '';
    });
  });

  // Source toggles
  (['media', 'content'] as const).forEach(src => {
    const cb = document.getElementById(`${cfg.uid}-src-${src}`) as HTMLInputElement | null;
    if (!cb) return;
    cb.addEventListener('change', () => {
      const section = document.getElementById(`${cfg.uid}-section-${src}`);
      if (section) section.style.display = cb.checked ? '' : 'none';
      if (src === 'media') {
        const filters = document.getElementById(`${cfg.uid}-collection-filter`);
        if (filters) filters.style.display = cb.checked ? '' : 'none';
      }
    });
  });

  // Substring mode toggle
  const substrCb = document.getElementById(`${cfg.uid}-substr`) as HTMLInputElement | null;
  substrCb?.addEventListener('change', () => {
    substringMode = substrCb.checked;
    search.mainIndex.getHelper()?.search();
  });

  // Collection checkboxes from facets
  const collectionList = document.getElementById(`${cfg.uid}-collection-list`);
  if (collectionList) {
    fetch(`${cfg.meiliUrl}/indexes/${cfg.mediaIndex}/search`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.meiliKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: '', limit: 0, facets: ['collection'] }),
    })
      .then(r => r.json())
      .then((data: { facetDistribution?: Record<string, Record<string, number>> }) => {
        const cols = data.facetDistribution?.['collection'];
        if (!cols) return;
        Object.keys(cols)
          .sort()
          .forEach(name => {
            const li = document.createElement('li');
            const cid = `${cfg.uid}-col-${name.replace(/\W/g, '_')}`;
            li.innerHTML = `<label><input type="checkbox" id="${cid}" checked> ${name} <span style="color:#aaa;font-size:.8em">(${cols[name]})</span></label>`;
            li.querySelector('input')!.addEventListener('change', applyCollectionFilter);
            collectionList.appendChild(li);
          });
      })
      .catch(() => undefined);
  }

  function applyCollectionFilter(): void {
    const checked: string[] = [];
    collectionList?.querySelectorAll<HTMLInputElement>('input:checked').forEach(cb => {
      const label = cb.closest('label')?.textContent?.trim().replace(/\s*\(\d+\)$/, '') ?? '';
      if (label) checked.push(label);
    });
    collectionFilter = checked.length
      ? checked.map(c => `collection = "${c}"`).join(' OR ')
      : null;
    search.mainIndex.getHelper()?.search();
  }

  document.getElementById(`${cfg.uid}-refine-collection`)?.addEventListener('input', function (this: HTMLInputElement) {
    const term = this.value.toLowerCase();
    collectionList?.querySelectorAll<HTMLLIElement>('li').forEach(li => {
      li.style.display = li.textContent?.toLowerCase().includes(term) ? '' : 'none';
    });
  });

  // Lightbox
  if (cfg.showMedia) {
    const lb = new Lightbox();
    const hitsEl = document.getElementById(`${cfg.uid}-hits-media`);

    hitsEl?.addEventListener('click', e => {
      const link = (e.target as Element).closest<HTMLAnchorElement>('a.fav-thumb');
      if (!link) return;
      e.preventDefault();

      const hitId = link.dataset['id'] ?? '';
      const collection = hitId.split('__')[0] ?? '';
      if (!collection) return;

      lb.open([{ url: '', caption: 'Laden…', text: '' }], 0);

      const sbEl = root.querySelector<HTMLInputElement>('.ais-SearchBox-input');
      const q = sbEl?.value.trim() ?? '';

      fetch(`${cfg.meiliUrl}/indexes/${cfg.mediaIndex}/search`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${cfg.meiliKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          q,
          filter: `collection = "${collection}"`,
          limit: 5000,
          attributesToRetrieve: ['id', 'url', 'title', 'page_number', 'text', 'collection'],
          attributesToHighlight: ['text'],
          highlightPreTag: '<em>',
          highlightPostTag: '</em>',
        }),
      })
        .then(r => r.json())
        .then((data: { hits?: MeiliHit[] }) => {
          const fetchedHits = (data.hits ?? []).filter(h => h.url);
          fetchedHits.sort((a, b) => (a.page_number ?? 0) - (b.page_number ?? 0));
          if (!fetchedHits.length) { lb.close(); return; }

          const items: LightboxItem[] = fetchedHits.map(h => {
            const highlighted = h._formatted?.text ?? h.text;
            const html = highlighted
              .split(/\n\n+/)
              .map(p => `<p style="margin:0 0 .8em">${p.replace(/\n/g, '<br>')}</p>`)
              .join('');
            const caption = (h.collection ?? '') + (h.page_number != null ? ` — pagina ${h.page_number}` : (h.title ? ` — ${h.title}` : ''));
            return { url: h.url, caption, text: html };
          });

          const startIdx = fetchedHits.findIndex(h => h.id === hitId);
          const focusSb = (): void => { root.querySelector<HTMLInputElement>('.ais-SearchBox-input')?.focus(); };
          lb.open(items, startIdx < 0 ? 0 : startIdx, focusSb);
        })
        .catch(() => lb.close());
    });
  }
}

// Bootstrap all instances injected by PHP via wp_localize_script
(window.favInstances ?? []).forEach(initInstance);
