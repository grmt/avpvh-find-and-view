import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  hideSearchError,
  meiliSearch,
  proxyHttpClient,
  proxySearch,
  searchIndex,
  showSearchError,
} from '../../src/ts/meili';
import type { FavConfig, SearchConfig } from '../../src/ts/types';

const proxy = {
  url: 'https://site.test/wp-json/avpvh-find-and-view/v1/search',
  nonce: 'nonce-1',
  indexes: ['media'],
  group: 'g',
  scopeNonce: 'scope-1',
};
const proxied: SearchConfig = { meiliUrl: '', meiliKey: '', searchProxy: proxy };
const direct: SearchConfig = { meiliUrl: 'https://meili.test', meiliKey: 'key-1' };

const favConfig = (base: SearchConfig): FavConfig => ({
  ...base,
  uid: 'fav-1',
  mediaIndex: 'media',
  contentIndex: 'content',
  perPage: 10,
  snippetLen: 30,
  showMedia: true,
  showContent: true,
  browseMode: false,
  browseRootLabel: '',
  placeholder: '',
  canEdit: false,
  restRoot: '',
  editNonce: '',
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('proxySearch', () => {
  it('posts the queries with the proxy scope and nonce', async () => {
    fetchMock.mockResolvedValue(json({ results: [{ hits: [] }] }));

    await expect(proxySearch(proxied, [{ q: 'x' }])).resolves.toEqual({ results: [{ hits: [] }] });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(proxy.url);
    expect(init.headers['X-WP-Nonce']).toBe('nonce-1');
    expect(JSON.parse(init.body)).toEqual({
      queries: [{ q: 'x' }],
      indexes: ['media'],
      group: 'g',
      scopeNonce: 'scope-1',
    });
  });

  it('fails without a proxy', async () => {
    await expect(proxySearch(direct, [])).rejects.toThrow('Missing search proxy');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails on an HTTP error', async () => {
    fetchMock.mockResolvedValue(json({}, 403));
    await expect(proxySearch(proxied, [])).rejects.toThrow('Search HTTP 403');
  });
});

describe('searchIndex', () => {
  it('goes through the proxy when there is one', async () => {
    fetchMock.mockResolvedValue(json({ results: [{ hits: [1] }] }));

    await expect(searchIndex(proxied, 'media', { q: 'x' })).resolves.toEqual({ hits: [1] });
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body).queries).toEqual([{ q: 'x', indexUid: 'media' }]);
  });

  it('calls Meilisearch directly otherwise', async () => {
    fetchMock.mockResolvedValue(json({ hits: [2] }));

    await expect(searchIndex(direct, 'a/b', { q: 'y' })).resolves.toEqual({ hits: [2] });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://meili.test/indexes/a%2Fb/search');
    expect(init.headers.Authorization).toBe('Bearer key-1');
  });

  it('fails on a Meilisearch HTTP error', async () => {
    fetchMock.mockResolvedValue(json({}, 500));
    await expect(searchIndex(direct, 'media', {})).rejects.toThrow('Meilisearch HTTP 500');
  });
});

describe('proxyHttpClient', () => {
  it('passes multi-search queries to the proxy', async () => {
    fetchMock.mockResolvedValue(json({ results: [] }));
    const client = proxyHttpClient(proxied);

    await client('https://meili.test/multi-search', {
      method: 'POST',
      body: JSON.stringify({ queries: [{ indexUid: 'media', q: 'z' }] }),
    });

    expect(JSON.parse(fetchMock.mock.calls[0]![1].body).queries).toEqual([{ indexUid: 'media', q: 'z' }]);
  });

  it('accepts a Request as input', async () => {
    fetchMock.mockResolvedValue(json({ results: [] }));
    const client = proxyHttpClient(proxied);

    await client(new Request('https://meili.test/multi-search'), { body: '{"queries":[]}' });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('refuses other Meilisearch operations', async () => {
    const client = proxyHttpClient(proxied);
    await expect(client('https://meili.test/indexes/media/documents')).rejects.toThrow('Unsupported search operation');
  });

  it('refuses a body that is not a string', async () => {
    const client = proxyHttpClient(proxied);
    await expect(client('https://meili.test/multi-search', { body: new Blob(['{}']) })).rejects.toThrow(
      'Unsupported search request body',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('treats a missing body as no queries', async () => {
    fetchMock.mockResolvedValue(json({ results: [] }));
    const client = proxyHttpClient(proxied);

    await client('https://meili.test/multi-search');
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).not.toHaveProperty('queries');
  });
});

describe('search error banner', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="fav-1"><div class="fav-searchbar"></div><div class="fav-hits"></div></div>';
  });

  const banner = () => document.querySelector<HTMLElement>('#fav-1 > .fav-error-banner');

  it('shows one banner after the search bar, and hides it again', () => {
    const cfg = favConfig(direct);
    showSearchError(cfg);
    showSearchError(cfg);

    expect(document.querySelectorAll('.fav-error-banner')).toHaveLength(1);
    expect(banner()!.previousElementSibling!.className).toBe('fav-searchbar');
    expect(banner()!.hidden).toBe(false);

    hideSearchError(cfg);
    expect(banner()!.hidden).toBe(true);
  });

  it('puts the banner first when there is no search bar', () => {
    document.body.innerHTML = '<div id="fav-1"><div class="fav-hits"></div></div>';
    showSearchError(favConfig(direct));
    expect(document.getElementById('fav-1')!.firstElementChild!.className).toBe('fav-error-banner');
  });

  it('does nothing when the search root is missing', () => {
    document.body.innerHTML = '';
    expect(() => {
      showSearchError(favConfig(direct));
      hideSearchError(favConfig(direct));
    }).not.toThrow();
  });
});

describe('meiliSearch', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="fav-1"></div>';
  });

  it('returns the result and hides the banner', async () => {
    const cfg = favConfig(direct);
    showSearchError(cfg);
    fetchMock.mockResolvedValue(json({ hits: [3] }));

    await expect(meiliSearch(cfg, 'media', {})).resolves.toEqual({ hits: [3] });
    expect(document.querySelector<HTMLElement>('.fav-error-banner')!.hidden).toBe(true);
  });

  it('returns null and shows the banner when the search fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchMock.mockRejectedValue(new TypeError('NetworkError'));

    await expect(meiliSearch(favConfig(direct), 'media', {})).resolves.toBeNull();
    expect(document.querySelector<HTMLElement>('.fav-error-banner')!.hidden).toBe(false);
  });
});
