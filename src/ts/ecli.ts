import DOMPurify from 'dompurify';
import '../css/ecli.css';
import { escapeHtml, safeUrl } from './escape';
import { searchIndex } from './meili';
import type { SearchConfig } from './types';

interface EcliReference {
  collection: string;
  title: string;
  url: string;
  source_url: string | null;
  page_number: number | null;
}

interface EcliDoc {
  id: string;
  ecli: string;
  citation_count: number;
  references: EcliReference[];
}

interface EcliConfig extends SearchConfig {
  uid: string;
  meiliUrl: string;
  meiliKey: string;
  ecliIndex: string;
  placeholder: string;
}


declare global {
  interface Window {
    favEcliInstances?: EcliConfig[];
  }
}

function refLabel(r: EcliReference): string {
  const name = r.title || r.collection || r.url;
  return r.page_number != null ? `${name} — pagina ${r.page_number}` : name;
}

// Prefer the original publisher/repository URL over our own hosted copy —
// page-number deep-linking only applies to the locally-hosted PDF, since we
// can't guarantee the external source paginates identically.
function refHref(r: EcliReference): string {
  const source = safeUrl(r.source_url);
  if (source) return source;
  const url = safeUrl(r.url);
  return url && r.page_number != null ? `${url}#page=${Number(r.page_number)}` : url;
}

function renderResults(el: HTMLElement, docs: EcliDoc[]): void {
  if (!docs.length) {
    el.innerHTML = '<p class="fav-ecli-empty">Geen ECLI\'s gevonden.</p>';
    return;
  }
  el.innerHTML = DOMPurify.sanitize(docs.map(d => `
    <div class="fav-ecli-card">
      <div class="fav-ecli-card-header">
        <a class="fav-ecli-id" href="https://uitspraken.rechtspraak.nl/details?id=${encodeURIComponent(d.ecli)}" target="_blank" rel="noopener noreferrer">${escapeHtml(d.ecli)}</a>
        <span class="fav-ecli-count">${escapeHtml(d.citation_count)} ${d.citation_count === 1 ? 'verwijzing' : 'verwijzingen'}</span>
      </div>
      <ul class="fav-ecli-refs">
        ${d.references.map(r => `<li><a href="${escapeHtml(refHref(r))}" target="_blank" rel="noopener noreferrer">${escapeHtml(refLabel(r))}</a></li>`).join('')}
      </ul>
    </div>
  `).join(''), { ADD_ATTR: ['target'] });
}

function initInstance(cfg: EcliConfig): void {
  const root = document.getElementById(cfg.uid);
  if (!root) return;
  const input = root.querySelector<HTMLInputElement>('.fav-ecli-search-input');
  const resultsEl = root.querySelector<HTMLElement>('.fav-ecli-results');
  const hintEl = root.querySelector<HTMLElement>('.fav-ecli-hint');
  if (!input || !resultsEl) return;

  // A complete, well-formed ECLI gets an exact filter match instead of a
  // full-text query — Meilisearch's default search ranks by shared tokens,
  // so a query for one ECLI that isn't itself in the index can otherwise
  // return a completely different (if similar-looking) case as top hit.
  const fullEcliPattern = /^ECLI:[A-Z]{2}:[A-Z0-9.]+:\d{4}:[A-Z0-9]+$/i;

  const search = (query: string): void => {
    const isFullEcli = fullEcliPattern.test(query);
    searchIndex<{ hits?: EcliDoc[] }>(cfg, cfg.ecliIndex,
        isFullEcli
          ? { q: '', filter: `ecli = "${query.toUpperCase()}"`, limit: 1 }
          : { q: query, limit: 50, ...(query ? {} : { sort: ['citation_count:desc'] }) },
    )
      .then((data: { hits?: EcliDoc[] }) => renderResults(resultsEl, data.hits ?? []))
      .catch(() => { resultsEl.innerHTML = '<p class="fav-ecli-empty">Kon niet zoeken.</p>'; });
    if (hintEl) hintEl.style.display = query ? 'none' : '';
  };

  let debounceTimer: number | undefined;
  input.addEventListener('input', () => {
    window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(() => search(input.value.trim()), 250);
  });

  search(''); // initial view: most-cited ECLIs
}

(window.favEcliInstances ?? []).forEach(initInstance);
