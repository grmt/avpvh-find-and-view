import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// The admin tree page script runs on import and wires itself up on
// DOMContentLoaded, so this suite loads it once against a stubbed REST API.

const ids = [
  'fav-tree-root',
  'fav-tree-selbar',
  'fav-sel-count',
  'fav-sel-move',
  'fav-sel-clear',
  'fav-tree-normalize',
  'fav-normalize-apply',
  'fav-normalize-panel',
  'fav-normalize-list',
  'fav-tree-remap',
  'fav-remap-apply',
  'fav-remap-panel',
  'fav-remap-list',
  'fav-tree-reindex',
  'fav-tree-reindex-content',
  'fav-index-stats',
  'fav-stats-refresh',
  'fav-idx-apply',
  'fav-idx-msg',
  'fav-doc-search',
  'fav-doc-results',
  'fav-doc-editor',
  'fav-doc-save',
  'fav-doc-save-msg',
  'fav-doc-title',
];
const inputs = [
  'fav-idx-name',
  'fav-doc-idx',
  'fav-doc-q',
  'fav-doc-id',
  'fav-doc-text',
  'fav-one-typo',
  'fav-two-typos',
  'fav-separators',
];

const tree = {
  name: 'root',
  path: '',
  leaf: false,
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
const failing = new Set<string>();
const alertMock = vi.fn();
const confirmMock = vi.fn(() => true);
const promptMock = vi.fn((): string | null => null);

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
    inputs.map(id => `<input id="${id}">`).join('') +
    '<input type="checkbox" id="fav-typo-on" checked>';
  (window as unknown as { favTree: unknown }).favTree = { root: '/wp-json/fav/v1/', nonce: 'nonce-1' };

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      const endpoint = url.replace('/wp-json/fav/v1/', '');
      calls.push({ endpoint, init });
      if (failing.has(endpoint)) return new Response('kapot', { status: 500 });
      return new Response(JSON.stringify(responses[endpoint] ?? {}), { status: 200 });
    }),
  );
  vi.stubGlobal('alert', alertMock);
  vi.stubGlobal('confirm', confirmMock);
  vi.stubGlobal('prompt', promptMock);

  await import('../../src/ts/admin/tree');
  document.dispatchEvent(new Event('DOMContentLoaded'));
  await flush();
});

beforeEach(() => {
  calls.length = 0;
  failing.clear();
  alertMock.mockReset();
  confirmMock.mockReset().mockReturnValue(true);
  promptMock.mockReset().mockReturnValue(null);
});

const el = (id: string) => document.getElementById(id)!;
const endpoints = () => calls.map(c => c.endpoint);
const bodyOf = (endpoint: string) => JSON.parse(calls.find(c => c.endpoint === endpoint)!.init.body as string);
const rowOf = (name: string) => nodeOf(name).querySelector<HTMLElement>(':scope > .fav-tree-row')!;
const select = (name: string) => {
  const cb = nodeOf(name).querySelector<HTMLInputElement>('.fav-tree-cb')!;
  cb.checked = !cb.checked;
  cb.dispatchEvent(new Event('change'));
};

