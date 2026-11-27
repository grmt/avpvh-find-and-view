import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FavConfig, MeiliHit } from '../../src/ts/types';

// search.ts starts every instance in window.favInstances on import. These
// tests run it with the real InstantSearch against a fake search proxy, and a
// stand-in for the lightbox (which needs pdf.js).

const lightbox = vi.hoisted(() => ({ open: vi.fn(), close: vi.fn() }));
vi.mock('../../src/ts/lightbox', () => ({
  Lightbox: class {
    open = lightbox.open;
    close = lightbox.close;
  },
}));

const UID = 'fav-1';
const PROXY = 'https://site.test/wp-json/avpvh-fav/v1/search';

const cfg = (over: Partial<FavConfig> = {}): FavConfig => ({
  uid: UID,
  meiliUrl: 'https://meili.test',
  meiliKey: '',
  searchProxy: { url: PROXY, nonce: 'n', indexes: ['media', 'content'], group: '', scopeNonce: 's' },
  mediaIndex: 'media',
  contentIndex: 'content',
  perPage: 10,
  snippetLen: 30,
  showMedia: true,
  showContent: true,
  browseMode: false,
  browseRootLabel: '',
  placeholder: 'Zoek',
  canEdit: false,
  restRoot: '',
  editNonce: '',
  ...over,
});

const markup = `
<div class="fav-wrap" id="${UID}">
  <div class="fav-searchbar"><div id="${UID}-searchbox"></div>
    <input type="checkbox" id="${UID}-substr"></div>
  <input type="checkbox" id="${UID}-src-media" checked><input type="checkbox" id="${UID}-src-content" checked>
  <div id="${UID}-collection-filter"></div><div id="${UID}-page-filter"></div>
  <h3 class="fav-section-header" data-target="${UID}-filter-panel" data-collapse-mobile="1">Filters</h3>
  <div id="${UID}-filter-panel">
    <input type="search" id="${UID}-refine-filter"><ul id="${UID}-filter-tree"></ul>
  </div>
  <div class="fav-browse"><nav class="fav-breadcrumb"></nav><div class="fav-browse-grid"></div></div>
  <div class="fav-browse" id="${UID}-page-browse">
    <nav class="fav-breadcrumb" id="${UID}-page-breadcrumb"></nav><div class="fav-browse-grid" id="${UID}-page-browse-grid"></div>
  </div>
  <div class="fav-results">
    <div id="${UID}-section-media"><h3 class="fav-section-header" data-target="${UID}-body-media">Media</h3>
      <div id="${UID}-body-media"><div id="${UID}-hits-media"></div><div id="${UID}-pag-media"></div></div></div>
    <div id="${UID}-section-content"><h3 class="fav-section-header" data-target="${UID}-body-content">Pagina's</h3>
      <div id="${UID}-body-content"><div id="${UID}-hits-content"></div><div id="${UID}-pag-content"></div></div></div>
  </div>
</div>`;

const hit = (over: Partial<MeiliHit>): MeiliHit => ({
  id: 'x',
  type: 'scan',
  title: '',
  text: '',
  collection: 'losse',
  url: 'https://site.test/x.jpg',
  thumb_url: '',
  tags: [],
  date: null,
  page_number: null,
  ...over,
});

