import type { FavConfig, SearchConfig } from './types';

export async function proxySearch(cfg: SearchConfig, queries: object[]): Promise<{ results: unknown[] }> {
  const proxy = cfg.searchProxy;
  if (!proxy) throw new Error('Missing search proxy');
  const res = await fetch(proxy.url, {
    method: 'POST', credentials: 'same-origin', cache: 'no-store',
    headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': proxy.nonce },
    body: JSON.stringify({ queries, indexes: proxy.indexes, group: proxy.group, scopeNonce: proxy.scopeNonce }),
  });
  if (!res.ok) throw new Error(`Search HTTP ${res.status}`);
  return res.json();
}

export async function searchIndex<T>(cfg: SearchConfig, index: string, body: object): Promise<T> {
  if (cfg.searchProxy) {
    const data = await proxySearch(cfg, [{ ...body, indexUid: index }]);
    return data.results[0] as T;
  }
  const res = await fetch(`${cfg.meiliUrl}/indexes/${encodeURIComponent(index)}/search`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.meiliKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Meilisearch HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

/** The SDK expects parsed JSON from a custom httpClient. */
export function proxyHttpClient(cfg: SearchConfig): (...args: Parameters<typeof fetch>) => Promise<unknown> {
  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.pathname !== '/multi-search') throw new Error('Unsupported search operation');
    const raw = init?.body ?? '{}';
    if (typeof raw !== 'string') throw new Error('Unsupported search request body');
    const body = JSON.parse(raw) as { queries: object[] };
    return proxySearch(cfg, body.queries);
  };
}

/**
 * Shared "search is down" banner + a guarded fetch wrapper for the raw
 * Meilisearch calls that live outside instantsearch's own client (browse
 * mode, ecli search, in-editor collection search). instantsearch.js catches
 * failures from its own searchClient internally (see search.ts's `error`
 * listener); these call sites don't have that safety net, so a Meilisearch
 * outage would otherwise surface as an uncaught NetworkError instead of a
 * readable message.
 */
function ensureBanner(root: HTMLElement): HTMLElement {
  let el = root.querySelector<HTMLElement>(':scope > .fav-error-banner');
  if (!el) {
    el = document.createElement('div');
    el.className = 'fav-error-banner';
    el.hidden = true;
    el.textContent = 'Zoeken is tijdelijk niet beschikbaar. Probeer het over enkele minuten opnieuw.';
    const bar = root.querySelector(':scope > .fav-searchbar');
    if (bar) bar.after(el); else root.prepend(el);
  }
  return el;
}

export function showSearchError(cfg: FavConfig): void {
  const root = document.getElementById(cfg.uid);
  if (root) ensureBanner(root).hidden = false;
}

export function hideSearchError(cfg: FavConfig): void {
  const root = document.getElementById(cfg.uid);
  root?.querySelector<HTMLElement>(':scope > .fav-error-banner')?.setAttribute('hidden', '');
}

export async function meiliSearch<T>(cfg: FavConfig, index: string, body: object): Promise<T | null> {
  try {
    const data = await searchIndex<T>(cfg, index, body);
    hideSearchError(cfg);
    return data;
  } catch (err) {
    console.error('[avpvh-fav] Meilisearch request failed', err);
    showSearchError(cfg);
    return null;
  }
}
