import type { FavConfig, MeiliHit } from './types';
import type { Lightbox } from './lightbox';

interface LightboxItem { url: string; caption: string; text: string }

const PAGE_SIZE = 60;

export class BrowseMode {
  private currentCollection: string | null = null;
  private loadMoreOffset = 0;
  private lightboxHandler: ((e: Event) => Promise<void>) | null = null;

  constructor(
    private readonly cfg: FavConfig,
    private readonly lb: Lightbox,
    private readonly container: HTMLElement,
    private readonly breadcrumbEl: HTMLElement,
    private gridEl: HTMLElement,
  ) {}

  show(): void { this.container.style.display = ''; }
  hide(): void { this.container.style.display = 'none'; }

  current(): string | null { return this.currentCollection; }

  async enter(collection?: string): Promise<void> {
    this.show();
    if (collection) {
      this.currentCollection = collection;
      this.loadMoreOffset = 0;
      await this.renderCollection(collection, true);
    } else {
      this.currentCollection = null;
      await this.renderOverview();
    }
  }

  private renderBreadcrumb(collection: string | null): void {
    if (!collection) {
      this.breadcrumbEl.innerHTML = '<span class="fav-bc-current">Galerij</span>';
      return;
    }
    this.breadcrumbEl.innerHTML =
      '<a class="fav-bc-link" href="#">Galerij</a>' +
      '<span class="fav-bc-sep">›</span>' +
      `<span class="fav-bc-current">${collection}</span>`;
    this.breadcrumbEl.querySelector('.fav-bc-link')?.addEventListener('click', e => {
      e.preventDefault();
      void this.enter();
    });
  }

  private async renderOverview(): Promise<void> {
    this.renderBreadcrumb(null);
    this.gridEl.innerHTML = '<div class="fav-browse-loading">Laden…</div>';

    const [facetData, coversData] = await Promise.all([
      this.fetchFacets(),
      this.fetchAllCovers(),
    ]);

    const cols = facetData.facetDistribution?.['collection'];
    if (!cols) { this.gridEl.innerHTML = '<p>Geen collecties gevonden.</p>'; return; }

    const names = Object.keys(cols).sort();
    this.gridEl.innerHTML = '';
    this.gridEl.className = 'fav-browse-grid fav-col-grid';

    names.forEach(name => {
      const card = document.createElement('div');
      card.className = 'fav-col-card';
      const thumb = coversData[name] ?? null;
      card.innerHTML =
        `<div class="fav-col-thumb">${thumb ? `<img src="${thumb}" alt="" loading="lazy">` : ''}</div>` +
        `<div class="fav-col-label">${name}</div>` +
        `<div class="fav-col-count">${cols[name]}</div>`;
      card.addEventListener('click', () => void this.enter(name));
      this.gridEl.appendChild(card);
    });
  }

