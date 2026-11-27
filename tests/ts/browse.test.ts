import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowseMode } from '../../src/ts/browse';
import type { Lightbox } from '../../src/ts/lightbox';
import type { FavConfig, MeiliHit } from '../../src/ts/types';

const cfg: FavConfig = {
  uid: 'fav-1',
  meiliUrl: 'https://meili.test',
  meiliKey: 'k',
  mediaIndex: 'media',
  contentIndex: 'content',
  perPage: 10,
  snippetLen: 30,
  showMedia: true,
  showContent: true,
  browseMode: true,
  browseRootLabel: '',
  placeholder: '',
  canEdit: false,
  restRoot: '',
  editNonce: '',
};

const facets: Record<string, number> = { 'boeken/deel1': 3, 'boeken/deel2': 2, losse: 1, map: 2, 'map/sub': 1 };

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

let collectionHits: MeiliHit[] = [];
let total = 0;
let fetchMock: ReturnType<typeof vi.fn>;
const requests = () => fetchMock.mock.calls.map(([, init]) => JSON.parse((init as RequestInit).body as string));

function respond(body: Record<string, unknown>): unknown {
  if (body['facets']) return { facetDistribution: { collection: facets } };
  const filter = typeof body['filter'] === 'string' ? body['filter'] : '';
  if (body['limit'] === 1000) {
    return {
      hits: [
        hit({ collection: 'boeken/deel1', thumb_url: 'https://site.test/t2.jpg', page_number: 2 }),
        hit({ collection: 'boeken/deel1', thumb_url: 'https://site.test/t1.jpg', page_number: 1 }),
        hit({ collection: 'boeken/deel2', thumb_url: 'https://site.test/u1.jpg', page_number: 1 }),
        hit({ collection: 'losse', thumb_url: '' }),
        ...Array.from({ length: 7 }, (_, i) =>
          hit({ collection: 'map', thumb_url: `https://site.test/m${i}.jpg`, page_number: i }),
        ),
      ].filter(h => filter.includes(`"${h.collection}"`)),
    };
  }
  if (body['limit'] === 60) {
    const offset = Number(body['offset']);
    return { hits: collectionHits.slice(offset, offset + 60), estimatedTotalHits: total };
  }
  return { hits: collectionHits };
}

let container: HTMLElement;
let breadcrumb: HTMLElement;
let grid: HTMLElement;
let lb: { open: ReturnType<typeof vi.fn> };
let browse: BrowseMode;
const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const labels = () => [...grid.querySelectorAll('.fav-col-label')].map(el => el.textContent);
const card = (name: string) =>
  [...grid.querySelectorAll<HTMLElement>('.fav-col-card')].find(
    c => c.querySelector('.fav-col-label')!.textContent === name,
  )!;