const mediaHits = [
  hit({
    id: 'm1',
    collection: 'boeken/deel1',
    page_number: 1,
    thumb_url: 'https://site.test/t1.jpg',
    text: 'Eerste pagina',
  }),
  hit({ id: 'm2', collection: 'losse', title: 'Brief', _snippetResult: { text: { value: 'een <em>brief</em>' } } }),
];
const contentHits = [
  hit({
    id: 'c1',
    type: 'page',
    title: 'Over ons',
    url: 'https://site.test/over/',
    thumb_url: 'https://site.test/o.jpg',
  }),
  hit({ id: 'c2', type: 'post', title: '', collection: '', url: 'https://site.test/nieuws/' }),
];
const contentDocs = [
  { id: 'p0', title: 'Home', url: 'https://site.test/', type: 'page' },
  { id: 'p1', title: 'Over ons', url: 'https://site.test/over/', type: 'page' },
  { id: 'p2', title: 'Team', url: 'https://site.test/over/team/', type: 'page' },
  { id: 'p3', title: 'Leden', url: 'https://site.test/over/team/leden/', type: 'page' },
  { id: 'p4', title: 'Bestuur', url: 'https://site.test/over/bestuur/', type: 'page' },
  { id: 'p5', title: 'Contact', url: 'https://site.test/contact/', type: 'page' },
  { id: 'p6', title: '', url: 'https://site.test/2023-verslag/', type: 'page' },
  { id: 'p7', title: 'Diep', url: 'https://site.test/archief/oud/diep/', type: 'page' },
  { id: 'b1', title: 'Nieuws', url: 'https://site.test/nieuws/', type: 'post', date: '2024-03-05' },
  { id: 'b2', title: '', url: 'https://site.test/oud-nieuws/', type: 'post', date: '2023-13-01' },
  { id: 'b3', title: 'Zonder datum', url: 'https://site.test/x/', type: 'post', date: null },
  { id: 'b4', title: 'Geen url', url: '', type: 'page' },
];
let lightboxHits: MeiliHit[] = [];
let extraMediaHits: MeiliHit[] = [];
let facetsResponse: unknown = { 'boeken/deel1': 2, 'boeken/deel2': 1, losse: 3 };
let contentDocsResponse: unknown[] = contentDocs;
let failProxy = false;

type Query = Record<string, unknown> & { indexUid: string; q?: string; filter?: unknown; limit?: number };
const queries: Query[] = [];

function answer(query: Query): Record<string, unknown> {
  const base = { indexUid: query.indexUid, query: query.q ?? '', processingTimeMs: 1, offset: 0, limit: 20 };
  if (Array.isArray(query['facets'])) return { ...base, hits: [], facetDistribution: { collection: facetsResponse } };
  if (query.indexUid === 'content' && query.limit === 1000) return { ...base, hits: contentDocsResponse };
  if (query.limit === 5000) {
    const hits = query.q
      ? lightboxHits
          .filter(h => h.text.includes(String(query.q)))
          .map(h => ({ ...h, _formatted: { text: h.text.replace(String(query.q), `<em>${query.q}</em>`) } }))
      : lightboxHits;
    return { ...base, hits };
  }
  const hits = query.q ? (query.indexUid === 'media' ? [...mediaHits, ...extraMediaHits] : contentHits) : [];
  return {
    ...base,
    hits,
    estimatedTotalHits: hits.length,
    totalHits: hits.length,
    hitsPerPage: 10,
    page: 1,
    totalPages: 1,
  };
}

let fetchMock: ReturnType<typeof vi.fn>;

async function start(config: FavConfig, html = markup) {
  document.body.innerHTML = html;
  window.favInstances = [config, cfg({ uid: 'missing' })];
  vi.resetModules();
  await import('../../src/ts/search');
  await settle();
}

const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise(resolve => setTimeout(resolve, 0));
};

async function waitFor(check: () => boolean) {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Timed out');
}

const $ = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const byId = <T extends HTMLElement = HTMLElement>(suffix: string) => document.getElementById(`${UID}-${suffix}`) as T;
const searchInput = () => $<HTMLInputElement>('.ais-SearchBox-input');

async function type(value: string) {
  searchInput().value = value;
  searchInput().dispatchEvent(new Event('input', { bubbles: true }));
  await settle();
}

const treeLabel = (text: string) =>
  [...byId('filter-tree').querySelectorAll('label')].find(l => l.textContent!.trim().startsWith(text))!;