function dragEvent(type: string) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: { effectAllowed: '' } });
  return event;
}

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

  it('shows the server error when a request fails', async () => {
    failing.add('tree/index-stats');
    document.getElementById('fav-stats-refresh')!.click();
    await flush();

    expect(document.getElementById('fav-index-stats')!.textContent).toBe('Fout: Error: kapot');
  });

  it('keeps the selection when a selected item is dragged', () => {
    const cb = nodeOf('a').querySelector<HTMLInputElement>('.fav-tree-cb')!;
    cb.checked = true;
    cb.dispatchEvent(new Event('change'));

    dragStart(nodeOf('a'));

    expect(nodeOf('a').classList.contains('fav-selected')).toBe(true);
    cb.dispatchEvent(new Event('change'));
    expect(document.querySelectorAll('.fav-selected')).toHaveLength(0);
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

  it('cancels a rename on Escape and ignores other keys', async () => {
    label('a').dispatchEvent(new MouseEvent('dblclick'));
    const input = document.querySelector<HTMLInputElement>('.fav-tree-rename')!;
    input.value = 'x';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    expect(input.isConnected).toBe(true);

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await flush();

    expect(input.isConnected).toBe(false);
    expect(label('a')).toBeDefined();
    expect(calls).toHaveLength(0);
  });

  it('only searches documents on Enter', async () => {
    document.getElementById('fav-doc-q')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'z' }));
    await flush();
    expect(calls).toHaveLength(0);
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

describe('drag and drop', () => {
  it('moves a dragged item into a folder after confirmation', async () => {
    dragStart(nodeOf('b'));
    const over = dragEvent('dragover');
    rowOf('a').dispatchEvent(over);
    expect(over.defaultPrevented).toBe(true);
    expect(rowOf('a').classList.contains('fav-drop-over')).toBe(true);

    rowOf('a').dispatchEvent(dragEvent('drop'));
    await flush();

    expect(confirmMock).toHaveBeenCalledWith("Verplaats 1 map(pen) naar 'a'?");
    expect(bodyOf('tree/move')).toEqual({ from: 'b', to: 'a/b' });
    expect(endpoints()).toContain('tree');
    nodeOf('b').dispatchEvent(dragEvent('dragend'));
  });

  it('drops onto a file into its folder, and onto the root folder', async () => {
    dragStart(nodeOf('b'));
    rowOf('a1').dispatchEvent(dragEvent('drop'));
    await flush();
    expect(bodyOf('tree/move')).toEqual({ from: 'b', to: 'a/b' });

    calls.length = 0;
    dragStart(nodeOf('a1'));
    rowOf('root').dispatchEvent(dragEvent('drop'));
    await flush();
    expect(confirmMock).toHaveBeenLastCalledWith("Verplaats 1 map(pen) naar 'root'?");
    expect(bodyOf('tree/move')).toEqual({ from: 'a/a1', to: 'a1' });
    nodeOf('a1').dispatchEvent(dragEvent('dragend'));
  });

  it('does nothing when the move is not confirmed', async () => {
    confirmMock.mockReturnValue(false);
    dragStart(nodeOf('b'));
    rowOf('a').dispatchEvent(dragEvent('drop'));
    await flush();
    expect(calls).toHaveLength(0);
    nodeOf('b').dispatchEvent(dragEvent('dragend'));
  });

  it('refuses to drop a folder into itself', () => {
    dragStart(nodeOf('a'));
    const over = dragEvent('dragover');
    rowOf('a1').dispatchEvent(over);
    expect(over.defaultPrevented).toBe(false);
    rowOf('a1').dispatchEvent(dragEvent('dragleave'));
    expect(document.querySelectorAll('.fav-drop-over')).toHaveLength(0);
    nodeOf('a').dispatchEvent(dragEvent('dragend'));
  });

  it('ignores dragover and drop without a drag in progress', async () => {
    const over = dragEvent('dragover');
    rowOf('a').dispatchEvent(over);
    rowOf('a').dispatchEvent(dragEvent('drop'));
    await flush();
    expect(over.defaultPrevented).toBe(false);
    expect(confirmMock).not.toHaveBeenCalled();
  });

  it('reports a failed move', async () => {
    failing.add('tree/move');
    dragStart(nodeOf('b'));
    rowOf('a').dispatchEvent(dragEvent('drop'));
    await flush();
    expect(alertMock).toHaveBeenCalledWith('Fout: Error: kapot');
    nodeOf('b').dispatchEvent(dragEvent('dragend'));
  });
});

describe('selection', () => {
  it('moves the selected items to the folder typed in', async () => {
    select('b');
    select('a1');
    promptMock.mockReturnValue('/a/');
    el('fav-sel-move').click();
    await flush();

    // a/a1 is already in a: skipped. b moves into a.
    expect(calls.filter(c => c.endpoint === 'tree/move').map(c => JSON.parse(c.init.body as string))).toEqual([
      { from: 'b', to: 'a/b' },
    ]);
    expect(el('fav-tree-selbar').style.display).toBe('none');
  });

  it('refuses to move a folder into its own subfolder', async () => {
    select('a');
    promptMock.mockReturnValue('a/a1');
    el('fav-sel-move').click();
    await flush();

    expect(alertMock).toHaveBeenCalledWith("Kan 'a' niet verplaatsen naar een eigen submap.");
    expect(endpoints()).not.toContain('tree/move');
  });

  it('does nothing when the prompt is cancelled or nothing is selected', async () => {
    el('fav-sel-move').click();
    await flush();
    expect(promptMock).not.toHaveBeenCalled();

    select('b');
    el('fav-sel-move').click();
    await flush();
    expect(promptMock).toHaveBeenCalledOnce();
    expect(calls).toHaveLength(0);
    el('fav-sel-clear').click();
  });

  it('reports a failed move', async () => {
    failing.add('tree/move');
    select('b');
    promptMock.mockReturnValue('a');
    el('fav-sel-move').click();
    await flush();
    expect(alertMock).toHaveBeenCalledWith('Fout: Error: kapot');
    el('fav-sel-clear').click();
  });

  it('clears the selection', () => {
    select('b');
    el('fav-sel-clear').click();
    expect(document.querySelectorAll('.fav-selected')).toHaveLength(0);
    expect(nodeOf('b').querySelector<HTMLInputElement>('.fav-tree-cb')!.checked).toBe(false);
    expect(el('fav-sel-count').textContent).toBe('0 geselecteerd');
  });
});

describe('tree editing', () => {
  it('creates a subfolder', async () => {
    promptMock.mockReturnValue('nieuw');
    nodeOf('a').querySelector<HTMLButtonElement>('.fav-tree-add')!.click();
    await flush();
    expect(bodyOf('tree/mkdir')).toEqual({ path: 'a/nieuw' });

    calls.length = 0;
    rowOf('root').querySelector<HTMLButtonElement>('.fav-tree-add')!.click();
    await flush();
    expect(bodyOf('tree/mkdir')).toEqual({ path: 'nieuw' });
  });

  it('creates nothing without a name, and reports a failure', async () => {
    rowOf('root').querySelector<HTMLButtonElement>('.fav-tree-add')!.click();
    await flush();
    expect(calls).toHaveLength(0);

    failing.add('tree/mkdir');
    promptMock.mockReturnValue('x');
    rowOf('root').querySelector<HTMLButtonElement>('.fav-tree-add')!.click();
    await flush();
    expect(alertMock).toHaveBeenCalledWith('Fout: Error: kapot');
  });

  it('folds and unfolds a folder', () => {
    const icon = nodeOf('a').querySelector<HTMLElement>('.fav-tree-icon')!;
    icon.click();
    expect(icon.textContent).toBe('📁');
    expect(nodeOf('a').querySelector('ul')!.hidden).toBe(true);
    icon.click();
    expect(icon.textContent).toBe('📂');
  });

  it('keeps the name when a rename is left unchanged', async () => {
    label('a').dispatchEvent(new MouseEvent('dblclick'));
    const input = document.querySelector<HTMLInputElement>('.fav-tree-rename')!;
    input.dispatchEvent(new Event('blur'));
    await flush();
    expect(input.isConnected).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('reports a failed rename', async () => {
    failing.add('tree/move');
    label('a1').dispatchEvent(new MouseEvent('dblclick'));
    const input = document.querySelector<HTMLInputElement>('.fav-tree-rename')!;
    input.value = 'a2';
    input.dispatchEvent(new Event('blur'));
    await flush();
    expect(bodyOf('tree/move')).toEqual({ from: 'a/a1', to: 'a/a2' });
    expect(alertMock).toHaveBeenCalledWith('Fout: Error: kapot');
    expect(label('a1')).toBeDefined();
  });
});

describe('normalize and remap', () => {
  it('previews and applies normalized numbering', async () => {
    responses['tree/normalize'] = { renamed: [{ from: 'a/1', to: 'a/01' }], dry_run: true };
    el('fav-tree-normalize').click();
    await flush();
    expect(bodyOf('tree/normalize')).toEqual({ dry_run: true });
    expect(el('fav-normalize-list').innerHTML).toContain('<code>a/1</code> → <code>a/01</code>');
    expect(el('fav-normalize-apply').style.display).toBe('');
    expect((el('fav-tree-normalize') as HTMLButtonElement).disabled).toBe(false);

    calls.length = 0;
    el('fav-normalize-apply').click();
    await flush();
    expect(bodyOf('tree/normalize')).toEqual({ dry_run: false });
    expect(el('fav-normalize-panel').style.display).toBe('none');
    expect(endpoints()).toContain('tree');
  });

  it('says when there is nothing to normalize, and reports a failure', async () => {
    responses['tree/normalize'] = { renamed: [], dry_run: true };
    el('fav-tree-normalize').click();
    await flush();
    expect(el('fav-normalize-list').textContent).toBe('Geen mappen te hernoemen.');
    expect(el('fav-normalize-apply').style.display).toBe('none');

    failing.add('tree/normalize');
    el('fav-tree-normalize').click();
    await flush();
    expect(alertMock).toHaveBeenCalledWith('Fout: Error: kapot');
  });

  it('previews a remap with matches, misses and leftovers', async () => {
    responses['tree/remap'] = {
      dry_run: true,
      mappings: [{ old: 'oud', new: 'nieuw', pages: 3 }],
      unmatched: [{ new: 'los', pages: 1, norm: 'los' }],
      unmatched_old: ['weg'],
    };
    el('fav-tree-remap').click();
    await flush();

    const list = el('fav-remap-list').textContent!;
    expect(list).toContain('oud');
    expect(list).toContain('los — geen match in index (1p)');
    expect(list).toContain('In index maar niet op server: weg');
    expect(el('fav-remap-apply').style.display).toBe('');
    expect(el('fav-remap-panel').style.display).toBe('');
  });

  it('offers no apply when nothing matches', async () => {
    responses['tree/remap'] = { dry_run: true, unmatched: [{ new: 'los', pages: 1, norm: 'los' }] };
    el('fav-tree-remap').click();
    await flush();
    expect(el('fav-remap-apply').style.display).toBe('none');

    responses['tree/remap'] = { dry_run: true };
    el('fav-tree-remap').click();
    await flush();
    expect(el('fav-remap-list').textContent).toBe('Niets te hernoemen.');
  });

  it('applies a remap, and reports a failure', async () => {
    responses['tree/remap'] = { dry_run: false, mapped: 2, inserted: 5, deleted: 1 };
    el('fav-remap-apply').click();
    await flush();
    expect(bodyOf('tree/remap')).toEqual({ dry_run: false });
    expect(alertMock).toHaveBeenCalledWith('Klaar — 2 collecties hernoemd, 5 docs bijgewerkt, 1 oud verwijderd.');
    expect(el('fav-remap-panel').style.display).toBe('none');

    failing.add('tree/remap');
    el('fav-tree-remap').click();
    await flush();
    expect(alertMock).toHaveBeenLastCalledWith('Fout: Error: kapot');
  });
});

describe('reindexing', () => {
  it.each([
    ['fav-tree-reindex', 'tree/reindex', "Klaar — 7 pagina's geïndexeerd.", 'Herindex scans'],
    [
      'fav-tree-reindex-content',
      'tree/reindex-content',
      "Klaar — 7 pagina's en berichten geïndexeerd.",
      "Herindex pagina's",
    ],
  ])('%s shows the result on the button, then its label', async (button, endpoint, done, buttonLabel) => {
    vi.useFakeTimers();
    try {
      responses[endpoint] = { indexed: 7 };
      el(button).click();
      await vi.advanceTimersByTimeAsync(0);
      expect(el(button).textContent).toBe(done);
      expect((el(button) as HTMLButtonElement).disabled).toBe(false);
      await vi.advanceTimersByTimeAsync(4000);
      expect(el(button).textContent).toBe(buttonLabel);

      failing.add(endpoint);
      el(button).click();
      await vi.advanceTimersByTimeAsync(0);
      expect(el(button).textContent).toBe('Fout: Error: kapot');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('index settings and stats', () => {
  it('applies the typo settings', async () => {
    (el('fav-idx-name') as HTMLInputElement).value = 'media';
    (el('fav-one-typo') as HTMLInputElement).value = '5';
    (el('fav-two-typos') as HTMLInputElement).value = '9';
    (el('fav-separators') as HTMLInputElement).value = '-';
    responses['tree/index-settings'] = { taskUid: 12 };
    el('fav-idx-apply').click();
    await flush();

    expect(bodyOf('tree/index-settings')).toEqual({
      index: 'media',
      typo_enabled: true,
      one_typo: '5',
      two_typos: '9',
      separators: '-',
    });
    expect(el('fav-idx-msg').textContent).toBe('Toegepast (taak #12)');
  });

  it('shows a question mark without a task id, and reports a failure', async () => {
    responses['tree/index-settings'] = {};
    el('fav-idx-apply').click();
    await flush();
    expect(el('fav-idx-msg').textContent).toBe('Toegepast (taak #?)');

    failing.add('tree/index-settings');
    el('fav-idx-apply').click();
    await flush();
    expect(el('fav-idx-msg').textContent).toBe('Fout: Error: kapot');
  });

  it('says when there are no indexes', async () => {
    const saved = responses['tree/index-stats'];
    responses['tree/index-stats'] = [];
    el('fav-stats-refresh').click();
    await flush();
    expect(el('fav-index-stats').textContent).toBe('Geen indexes gevonden.');
    responses['tree/index-stats'] = [{ uid: 'busy', docs: 1, indexing: true, primaryKey: null }];
    el('fav-stats-refresh').click();
    await flush();
    expect(el('fav-index-stats').textContent).toContain('⟳ bezig');
    responses['tree/index-stats'] = saved;
  });
});

describe('document editor', () => {
  it('opens a found document in the editor and saves it', async () => {
    (el('fav-doc-idx') as HTMLInputElement).value = 'media';
    responses['tree/doc-search'] = [
      { id: 'doc 1', text: 'Tekst <b>', collection: 'boek', page_number: 4 },
      { id: 'doc2', text: 'Ander' },
    ];
    el('fav-doc-search').click();
    await flush();

    const rows = el('fav-doc-results').querySelectorAll<HTMLTableRowElement>('tr[data-id]');
    expect(rows).toHaveLength(2);
    rows[0]!.click();
    expect((el('fav-doc-id') as HTMLInputElement).value).toBe('doc 1');
    expect((el('fav-doc-text') as HTMLInputElement).value).toBe('Tekst <b>');
    expect(el('fav-doc-title').textContent).toBe('boek — pagina 4');
    expect(el('fav-doc-editor').style.display).toBe('');
    rows[1]!.click();
    expect(el('fav-doc-title').textContent).toBe('doc2');

    responses['tree/doc-save'] = { taskUid: 3 };
    (el('fav-doc-text') as HTMLInputElement).value = 'Nieuwe tekst';
    el('fav-doc-save').click();
    await flush();
    expect(bodyOf('tree/doc-save')).toEqual({ index: 'media', id: 'doc2', text: 'Nieuwe tekst' });
    expect(el('fav-doc-save-msg').textContent).toBe('Opgeslagen! (taak #3)');
    responses['tree/doc-search'] = [];
  });

  it('reports failures', async () => {
    failing.add('tree/doc-search');
    failing.add('tree/doc-save');
    el('fav-doc-search').click();
    await flush();
    expect(el('fav-doc-results').textContent).toBe('Fout: Error: kapot');

    el('fav-doc-save').click();
    await flush();
    expect(el('fav-doc-save-msg').textContent).toBe('Fout: Error: kapot');

    responses['tree/doc-save'] = {};
    failing.clear();
    el('fav-doc-save').click();
    await flush();
    expect(el('fav-doc-save-msg').textContent).toBe('Opgeslagen! (taak #?)');
  });
});
