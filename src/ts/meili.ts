import type { FavConfig } from './types';

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
    const res = await fetch(`${cfg.meiliUrl}/indexes/${index}/search`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.meiliKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Meilisearch HTTP ${res.status}`);
    const data = (await res.json()) as T;
    hideSearchError(cfg);
    return data;
  } catch (err) {
    console.error('[avpvh-fav] Meilisearch request failed', err);
    showSearchError(cfg);
    return null;
  }
}