const treeBox = (text: string) => treeLabel(text).querySelector('input')!;
function toggle(text: string) {
  const cb = treeBox(text);
  cb.checked = !cb.checked;
  cb.dispatchEvent(new Event('change'));
}
// InstantSearch passes the filter as a one-element array.
const lastFilter = (index: string) => {
  const filter = queries
    .filter(q => q.indexUid === index && q.limit !== 1000 && q.limit !== 5000 && !q['facets'])
    .at(-1)?.filter;
  return Array.isArray(filter) ? filter.join(' AND ') : filter;
};

beforeEach(() => {
  queries.length = 0;
  lightbox.open.mockReset();
  lightbox.close.mockReset();
  lightboxHits = [];
  extraMediaHits = [];
  facetsResponse = { 'boeken/deel1': 2, 'boeken/deel2': 1, losse: 3 };
  contentDocsResponse = contentDocs;
  failProxy = false;
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false })),
  );
  fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string) as { queries: Query[] };
    queries.push(...body.queries);
    if (failProxy) return new Response('', { status: 500 });
    return new Response(JSON.stringify({ results: body.queries.map(answer) }));
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete window.favInstances;
});

describe('search results', () => {
  it('shows media and content hits for a query', async () => {
    await start(cfg());
    await type('brief');
    await waitFor(() => !!byId('hits-media').querySelector('.ais-Hits-item'));

    const media = byId('hits-media');
    expect(media.querySelectorAll('.ais-Hits-item')).toHaveLength(2);
    expect(media.querySelector('h3')!.textContent).toBe('boeken/deel1 — pagina 1');
    expect(media.querySelector('img')!.getAttribute('src')).toBe('https://site.test/t1.jpg');
    expect(media.querySelectorAll('h3')[1]!.textContent).toBe('Brief');
    expect(media.querySelectorAll('.fav-body p')[1]!.innerHTML).toBe('een <em>brief</em>');
    expect(media.querySelector('.fav-thumb-placeholder')).not.toBeNull();

    await waitFor(() => !!byId('hits-content').querySelector('.ais-Hits-item'));
    const content = byId('hits-content');
    expect(content.querySelector('h3 a')!.getAttribute('href')).toBe('https://site.test/over/');
    expect(content.querySelectorAll('h3')[1]!.textContent).toBe('c2');
    expect(content.querySelector('.fav-body p')!.textContent).toBe('…');
    expect(byId('pag-content').style.display).toBe('');
    expect(byId('section-content').style.display).toBe('');
  });

  it('hides the pagination of a source without hits', async () => {
    await start(cfg());
    await waitFor(() => byId('pag-media').style.display === 'none');
    expect(byId('section-content').style.display).toBe('none');
  });

  it('shows the error banner when the search fails, and hides it again', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await start(cfg());
    failProxy = true;
    await type('brief');
    await waitFor(() => !!document.querySelector('.fav-error-banner:not([hidden])'));

    failProxy = false;
    await type('brieven');
    await waitFor(() => !!document.querySelector('.fav-error-banner[hidden]'));
  });

  it('searches word parts with CONTAINS filters', async () => {
    await start(cfg());
    byId<HTMLInputElement>('substr').checked = true;
    byId('substr').dispatchEvent(new Event('change'));
    await type('brief AND "" OR NOT "kaart" AND rol');
    await waitFor(() => lastFilter('media') !== undefined);

    expect(lastFilter('media')).toBe('text CONTAINS "brief" OR NOT text CONTAINS "kaart" AND text CONTAINS "rol"');
  });

  it('works with only one source', async () => {
    await start(cfg({ showContent: false }));
    await type('brief');
    await waitFor(() => !!byId('hits-media').querySelector('.ais-Hits-item'));
    expect(queries.some(q => q.indexUid === 'content')).toBe(false);
    expect(treeLabel('Media')).toBeDefined();
  });
});

