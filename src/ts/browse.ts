import type { FavConfig, MeiliHit } from './types';
import type { Lightbox, LightboxItem } from './lightbox';
import { renderMarkdown, renderPlain, looksLikeMarkdown } from './markdown';

const PAGE_SIZE = 60;

export class BrowseMode {
  private currentPath: string | null = null;   // null = root, string = folder or collection
  private loadMoreOffset = 0;
  private lightboxHandler: ((e: Event) => Promise<void>) | null = null;
  private allCollections: Record<string, number> = {};  // cached facets
  private activeCollections: Set<string> | null = null; // null = all active

  constructor(
    private readonly cfg: FavConfig,
    private readonly lb: Lightbox,
    private readonly container: HTMLElement,
    private readonly breadcrumbEl: HTMLElement,
    private gridEl: HTMLElement,
  ) {}

  show(): void { this.container.style.display = ''; }
  hide(): void { this.container.style.display = 'none'; }

  current(): string | null { return this.currentPath; }

  setActiveCollections(paths: string[] | null): void {
    this.activeCollections = paths ? new Set(paths) : null;
    if (this.container.style.display !== 'none') {
      void this.enter(this.currentPath ?? undefined);
    }
  }

  async enter(path?: string): Promise<void> {
    this.show();
    this.currentPath = path ?? null;
    this.loadMoreOffset = 0;

    // Fetch facets once and cache
    if (!Object.keys(this.allCollections).length) {
      const data = await this.fetchFacets();
      this.allCollections = data.facetDistribution?.['collection'] ?? {};
    }

    // Determine if path is a leaf collection (has own documents) or a folder prefix
    const isLeaf = path !== undefined && path in this.allCollections;
    const isFolder = path === undefined || this.hasChildren(path);

    if (isLeaf && !isFolder) {
      await this.renderCollection(path!);
    } else if (isLeaf && isFolder) {
      // Both a folder and a collection — treat as folder (sub-collections take priority)
      await this.renderFolder(path ?? null);
    } else {
      await this.renderFolder(path ?? null);
    }
  }

  /** Returns true if any collection starts with `prefix/` */
  private hasChildren(prefix: string | undefined): boolean {
    if (!prefix) return true;
    const p = prefix + '/';
    return Object.keys(this.allCollections).some(c => c.startsWith(p));
  }

  private rootLabel(): string {
    return this.cfg.browseRootLabel || 'Galerij';
  }

  private renderBreadcrumb(path: string | null): void {
    const root = this.rootLabel();
    if (!path) {
      this.breadcrumbEl.innerHTML = `<span class="fav-bc-current">${root}</span>`;
      return;
    }
    const parts = path.split('/');
    let html = `<a class="fav-bc-link" href="#" data-path="">${root}</a>`;
    parts.forEach((part, i) => {
      const partPath = parts.slice(0, i + 1).join('/');
      html += '<span class="fav-bc-sep">›</span>';
      if (i === parts.length - 1) {
        html += `<span class="fav-bc-current">${part}</span>`;
      } else {
        html += `<a class="fav-bc-link" href="#" data-path="${partPath}">${part}</a>`;
      }
    });
    this.breadcrumbEl.innerHTML = html;
    this.breadcrumbEl.querySelectorAll<HTMLAnchorElement>('.fav-bc-link').forEach(link => {
      link.addEventListener('click', e => {
        e.preventDefault();
        this.allCollections = {};  // invalidate cache so we re-fetch on back-nav
        void this.enter(link.dataset['path'] || undefined);
      });
    });
  }

  private async renderFolder(prefix: string | null): Promise<void> {
    this.renderBreadcrumb(prefix);
    this.gridEl.innerHTML = '<div class="fav-browse-loading">Laden…</div>';
    this.gridEl.className = 'fav-browse-grid fav-col-grid';
    this.detachLightboxHandler();

    const cols = this.allCollections;
    const prefixSlash = prefix ? prefix + '/' : '';

    // Collect unique children: folders (have sub-collections) and leaves
    const folders = new Set<string>();
    const leaves: string[] = [];

    for (const col of Object.keys(cols)) {
      if (prefix && !col.startsWith(prefixSlash) && col !== prefix) continue;
      if (this.activeCollections && !this.activeCollections.has(col)) continue;
      const rest = prefix ? col.slice(prefixSlash.length) : col;
      if (!rest) continue;
      const slash = rest.indexOf('/');
      if (slash === -1) {
        // Direct child collection (leaf at this level)
        const fullPath = prefix ? prefixSlash + rest : rest;
        leaves.push(fullPath);
      } else {
        // Sub-folder
        const folderName = rest.slice(0, slash);
        const fullPath = prefix ? prefixSlash + folderName : folderName;
        folders.add(fullPath);
      }
    }

    const covers = await this.fetchCoversFor([...folders, ...leaves]);

    this.gridEl.innerHTML = '';

    // Folders first
    [...folders].sort().forEach(folderPath => {
      const name = folderPath.split('/').at(-1)!;
      const card = this.makeCard(name, covers[folderPath] ?? [], null, '📁');
      card.addEventListener('click', () => void this.enter(folderPath));
      this.gridEl.appendChild(card);
    });

    // Then leaf collections
    leaves.sort().forEach(colPath => {
      const name = colPath.split('/').at(-1)!;
      const count = cols[colPath] ?? 0;
      const card = this.makeCard(name, covers[colPath] ?? [], count);
      card.addEventListener('click', () => void this.enter(colPath));
      this.gridEl.appendChild(card);
    });

    if (!folders.size && !leaves.length) {
      this.gridEl.innerHTML = '<p>Geen collecties gevonden.</p>';
    }
  }

