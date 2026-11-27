import '../css/search.css';
import instantsearch from 'instantsearch.js';
import { searchBox, hits, pagination, configure, index } from 'instantsearch.js/es/widgets';
import { instantMeiliSearch } from '@meilisearch/instant-meilisearch';
import { Lightbox, type LightboxItem } from './lightbox';
import { BrowseMode } from './browse';
import { attachCycleCheckbox } from './cycle-checkbox';
import { renderMarkdown, renderPlain, looksLikeMarkdown } from './markdown';
import { compareHitOrder, type FavConfig, type MeiliHit } from './types';
import { showSearchError, hideSearchError, searchIndex, proxyHttpClient } from './meili';
import { escapeHtml, highlightHtml, safeUrl, urlAttribute, quoteFilter } from './escape';

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
          const term = ap
            .replace(/^NOT\s+/i, '')
            .replace(/"/g, '')
            .trim();
          if (!term) return null;
          return (neg ? 'NOT ' : '') + `text CONTAINS ${quoteFilter(term)}`;
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
  const snip =
    hit._snippetResult?.text?.value != null
      ? highlightHtml(hit._snippetResult.text.value)
      : escapeHtml((hit.text ?? '').substring(0, 200) + '…');
  const title = escapeHtml(
    hit.page_number != null
      ? `${hit.title || hit.collection} — pagina ${hit.page_number}`
      : hit.title || hit.collection || hit.id,
  );

  if (!withLink) {
    // Media hit: always clickable into the lightbox, even without a thumbnail
    // image (e.g. PDF pages that only have extracted text, no page image).
    const thumbInner = hit.thumb_url
      ? `<img src="${urlAttribute(hit.thumb_url)}" alt="" loading="lazy">`
      : `<span class="fav-thumb-placeholder">📄</span>`;
    return `<a class="fav-thumb" href="${urlAttribute(hit.url)}" data-id="${escapeHtml(hit.id)}" data-collection="${escapeHtml(hit.collection)}">
      ${thumbInner}</a>
      <div class="fav-body"><h3>${title}</h3><p>${snip}</p></div>`;
  }
  const img = hit.thumb_url
    ? `<a class="fav-thumb" href="${urlAttribute(hit.url)}"><img src="${urlAttribute(hit.thumb_url)}" alt="" loading="lazy"></a>`
    : '';
  return `${img}<div class="fav-body">
    <h3><a href="${urlAttribute(hit.url)}">${title}</a></h3><p>${snip}</p></div>`;
}

interface PgNode {
  url: string;
  title: string;
  children: Record<string, PgNode>;
}