describe('filter tree', () => {
  it('lists the collections and pages, and filters on them', async () => {
    await start(cfg());
    await waitFor(() => !!treeLabel('deel1'));

    expect(treeLabel('deel1').textContent).toBe(' deel1 (2)');
    toggle('deel2');
    toggle('losse');
    await type('brief');
    await waitFor(() => lastFilter('media') !== undefined);
    expect(lastFilter('media')).toBe('collection = "boeken/deel1"');

    toggle('deel1');
    await settle();
    expect(lastFilter('media')).toBe('collection = "__avpvh_no_match__"');

    byId<HTMLInputElement>('substr').checked = true;
    byId('substr').dispatchEvent(new Event('change'));
    await settle();
    expect(lastFilter('media')).toBe('(collection = "__avpvh_no_match__") AND (text CONTAINS "brief")');
  });

  it('builds the page tree with an "(overige)" bucket and posts by year and month', async () => {
    await start(cfg());
    await waitFor(() => !!treeLabel('Over ons'));

    for (const name of ['Over ons', 'Team', 'Leden', 'Bestuur', 'Contact', '(overige)', '2023 Verslag', 'Diep']) {
      expect(treeLabel(name)).toBeDefined();
    }
    expect(treeLabel('Archief')).toBeDefined();
    expect(treeLabel('2024')).toBeDefined();
    expect(treeLabel('Maart')).toBeDefined();
    expect(treeLabel('13')).toBeDefined();
    expect(treeLabel('https://site.test/oud-nieuws/')).toBeDefined();

    const years = [...byId('filter-tree').querySelectorAll('label')]
      .map(l => l.textContent!.trim())
      .filter(t => /^\d{4}$/.test(t));
    expect(years).toEqual(['2024', '2023']);
  });

  it('filters content on the checked pages', async () => {
    await start(cfg());
    await waitFor(() => !!treeLabel('Contact'));
    await type('over');

    toggle('Contact');
    await settle();
    const filter = String(lastFilter('content'));
    expect(filter).toContain('url = "https://site.test/over/"');
    expect(filter).not.toContain('contact');

    // Unticking Contact left Pagina's unticked: the first click ticks all again.
    toggle("Pagina's");
    toggle("Pagina's");
    toggle('Berichten');
    await settle();
    expect(lastFilter('content')).toBe('url = "__avpvh_no_match__"');

    // "Alles" ticks everything again. The search client caches the earlier
    // unfiltered request, so check with a new filter: everything but Bestuur.
    toggle('Alles');
    expect([treeBox('Contact').checked, treeBox('Nieuws').checked]).toEqual([true, true]);
    toggle('Bestuur');
    await settle();
    expect(String(lastFilter('content'))).toContain('url = "https://site.test/contact/"');
    expect(String(lastFilter('content'))).toContain('url = "https://site.test/nieuws/"');
    expect(String(lastFilter('content'))).not.toContain('bestuur');
  });

  it('marks a folder as partly checked', async () => {
    await start(cfg());
    await waitFor(() => !!treeLabel('Team'));
    toggle('Bestuur');
    expect(treeBox('Over ons').indeterminate).toBe(true);
    toggle('Bestuur');
    expect(treeBox('Over ons').checked).toBe(true);

    toggle('deel2');
    await settle();
    expect(treeBox('boeken').indeterminate).toBe(true);
  });

  it('folds tree folders open and closed', async () => {
    await start(cfg());
    await waitFor(() => !!treeLabel('boeken') && !!treeLabel('Over ons'));

    for (const name of ['boeken', 'Over ons', 'Media']) {
      const li = treeLabel(name).closest('li')!;
      const button = li.querySelector<HTMLButtonElement>(':scope > .fav-col-tree-row > .fav-col-tree-toggle')!;
      const wasClosed = li.classList.contains('fav-col-tree-closed');
      button.click();
      expect(li.classList.contains('fav-col-tree-closed')).toBe(!wasClosed);
      button.click();
      expect(button.textContent).toBe(wasClosed ? '▸' : '▾');
    }
  });

  it('narrows the tree to matching entries', async () => {
    await start(cfg());
    await waitFor(() => !!treeLabel('deel1') && !!treeLabel('Contact'));
    const refine = byId<HTMLInputElement>('refine-filter');

    refine.value = 'DEEL1';
    refine.dispatchEvent(new Event('input'));
    expect(treeLabel('deel1').closest('li')!.hidden).toBe(false);
    expect(treeLabel('losse').closest('li')!.hidden).toBe(true);
    expect(treeLabel('Over ons').closest('li')!.hidden).toBe(true);

    toggle('Media');
    await type('brief');
    await waitFor(() => lastFilter('media') !== undefined);
    expect(lastFilter('media')).toBe('collection = "__avpvh_no_match__"');

    refine.value = '';
    refine.dispatchEvent(new Event('input'));
    expect(treeLabel('losse').closest('li')!.hidden).toBe(false);
  });

  it('copes with no facets and no content documents, or a failing tree search', async () => {
    facetsResponse = undefined;
    contentDocsResponse = [];
    await start(cfg());
    expect(byId('filter-tree').querySelectorAll('.fav-col-tree-leaf')).toHaveLength(0);

    failProxy = true;
    await start(cfg());
    expect(byId('filter-tree').querySelectorAll('.fav-col-tree-leaf')).toHaveLength(0);
  });
});