beforeEach(() => {
  document.body.innerHTML = '<div id="c"><div id="bc"></div><div id="g"></div></div>';
  container = document.getElementById('c')!;
  breadcrumb = document.getElementById('bc')!;
  grid = document.getElementById('g')!;
  lb = { open: vi.fn() };
  browse = new BrowseMode(cfg, lb as unknown as Lightbox, container, breadcrumb, grid);
  collectionHits = [];
  total = 0;
  fetchMock = vi.fn(
    async (_url: string, init: RequestInit) => new Response(JSON.stringify(respond(JSON.parse(init.body as string)))),
  );
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('BrowseMode folders', () => {
  it('shows folders first, then collections, at the root', async () => {
    await browse.enter();

    expect(container.style.display).toBe('');
    expect(browse.current()).toBeNull();
    expect(breadcrumb.textContent).toBe('Galerij');
    expect(labels()).toEqual(['boeken', 'map', 'losse', 'map']);
    expect(card('losse').querySelector('.fav-col-count')!.textContent).toBe('1');
    expect(card('losse').querySelector('.fav-col-icon')!.textContent).toBe('📄');
  });

  it('gives a folder one cover per collection and a collection its first pages', async () => {
    await browse.enter();

    const folder = grid.querySelectorAll<HTMLElement>('.fav-col-card')[0]!;
    expect([...folder.querySelectorAll('img')].map(i => i.getAttribute('src'))).toEqual([
      'https://site.test/t1.jpg',
      'https://site.test/u1.jpg',
    ]);
    const mapLeaf = grid.querySelectorAll<HTMLElement>('.fav-col-card')[3]!;
    expect(mapLeaf.querySelectorAll('img')).toHaveLength(6);
    expect(mapLeaf.querySelector('.fav-mosaic-6')).not.toBeNull();
  });

  it('opens a folder from its card and goes back through the breadcrumb', async () => {
    await browse.enter();
    card('boeken').click();
    await flush();
    await flush();

    expect(browse.current()).toBe('boeken');
    expect(labels()).toEqual(['deel1', 'deel2']);
    expect(breadcrumb.textContent).toBe('Galerij›boeken');

    breadcrumb.querySelector<HTMLAnchorElement>('.fav-bc-link')!.click();
    await flush();
    await flush();
    expect(browse.current()).toBeNull();
  });

  it('treats a collection that also has sub-collections as a folder', async () => {
    await browse.enter('map');
    expect(labels()).toEqual(['sub']);
  });

  it('uses the configured root label and links every level of the path', async () => {
    browse = new BrowseMode(
      { ...cfg, browseRootLabel: 'Archief' },
      lb as unknown as Lightbox,
      container,
      breadcrumb,
      grid,
    );
    await browse.enter('boeken/deel1');
    expect(breadcrumb.textContent).toBe('Archief›boeken›deel1');
    expect([...breadcrumb.querySelectorAll<HTMLAnchorElement>('.fav-bc-link')].map(a => a.dataset['path'])).toEqual([
      '',
      'boeken',
    ]);
  });

  it('limits the folders to the active collections, and hides', async () => {
    await browse.enter();
    browse.setActiveCollections(['losse']);
    await flush();
    await flush();
    expect(labels()).toEqual(['losse']);

    browse.setActiveCollections(['nergens']);
    await flush();
    await flush();
    expect(grid.textContent).toBe('Geen collecties gevonden.');

    browse.hide();
    expect(container.style.display).toBe('none');
    fetchMock.mockClear();
    browse.setActiveCollections(null);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows an empty grid when the search is down', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchMock.mockRejectedValue(new TypeError('NetworkError'));
    await browse.enter();
    expect(grid.textContent).toBe('Geen collecties gevonden.');
  });
});

describe('BrowseMode collections', () => {
  it('shows the pages of a collection in order, with badges', async () => {
    collectionHits = [
      hit({ id: 'p2', page_number: 2, thumb_url: 'https://site.test/p2.jpg' }),
      hit({ id: 'p1', page_number: 1 }),
      hit({ id: 'chat', title: 'Gesprek' }),
      hit({ id: 'bare' }),
    ];
    total = 4;
    await browse.enter('losse');

    const items = [...grid.querySelectorAll<HTMLAnchorElement>('a.fav-thumb')];
    expect(items.map(a => a.dataset['id'])).toEqual(['p1', 'p2', 'chat', 'bare']);
    expect(items[0]!.querySelector('.fav-thumb-placeholder')).not.toBeNull();
    expect(items[1]!.querySelector('img')!.getAttribute('src')).toBe('https://site.test/p2.jpg');
    expect(items[1]!.querySelector('.fav-page-badge')!.textContent).toBe('2');
    expect(items[2]!.querySelector('.fav-title-badge')!.textContent).toBe('Gesprek');
    expect(items[3]!.querySelector('.fav-page-badge')).toBeNull();
    expect(grid.querySelector('.fav-load-more')).toBeNull();
  });

  it('loads more pages on request', async () => {
    collectionHits = Array.from({ length: 70 }, (_, i) => hit({ id: `p${i}`, page_number: i }));
    total = 70;
    await browse.enter('losse');

    const more = grid.querySelector<HTMLButtonElement>('.fav-load-more')!;
    expect(more.textContent).toBe('Meer laden (10 resterend)');
    more.click();
    expect(more.disabled).toBe(true);
    await flush();
    await flush();

    expect(grid.querySelectorAll('a.fav-thumb')).toHaveLength(70);
    expect(grid.querySelector('.fav-load-more')).toBeNull();
    expect(requests().at(-1)).toMatchObject({ offset: 60 });
  });

  it('shows nothing when the collection cannot be loaded', async () => {
    await browse.enter();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchMock.mockRejectedValue(new TypeError('NetworkError'));
    await browse.enter('losse');
    expect(grid.innerHTML).toBe('');
  });

  it('opens the lightbox on the clicked page with every page of the collection', async () => {
    collectionHits = [
      hit({
        id: 'a',
        page_number: 1,
        url: 'https://site.test/doc.PDF?x=1',
        text: '## Kop',
        source_url: 'https://bron.test',
      }),
      hit({ id: 'b', page_number: 2, text: 'gewone tekst', text_format: 'text' }),
      hit({ id: 'c', title: 'Chat', text: 'regel', has_image: false }),
      hit({ id: 'd', page_number: 3, text_format: 'md' }),
      hit({ id: 'e', url: '' }),
    ];
    total = 5;
    await browse.enter('map/sub');

    grid.querySelector<HTMLAnchorElement>('a.fav-thumb[data-id="b"]')!.click();
    await flush();

    expect(lb.open).toHaveBeenCalledOnce();
    const [items, start] = lb.open.mock.calls[0]!;
    expect(start).toBe(1);
    expect(items).toHaveLength(4);
    expect(items[0]).toMatchObject({ kind: 'pdf', caption: 'sub — pagina 1', page: 1, sourceUrl: 'https://bron.test' });
    expect(items[0].text).toContain('<h2>Kop</h2>');
    expect(items[0].textAlt).toContain('## Kop');
    expect(items[1]).toMatchObject({ caption: 'sub — pagina 2', page: 2 });
    expect(items[1].kind).toBeUndefined();
    expect(items[1].text).toContain('gewone tekst');
    expect(items[2]).toMatchObject({ caption: 'sub — pagina 3', text: '', textAlt: undefined });
    expect(items[3]).toMatchObject({ caption: 'sub — Chat', kind: 'text' });
  });

  it('starts the lightbox at the first page when the clicked page is gone', async () => {
    collectionHits = [hit({ id: 'a', page_number: 1 })];
    total = 1;
    await browse.enter('losse');
    const link = grid.querySelector<HTMLAnchorElement>('a.fav-thumb')!;
    collectionHits = [hit({ id: 'other', page_number: 1 })];
    link.click();
    await flush();
    expect(lb.open.mock.calls[0]![1]).toBe(0);
  });

  it('ignores clicks outside a page, and a failed lightbox search', async () => {
    collectionHits = [hit({ id: 'a', page_number: 1 })];
    total = 1;
    await browse.enter('losse');
    grid.click();
    await flush();

    vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchMock.mockRejectedValue(new TypeError('NetworkError'));
    grid.querySelector<HTMLAnchorElement>('a.fav-thumb')!.click();
    await flush();
    expect(lb.open).not.toHaveBeenCalled();
  });
});