  private makeCard(
    label: string,
    thumbs: string[],
    count: number | null,
    icon = '',
  ): HTMLElement {
    const card = document.createElement('div');
    card.className = 'fav-col-card';
    let thumbHtml: string;
    if (thumbs.length) {
      const n = Math.min(thumbs.length, 6);
      const imgs = thumbs.slice(0, 6).map(u => `<img src="${u}" alt="" loading="lazy">`).join('');
      thumbHtml = `<div class="fav-mosaic fav-mosaic-${n}">${imgs}</div>`;
    } else {
      thumbHtml = icon ? `<span class="fav-col-icon">${icon}</span>` : '';
    }
    card.innerHTML =
      `<div class="fav-col-thumb">${thumbHtml}</div>` +
      `<div class="fav-col-label">${label}</div>` +
      (count !== null ? `<div class="fav-col-count">${count}</div>` : '');
    return card;
  }

  private async fetchCoversFor(paths: string[]): Promise<Record<string, string[]>> {
    if (!paths.length) return {};

    const pathToCollections: Record<string, string[]> = {};
    for (const p of paths) {
      if (p in this.allCollections) {
        pathToCollections[p] = [p];
      } else {
        const prefix = p + '/';
        pathToCollections[p] = Object.keys(this.allCollections).filter(c => c.startsWith(prefix));
      }
    }

    const needed = [...new Set(Object.values(pathToCollections).flat())];
    if (!needed.length) return {};

    const filter = needed.map(c => `collection = "${c}"`).join(' OR ');
    const data = await fetch(`${this.cfg.meiliUrl}/indexes/${this.cfg.mediaIndex}/search`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.cfg.meiliKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        q: '',
        limit: 1000,
        filter,
        attributesToRetrieve: ['collection', 'thumb_url', 'page_number'],
      }),
    }).then(r => r.json()) as { hits: MeiliHit[] };

    // Up to 6 thumbs per collection, sorted by page_number asc
    const colThumbs: Record<string, string[]> = {};
    const hits = (data.hits ?? []).filter(h => h.thumb_url).sort((a, b) => (a.page_number ?? 0) - (b.page_number ?? 0));
    for (const hit of hits) {
      if (!colThumbs[hit.collection]) colThumbs[hit.collection] = [];
      if (colThumbs[hit.collection].length < 6) colThumbs[hit.collection].push(hit.thumb_url!);
    }

    const result: Record<string, string[]> = {};
    for (const [p, cols] of Object.entries(pathToCollections)) {
      if (cols.length === 1 && cols[0] === p) {
        // Leaf: show first 6 pages of the collection
        result[p] = colThumbs[p] ?? [];
      } else {
        // Folder: show 1 cover per active child collection, up to 6 total
        result[p] = cols
          .filter(c => !this.activeCollections || this.activeCollections.has(c))
          .map(c => colThumbs[c]?.[0])
          .filter((u): u is string => Boolean(u))
          .slice(0, 6);
      }
    }
    return result;
  }

  private async fetchFacets(): Promise<{ facetDistribution?: Record<string, Record<string, number>> }> {
    return fetch(`${this.cfg.meiliUrl}/indexes/${this.cfg.mediaIndex}/search`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.cfg.meiliKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: '', limit: 0, facets: ['collection'] }),
    }).then(r => r.json());
  }

  private async renderCollection(name: string, reset = true): Promise<void> {
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
      const thumbInner = hit.thumb_url
        ? `<img src="${hit.thumb_url}" alt="" loading="lazy">`
        : `<span class="fav-thumb-placeholder">📄</span>`;
      div.innerHTML =
        `<a class="fav-thumb" href="${hit.url}" data-id="${hit.id}">` +
        thumbInner +
        (hit.page_number != null ? `<span class="fav-page-badge">${hit.page_number}</span>` : '') +
        `</a>`;
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
    const collectionLeaf = collection.split('/').at(-1)!;

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
          attributesToRetrieve: ['id', 'url', 'source_url', 'title', 'page_number', 'text', 'collection', 'text_format', 'has_image'],
        }),
      }).then(r => r.json()) as { hits: MeiliHit[] };

      const allHits = (data.hits ?? [])
        .filter(h => h.url)
        .sort((a, b) => (a.page_number ?? 0) - (b.page_number ?? 0));

      const items: LightboxItem[] = allHits.map(h => {
        // Show only leaf collection name + page number (not full path)
        const caption = collectionLeaf + (h.page_number != null ? ` — pagina ${h.page_number}` : '');
        const isMd = h.text_format === 'md' || (h.text ? looksLikeMarkdown(h.text) : false);
        const mdHtml = h.text ? renderMarkdown(h.text) : '';
        const plainHtml = h.text ? renderPlain(h.text) : '';
        const text = isMd ? mdHtml : plainHtml;
        const textAlt = h.text ? (isMd ? plainHtml : mdHtml) : undefined;
        const isPdf = h.url.toLowerCase().split('?')[0]?.endsWith('.pdf') ?? false;
        const hasImage = h.has_image !== false;
        return isPdf
          ? { url: h.url, sourceUrl: h.source_url ?? undefined, caption, text, textAlt, kind: 'pdf' as const, page: h.page_number ?? undefined }
          : { url: h.url, caption, text, textAlt, ...(hasImage ? {} : { kind: 'text' as const }) };
      });

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