describe('page layout', () => {
  it('collapses sections, and starts the filters collapsed on a phone', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: true })),
    );
    await start(cfg());
    const filters = $('.fav-section-header[data-collapse-mobile]');
    expect(filters.classList.contains('collapsed')).toBe(true);
    expect(byId('filter-panel').style.display).toBe('none');

    filters.click();
    expect(byId('filter-panel').style.display).toBe('');
    $(`[data-target="${UID}-body-media"]`).click();
    expect(byId('body-media').style.display).toBe('none');
  });

  it('shows and hides a source and its filters with the source toggles', async () => {
    await start(cfg());
    for (const [src, panel] of [
      ['media', 'collection-filter'],
      ['content', 'page-filter'],
    ] as const) {
      const cb = byId<HTMLInputElement>(`src-${src}`);
      cb.checked = false;
      cb.dispatchEvent(new Event('change'));
      expect(byId(`section-${src}`).style.display).toBe('none');
      expect(byId(panel).style.display).toBe('none');
      cb.checked = true;
      cb.dispatchEvent(new Event('change'));
      expect(byId(panel).style.display).toBe('');
    }
  });
});

describe('browse mode', () => {
  it('shows the galleries while the search box is empty, and results while typing', async () => {
    await start(cfg({ browseMode: true }));
    await waitFor(() => !!searchInput()?.dataset['browseAttached']);
    await waitFor(() => !!byId('page-browse-grid').querySelector('.fav-col-card'));

    expect($('.fav-results').style.display).toBe('none');
    expect(queries.filter(q => q.limit === 10 || q['hitsPerPage'])).toHaveLength(0);

    await type('brief');
    expect($('.fav-results').style.display).toBe('');
    expect(byId('page-browse').style.display).toBe('none');

    await type('');
    expect(byId('page-browse').style.display).toBe('');
  });

  it('browses the page tree by folder', async () => {
    await start(cfg({ browseMode: true }));
    await waitFor(() => !!byId('page-browse-grid').querySelector('.fav-col-card'));
    const grid = byId('page-browse-grid');
    const cards = () => [...grid.querySelectorAll<HTMLElement>('.fav-col-card')];
    const cardLabels = () => cards().map(c => c.querySelector('.fav-col-label')!.textContent);

    // Sorted by folder title; a folder with a single page shows that page.
    expect(cardLabels()).toEqual(['2023 Verslag', 'Diep', 'Contact', 'Over ons']);
    expect(byId('page-breadcrumb').textContent).toBe("Pagina's");
    expect(cards()[2]!.getAttribute('href')).toBe('https://site.test/contact/');
    expect(cards()[1]!.getAttribute('href')).toBe('https://site.test/archief/oud/diep/');

    cards()[3]!.click();
    expect(cardLabels()).toEqual(['Bestuur', 'Leden']);
    expect(byId('page-breadcrumb').textContent).toBe("Pagina's›Over ons");
    byId('page-breadcrumb').querySelector<HTMLAnchorElement>('.fav-bc-link')!.click();
    expect(cardLabels()).toHaveLength(4);
  });

  it('shows at most seven subfolder names on a folder card', async () => {
    contentDocsResponse = Array.from({ length: 9 }, (_, i) => ({
      id: `d${i}`,
      title: `Onderdeel ${i}`,
      url: `https://site.test/map/d${i}/`,
      type: 'page',
    }));
    await start(cfg({ browseMode: true }));
    await waitFor(() => !!byId('page-browse-grid').querySelector('.fav-dir-sublist'));

    const items = byId('page-browse-grid').querySelectorAll('.fav-dir-sublist-item');
    expect(items).toHaveLength(7);
    expect(items[6]!.textContent).toBe('Onder…');
    expect(items[6]!.classList.contains('fav-dir-sublist-more')).toBe(true);
  });

  it('links a nested breadcrumb level and hides pages that are filtered out', async () => {
    await start(cfg({ browseMode: true }));
    await waitFor(() => !!byId('page-browse-grid').querySelector('.fav-col-card'));
    const grid = byId('page-browse-grid');
    const card = (name: string) =>
      [...grid.querySelectorAll<HTMLElement>('.fav-col-card')].find(
        c => c.querySelector('.fav-col-label')!.textContent === name,
      )!;

    card('Over ons').click();
    expect(byId('page-breadcrumb').querySelectorAll('.fav-bc-link')).toHaveLength(1);

    byId('page-breadcrumb').querySelector<HTMLAnchorElement>('.fav-bc-link')!.click();
    toggle('Contact');
    expect(card('Contact')).toBeUndefined();

    toggle("Pagina's");
    toggle("Pagina's");
    toggle('Berichten');
    expect(grid.textContent).toBe("Geen pagina's gevonden.");
  });

  it('keeps the gallery and pages for a single source', async () => {
    await start(cfg({ browseMode: true, showMedia: false }));
    await waitFor(() => !!byId('page-browse-grid').querySelector('.fav-col-card'));
    expect($('.fav-browse-grid').textContent).toBe('');
  });
});

