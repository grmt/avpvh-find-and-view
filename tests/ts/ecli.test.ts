import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ecli.ts starts every instance in window.favEcliInstances on import.

type Doc = {
  id: string;
  ecli: string;
  citation_count: number;
  references: {
    collection: string;
    title: string;
    url: string;
    source_url: string | null;
    page_number: number | null;
  }[];
};

const docs: Doc[] = [
  {
    id: '1',
    ecli: 'ECLI:NL:HR:2020:1',
    citation_count: 2,
    references: [
      { collection: 'boek', title: 'Titel', url: 'https://site.test/a.pdf', source_url: null, page_number: 3 },
      {
        collection: 'map',
        title: '',
        url: 'https://site.test/b.pdf',
        source_url: 'https://bron.test/b',
        page_number: 4,
      },
      { collection: '', title: '', url: 'javascript:alert(1)', source_url: null, page_number: null },
    ],
  },
  { id: '2', ecli: 'ECLI:NL:RBAMS:2021:9', citation_count: 1, references: [] },
];

let fetchMock: ReturnType<typeof vi.fn>;
const bodies = () => fetchMock.mock.calls.map(([, init]) => JSON.parse((init as RequestInit).body as string));
const flush = () => vi.advanceTimersByTimeAsync(0);

async function start(html: string) {
  document.body.innerHTML = html;
  window.favEcliInstances = [
    { uid: 'ecli-1', meiliUrl: 'https://meili.test', meiliKey: 'k', ecliIndex: 'ecli', placeholder: '' },
    { uid: 'missing', meiliUrl: '', meiliKey: '', ecliIndex: 'ecli', placeholder: '' },
  ];
  vi.resetModules();
  await import('../../src/ts/ecli');
  await flush();
}

const markup = `<div id="ecli-1">
  <input class="fav-ecli-search-input"><p class="fav-ecli-hint">Tip</p><div class="fav-ecli-results"></div>
</div>`;
const results = () => document.querySelector<HTMLElement>('.fav-ecli-results')!;
const hint = () => document.querySelector<HTMLElement>('.fav-ecli-hint')!;

function type(value: string) {
  const input = document.querySelector<HTMLInputElement>('.fav-ecli-search-input')!;
  input.value = value;
  input.dispatchEvent(new Event('input'));
}

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ hits: docs })));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete window.favEcliInstances;
});

describe('ECLI search', () => {
  it('shows the most-cited ECLIs on start', async () => {
    await start(markup);

    expect(bodies()).toEqual([{ q: '', limit: 50, sort: ['citation_count:desc'] }]);
    const cards = results().querySelectorAll('.fav-ecli-card');
    expect(cards).toHaveLength(2);
    expect(cards[0]!.querySelector('.fav-ecli-count')!.textContent).toBe('2 verwijzingen');
    expect(cards[1]!.querySelector('.fav-ecli-count')!.textContent).toBe('1 verwijzing');
    expect(cards[0]!.querySelector('.fav-ecli-id')!.getAttribute('href')).toBe(
      'https://uitspraken.rechtspraak.nl/details?id=ECLI%3ANL%3AHR%3A2020%3A1',
    );
  });

  it('links each reference to its source or its page', async () => {
    await start(markup);

    const links = [...results().querySelectorAll<HTMLAnchorElement>('.fav-ecli-refs a')];
    expect(links.map(a => a.textContent)).toEqual(['Titel — pagina 3', 'map — pagina 4', 'javascript:alert(1)']);
    expect(links.map(a => a.getAttribute('href'))).toEqual([
      'https://site.test/a.pdf#page=3',
      'https://bron.test/b',
      '',
    ]);
    expect(links[0]!.target).toBe('_blank');
  });

  it('searches the typed text after a pause and hides the hint', async () => {
    await start(markup);
    fetchMock.mockClear();

    type('hoge raad');
    type('hoge raad 2020');
    await vi.advanceTimersByTimeAsync(250);

    expect(bodies()).toEqual([{ q: 'hoge raad 2020', limit: 50 }]);
    expect(hint().style.display).toBe('none');
  });

  it('looks up a complete ECLI exactly', async () => {
    await start(markup);
    fetchMock.mockClear();

    type('ecli:nl:hr:2020:1');
    await vi.advanceTimersByTimeAsync(250);

    expect(bodies()).toEqual([{ q: '', filter: 'ecli = "ECLI:NL:HR:2020:1"', limit: 1 }]);
  });

  it('says when nothing was found, or when the search failed', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({})));
    await start(markup);
    expect(results().textContent).toBe("Geen ECLI's gevonden.");

    fetchMock.mockResolvedValueOnce(new Response('', { status: 500 }));
    type('x');
    await vi.advanceTimersByTimeAsync(250);
    expect(results().textContent).toBe('Kon niet zoeken.');
  });

  it('skips an instance without its search field', async () => {
    await start('<div id="ecli-1"></div>');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('works without a hint', async () => {
    await start(`<div id="ecli-1"><input class="fav-ecli-search-input"><div class="fav-ecli-results"></div></div>`);
    expect(results().querySelectorAll('.fav-ecli-card')).toHaveLength(2);
  });
});