function initInstance(cfg: FavConfig): void {
  const root = document.getElementById(cfg.uid);
  if (!root) return;

  let substringMode = false;
  let collectionFilter: string | null = null;
  let pageFilter: string | null = null;
  let pageTreeData: Record<string, PgNode> | null = null;
  let pageBrowsePath: string[] = [];
  let activePageUrls: Set<string> | null = null;

  const { searchClient: baseClient } = instantMeiliSearch(cfg.meiliUrl, cfg.meiliKey, {
    placeholderSearch: false,
    meiliSearchParams: { highlightPreTag: '<em>', highlightPostTag: '</em>' },
    ...(cfg.searchProxy ? { httpClient: proxyHttpClient(cfg) } : {}),
  });

  // search() also takes a single composition request since 0.2x; InstantSearch
  // only ever sends the array of per-index requests.
  type SearchRequests = Extract<Parameters<typeof baseClient.search>[0], readonly unknown[]>;

  const emptyResults = (reqs: SearchRequests) =>
    Promise.resolve({
      results: reqs.map(() => ({
        hits: [],
        nbHits: 0,
        page: 0,
        nbPages: 0,
        hitsPerPage: cfg.perPage,
        processingTimeMS: 0,
        exhaustiveNbHits: true as const,
        query: '',
        params: '',
      })),
    });

  const client = {
    search: (requests: SearchRequests) => {
      const sbInput = root.querySelector<HTMLInputElement>('.ais-SearchBox-input');
      const q = sbInput?.value.trim() ?? '';
      if (cfg.browseMode && !q) return emptyResults(requests);
      const filtered: SearchRequests = requests.map(req => {
        const filter =
          req.indexName === cfg.mediaIndex
            ? buildFilter(collectionFilter, substringMode, q)
            : req.indexName === cfg.contentIndex
              ? (pageFilter ?? '')
              : '';
        return { ...req, params: { ...req.params, filters: filter } };
      });
      // InstantSearch types searchClient as a union of client shapes, so search()
      // only accepts the intersection of their arguments; call the array form.
      return (baseClient as { search(r: SearchRequests): ReturnType<typeof baseClient.search> }).search(filtered);
    },
  };

  const search = instantsearch({
    indexName: cfg.showMedia ? cfg.mediaIndex : cfg.contentIndex,
    searchClient: client as Parameters<typeof instantsearch>[0]['searchClient'],
  });

  const widgets: any[] = [
    searchBox({ container: `#${cfg.uid}-searchbox`, placeholder: cfg.placeholder, showReset: true, showSubmit: false }),
    configure({ hitsPerPage: cfg.perPage, attributesToSnippet: [`text:${cfg.snippetLen}`], snippetEllipsisText: '…' }),
  ];

  if (cfg.showMedia) {
    widgets.push(
      // hitToHtml owns escaping; avoid escaping snippets twice in InstantSearch.
      hits({
        container: `#${cfg.uid}-hits-media`,
        escapeHTML: false,
        templates: { item: (hit: MeiliHit) => hitToHtml(hit, false), empty: () => '' },
      }),
      pagination({ container: `#${cfg.uid}-pag-media` }),
    );
  }

  if (cfg.showContent) {
    widgets.push(
      index({ indexName: cfg.contentIndex }).addWidgets([
        hits({
          container: `#${cfg.uid}-hits-content`,
          escapeHTML: false,
          templates: { item: (hit: MeiliHit) => hitToHtml(hit, true), empty: () => '' },
        }),
        configure({
          hitsPerPage: cfg.perPage,
          attributesToSnippet: [`text:${cfg.snippetLen}`],
          snippetEllipsisText: '…',
        }),
        pagination({ container: `#${cfg.uid}-pag-content` }),
      ]),
    );
  }

  search.addWidgets(widgets);
  search.start();

  search.on('error', () => showSearchError(cfg));
  search.on('render', () => {
    if (search.status !== 'error') hideSearchError(cfg);
    (['media', 'content'] as const).forEach(src => {
      const hitsEl = document.getElementById(`${cfg.uid}-hits-${src}`);
      const pagEl = document.getElementById(`${cfg.uid}-pag-${src}`);
      const secEl = document.getElementById(`${cfg.uid}-section-${src}`);
      if (!pagEl) return;
      const hasHits = !!hitsEl?.querySelector('.ais-Hits-item');
      pagEl.style.display = hasHits ? '' : 'none';
      if (secEl && src === 'content') secEl.style.display = hasHits ? '' : 'none';
    });
  });

  // Lightbox — created early so BrowseMode can reference it
  const lb = cfg.showMedia ? new Lightbox(cfg) : null;

  // Browse mode — activated when search box is empty. Typing is itself a form
  // of filtering, so an empty query shows top-level browse overviews (media
  // Galerij, page tree) instead of hiding everything.
  let browse: BrowseMode | null = null;
  if (cfg.browseMode && (cfg.showMedia || cfg.showContent)) {
    const resultsEl = root.querySelector<HTMLElement>('.fav-results')!;

    if (cfg.showMedia) {
      const browseContainer = root.querySelector<HTMLElement>('.fav-browse')!;
      const breadcrumbEl = root.querySelector<HTMLElement>('.fav-breadcrumb')!;
      const browseGrid = root.querySelector<HTMLElement>('.fav-browse-grid')!;
      browse = new BrowseMode(cfg, lb!, browseContainer, breadcrumbEl, browseGrid);
    }

    const syncBrowse = (query: string): void => {
      if (query.trim()) {
        browse?.hide();
        if (pageBrowseContainer) pageBrowseContainer.style.display = 'none';
        resultsEl.style.display = '';
      } else {
        resultsEl.style.display = 'none';
        if (browse) void browse.enter(browse.current() ?? undefined);
        if (pageBrowseContainer) {
          pageBrowseContainer.style.display = '';
          renderPageBrowseLevel(pageBrowsePath);
        }
      }
    };

    // Attach once the searchbox widget has rendered
    search.on('render', () => {
      const input = root.querySelector<HTMLInputElement>('.ais-SearchBox-input');
      if (!input || input.dataset['browseAttached']) return;
      input.dataset['browseAttached'] = '1';
      input.addEventListener('input', () => syncBrowse(input.value));
      // Initial state
      syncBrowse(input.value);
    });
  }

  // Combined filter tree: media collections + content pages, in one panel
  const filterTreeEl = document.getElementById(`${cfg.uid}-filter-tree`);
  let colTreeUl: HTMLUListElement | null = null;
  let pgTreeUl: HTMLUListElement | null = null;
  let postTreeUl: HTMLUListElement | null = null;

  function makeTopFolder(
    rootUl: HTMLElement,
    label: string,
    onToggle: () => void,
    updateParents: (el: HTMLElement) => void = () => {
      /* no ancestor above this folder */
    },
  ): { li: HTMLLIElement; ul: HTMLUListElement } {
    const ul = document.createElement('ul');
    ul.className = 'fav-col-tree';

    const li = document.createElement('li');
    li.className = 'fav-col-tree-folder';
    const row = document.createElement('div');
    row.className = 'fav-col-tree-row';
    const toggle = document.createElement('button');
    toggle.className = 'fav-col-tree-toggle';
    toggle.type = 'button';
    toggle.textContent = '▾';
    toggle.addEventListener('click', () => {
      const closed = li.classList.toggle('fav-col-tree-closed');
      toggle.textContent = closed ? '▸' : '▾';
    });
    row.appendChild(toggle);
    const lbl = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = true;
    attachCycleCheckbox(cb, li, true, () => rootUl, onToggle, updateParents);
    lbl.appendChild(cb);
    lbl.append(` ${label}`);
    row.appendChild(lbl);
    li.appendChild(row);
    li.appendChild(ul);
    return { li, ul };
  }

  if (filterTreeEl) {
    const outerUl = document.createElement('ul');
    outerUl.className = 'fav-col-tree';
    filterTreeEl.appendChild(outerUl);

    // A root "Alles" checkbox above Media/Pagina's/Berichten: a single
    // always-available way to select everything again, regardless of
    // whatever solo/toggle state the buckets below are in.
    const allFolder = makeTopFolder(outerUl, 'Alles', () => {
      applyCollectionFilter();
      applyPageFilter();
    });
    outerUl.appendChild(allFolder.li);
    const rootUl = allFolder.ul;

    if (cfg.showMedia) {
      const { li, ul } = makeTopFolder(rootUl, 'Media', () => applyCollectionFilter(), updateColParents);
      rootUl.appendChild(li);
      colTreeUl = ul;
    }
    if (cfg.showContent) {
      const { li, ul } = makeTopFolder(rootUl, "Pagina's", () => applyPageFilter(), updateColParents);
      rootUl.appendChild(li);
      pgTreeUl = ul;

      const berichtenFolder = makeTopFolder(rootUl, 'Berichten', () => applyPageFilter(), updateColParents);
      rootUl.appendChild(berichtenFolder.li);
      postTreeUl = berichtenFolder.ul;
    }
  }

  // Page browse: folder-drill-down overview of content pages, mirroring media Galerij
  const pageBrowseGrid = document.getElementById(`${cfg.uid}-page-browse-grid`);
  const pageBrowseCrumb = document.getElementById(`${cfg.uid}-page-breadcrumb`);
  const pageBrowseContainer = document.getElementById(`${cfg.uid}-page-browse`);

  function getPageNodeAt(path: string[]): PgNode | null {
    let node: Record<string, PgNode> | undefined = pageTreeData ?? undefined;
    let current: PgNode | null = null;
    for (const slug of path) {
      if (!node || !node[slug]) return null;
      current = node[slug];
      node = current.children;
    }
    return current;
  }

  function renderPageBreadcrumb(path: string[]): void {
    if (!pageBrowseCrumb) return;
    const root = "Pagina's";
    if (!path.length) {
      pageBrowseCrumb.innerHTML = `<span class="fav-bc-current">${root}</span>`;
      return;
    }
    let html = `<a class="fav-bc-link" href="#" data-path="">${root}</a>`;
    for (let i = 0; i < path.length; i++) {
      const nd = getPageNodeAt(path.slice(0, i + 1));
      const label = nd?.title ?? path[i];
      html += '<span class="fav-bc-sep">›</span>';
      html +=
        i === path.length - 1
          ? `<span class="fav-bc-current">${escapeHtml(label)}</span>`
          : `<a class="fav-bc-link" href="#" data-path="${escapeHtml(path.slice(0, i + 1).join('/'))}">${escapeHtml(label)}</a>`;
    }
    pageBrowseCrumb.innerHTML = html;
    pageBrowseCrumb.querySelectorAll<HTMLAnchorElement>('.fav-bc-link').forEach(link => {
      link.addEventListener('click', e => {
        e.preventDefault();
        const p = link.dataset['path'];
        renderPageBrowseLevel(p ? p.split('/') : []);
      });
    });
  }

  function nodeIsActive(node: PgNode): boolean {
    if (!activePageUrls) return true;
    const hasChildren = Object.keys(node.children).length > 0;
    if (!hasChildren) return activePageUrls.has(node.url);
    return Object.values(node.children).some(nodeIsActive);
  }

  function setActivePageUrls(urls: string[] | null): void {
    activePageUrls = urls ? new Set(urls) : null;
    if (pageBrowseContainer && pageBrowseContainer.style.display !== 'none') {
      renderPageBrowseLevel(pageBrowsePath);
    }
  }

  // A folder that only wraps a single child is pointless to browse into —
  // skip straight through any such chain to the first node that's an
  // actual leaf or actually branches, so its tile can show real content
  // instead of a one-item sublist. Returns the extra path segments skipped,
  // so a click can jump directly past them.
  function collapseSingleChild(node: PgNode): { node: PgNode; extraSlugs: string[] } {
    let current = node;
    let entries = Object.entries(current.children);
    const extraSlugs: string[] = [];
    while (entries.length === 1) {
      const [slug, child] = entries[0]!;
      extraSlugs.push(slug);
      current = child;
      entries = Object.entries(current.children);
    }
    return { node: current, extraSlugs };
  }

  // Subfolder name preview inside a folder tile, mirroring avpvh-gallery's
  // directory sublist (up to 7 names, last one truncated to signal overflow).
  function renderDirSublist(children: PgNode[]): string {
    const shown = children.slice(0, 7);
    const hasTruncated = shown.length === 7 && children.length > 7;
    const items = shown
      .map((child, i) => {
        const isTruncated = hasTruncated && i === 6;
        const label = isTruncated ? child.title.slice(0, 5) + '…' : child.title;
        return `<div class="fav-dir-sublist-item${isTruncated ? ' fav-dir-sublist-more' : ''}">${escapeHtml(label)}</div>`;
      })
      .join('');
    return `<div class="fav-dir-sublist">${items}</div>`;
  }

  function renderPageBrowseLevel(path: string[]): void {
    if (!pageBrowseGrid || !pageTreeData) return;
    pageBrowsePath = path;
    renderPageBreadcrumb(path);

    let node: Record<string, PgNode> = pageTreeData;
    for (const slug of path) node = node[slug]?.children ?? {};

    pageBrowseGrid.innerHTML = '';
    pageBrowseGrid.className = 'fav-browse-grid fav-col-grid';
    const entries = Object.entries(node)
      .filter(([, nd]) => nodeIsActive(nd))
      .sort(([, a], [, b]) => a.title.localeCompare(b.title, 'nl'));
    if (!entries.length) {
      pageBrowseGrid.innerHTML = "<p>Geen pagina's gevonden.</p>";
      return;
    }
    for (const [slug, nd] of entries) {
      const { node: effective, extraSlugs } = collapseSingleChild(nd);
      const children = Object.values(effective.children).sort((a, b) => a.title.localeCompare(b.title, 'nl'));
      const hasChildren = children.length > 0;
      const card = document.createElement(hasChildren ? 'div' : 'a') as HTMLElement;
      card.className = 'fav-col-card';
      if (!hasChildren) (card as HTMLAnchorElement).href = safeUrl(effective.url);
      const thumbHtml = hasChildren ? renderDirSublist(children) : '<span class="fav-col-icon">📄</span>';
      card.innerHTML =
        `<div class="fav-col-thumb${hasChildren ? ' fav-col-no-thumb' : ''}">${thumbHtml}</div>` +
        `<div class="fav-col-label">${escapeHtml(effective.title)}</div>`;
      if (hasChildren) card.addEventListener('click', () => renderPageBrowseLevel([...path, slug, ...extraSlugs]));
      pageBrowseGrid.appendChild(card);
    }
  }

  // Page & post tree filter (content index): pages by URL path, posts by Jaar/Maand
  if (pgTreeUl) {
    searchIndex<{ hits?: Array<{ id: string; title: string; url: string; type?: string; date?: string | null }> }>(
      cfg,
      cfg.contentIndex,
      { q: '', limit: 1000, attributesToRetrieve: ['id', 'title', 'url', 'type', 'date'] },
    )
      .then(
        (data: { hits?: Array<{ id: string; title: string; url: string; type?: string; date?: string | null }> }) => {
          const docs = (data.hits ?? []).filter(d => d.url);
          const firstDoc = docs[0];
          if (!firstDoc) return;
          const baseUrl = firstDoc.url.replace(/^(https?:\/\/[^/]+).*/, '$1');
          const urlToTitle = new Map(docs.map(d => [d.url, d.title]));

          const pageDocs = docs.filter(d => d.type !== 'post');
          const postDocs = docs.filter(d => d.type === 'post');

          const pgTree: Record<string, PgNode> = Object.create(null);

          const slugTitle = (slug: string): string => slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
          const isAutoSlug = (slug: string): boolean => /^\d/.test(slug);

          // Two top-level buckets: normal tree + "(overige)" for auto-slugged pages
          const overige: PgNode[] = [];

          const sorted = [...pageDocs].sort((a, b) => a.url.length - b.url.length);
          for (const doc of sorted) {
            const path = doc.url.slice(baseUrl.length).replace(/^\/|\/$/g, '');
            if (!path) continue;
            const segs = path.split('/');
            const firstSeg = segs[0] ?? '';

            // If any segment is an auto-slug, put in overige (top-level only: first segment)
            if (isAutoSlug(firstSeg)) {
              overige.push({ url: doc.url, title: doc.title || slugTitle(firstSeg), children: {} });
              continue;
            }

            let node = pgTree;
            segs.forEach((slug, i) => {
              let child = node[slug];
              if (!child) {
                const partUrl = `${baseUrl}/${segs.slice(0, i + 1).join('/')}/`;
                child = node[slug] = {
                  url: partUrl,
                  title: urlToTitle.get(partUrl) ?? slugTitle(slug),
                  children: Object.create(null),
                };
              }
              node = child.children;
            });
          }

          // Add overige bucket if needed
          if (overige.length) {
            pgTree['__overige__'] = {
              url: '',
              title: '(overige)',
              children: Object.fromEntries(overige.map((n, i) => [String(i), n])),
            };
          }

          // Post tree: Jaar > Maand > Bericht, newest first
          const monthNames = [
            'januari',
            'februari',
            'maart',
            'april',
            'mei',
            'juni',
            'juli',
            'augustus',
            'september',
            'oktober',
            'november',
            'december',
          ];
          const postTree: Record<string, PgNode> = Object.create(null);
          for (const doc of postDocs) {
            const d = doc.date;
            if (!d) continue;
            const year = d.slice(0, 4);
            const month = d.slice(5, 7);
            if (!postTree[year]) postTree[year] = { url: '', title: year, children: Object.create(null) };
            const yearNode = postTree[year];
            if (!yearNode.children[month]) {
              const label = monthNames[parseInt(month, 10) - 1] ?? month;
              yearNode.children[month] = {
                url: '',
                title: label.charAt(0).toUpperCase() + label.slice(1),
                children: {},
              };
            }
            yearNode.children[month].children[`${d}_${doc.id}`] = {
              url: doc.url,
              title: doc.title || doc.url,
              children: {},
            };
          }
          const dateDesc = (a: [string, PgNode], b: [string, PgNode]): number => b[0].localeCompare(a[0]);

          function renderPgNode(
            tree: Record<string, PgNode>,
            compareFn: (a: [string, PgNode], b: [string, PgNode]) => number = (a, b) =>
              a[1].title.localeCompare(b[1].title, 'nl'),
          ): HTMLUListElement {
            const ul = document.createElement('ul');
            ul.className = 'fav-col-tree';
            for (const [, nd] of Object.entries(tree).sort(compareFn)) {
              const hasChildren = Object.keys(nd.children).length > 0;
              const li = document.createElement('li');
              li.className = hasChildren ? 'fav-col-tree-folder' : 'fav-col-tree-leaf';
              const row = document.createElement('div');
              row.className = 'fav-col-tree-row';
              if (hasChildren) {
                li.classList.add('fav-col-tree-closed');
                const tog = document.createElement('button');
                tog.className = 'fav-col-tree-toggle';
                tog.type = 'button';
                tog.textContent = '▸';
                tog.addEventListener('click', () => {
                  const closed = li.classList.toggle('fav-col-tree-closed');
                  tog.textContent = closed ? '▸' : '▾';
                });
                row.appendChild(tog);
              }
              const label = document.createElement('label');
              const cb = document.createElement('input');
              cb.type = 'checkbox';
              cb.checked = true;
              cb.dataset['pageUrl'] = nd.url;
              attachCycleCheckbox(
                cb,
                li,
                hasChildren,
                () => (pgTreeUl?.contains(li) ? pgTreeUl : postTreeUl),
                applyPageFilter,
                updatePgParents,
              );
              label.appendChild(cb);
              label.append(` ${nd.title}`);
              row.appendChild(label);
              li.appendChild(row);
              if (hasChildren) li.appendChild(renderPgNode(nd.children, compareFn));
              ul.appendChild(li);
            }
            return ul;
          }

          function updatePgParents(el: HTMLElement): void {
            const folder = el.parentElement?.closest<HTMLElement>('.fav-col-tree-folder');
            if (!folder) return;
            const ownCb = folder.querySelector<HTMLInputElement>(':scope > .fav-col-tree-row input');
            const allCbs = [...folder.querySelectorAll<HTMLInputElement>('input[type=checkbox]')].filter(
              c => c !== ownCb,
            );
            if (ownCb && allCbs.length) {
              const all = allCbs.every(c => c.checked),
                none = allCbs.every(c => !c.checked);
              ownCb.checked = all;
              ownCb.indeterminate = !all && !none;
            }
            updatePgParents(folder);
          }

          const built = renderPgNode(pgTree);
          while (built.firstChild) pgTreeUl!.appendChild(built.firstChild);

          if (postTreeUl) {
            const builtPosts = renderPgNode(postTree, dateDesc);
            while (builtPosts.firstChild) postTreeUl.appendChild(builtPosts.firstChild);
          }

          pageTreeData = pgTree;
          if (pageBrowseGrid) renderPageBrowseLevel(pageBrowsePath);
        },
      )
      .catch(() => undefined);
  }

  function applyPageFilter(): void {
    const allCbs = [
      ...(pgTreeUl?.querySelectorAll<HTMLInputElement>('input[data-page-url]') ?? []),
      ...(postTreeUl?.querySelectorAll<HTMLInputElement>('input[data-page-url]') ?? []),
    ];
    // Structural folders (e.g. Berichten's Jaar/Maand grouping) carry an empty
    // data-page-url and must be excluded from the "everything selected" tally,
    // otherwise it never matches and a real (large) filter gets sent needlessly.
    const realCbs = allCbs.filter(cb => cb.dataset['pageUrl'] && !cb.closest('li')?.hidden);
    const checked = realCbs.filter(cb => cb.checked).map(cb => cb.dataset['pageUrl']!);
    const allChecked = checked.length === realCbs.length;
    pageFilter = allChecked
      ? null
      : checked.length
        ? checked.map(u => `url = ${quoteFilter(u)}`).join(' OR ')
        : 'url = "__avpvh_no_match__"';
    search.mainIndex.getHelper()?.search();

    setActivePageUrls(allChecked ? null : checked);
  }

  // Section collapse
  root.querySelectorAll<HTMLElement>('.fav-section-header').forEach(hdr => {
    const target = hdr.dataset['target'];
    const body = target ? document.getElementById(target) : null;
    hdr.addEventListener('click', () => {
      const collapsed = hdr.classList.toggle('collapsed');
      if (body) body.style.display = collapsed ? 'none' : '';
    });
    if (hdr.dataset['collapseMobile'] !== undefined && window.matchMedia('(max-width: 760px)').matches) {
      hdr.classList.add('collapsed');
      if (body) body.style.display = 'none';
    }
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
      if (src === 'content') {
        const pgPanel = document.getElementById(`${cfg.uid}-page-filter`);
        if (pgPanel) pgPanel.style.display = cb.checked ? '' : 'none';
      }
    });
  });

  // Substring mode toggle
  const substrCb = document.getElementById(`${cfg.uid}-substr`) as HTMLInputElement | null;
  substrCb?.addEventListener('change', () => {
    substringMode = substrCb.checked;
    search.mainIndex.getHelper()?.search();
  });

  // Collection tree from facets
  if (colTreeUl) {
    searchIndex<{ facetDistribution?: Record<string, Record<string, number>> }>(cfg, cfg.mediaIndex, {
      q: '',
      limit: 0,
      facets: ['collection'],
    })
      .then((data: { facetDistribution?: Record<string, Record<string, number>> }) => {
        const cols = data.facetDistribution?.['collection'];
        if (!cols) return;
        const built = buildColTree(cols);
        while (built.firstChild) colTreeUl!.appendChild(built.firstChild);
      })
      .catch(() => undefined);
  }

  function buildColTree(cols: Record<string, number>): HTMLUListElement {
    // Build nested tree structure from flat paths
    const tree: Record<string, any> = Object.create(null);
    for (const [path, count] of Object.entries(cols)) {
      const parts = path.split('/');
      let node = tree;
      parts.forEach((part, i) => {
        const child = (node[part] ??= {
          _path: parts.slice(0, i + 1).join('/'),
          _count: 0,
          _children: Object.create(null),
        });
        if (i === parts.length - 1) child._count = count;
        node = child._children;
      });
    }
    return renderColTreeNode(tree);
  }

  function renderColTreeNode(tree: Record<string, any>): HTMLUListElement {
    const ul = document.createElement('ul');
    ul.className = 'fav-col-tree';
    for (const [name, info] of Object.entries(tree).sort(([a], [b]) => a.localeCompare(b))) {
      const hasChildren = Object.keys(info._children ?? {}).length > 0;
      const li = document.createElement('li');
      li.className = hasChildren ? 'fav-col-tree-folder' : 'fav-col-tree-leaf';

      const row = document.createElement('div');
      row.className = 'fav-col-tree-row';

      if (hasChildren) {
        li.classList.add('fav-col-tree-closed');
        const toggle = document.createElement('button');
        toggle.className = 'fav-col-tree-toggle';
        toggle.type = 'button';
        toggle.textContent = '▸';
        toggle.addEventListener('click', () => {
          const closed = li.classList.toggle('fav-col-tree-closed');
          toggle.textContent = closed ? '▸' : '▾';
        });
        row.appendChild(toggle);
      }

      const label = document.createElement('label');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = true;
      if (!hasChildren) cb.dataset['leafPath'] = info._path;
      attachCycleCheckbox(cb, li, hasChildren, () => colTreeUl, applyCollectionFilter, updateColParents);
      label.appendChild(cb);
      label.append(` ${name}`);
      if (!hasChildren) {
        const countEl = document.createElement('span');
        countEl.className = 'fav-col-tree-count';
        countEl.textContent = ` (${info._count})`;
        label.appendChild(countEl);
      }
      row.appendChild(label);
      li.appendChild(row);

      if (hasChildren) li.appendChild(renderColTreeNode(info._children));
      ul.appendChild(li);
    }
    return ul;
  }

  function updateColParents(el: HTMLElement): void {
    const folder = el.parentElement?.closest<HTMLElement>('.fav-col-tree-folder');
    if (!folder) return;
    const ownCb = folder.querySelector<HTMLInputElement>(':scope > .fav-col-tree-row input');
    const leaves = [...folder.querySelectorAll<HTMLInputElement>('.fav-col-tree-leaf input[type=checkbox]')];
    if (ownCb && leaves.length) {
      const all = leaves.every(c => c.checked);
      const none = leaves.every(c => !c.checked);
      ownCb.checked = all;
      ownCb.indeterminate = !all && !none;
    }
    updateColParents(folder);
  }

  function applyCollectionFilter(): void {
    const allLeaves = [
      ...(colTreeUl?.querySelectorAll<HTMLInputElement>('.fav-col-tree-leaf input[type=checkbox]') ?? []),
    ];
    const visibleLeaves = allLeaves.filter(cb => !cb.closest<HTMLElement>('.fav-col-tree-leaf')?.hidden);
    const checked = visibleLeaves
      .filter(cb => cb.checked)
      .map(cb => cb.dataset['leafPath']!)
      .filter(Boolean);
    const allChecked = checked.length === visibleLeaves.length;

    collectionFilter = allChecked
      ? null
      : checked.length
        ? checked.map(p => `collection = ${quoteFilter(p)}`).join(' OR ')
        : 'collection = "__avpvh_no_match__"';
    search.mainIndex.getHelper()?.search();

    // Sync browse mode: show only tiles for active collections
    browse?.setActiveCollections(allChecked ? null : checked);
  }

  document.getElementById(`${cfg.uid}-refine-filter`)?.addEventListener('input', function (this: HTMLInputElement) {
    const term = this.value.toLowerCase();
    if (!filterTreeEl) return;
    if (!term) {
      filterTreeEl.querySelectorAll<HTMLElement>('li').forEach(li => {
        li.hidden = false;
      });
      return;
    }
    filterTreeEl.querySelectorAll<HTMLElement>('.fav-col-tree-leaf').forEach(li => {
      li.hidden = !(li.textContent?.toLowerCase().includes(term) ?? false);
    });
    filterTreeEl.querySelectorAll<HTMLElement>('.fav-col-tree-folder').forEach(folder => {
      folder.hidden = !folder.querySelector('.fav-col-tree-leaf:not([hidden])');
    });
  });

  // Lightbox
  if (cfg.showMedia && lb) {
    const hitsEl = document.getElementById(`${cfg.uid}-hits-media`);

    hitsEl?.addEventListener('click', e => {
      const link = (e.target as Element).closest<HTMLAnchorElement>('a.fav-thumb');
      if (!link) return;
      e.preventDefault();

      const hitId = link.dataset['id'] ?? '';
      const collection = link.dataset['collection'] ?? '';
      if (!collection) return;

      lb.open([{ url: '', caption: 'Laden…', text: '' }], 0);

      const sbEl = root.querySelector<HTMLInputElement>('.ais-SearchBox-input');
      const q = sbEl?.value.trim() ?? '';

      const fetchHits = (query: string, highlight: boolean): Promise<{ hits?: MeiliHit[] }> =>
        searchIndex(cfg, cfg.mediaIndex, {
          q: query,
          filter: `collection = ${quoteFilter(collection)}`,
          limit: 5000,
          attributesToRetrieve: [
            'id',
            'url',
            'source_url',
            'title',
            'page_number',
            'date',
            'text',
            'collection',
            'text_format',
            'has_image',
          ],
          ...(highlight ? { attributesToHighlight: ['text'], highlightPreTag: '<em>', highlightPostTag: '</em>' } : {}),
        });

      // Fetch every page of the document (so the lightbox can browse page by
      // page, not just through matches) plus a separate query for the actual
      // search matches (for highlighting + "next search result" jumps).
      Promise.all([fetchHits('', false), q ? fetchHits(q, true) : Promise.resolve({ hits: [] })])
        .then(([allData, matchData]) => {
          const allHits = (allData.hits ?? []).filter(h => h.url);
          allHits.sort(compareHitOrder);
          if (!allHits.length) {
            lb.close();
            return;
          }

          const matchMap = new Map((matchData.hits ?? []).map(h => [h.id, h]));

          const items: LightboxItem[] = allHits.map(h => {
            const matchHit = matchMap.get(h.id);
            const isMatch = matchHit != null;
            const highlighted = matchHit?._formatted?.text ?? h.text;
            const isMd = h.text_format === 'md' || looksLikeMarkdown(h.text);
            const mdHtml = renderMarkdown(highlighted);
            const plainHtml = renderPlain(highlighted, true);
            const html = isMd ? mdHtml : plainHtml;
            const htmlAlt = highlighted ? (isMd ? plainHtml : mdHtml) : undefined;
            const caption =
              (h.collection ?? '') +
              (h.page_number != null ? ` — pagina ${h.page_number}` : h.title ? ` — ${h.title}` : '');
            const isPdf = h.url.toLowerCase().split('?')[0]?.endsWith('.pdf') ?? false;
            const hasImage = h.has_image !== false;
            const highlightTerms = isMatch
              ? Array.from(
                  new Set(
                    Array.from(highlighted.matchAll(/<em>(.*?)<\/em>/gi), m => (m[1] ?? '').trim()).filter(Boolean),
                  ),
                )
              : [];
            return isPdf
              ? {
                  url: h.url,
                  sourceUrl: h.source_url ?? undefined,
                  caption,
                  text: html,
                  textAlt: htmlAlt,
                  kind: 'pdf' as const,
                  page: h.page_number ?? undefined,
                  highlightTerms,
                  isMatch,
                  collection: h.collection,
                  rawText: h.text,
                }
              : {
                  url: h.url,
                  caption,
                  text: html,
                  textAlt: htmlAlt,
                  isMatch,
                  collection: h.collection,
                  rawText: h.text,
                  page: h.page_number ?? undefined,
                  ...(hasImage ? {} : { kind: 'text' as const }),
                };
          });

          const startIdx = allHits.findIndex(h => h.id === hitId);
          const focusSb = (): void => {
            root.querySelector<HTMLInputElement>('.ais-SearchBox-input')?.focus();
          };
          lb.open(items, startIdx < 0 ? 0 : startIdx, focusSb);
        })
        .catch(() => lb.close());
    });
  }
}

// Bootstrap all instances injected by PHP via wp_localize_script
(window.favInstances ?? []).forEach(initInstance);