describe('media lightbox', () => {
  beforeEach(() => {
    lightboxHits = [
      hit({
        id: 'l2',
        collection: 'boeken/deel1',
        page_number: 2,
        url: 'https://site.test/boek.pdf',
        text: 'brief twee',
      }),
      hit({
        id: 'l1',
        collection: 'boeken/deel1',
        page_number: 1,
        url: 'https://site.test/boek.pdf',
        text: '## Kop',
        source_url: 'https://bron.test',
      }),
      hit({
        id: 'l3',
        collection: 'boeken/deel1',
        title: 'Bijlage',
        url: 'https://site.test/b.jpg',
        text: 'tekst',
        text_format: 'md',
      }),
      hit({ id: 'l4', collection: 'boeken/deel1', url: 'https://site.test/c.txt', text: '', has_image: false }),
      hit({ id: 'l5', collection: 'boeken/deel1', url: '' }),
    ];
  });

  async function openFirstHit() {
    await start(cfg());
    await type('brief');
    await waitFor(() => !!byId('hits-media').querySelector('a.fav-thumb'));
    byId('hits-media').querySelector<HTMLAnchorElement>('a.fav-thumb')!.click();
    await waitFor(() => lightbox.open.mock.calls.length === 2);
  }

  it('opens every page of the document, marking and highlighting the matches', async () => {
    await openFirstHit();

    expect(lightbox.open.mock.calls[0]).toEqual([[{ url: '', caption: 'Laden…', text: '' }], 0]);
    const [items, start, onClose] = lightbox.open.mock.calls[1]!;
    expect(start).toBe(0);
    expect(items).toHaveLength(4);
    expect(items[0]).toMatchObject({ kind: 'pdf', page: 1, isMatch: false, sourceUrl: 'https://bron.test' });
    expect(items[0].text).toContain('<h2>Kop</h2>');
    expect(items[1]).toMatchObject({ caption: 'boeken/deel1 — pagina 2', isMatch: true, highlightTerms: ['brief'] });
    expect(items[1].text).toContain('<em>brief</em>');
    expect(items[2]).toMatchObject({ caption: 'boeken/deel1 — Bijlage', isMatch: false });
    expect(items[2].kind).toBeUndefined();
    expect(items[3]).toMatchObject({ kind: 'text', textAlt: undefined });

    onClose();
    expect(document.activeElement).toBe(searchInput());
  });

  it('closes the lightbox when the document has no pages or the search fails', async () => {
    lightboxHits = [];
    await start(cfg());
    await type('brief');
    await waitFor(() => !!byId('hits-media').querySelector('a.fav-thumb'));
    const link = byId('hits-media').querySelector<HTMLAnchorElement>('a.fav-thumb')!;
    link.click();
    await waitFor(() => lightbox.close.mock.calls.length === 1);

    failProxy = true;
    link.click();
    await waitFor(() => lightbox.close.mock.calls.length === 2);
  });

  it('starts at the first page when the clicked hit is not in the document, and ignores other clicks', async () => {
    lightboxHits = [hit({ id: 'other', collection: 'boeken/deel1', page_number: 1, url: 'https://site.test/p.jpg' })];
    await openFirstHit();
    expect(lightbox.open.mock.calls[1]![1]).toBe(0);

    byId('hits-media').click();
    const link = byId('hits-media').querySelector<HTMLAnchorElement>('a.fav-thumb')!;
    link.dataset['collection'] = '';
    link.click();
    await settle();
    expect(lightbox.open).toHaveBeenCalledTimes(2);
  });

  it('opens without a query too', async () => {
    await start(cfg());
    await type('brief');
    await waitFor(() => !!byId('hits-media').querySelector('a.fav-thumb'));
    const link = byId('hits-media').querySelector<HTMLAnchorElement>('a.fav-thumb')!;
    searchInput().value = '';
    link.click();
    await waitFor(() => lightbox.open.mock.calls.length === 2);
    expect(lightbox.open.mock.calls[1]![0].every((i: { isMatch: boolean }) => !i.isMatch)).toBe(true);
  });
});

