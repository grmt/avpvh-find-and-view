import { escapeHtml, highlightHtml, safeUrl, safeLocalOcrUrl, quoteFilter } from '../src/ts/escape';
import { renderPlain, renderMarkdown } from '../src/ts/markdown';
import { Lightbox } from '../src/ts/lightbox';
import type { FavConfig } from '../src/ts/types';

const state = { done: false, checks: 0, error: '' };
(window as any).__favChecks = state;
(window as any).__inlineRan = 0;
const sampleMarkup = '"><img src=x onerror="window.__inlineRan=1"><svg onload="window.__inlineRan=2">';
const collection = 'folder' + sampleMarkup + '/book';
const requests: Array<{ url: string; body: any }> = [];
const waitFor = async (condition: () => boolean): Promise<void> => {
  for (let i = 0; i < 150; i++) {
    if (condition()) return;
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  throw new Error('Timed out waiting for UI');
};
function check(ok: unknown, message: string): void {
  if (!ok) throw new Error(message);
  state.checks++;
}
function safeDom(el: ParentNode): void {
  check(!el.querySelector('[onerror], [onload], iframe, object, embed'), 'Untrusted markup became live DOM');
  el.querySelectorAll<HTMLAnchorElement>('a[href]').forEach(a => {
    check(['http:', 'https:'].includes(new URL(a.href).protocol), 'Executable link rendered');
  });
}
const proxy = (indexes: string[]) => ({ url: location.origin + '/test-search', nonce: 'read-nonce', indexes, group: '', scopeNonce: 'signed-scope' });
const cfg = (uid: string, showMedia = true): FavConfig => ({
  uid, meiliUrl: location.origin, meiliKey: '', mediaIndex: 'fav_media', contentIndex: 'fav_content',
  searchProxy: proxy(showMedia ? ['fav_media', 'fav_content'] : ['fav_content']),
  perPage: 10, snippetLen: 30, showMedia, showContent: true, browseMode: true,
  browseRootLabel: 'Galerij ' + sampleMarkup, placeholder: 'Zoeken', canEdit: false, restRoot: '/test-admin/', editNonce: '',
});
function skeleton(uid: string): string {
  return `<div class="fav-wrap" id="${uid}"><div class="fav-searchbar"><div id="${uid}-searchbox"></div></div>
    <div class="fav-layout"><div class="fav-filters"><ul id="${uid}-filter-tree"></ul></div>
    <div class="fav-browse"><nav class="fav-breadcrumb"></nav><div class="fav-browse-grid"></div></div>
    <div class="fav-browse" id="${uid}-page-browse"><nav id="${uid}-page-breadcrumb"></nav><div id="${uid}-page-browse-grid"></div></div>
    <div class="fav-results"><div id="${uid}-section-media"><div id="${uid}-hits-media"></div><div id="${uid}-pag-media"></div></div>
    <div id="${uid}-section-content"><div id="${uid}-hits-content"></div><div id="${uid}-pag-content"></div></div></div></div></div>`;
}

window.fetch = async (input, init) => {
  const url = String(input);
  const body = JSON.parse(String(init?.body ?? '{}'));
  requests.push({ url, body });
  const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
  if (url.endsWith('/test-search')) {
    check(new Headers(init?.headers).get('X-WP-Nonce') === 'read-nonce', 'Missing session nonce');
    check(!new Headers(init?.headers).has('Authorization'), 'Credential sent from private browser');
    for (const query of body.queries) check(body.indexes.includes(query.indexUid), 'Hidden index requested by UI');
    return json({ results: body.queries.map((q: any) => {
      const hits = q.indexUid === 'fav_ecli' ? [{
        id: 'ecli1', ecli: 'ECLI:NL:TEST:2026:1', citation_count: sampleMarkup,
        references: [{ collection, title: sampleMarkup, url: 'javascript:window.__inlineRan=3', source_url: 'javascript:window.__inlineRan=4', page_number: 1 }],
      }] : q.indexUid === 'fav_content' ? [
        { id: '1', type: 'page', title: sampleMarkup, text: sampleMarkup, url: location.origin + '/parent/child/', date: '2026-11-20' },
        { id: '2', type: 'page', title: sampleMarkup + ' second', text: sampleMarkup, url: location.origin + '/parent/other/', date: '2026-11-20' },
      ] : [{
        id: sampleMarkup, type: 'scan', title: sampleMarkup, text: sampleMarkup, collection, url: 'javascript:window.__inlineRan=5',
        thumb_url: 'x" onerror="window.__inlineRan=6', has_image: false, page_number: 1,
        _formatted: { text: '<em>needle</em> ' + sampleMarkup },
      }];
      return { indexUid: q.indexUid, hits, query: q.q ?? '', processingTimeMs: 1, limit: q.limit ?? 20,
        offset: q.offset ?? 0, estimatedTotalHits: hits.length, facetDistribution: { collection: { [collection]: 1 } } };
    }) });
  }
  if (url.includes('/test-admin/')) {
    const endpoint = url.split('/test-admin/')[1];
    if (endpoint === 'tree') return json({ name: sampleMarkup, path: '', leaf: false, children: [] });
    if (endpoint === 'tree/index-stats') return json([{ uid: sampleMarkup, docs: sampleMarkup, indexing: false, primaryKey: null }]);
    if (endpoint === 'tree/doc-search') return json([{ id: sampleMarkup, text: sampleMarkup, collection, page_number: 1 }]);
    if (endpoint === 'tree/normalize') return json({ renamed: [{ from: sampleMarkup, to: sampleMarkup }], dry_run: true });
    if (endpoint === 'tree/remap') return json({ mappings: [{ old: sampleMarkup, new: sampleMarkup, pages: sampleMarkup }], unmatched: [{ new: sampleMarkup, pages: sampleMarkup }], unmatched_old: [sampleMarkup] });
  }
  throw new Error('Unexpected browser request: ' + url);
};

async function run(): Promise<void> {
  const host = document.createElement('div');
  document.body.append(host);
  check(escapeHtml('"\'&<>') === '&quot;&#39;&amp;&lt;&gt;', 'Incomplete attribute escaping');
  for (const url of ['javascript:alert(1)', 'java\tscript:alert(1)', 'data:text/html,x', 'vbscript:x', 'file:///etc/passwd']) {
    check(safeUrl(url) === '', 'Unsafe URL accepted: ' + url);
  }
  check(safeUrl('/safe?a=1') === location.origin + '/safe?a=1', 'Relative link broken');
  check(safeLocalOcrUrl('http://localhost:5001/v1/convert/file') === 'http://localhost:5001/v1/convert/file', 'Valid localhost OCR URL rejected');
  check(safeLocalOcrUrl('http://127.0.0.1:5001/v1/convert/file') === 'http://127.0.0.1:5001/v1/convert/file', 'Valid 127.0.0.1 OCR URL rejected');
  for (const badOcr of ['https://evil.example/upload', 'http://localhost.evil.example/ocr', 'http://user:pass@localhost:5001/ocr', 'javascript:alert(1)', 'file:///etc/passwd']) {
    check(safeLocalOcrUrl(badOcr) === '', 'Unsafe local OCR URL accepted: ' + badOcr);
  }
  check(quoteFilter('a\\" OR type = scan') === JSON.stringify('a\\" OR type = scan'), 'Filter quoting broken');
  host.innerHTML = renderPlain(sampleMarkup + '\n\n<em>literal</em>');
  safeDom(host);
  check(!host.querySelector('em') && host.textContent?.includes('<em>literal</em>'), 'Plain source interpreted as HTML');
  host.innerHTML = renderPlain('<em>needle</em> <em onclick="bad()">text</em> ' + sampleMarkup, true);
  safeDom(host);
  check(host.querySelector('em')?.textContent === 'needle' && !host.querySelector('[onclick]'), 'Highlighting not safely preserved');
  host.innerHTML = highlightHtml(sampleMarkup + '<em>needle</em>');
  safeDom(host);
  host.innerHTML = renderMarkdown('## Heading\n\n| A | B |\n|---|---|\n|1|2|\n\n' + sampleMarkup + '\n\n[bad](javascript:alert(1))');
  safeDom(host);
  check(host.querySelector('h2') && host.querySelector('table'), 'Markdown heading or table broken');
  host.remove();

  document.body.insertAdjacentHTML('beforeend', skeleton('full') + skeleton('content-only') +
    '<div id="ecli"><input class="fav-ecli-search-input"><p class="fav-ecli-hint"></p><div class="fav-ecli-results"></div></div>');
  window.favInstances = [cfg('full'), cfg('content-only', false)];
  (window as any).favEcliInstances = [{ uid: 'ecli', meiliUrl: location.origin, meiliKey: '', ecliIndex: 'fav_ecli', placeholder: '', searchProxy: proxy(['fav_ecli']) }];
  await import('../src/ts/search');
  await import('../src/ts/ecli');
  await waitFor(() => !!document.querySelector('#full .fav-col-card') && !!document.querySelector('#content-only-page-browse-grid .fav-col-card') && !!document.querySelector('.fav-ecli-card'));
  safeDom(document.body);
  check(document.querySelector('#full .fav-col-label')?.textContent?.includes('<img'), 'Collection title lost');
  check(document.querySelector('#full-page-browse-grid .fav-dir-sublist-item'), 'Page folder preview missing');
  const card = document.querySelector<HTMLElement>('#full .fav-col-card')!;
  card.click();
  await waitFor(() => !!document.querySelector('#full .fav-col-label'));
  safeDom(document.body);
  for (const uid of ['full', 'content-only']) {
    const input = document.querySelector<HTMLInputElement>(`#${uid} .ais-SearchBox-input`)!;
    input.value = 'needle';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
  await waitFor(() => !!document.querySelector('#full-hits-media .ais-Hits-item') && !!document.querySelector('#content-only-hits-content .ais-Hits-item'));
  safeDom(document.body);
  check(document.querySelector('#full-hits-media em')?.textContent === 'needle', 'Search highlighting broken: ' + document.querySelector('#full-hits-media')?.innerHTML);

  const lb = new Lightbox(cfg('full'));
  lb.open([{ url: '', kind: 'text', caption: sampleMarkup, collection, page: 1,
    rawText: sampleMarkup, text: renderMarkdown('## Heading\n' + sampleMarkup), textAlt: renderPlain(sampleMarkup) }], 0);
  const textRect = document.querySelector('.fav-lb-text-content')!.getBoundingClientRect();
  check(textRect.width > 0 && textRect.height > 0 && textRect.right <= innerWidth + 1, 'Lightbox text inaccessible at this viewport');
  document.querySelector<HTMLButtonElement>('.fav-lb-format-toggle')!.click();
  check(document.querySelector('.fav-lb-text-content')?.textContent?.includes('<img'), 'Plain text toggle did not preserve source');
  await (lb as any).runCollectionSearch('needle');
  safeDom(document.body);
  check(document.querySelector('.fav-lb-search-result-snippet em'), 'Collection highlighting broken');
  check((Lightbox as any).openPdfHref({ url: 'javascript:bad()', sourceUrl: 'data:text/html,x' }) === '', 'PDF external link unsafe');
  lb.close();

  const ids = ['fav-tree-root', 'fav-index-stats', 'fav-tree-selbar', 'fav-sel-count', 'fav-normalize-panel', 'fav-normalize-list',
    'fav-remap-panel', 'fav-remap-list', 'fav-doc-results', 'fav-doc-editor', 'fav-doc-title', 'fav-doc-save-msg', 'fav-idx-msg'];
  for (const id of ids) { const el = document.createElement('div'); el.id = id; document.body.append(el); }
  for (const id of ['fav-tree-normalize', 'fav-normalize-apply', 'fav-tree-remap', 'fav-remap-apply', 'fav-doc-search']) {
    const el = document.createElement('button'); el.id = id; document.body.append(el);
  }
  for (const id of ['fav-doc-idx', 'fav-doc-q', 'fav-doc-id', 'fav-doc-text']) {
    const el = document.createElement('input'); el.id = id; el.value = 'fav_media'; document.body.append(el);
  }
  (window as any).favTree = { root: location.origin + '/test-admin/', nonce: 'admin-nonce' };
  await import('../src/ts/admin/tree');
  document.dispatchEvent(new Event('DOMContentLoaded'));
  document.getElementById('fav-doc-search')!.click();
  document.getElementById('fav-tree-normalize')!.click();
  document.getElementById('fav-tree-remap')!.click();
  await waitFor(() => !!document.querySelector('#fav-doc-results tr[data-id]') && !!document.querySelector('#fav-normalize-list li') && !!document.querySelector('#fav-remap-list table'));
  safeDom(document.body);
  document.querySelector<HTMLElement>('#fav-doc-results tr[data-id]')!.click();
  check((document.getElementById('fav-doc-text') as HTMLInputElement).value === sampleMarkup, 'Admin editor lost literal source');
  check(document.querySelector('#fav-index-stats')?.textContent?.includes('<img'), 'Admin stats lost literal data');
  const normalFetch = window.fetch;
  window.fetch = async (input, init) => String(input).endsWith('/tree/doc-search')
    ? new Response(sampleMarkup, { status: 500 }) : normalFetch(input, init);
  document.getElementById('fav-doc-search')!.click();
  await waitFor(() => !!document.getElementById('fav-doc-results')?.textContent?.startsWith('Fout:'));
  safeDom(document.getElementById('fav-doc-results')!);
  window.fetch = normalFetch;
  await new Promise(resolve => setTimeout(resolve, 200));
  check((window as any).__inlineRan === 0, 'Inline script handler executed');
  check(requests.every(r => r.url.includes('/test-search') || r.url.includes('/test-admin/')), 'Private browser contacted Meilisearch');
  state.done = true;
}
run().catch(error => { state.error = error.stack ?? String(error); state.done = true; });
