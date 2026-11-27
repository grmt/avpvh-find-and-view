import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// The admin tree page script runs on import and wires itself up on
// DOMContentLoaded, so this suite loads it once against a stubbed REST API.

const ids = [
  'fav-tree-root', 'fav-tree-selbar', 'fav-sel-count', 'fav-sel-move', 'fav-sel-clear',
  'fav-tree-normalize', 'fav-normalize-apply', 'fav-normalize-panel', 'fav-normalize-list',
  'fav-tree-remap', 'fav-remap-apply', 'fav-remap-panel', 'fav-remap-list',
  'fav-tree-reindex', 'fav-tree-reindex-content', 'fav-index-stats', 'fav-stats-refresh',
  'fav-idx-apply', 'fav-idx-msg', 'fav-doc-search', 'fav-doc-results', 'fav-doc-editor',
  'fav-doc-save', 'fav-doc-save-msg', 'fav-doc-title',
];
const inputs = ['fav-idx-name', 'fav-doc-idx', 'fav-doc-q', 'fav-doc-id', 'fav-doc-text'];

const tree = {
  name: 'root', path: '', leaf: false,
  children: [
    { name: 'a', path: 'a', leaf: false, children: [{ name: 'a1', path: 'a/a1', leaf: true, children: [] }] },
    { name: 'b', path: 'b', leaf: true, children: [] },
  ],
};

type Call = { endpoint: string; init: RequestInit };
const calls: Call[] = [];
const responses: Record<string, unknown> = {
  tree,
  'tree/index-stats': [{ uid: 'media', docs: 3, indexing: false, primaryKey: 'id' }],
  'tree/move': { ok: true },
  'tree/doc-search': [],
};

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const label = (name: string) =>
  [...document.querySelectorAll<HTMLElement>('.fav-tree-label')].find(el => el.textContent === name)!;
const nodeOf = (name: string) => label(name).closest<HTMLElement>('li')!;

function dragStart(li: HTMLElement) {
  const event = new Event('dragstart', { bubbles: true });
  Object.defineProperty(event, 'dataTransfer', { value: { effectAllowed: '' } });
  li.dispatchEvent(event);
}

beforeAll(async () => {
  document.body.innerHTML =
    ids.map(id => `<div id="${id}"></div>`).join('') +
    inputs.map(id => `<input id="${id}">`).join('');
  (window as unknown as { favTree: unknown }).favTree = { root: '/wp-json/fav/v1/', nonce: 'nonce-1' };

  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    const endpoint = url.replace('/wp-json/fav/v1/', '');
    calls.push({ endpoint, init });
    return new Response(JSON.stringify(responses[endpoint] ?? {}), { status: 200 });
  }));
  vi.stubGlobal('alert', vi.fn());

  await import('../../src/ts/admin/tree');
  document.dispatchEvent(new Event('DOMContentLoaded'));
  await flush();
});

beforeEach(() => {
  calls.length = 0;
});

describe('admin tree page', () => {
  it('loads the tree and the index stats on start', () => {
    expect(document.querySelectorAll('.fav-tree-node')).toHaveLength(4);
    expect(document.getElementById('fav-index-stats')!.textContent).toContain('media');
  });

  it('sends the REST nonce and JSON content type with each request', async () => {
    document.getElementById('fav-stats-refresh')!.click();
    await flush();

    const headers = new Headers(calls[0]!.init.headers);
    expect(calls[0]!.endpoint).toBe('tree/index-stats');
    expect(headers.get('X-WP-Nonce')).toBe('nonce-1');
    expect(headers.get('Content-Type')).toBe('application/json');
  });

  it('drops the selection when an unselected item is dragged', () => {
    const cb = nodeOf('b').querySelector<HTMLInputElement>('.fav-tree-cb')!;
    cb.checked = true;
    cb.dispatchEvent(new Event('change'));
    expect(nodeOf('b').classList.contains('fav-selected')).toBe(true);
    expect(document.getElementById('fav-sel-count')!.textContent).toBe('1 geselecteerd');

    dragStart(nodeOf('a1'));

    expect(document.querySelectorAll('.fav-selected')).toHaveLength(0);
  });

  it('keeps nothing selected when dragging with an empty selection', () => {
    dragStart(nodeOf('a'));
    expect(document.querySelectorAll('.fav-selected')).toHaveLength(0);
  });

  it('renames on Enter', async () => {
    label('b').dispatchEvent(new MouseEvent('dblclick'));
    const input = document.querySelector<HTMLInputElement>('.fav-tree-rename')!;
    input.value = 'c';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await flush();

    expect(calls.map(c => c.endpoint)).toEqual(['tree/move', 'tree']);
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ from: 'b', to: 'c' });
  });

  it('searches documents on Enter', async () => {
    (document.getElementById('fav-doc-idx') as HTMLInputElement).value = 'media';
    (document.getElementById('fav-doc-q') as HTMLInputElement).value = 'zoek';
    document.getElementById('fav-doc-q')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await flush();

    expect(calls[0]!.endpoint).toBe('tree/doc-search');
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ index: 'media', query: 'zoek' });
    expect(document.getElementById('fav-doc-results')!.textContent).toBe('Geen resultaten.');
  });
});