describe('less common data', () => {
  it('shows a media hit without text or snippet', async () => {
    extraMediaHits = [hit({ id: 'leeg', collection: 'losse', text: undefined as unknown as string })];
    await start(cfg());
    await type('brief');
    await waitFor(() => byId('hits-media').querySelectorAll('.ais-Hits-item').length === 3);
    expect(byId('hits-media').querySelectorAll('.fav-body p')[2]!.textContent).toBe('…');
  });

  it('copes with a page list without hits', async () => {
    contentDocsResponse = undefined as unknown as unknown[];
    await start(cfg());
    expect(treeLabel("Pagina's").closest('li')!.querySelectorAll('.fav-col-tree-leaf')).toHaveLength(0);
  });

  it('groups several posts of one month, and filters on a post', async () => {
    contentDocsResponse = [
      { id: 'p1', title: 'Over ons', url: 'https://site.test/over/', type: 'page' },
      { id: 'b1', title: 'Eerste', url: 'https://site.test/eerste/', type: 'post', date: '2024-03-05' },
      { id: 'b2', title: 'Tweede', url: 'https://site.test/tweede/', type: 'post', date: '2024-03-20' },
      { id: 'b3', title: 'Later', url: 'https://site.test/later/', type: 'post', date: '2024-04-01' },
    ];
    await start(cfg());
    await waitFor(() => !!treeLabel('Tweede'));
    expect(treeLabel('Maart').closest('li')!.querySelectorAll('.fav-col-tree-leaf')).toHaveLength(2);
    expect(treeLabel('2024').closest('li')!.querySelectorAll(':scope > ul > li')).toHaveLength(2);

    await type('over');
    toggle('Eerste');
    await settle();
    const filter = String(lastFilter('content'));
    expect(filter).toContain('url = "https://site.test/tweede/"');
    expect(filter).not.toContain('eerste');
    expect(treeBox('Maart').indeterminate).toBe(true);
  });

  it('links every level above the current one in the page breadcrumb', async () => {
    contentDocsResponse = [
      { id: 'p1', title: 'Over ons', url: 'https://site.test/over/', type: 'page' },
      { id: 'p2', title: 'Team', url: 'https://site.test/over/team/', type: 'page' },
      { id: 'p3', title: 'Leden', url: 'https://site.test/over/team/leden/', type: 'page' },
      { id: 'p4', title: 'Oud-leden', url: 'https://site.test/over/team/oud/', type: 'page' },
      { id: 'p5', title: 'Bestuur', url: 'https://site.test/over/bestuur/', type: 'page' },
      { id: 'p6', title: 'Contact', url: 'https://site.test/contact/', type: 'page' },
    ];
    await start(cfg({ browseMode: true }));
    await waitFor(() => !!byId('page-browse-grid').querySelector('.fav-col-card'));
    const card = (name: string) =>
      [...byId('page-browse-grid').querySelectorAll<HTMLElement>('.fav-col-card')].find(
        c => c.querySelector('.fav-col-label')!.textContent === name,
      )!;
    card('Over ons').click();
    card('Team').click();

    const crumb = byId('page-breadcrumb');
    expect(crumb.textContent).toBe("Pagina's›Over ons›Team");
    expect([...crumb.querySelectorAll<HTMLAnchorElement>('.fav-bc-link')].map(a => a.dataset['path'])).toEqual([
      '',
      'over',
    ]);
    crumb.querySelectorAll<HTMLAnchorElement>('.fav-bc-link')[1]!.click();
    expect(crumb.textContent).toBe("Pagina's›Over ons");
  });

  it('builds the filter tree on a page without the page browser', async () => {
    const withoutPageBrowser = markup.replace(
      /<div class="fav-browse" id="fav-1-page-browse">[\s\S]*?<\/div>\s*<\/div>/,
      '',
    );
    expect(withoutPageBrowser).not.toContain('page-browse-grid');
    await start(cfg(), withoutPageBrowser);
    await waitFor(() => !!treeLabel('Contact'));
    expect(byId('page-browse-grid')).toBeNull();
  });

  it('filters content from "Alles" when there is no media tree', async () => {
    await start(cfg({ showMedia: false }));
    await waitFor(() => !!treeLabel('Contact'));
    await type('over');
    toggle('Contact');
    await settle();
    toggle('Alles');
    toggle('Alles');
    await settle();
    expect(lastFilter('content')).toBe('url = "__avpvh_no_match__"');
  });

  it('opens images with a page number and hits without a collection in the lightbox', async () => {
    lightboxHits = [
      hit({ id: 'l1', collection: 'boeken/deel1', page_number: 1, url: 'https://site.test/p1.jpg', text: 'brief' }),
      hit({ id: 'l2', collection: undefined as unknown as string, url: 'https://site.test/p2.jpg', text: 'tekst' }),
      hit({ id: 'l3', collection: 'boeken/deel1', url: 'https://site.test/los.pdf', text: 'brief' }),
    ];
    await start(cfg());
    await type('brief');
    await waitFor(() => !!byId('hits-media').querySelector('a.fav-thumb'));
    byId('hits-media').querySelector<HTMLAnchorElement>('a.fav-thumb')!.click();
    await waitFor(() => lightbox.open.mock.calls.length === 2);

    const [items] = lightbox.open.mock.calls[1]!;
    expect(items[0]).toMatchObject({ page: 1, isMatch: true, caption: 'boeken/deel1 — pagina 1' });
    expect(items[0].kind).toBeUndefined();
    expect(items[1]).toMatchObject({ caption: '', page: undefined });
    expect(items[2]).toMatchObject({ kind: 'pdf', page: undefined, isMatch: true });
  });
});