  private async fetchFacets(): Promise<{ facetDistribution?: Record<string, Record<string, number>> }> {
    return fetch(`${this.cfg.meiliUrl}/indexes/${this.cfg.mediaIndex}/search`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.cfg.meiliKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: '', limit: 0, facets: ['collection'] }),
    }).then(r => r.json());
  }

  private async fetchAllCovers(): Promise<Record<string, string | null>> {
    // One request with high limit; group by collection in JS to get first thumbnail per collection
    const data = await fetch(`${this.cfg.meiliUrl}/indexes/${this.cfg.mediaIndex}/search`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.cfg.meiliKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        q: '',
        limit: 1000,
        attributesToRetrieve: ['collection', 'thumb_url', 'page_number'],
      }),
    }).then(r => r.json()) as { hits: MeiliHit[] };

    const covers: Record<string, string | null> = {};
    // Sort by page_number so page_001 (or the first page) becomes the cover
    const sorted = (data.hits ?? [])
      .filter(h => h.thumb_url)
      .sort((a, b) => (a.page_number ?? 0) - (b.page_number ?? 0));
    for (const hit of sorted) {
      if (!(hit.collection in covers)) {
        covers[hit.collection] = hit.thumb_url || null;
      }
    }
    return covers;
  }

  private async renderCollection(name: string, reset: boolean): Promise<void> {
    this.renderBreadcrumb(name);

    if (reset) {
      this.gridEl.innerHTML = '<div class="fav-browse-loading">Laden…</div>';
      this.gridEl.className = 'fav-browse-grid fav-item-grid';
      this.detachLightboxHandler();
    } else {
      this.gridEl.querySelector('.fav-load-more')?.remove();
    }

    const data = await fetch(`${this.cfg.meiliUrl}/indexes/${this.cfg.mediaIndex}/search`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.cfg.meiliKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        q: '',
        filter: `collection = "${name}"`,
        limit: PAGE_SIZE,
        offset: this.loadMoreOffset,
        attributesToRetrieve: ['id', 'url', 'thumb_url', 'title', 'page_number', 'collection'],
      }),
    }).then(r => r.json()) as { hits: MeiliHit[]; estimatedTotalHits: number };

    const hits = (data.hits ?? []).sort((a, b) => (a.page_number ?? 0) - (b.page_number ?? 0));
    const total = data.estimatedTotalHits ?? 0;

    if (reset) this.gridEl.innerHTML = '';

    hits.forEach(hit => {
      const div = document.createElement('div');
      div.className = 'fav-browse-item';
      const thumb = hit.thumb_url || hit.url;
      div.innerHTML = thumb
        ? `<a class="fav-thumb" href="${hit.url}" data-id="${hit.id}">` +
          `<img src="${thumb}" alt="" loading="lazy">` +
          (hit.page_number != null ? `<span class="fav-page-badge">${hit.page_number}</span>` : '') +
          `</a>`
        : `<div class="fav-body"><span>${hit.title || name}</span></div>`;
      this.gridEl.appendChild(div);
    });

    if (reset) this.attachLightboxHandler(name);

    this.loadMoreOffset += hits.length;
    if (this.loadMoreOffset < total) {
      const btn = document.createElement('button');
      btn.className = 'fav-load-more';
      btn.textContent = `Meer laden (${total - this.loadMoreOffset} resterend)`;
      btn.addEventListener('click', () => {
        btn.disabled = true;
        void this.renderCollection(name, false);
      });
      this.gridEl.appendChild(btn);
    }
  }

  private attachLightboxHandler(collection: string): void {
    const handler = async (e: Event): Promise<void> => {
      const link = (e.target as Element).closest<HTMLAnchorElement>('a.fav-thumb');
      if (!link) return;
      e.preventDefault();
      const hitId = link.dataset['id'] ?? '';

      const data = await fetch(`${this.cfg.meiliUrl}/indexes/${this.cfg.mediaIndex}/search`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.cfg.meiliKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          q: '',
          filter: `collection = "${collection}"`,
          limit: 5000,
          attributesToRetrieve: ['id', 'url', 'title', 'page_number', 'text', 'collection'],
        }),
      }).then(r => r.json()) as { hits: MeiliHit[] };

      const allHits = (data.hits ?? [])
        .filter(h => h.url)
        .sort((a, b) => (a.page_number ?? 0) - (b.page_number ?? 0));

      const items: LightboxItem[] = allHits.map(h => ({
        url: h.url,
        caption: (h.collection ?? '') + (h.page_number != null ? ` — pagina ${h.page_number}` : h.title ? ` — ${h.title}` : ''),
        text: h.text
          ? h.text.split(/\n\n+/).map(p => `<p style="margin:0 0 .8em">${p.replace(/\n/g, '<br>')}</p>`).join('')
          : '',
      }));

      const startIdx = allHits.findIndex(h => h.id === hitId);
      this.lb.open(items, startIdx < 0 ? 0 : startIdx);
    };

    this.lightboxHandler = handler;
    this.gridEl.addEventListener('click', handler);
  }

  private detachLightboxHandler(): void {
    if (this.lightboxHandler) {
      this.gridEl.removeEventListener('click', this.lightboxHandler);
      this.lightboxHandler = null;
    }
  }
}
