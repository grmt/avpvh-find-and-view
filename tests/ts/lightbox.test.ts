import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { Lightbox as LightboxClass, LightboxItem } from '../../src/ts/lightbox';
import type { FavConfig } from '../../src/ts/types';

// pdf.js can't run in jsdom: a fake document whose pages render nothing but
// report one text item, so the highlight lookup has something to match.
const pdf = vi.hoisted(() => {
  const page = {
    getViewport: () => ({ width: 200, height: 100, scale: 2, transform: [2, 0, 0, -2, 0, 100] }),
    getTextContent: async () => ({
      items: [{ str: 'een brief hier', transform: [1, 0, 0, 10, 10, 20], width: 50 }, { str: '' }, { str: 'niets' }],
    }),
    render: () => ({ promise: Promise.resolve() }),
  };
  return {
    page,
    getDocument: vi.fn((_options: { url: string }) => ({
      promise: Promise.resolve({ getPage: async () => page }),
      destroy: () => Promise.resolve(),
    })),
  };
});
vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {} as { workerSrc?: string },
  getDocument: pdf.getDocument,
  Util: {
    transform: (a: number[], b: number[]) => [a[0]! * b[0]!, 0, 0, a[3]! * b[3]!, a[0]! * b[4]!, a[3]! * b[5]! + a[5]!],
  },
}));

let Lightbox: typeof LightboxClass;
const requestFullscreen = vi.fn(() => Promise.resolve());
const revokeObjectURL = vi.fn();
let workerSrc: string | undefined;

const cfg = (over: Partial<FavConfig> = {}): FavConfig => ({
  uid: 'fav-1',
  meiliUrl: 'https://meili.test',
  meiliKey: 'k',
  mediaIndex: 'media',
  contentIndex: 'content',
  perPage: 10,
  snippetLen: 30,
  showMedia: true,
  showContent: true,
  browseMode: false,
  browseRootLabel: '',
  placeholder: '',
  canEdit: true,
  restRoot: 'https://site.test/wp-json/avpvh-fav/v1/',
  editNonce: 'nonce',
  ...over,
});

const scan = (page: number, over: Partial<LightboxItem> = {}): LightboxItem => ({
  url: `https://site.test/scan/${page}.jpg`,
  caption: `boek — pagina ${page}`,
  text: `<p>Tekst ${page}</p>`,
  collection: 'boek',
  page,
  rawText: `Tekst ${page}`,
  ...over,
});

// --- fake server ---
type Reply = { status?: number; body?: unknown; reject?: boolean };
const replies: Record<string, Reply> = {};
const posted: Array<{ url: string; body: unknown }> = [];
let fetchMock: ReturnType<typeof vi.fn>;

function reply(path: string, body: unknown, status = 200) {
  replies[path] = { body, status };
}

const alertMock = vi.fn();
const confirmMock = vi.fn(() => true);
const openMock = vi.fn();

let lb: LightboxClass;
let onClose: Mock<() => void>;
const q = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(`.fav-lb ${selector}`)!;
const click = (selector: string) => q(selector).click();
const key = (k: string, init: KeyboardEventInit = {}, target: EventTarget = document) =>
  target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));
const flush = async () => {
  for (let i = 0; i < 6; i++) await new Promise(resolve => setTimeout(resolve, 0));
};
const counter = () => q('.fav-lb-counter').textContent;
const textarea = () => q<HTMLTextAreaElement>('.fav-lb-edit-textarea');

function touch(type: string, points: Array<[number, number]>, changed: Array<[number, number]> = points) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  const list = (p: Array<[number, number]>) => p.map(([clientX, clientY]) => ({ clientX, clientY }));
  Object.defineProperty(event, 'touches', { value: list(points) });
  Object.defineProperty(event, 'changedTouches', { value: list(changed) });
  q('.fav-lb-img-wrap').dispatchEvent(event);
  return event;
}

function pointer(target: HTMLElement, type: string, init: Record<string, unknown>) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, ...(init as MouseEventInit) });
  for (const [k, v] of Object.entries(init)) Object.defineProperty(event, k, { value: v });
  target.dispatchEvent(event);
  return event;
}

function wheel(selector: string, init: WheelEventInit) {
  const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init });
  q(selector).dispatchEvent(event);
  return event;
}

const transform = () => q('.fav-lb-img').style.transform;

beforeAll(async () => {
  Object.defineProperty(document, 'currentScript', {
    configurable: true,
    value: { src: 'https://site.test/wp-content/plugins/fav/dist/js/search.iife.js?ver=1.2' },
  });
  ({ Lightbox } = await import('../../src/ts/lightbox'));
  workerSrc = ((await import('pdfjs-dist')).GlobalWorkerOptions as { workerSrc?: string }).workerSrc;
  Object.defineProperty(document, 'currentScript', { configurable: true, value: null });

  const captured = new Set<number>();
  Object.assign(Element.prototype, {
    setPointerCapture(this: Element, id: number) {
      captured.add(id);
    },
    hasPointerCapture: (id: number) => captured.has(id),
    releasePointerCapture: (id: number) => captured.delete(id),
    requestFullscreen,
  });
  Object.assign(HTMLCanvasElement.prototype, {
    getContext: () => ({ drawImage: vi.fn() }),
    toBlob: (cb: (b: Blob | null) => void) => cb(new Blob(['png'])),
    toDataURL: () => 'data:image/png;base64,AA',
  });
  Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:page'), revokeObjectURL });
});

beforeEach(() => {
  for (const k of Object.keys(replies)) delete replies[k];
  posted.length = 0;
  alertMock.mockReset();
  confirmMock.mockReset().mockReturnValue(true);
  openMock.mockReset();
  localStorage.clear();
  vi.stubGlobal('alert', alertMock);
  vi.stubGlobal('confirm', confirmMock);
  vi.stubGlobal('open', openMock);
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: true })),
  );
  fetchMock = vi.fn(async (url: string, init: RequestInit = {}) => {
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
    posted.push({ url, body });
    const path = url.startsWith('https://site.test/wp-json/avpvh-fav/v1/')
      ? url.slice('https://site.test/wp-json/avpvh-fav/v1/'.length)
      : url;
    const r = replies[path] ?? replies[url];
    if (!r) return new Response('{}', { status: 404 });
    if (r.reject) throw new TypeError('NetworkError');
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status ?? 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  onClose = vi.fn<() => void>();
  lb = new Lightbox(cfg());
});

afterEach(() => {
  lb.close();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('pdf.js worker', () => {
  it('loads the worker from next to this script, with its version', () => {
    expect(workerSrc).toBe('https://site.test/wp-content/plugins/fav/dist/js/pdf.worker.js?ver=1.2');
  });
});

describe('opening and paging', () => {
  it('shows the start item and pages with the buttons and arrow keys', () => {
    lb.open([scan(1), scan(2), scan(3)], 1, onClose);

    expect(counter()).toBe('2 / 3');
    expect(q('.fav-lb-caption').textContent).toBe('boek — pagina 2');
    expect(q<HTMLImageElement>('.fav-lb-img').src).toBe('https://site.test/scan/2.jpg');
    expect(q('.fav-lb-text-content').innerHTML).toBe('<p>Tekst 2</p>');

    click('.fav-lb-next');
    expect(counter()).toBe('3 / 3');
    expect(q<HTMLButtonElement>('.fav-lb-next').disabled).toBe(true);
    key('ArrowRight');
    expect(counter()).toBe('3 / 3');
    key('ArrowLeft');
    click('.fav-lb-prev');
    expect(counter()).toBe('1 / 3');
    expect(q<HTMLButtonElement>('.fav-lb-prev').disabled).toBe(true);
  });

  it('jumps between search matches', () => {
    lb.open([scan(1, { isMatch: true }), scan(2), scan(3, { isMatch: true }), scan(4)], 1);

    expect(q('.fav-lb-match-nav').style.display).toBe('flex');
    expect(q('.fav-lb-match-counter').textContent).toBe('2');
    click('.fav-lb-next-match');
    expect(counter()).toBe('3 / 4');
    expect(q('.fav-lb-match-counter').textContent).toBe('2/2');
    expect(q<HTMLButtonElement>('.fav-lb-next-match').disabled).toBe(true);
    click('.fav-lb-next-match');
    expect(counter()).toBe('3 / 4');

    click('.fav-lb-prev-match');
    expect(counter()).toBe('1 / 4');
    click('.fav-lb-prev-match');
    key('ArrowDown');
    expect(counter()).toBe('3 / 4');
    key('ArrowUp');
    expect(counter()).toBe('1 / 4');
    key('ArrowUp');
    expect(counter()).toBe('1 / 4');
  });

  it('hides the match navigation without matches', () => {
    lb.open([scan(1)], 0);
    expect(q('.fav-lb-match-nav').style.display).toBe('none');
  });

  it('closes with the close button or Escape, and calls back', () => {
    lb.open([scan(1)], 0, onClose);
    click('.fav-lb-close');
    expect(document.querySelector('.fav-lb')).toBeNull();
    expect(onClose).toHaveBeenCalledOnce();

    lb.open([scan(1)], 0);
    key('Escape');
    expect(document.querySelector('.fav-lb')).toBeNull();
    key('Escape');
    lb.close();
  });

  it('shows a text-only item without the image panel', () => {
    lb.open([scan(1), { url: '', caption: 'Chat', text: '', kind: 'text' }], 1);
    expect(q('.fav-lb-img-outer').style.display).toBe('none');
    expect(q('.fav-lb-toggle-img').style.display).toBe('none');
    expect(q('.fav-lb-text-wrap').style.width).toBe('100%');
    expect(q('.fav-lb-text-content').textContent).toBe('Geen tekst beschikbaar.');
    expect(q('.fav-lb-search-wrap').style.display).toBe('none');
  });

  it('hides the editing tools from visitors', () => {
    lb = new Lightbox(cfg({ canEdit: false }));
    lb.open([scan(1)], 0);
    expect(q('.fav-lb-edit').style.display).toBe('none');
    expect(q('.fav-lb-crop-tools').style.display).toBe('none');
    expect(q('.fav-lb-search-replace-row').style.display).toBe('none');
    expect(q('.fav-lb-search-wrap').style.display).toBe('');
  });
});

describe('panels and zoom', () => {
  it('hides one panel at a time', () => {
    lb.open([scan(1), scan(2)], 0);
    click('.fav-lb-toggle-img');
    expect(q('.fav-lb-img-outer').style.display).toBe('none');
    expect(q('.fav-lb-resizer').style.display).toBe('none');
    click('.fav-lb-toggle-text');
    expect(q('.fav-lb-img-outer').style.display).toBe('');
    expect(q('.fav-lb-text-wrap').style.display).toBe('none');
    click('.fav-lb-next');
    expect(q('.fav-lb-text-wrap').style.display).toBe('none');
    click('.fav-lb-toggle-text');
    expect(q('.fav-lb-text-wrap').style.display).toBe('');
  });

  it('zooms the image with the buttons and ctrl+wheel, and resets to 1:1', () => {
    lb.open([scan(1)], 0);
    const [minus, reset, plus] = document.querySelectorAll<HTMLButtonElement>('.fav-lb-iz .fav-lb-zbtn');
    plus!.click();
    expect(transform()).toContain('scale(1.3)');
    expect(q('.fav-lb-img-wrap').classList.contains('fav-lb-zoomed')).toBe(true);
    minus!.click();
    expect(transform()).toContain('scale(1)');

    expect(wheel('.fav-lb-img-wrap', { ctrlKey: true, deltaY: -1 }).defaultPrevented).toBe(true);
    expect(transform()).toContain('scale(1.1');
    wheel('.fav-lb-img-wrap', { ctrlKey: true, deltaY: 1 });
    reset!.click();
    expect(transform()).toContain('scale(1)');
    expect(wheel('.fav-lb-img-wrap', { deltaY: 5 }).defaultPrevented).toBe(false);
  });

  it('pans a zoomed image with the wheel, arrow keys, a mouse drag and a finger', () => {
    lb.open([scan(1), scan(2)], 0);
    const plus = document.querySelectorAll<HTMLButtonElement>('.fav-lb-iz .fav-lb-zbtn')[2]!;
    plus.click();
    const before = transform();

    expect(wheel('.fav-lb-img-wrap', { deltaX: 10, deltaY: 20 }).defaultPrevented).toBe(true);
    expect(transform()).not.toBe(before);

    for (const k of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) key(k);
    expect(counter()).toBe('1 / 2');

    const wrap = q('.fav-lb-img-wrap');
    pointer(wrap, 'pointerdown', { pointerType: 'mouse', pointerId: 1, clientX: 0, clientY: 0, button: 0 });
    expect(wrap.classList.contains('fav-lb-panning')).toBe(true);
    pointer(wrap, 'pointermove', { pointerId: 1, clientX: 30, clientY: 40 });
    expect(transform()).toContain('translate(');
    pointer(wrap, 'pointerup', { pointerId: 1 });
    expect(wrap.classList.contains('fav-lb-panning')).toBe(false);
    pointer(wrap, 'pointermove', { pointerId: 1, clientX: 90, clientY: 90 });
    pointer(wrap, 'pointercancel', { pointerId: 1 });
    pointer(wrap, 'pointerdown', { pointerType: 'touch', pointerId: 2 });

    touch('touchstart', [[0, 0]]);
    expect(touch('touchmove', [[20, 10]]).defaultPrevented).toBe(true);
    touch('touchmove', []);
    touch('touchend', [], [[20, 10]]);
    expect(counter()).toBe('1 / 2');
  });

  it('sizes the text with its buttons and ctrl+wheel', () => {
    lb.open([scan(1)], 0);
    const [smaller, normal, larger] = document.querySelectorAll<HTMLButtonElement>(
      '.fav-lb-text-bar .fav-lb-zbtn:not(.fav-lb-format-toggle)',
    );
    // The text starts at 0.72em.
    larger!.click();
    expect(q('.fav-lb-text-content').style.fontSize).toBe('0.864em');
    smaller!.click();
    normal!.click();
    expect(q('.fav-lb-text-content').style.fontSize).toBe('0.72em');
    wheel('.fav-lb-text-content', { ctrlKey: true, deltaY: -1 });
    wheel('.fav-lb-text-content', { ctrlKey: true, deltaY: 1 });
    expect(wheel('.fav-lb-text-content', { deltaY: 1 }).defaultPrevented).toBe(false);
  });

  it('switches to the plain text and to a monospace font', () => {
    lb.open([scan(1, { textAlt: '<p>## Tekst</p>' }), scan(2)], 0);
    const toggle = q<HTMLButtonElement>('.fav-lb-format-toggle');
    expect(toggle.textContent).toBe('Platte tekst');
    toggle.click();
    expect(q('.fav-lb-text-content').innerHTML).toBe('<p>## Tekst</p>');
    expect(toggle.textContent).toBe('Opgemaakt');
    click('.fav-lb-next');
    expect(toggle.style.display).toBe('none');

    click('.fav-lb-mono-toggle');
    expect(q('.fav-lb-text-content').classList.contains('fav-lb-mono')).toBe(true);
    expect(q('.fav-lb-mono-toggle').classList.contains('fav-lb-active')).toBe(true);
  });

  it('remembers the split between image and text per orientation', () => {
    localStorage.setItem('avpvh-fav-lb-split-landscape', '0.4');
    lb.open([scan(1)], 0);
    expect(q('.fav-lb-text-wrap').style.width).toBe('40%');

    const resizer = q('.fav-lb-resizer');
    q('.fav-lb-body').getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 1000, bottom: 500, width: 1000, height: 500 }) as DOMRect;
    pointer(resizer, 'pointermove', { pointerId: 7, clientX: 100 });
    pointer(resizer, 'pointerdown', { pointerId: 7 });
    pointer(resizer, 'pointermove', { pointerId: 7, clientX: 700 });
    expect(q('.fav-lb-text-wrap').style.width).toBe('30%');
    expect(localStorage.getItem('avpvh-fav-lb-split-landscape')).toBe('0.3');
    pointer(resizer, 'pointerup', { pointerId: 7 });
    pointer(resizer, 'pointercancel', { pointerId: 7 });

    lb.close();
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: false })),
    );
    localStorage.setItem('avpvh-fav-lb-split-portrait', '0.5');
    lb.open([scan(1)], 0);
    expect(q('.fav-lb-text-wrap').style.height).toBe('50%');
    pointer(q('.fav-lb-resizer'), 'pointerdown', { pointerId: 8 });
    q('.fav-lb-body').getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 1000, bottom: 500, width: 1000, height: 500 }) as DOMRect;
    pointer(q('.fav-lb-resizer'), 'pointermove', { pointerId: 8, clientY: 0 });
    expect(q('.fav-lb-text-wrap').style.height).toBe('80%');
  });

  it('toggles full screen', async () => {
    lb.open([scan(1)], 0);
    click('.fav-lb-fullscreen');
    expect(requestFullscreen).toHaveBeenCalled();

    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      value: document.querySelector('.fav-lb'),
    });
    const exit = vi.fn(() => Promise.resolve());
    Object.defineProperty(document, 'exitFullscreen', { configurable: true, value: exit });
    document.dispatchEvent(new Event('fullscreenchange'));
    expect(q('.fav-lb-fullscreen').innerHTML).toContain('M5 16h3v3h2v-5H5v2z');
    click('.fav-lb-fullscreen');
    expect(exit).toHaveBeenCalledOnce();
    lb.close();
    expect(exit).toHaveBeenCalledTimes(2);
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null });
    document.dispatchEvent(new Event('fullscreenchange'));
  });
});

describe('touch gestures', () => {
  it('swipes to the next and previous page and to search matches', () => {
    lb.open([scan(1, { isMatch: true }), scan(2), scan(3, { isMatch: true })], 1);

    touch('touchstart', [[200, 100]]);
    touch('touchend', [], [[100, 100]]);
    expect(counter()).toBe('3 / 3');
    touch('touchstart', [[100, 100]]);
    touch('touchend', [], [[200, 100]]);
    expect(counter()).toBe('2 / 3');

    touch('touchstart', [[100, 200]]);
    touch('touchend', [], [[100, 100]]);
    expect(counter()).toBe('1 / 3');
    touch('touchstart', [[100, 100]]);
    touch('touchend', [], [[100, 200]]);
    expect(counter()).toBe('3 / 3');
    touch('touchstart', [[100, 100]]);
    touch('touchend', [], [[100, 200]]);
    expect(counter()).toBe('3 / 3');

    touch('touchstart', [[100, 100]]);
    touch('touchend', [], [[110, 105]]);
    touch('touchstart', [[100, 100]]);
    touch('touchend', [], []);
    touch('touchstart', [
      [1, 1],
      [2, 2],
      [3, 3],
    ]);
    touch('touchend', [], [[300, 100]]);
    touch('touchcancel', []);
    expect(counter()).toBe('3 / 3');
  });

  it('zooms with a pinch', () => {
    lb.open([scan(1)], 0);
    touch('touchstart', [
      [100, 100],
      [200, 100],
    ]);
    expect(
      touch('touchmove', [
        [50, 100],
        [250, 100],
      ]).defaultPrevented,
    ).toBe(true);
    expect(transform()).toContain('scale(2)');
    touch('touchend', [[50, 100]]);
    touch('touchend', []);
  });
});

describe('PDF pages', () => {
  it('renders the page with pdf.js and highlights the search terms', async () => {
    const pdfItem: LightboxItem = {
      url: 'https://site.test/boek.pdf',
      sourceUrl: 'https://bron.test/boek',
      caption: 'boek — pagina 2',
      text: '',
      kind: 'pdf',
      page: 2,
      highlightTerms: ['Brief'],
    };
    lb.open([pdfItem, { ...pdfItem, sourceUrl: undefined, page: 3, highlightTerms: undefined }], 0);
    expect(q('.fav-lb-loading').style.display).toBe('');
    await flush();

    expect(q<HTMLImageElement>('.fav-lb-img').src).toBe('blob:page');
    expect(q('.fav-lb-loading').style.display).toBe('none');
    expect(q<HTMLAnchorElement>('.fav-lb-open-pdf').href).toBe('https://bron.test/boek');

    const img = q<HTMLImageElement>('.fav-lb-img');
    Object.defineProperties(img, {
      offsetWidth: { configurable: true, value: 400 },
      offsetHeight: { configurable: true, value: 200 },
    });
    img.dispatchEvent(new Event('load'));
    const box = q('.fav-lb-highlight-box');
    expect(box.style.width).toBe('200px');

    img.dispatchEvent(new MouseEvent('contextmenu', { cancelable: true }));
    expect(openMock).toHaveBeenCalledWith('https://bron.test/boek', '_blank', 'noopener,noreferrer');

    click('.fav-lb-next');
    await flush();
    expect(q<HTMLAnchorElement>('.fav-lb-open-pdf').href).toBe('https://site.test/boek.pdf#page=3');
    expect(pdf.getDocument).toHaveBeenCalledTimes(1);

    click('.fav-lb-prev');
    await flush();
    expect(q<HTMLImageElement>('.fav-lb-img').src).toBe('blob:page');
  });

  it('says when a page cannot be rendered', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    pdf.getDocument.mockImplementationOnce(() => ({
      promise: Promise.reject(new Error('kapot')),
      destroy: () => Promise.reject(new Error('al weg')),
    }));
    lb.open([{ url: 'https://site.test/kapot.pdf', caption: 'x', text: '', kind: 'pdf', page: 1 }], 0);
    await flush();
    expect(q('.fav-lb-loading').textContent).toBe('Kon PDF-pagina niet laden.');
  });

  it('ignores the context menu on an image', () => {
    lb.open([scan(1)], 0);
    q('.fav-lb-img').dispatchEvent(new MouseEvent('contextmenu', { cancelable: true }));
    expect(openMock).not.toHaveBeenCalled();
  });

  it('keeps at most 24 rendered pages', async () => {
    const pages = Array.from({ length: 26 }, (_, i) => ({
      url: 'https://site.test/lang.pdf',
      caption: `p${i + 1}`,
      text: '',
      kind: 'pdf' as const,
      page: i + 1,
    }));
    lb.open(pages, 0);
    for (let i = 0; i < 25; i++) {
      await flush();
      click('.fav-lb-next');
    }
    await flush();
    expect(revokeObjectURL).toHaveBeenCalled();
  });
});

describe('editing a page', () => {
  it('edits, formats and saves the text', async () => {
    lb.open([scan(1), scan(2)], 0);
    click('.fav-lb-edit');
    expect(q('.fav-lb-edit-wrap').style.display).toBe('flex');
    expect(textarea().value).toBe('Tekst 1');

    textarea().setSelectionRange(0, 5);
    key('b', { ctrlKey: true });
    expect(textarea().value).toBe('**Tekst** 1');
    // Wrapping selects the text inside the markers; unwrapping needs them selected.
    textarea().setSelectionRange(0, 9);
    key('b', { ctrlKey: true });
    expect(textarea().value).toBe('Tekst 1');
    textarea().setSelectionRange(0, 5);
    key('i', { ctrlKey: true });
    key('x', { ctrlKey: true, shiftKey: true });
    expect(textarea().value).toBe('*~~Tekst~~* 1');
    textarea().setSelectionRange(1, 10);
    click('.fav-lb-fmt-strike');
    textarea().setSelectionRange(0, 7);
    click('.fav-lb-fmt-italic');
    click('.fav-lb-fmt-bold');
    expect(textarea().value).toBe('**Tekst** 1');

    reply('scan/edit', { text: '## Kop\n\ntekst', text_format: 'md' });
    key('s', { ctrlKey: true });
    await flush();
    expect(posted.at(-1)).toEqual({
      url: 'https://site.test/wp-json/avpvh-fav/v1/scan/edit',
      body: { collection: 'boek', page_number: 1, text: '**Tekst** 1' },
    });
    expect(q('.fav-lb-edit-wrap').style.display).toBe('none');
    expect(q('.fav-lb-text-content').innerHTML).toContain('<h2>Kop</h2>');

    click('.fav-lb-edit');
    textarea().value = 'gewoon';
    reply('scan/edit', {});
    click('.fav-lb-edit-save');
    await flush();
    expect(q('.fav-lb-text-content').innerHTML).toContain('gewoon');
  });

  it('reports a failed save', async () => {
    lb.open([scan(1)], 0);
    click('.fav-lb-edit');
    reply('scan/edit', { message: 'Geen rechten' }, 403);
    click('.fav-lb-edit-save');
    await flush();
    expect(q('.fav-lb-edit-status').textContent).toBe('Geen rechten');

    reply('scan/edit', {}, 500);
    click('.fav-lb-edit-save');
    await flush();
    expect(q('.fav-lb-edit-status').textContent).toBe('Opslaan mislukt.');

    replies['scan/edit'] = { reject: true };
    click('.fav-lb-edit-save');
    await flush();
    expect(q('.fav-lb-edit-status').textContent).toBe('Opslaan mislukt.');
  });

  it('cannot edit an item without a page', () => {
    lb.open([{ url: 'https://site.test/x.jpg', caption: 'x', text: '' }], 0);
    expect(q('.fav-lb-edit').style.display).toBe('none');
    key('s', { ctrlKey: true });
  });

  it('leaves edit mode with Escape, cancel or a page change', () => {
    lb.open([scan(1), scan(2)], 0);
    click('.fav-lb-toggle-text');
    click('.fav-lb-edit');
    expect(q('.fav-lb-text-wrap').style.display).toBe('');
    key('Escape');
    expect(q('.fav-lb-edit-wrap').style.display).toBe('none');
    click('.fav-lb-edit');
    click('.fav-lb-edit-cancel');
    expect(q('.fav-lb-edit-wrap').style.display).toBe('none');
    click('.fav-lb-edit');
    click('.fav-lb-next');
    expect(q('.fav-lb-edit-wrap').style.display).toBe('none');
  });

  it('types a tab in the editor and leaves the arrow keys to it', () => {
    lb.open([scan(1), scan(2)], 0);
    click('.fav-lb-edit');
    textarea().setSelectionRange(5, 5);
    key('Tab', {}, textarea());
    expect(textarea().value).toBe('Tekst\t 1');
    key('ArrowRight', {}, textarea());
    key('ArrowRight', {}, q('.fav-lb-search-input'));
    expect(counter()).toBe('1 / 2');
  });

  it('toggles a heading, reflows a paragraph and builds a table', () => {
    lb.open([scan(1)], 0);
    click('.fav-lb-edit');
    const ta = textarea();

    ta.value = 'regel een\nregel twee';
    ta.setSelectionRange(12, 12);
    click('.fav-lb-fmt-heading');
    expect(ta.value).toBe('regel een\n## regel twee');
    click('.fav-lb-fmt-heading');
    expect(ta.value).toBe('regel een\nregel twee');

    ta.value = 'kop\n\neen  lange\n  regel\n\nslot';
    ta.setSelectionRange(7, 7);
    click('.fav-lb-fmt-paragraph');
    expect(ta.value).toBe('kop\n\neen lange regel\n\nslot');
    ta.value = 'a\nb\n\n\nc\nd';
    ta.setSelectionRange(0, ta.value.length);
    click('.fav-lb-fmt-paragraph');
    expect(ta.value).toBe('a b\n\nc d');
    ta.value = 'enkel\nwoord';
    ta.setSelectionRange(0, 0);
    click('.fav-lb-fmt-paragraph');
    expect(ta.value).toBe('enkel woord');

    ta.value = 'naam  leeftijd\nJan  40\nPiet\t30\t|x|';
    ta.setSelectionRange(0, ta.value.length);
    click('.fav-lb-fmt-table');
    // A line with a pipe is split on pipes only, so its tab stays in the cell.
    expect(ta.value).toBe('| naam | leeftijd |\n| --- | --- |\n| Jan | 40 |\n| Piet\t30 | x |');

    ta.value = 'a\tb\tc\nd\te';
    ta.setSelectionRange(0, ta.value.length);
    click('.fav-lb-fmt-table');
    expect(ta.value).toBe('| a | b | c |\n| --- | --- | --- |\n| d | e |  |');

    ta.value = '| a | b |\n|c|';
    ta.setSelectionRange(0, ta.value.length);
    click('.fav-lb-fmt-table');
    expect(ta.value).toBe('| a | b |\n| --- | --- |\n| c |  |');

    ta.value = '  ';
    ta.setSelectionRange(0, 2);
    click('.fav-lb-fmt-table');
    expect(ta.value).toBe('  ');
  });

  it('runs OCR again on the server', async () => {
    lb.open([scan(1)], 0);
    click('.fav-lb-edit');
    confirmMock.mockReturnValueOnce(false);
    click('.fav-lb-edit-ocr');
    await flush();
    expect(posted).toHaveLength(0);

    q<HTMLSelectElement>('.fav-lb-crop-engine').value = 'tesseract';
    reply('scan/ocr', { text: 'nieuwe OCR' });
    click('.fav-lb-edit-ocr');
    await flush();
    expect(posted.at(-1)!.body).toEqual({ collection: 'boek', page_number: 1, engine: 'tesseract' });
    expect(textarea().value).toBe('nieuwe OCR');
    expect(q('.fav-lb-edit-status').textContent).toBe('OCR klaar — nog niet opgeslagen.');

    reply('scan/ocr', { message: 'Quotum op' }, 429);
    click('.fav-lb-edit-ocr');
    await flush();
    expect(q('.fav-lb-edit-status').textContent).toBe('Quotum op');
    reply('scan/ocr', {}, 500);
    click('.fav-lb-edit-ocr');
    await flush();
    expect(q('.fav-lb-edit-status').textContent).toBe('OCR mislukt.');
    replies['scan/ocr'] = { reject: true };
    textarea().value = '';
    click('.fav-lb-edit-ocr');
    await flush();
    expect(q('.fav-lb-edit-status').textContent).toBe('OCR mislukt.');
    reply('scan/ocr', {});
    click('.fav-lb-edit-ocr');
    await flush();
    expect(textarea().value).toBe('');
  });

  it('runs OCR again in a local container', async () => {
    lb.open([scan(1)], 0);
    click('.fav-lb-edit');
    const img = q<HTMLImageElement>('.fav-lb-img');
    Object.defineProperties(img, { naturalWidth: { value: 100 }, naturalHeight: { value: 50 } });
    q<HTMLSelectElement>('.fav-lb-crop-engine').value = 'local';
    const local = 'http://localhost:5001/v1/convert/file';

    reply(local, { document: { md_content: ' # Lokaal ' } });
    click('.fav-lb-edit-ocr');
    await flush();
    expect(textarea().value).toBe('# Lokaal');
    expect(q('.fav-lb-edit-status').textContent).toBe('OCR klaar (Lokale Docker) — nog niet opgeslagen.');

    reply(local, { document: { text_content: 'platte' } });
    click('.fav-lb-edit-ocr');
    await flush();
    expect(textarea().value).toBe('platte');

    reply(local, { detail: 'Model laadt' }, 503);
    click('.fav-lb-edit-ocr');
    await flush();
    expect(q('.fav-lb-edit-status').textContent).toBe('Model laadt');
    reply(local, {}, 503);
    click('.fav-lb-edit-ocr');
    await flush();
    expect(q('.fav-lb-edit-status').textContent).toBe('Lokale OCR mislukt.');
    replies[local] = { reject: true };
    click('.fav-lb-edit-ocr');
    await flush();
    expect(q('.fav-lb-edit-status').textContent).toBe(
      `Kon docling-serve niet bereiken op ${local}. Draait de container?`,
    );

    q<HTMLInputElement>('.fav-lb-crop-local-url').value = 'http://example.org/ocr';
    click('.fav-lb-edit-ocr');
    await flush();
    expect(q('.fav-lb-edit-status').textContent).toContain('Alleen lokale adressen');
  });

  it('needs a loaded page image for local OCR', async () => {
    lb.open([scan(1)], 0);
    click('.fav-lb-edit');
    q<HTMLSelectElement>('.fav-lb-crop-engine').value = 'local';
    click('.fav-lb-edit-ocr');
    await flush();
    expect(q('.fav-lb-edit-status').textContent).toBe('Paginabeeld niet geladen.');

    const img = q<HTMLImageElement>('.fav-lb-img');
    Object.defineProperties(img, { naturalWidth: { value: 10 }, naturalHeight: { value: 10 } });
    const toBlob = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb: BlobCallback) => cb(null));
    click('.fav-lb-edit-ocr');
    await flush();
    toBlob.mockRestore();
    expect(q('.fav-lb-edit-status').textContent).toBe('Kon paginabeeld niet verwerken.');
  });
});

describe('backups, deleting and the collection overview', () => {
  it('lists the backups and shows a diff against the editor text', async () => {
    lb.open([scan(1)], 0);
    reply('scan/history', {
      versions: [
        { version: 1, exists: true, mtime: '2026-11-01 10:00' },
        { version: 2, exists: false, mtime: null },
      ],
    });
    click('.fav-lb-history-btn');
    await flush();
    const panel = q('.fav-lb-history-panel');
    expect(panel.classList.contains('fav-open')).toBe(true);
    expect(panel.textContent).toContain('.bak1 (meest recent) — 2026-11-01 10:00');
    expect(panel.textContent).toContain('.bak2 — (geen back-up)');

    reply('scan/diff', { old_text: 'Tekst een' });
    panel.querySelector<HTMLButtonElement>('.fav-lb-history-diff-btn')!.click();
    await flush();
    expect(q('.fav-lb-diff-view').style.display).toBe('flex');
    expect(q('.fav-lb-diff-title').textContent).toBe('Diff — .bak1 vs. huidige tekst in het bewerkveld');
    expect(q('.fav-lb-diff-body').innerHTML).toBe('Tekst <del>een</del><ins>1</ins>');

    key('Escape');
    expect(q('.fav-lb-diff-view').style.display).toBe('none');
    click('.fav-lb-history-btn');
    await flush();
    panel.querySelector<HTMLButtonElement>('.fav-lb-history-diff-btn')!.click();
    await flush();
    click('.fav-lb-diff-back');
    expect(q<HTMLTextAreaElement>('.fav-lb-edit-textarea').style.display).toBe('');
  });

  it('closes the backup list on a second click, Escape or a click elsewhere', async () => {
    lb.open([scan(1)], 0);
    reply('scan/history', { versions: [] });
    const panel = q('.fav-lb-history-panel');
    click('.fav-lb-history-btn');
    await flush();
    click('.fav-lb-history-btn');
    expect(panel.classList.contains('fav-open')).toBe(false);

    click('.fav-lb-history-btn');
    await flush();
    key('Escape');
    expect(panel.classList.contains('fav-open')).toBe(false);
    expect(document.querySelector('.fav-lb')).not.toBeNull();

    click('.fav-lb-history-btn');
    await flush();
    document.body.click();
    expect(panel.classList.contains('fav-open')).toBe(false);

    reply('scan/history', {}, 500);
    click('.fav-lb-history-btn');
    await flush();
    expect(panel.classList.contains('fav-open')).toBe(false);
    reply('scan/diff', {}, 404);
  });

  it('shows no diff when the backup is missing', async () => {
    lb.open([scan(1)], 0);
    reply('scan/history', { versions: [{ version: 3, exists: true, mtime: 'x' }] });
    click('.fav-lb-history-btn');
    await flush();
    reply('scan/diff', {});
    q('.fav-lb-history-panel').querySelector<HTMLButtonElement>('.fav-lb-history-diff-btn')!.click();
    await flush();
    expect(q('.fav-lb-diff-view').style.display).toBe('none');
  });

  it('deletes a page and renumbers the later ones', async () => {
    lb.open([scan(1), scan(2), scan(3), { ...scan(4), collection: 'ander' }], 1);
    confirmMock.mockReturnValueOnce(false);
    click('.fav-lb-delete-page');
    await flush();
    expect(posted).toHaveLength(0);

    reply('scan/delete', {});
    click('.fav-lb-delete-page');
    await flush();
    expect(posted.at(-1)!.body).toEqual({ collection: 'boek', page_number: 2 });
    expect(counter()).toBe('2 / 3');
    expect(q('.fav-lb-caption').textContent).toBe('boek — pagina 2');

    reply('scan/delete', { message: 'Bestand op slot' }, 409);
    click('.fav-lb-delete-page');
    await flush();
    expect(alertMock).toHaveBeenCalledWith('Bestand op slot');
    reply('scan/delete', {}, 500);
    click('.fav-lb-delete-page');
    await flush();
    expect(alertMock).toHaveBeenLastCalledWith('Verwijderen mislukt.');
  });

  it('closes after deleting the last page', async () => {
    lb.open([scan(1)], 0, onClose);
    reply('scan/delete', {});
    click('.fav-lb-delete-page');
    await flush();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('regenerates the collection overview', async () => {
    lb.open([scan(1)], 0);
    confirmMock.mockReturnValueOnce(false);
    click('.fav-lb-consolidate');
    await flush();
    expect(posted).toHaveLength(0);

    reply('scan/consolidate', { pages: 12 });
    click('.fav-lb-consolidate');
    await flush();
    expect(alertMock).toHaveBeenCalledWith("Overzicht bijgewerkt (12 pagina's).");
    reply('scan/consolidate', {});
    click('.fav-lb-consolidate');
    await flush();
    expect(alertMock).toHaveBeenLastCalledWith("Overzicht bijgewerkt (0 pagina's).");
    reply('scan/consolidate', {}, 500);
    click('.fav-lb-consolidate');
    await flush();
    expect(alertMock).toHaveBeenLastCalledWith('Genereren mislukt.');
  });
});

describe('searching and replacing in the collection', () => {
  const meili = 'https://meili.test/indexes/media/search';

  async function search(text: string) {
    const input = q<HTMLInputElement>('.fav-lb-search-input');
    input.value = text;
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new Event('input'));
    await new Promise(resolve => setTimeout(resolve, 260));
    await flush();
  }

  it('lists matching pages and jumps to one', async () => {
    lb.open([scan(1), scan(2), scan(3)], 0);
    click('.fav-lb-search-btn');
    expect(q('.fav-lb-search-panel').classList.contains('fav-open')).toBe(true);

    reply(meili, {
      hits: [
        { page_number: 3, _formatted: { text: 'een <em>brief</em>' } },
        { page_number: 9, _formatted: { text: 'elders' } },
        { _formatted: {} },
      ],
    });
    await search('brief');
    expect(posted.at(-1)!.body).toMatchObject({ q: 'brief', filter: 'collection = "boek"', limit: 30 });
    const results = document.querySelectorAll<HTMLButtonElement>('.fav-lb-search-result');
    expect(results).toHaveLength(3);
    expect(results[0]!.innerHTML).toContain('<em>brief</em>');
    expect(results[2]!.textContent).toContain('Pagina ?');

    results[1]!.click();
    expect(counter()).toBe('1 / 3');
    results[0]!.click();
    expect(counter()).toBe('3 / 3');
    expect(q('.fav-lb-search-panel').classList.contains('fav-open')).toBe(false);
  });

  it('says when nothing was found or the search failed, and needs two characters', async () => {
    lb.open([scan(1)], 0);
    reply(meili, { hits: [] });
    await search('xyz');
    expect(q('.fav-lb-search-results').textContent).toBe('Geen resultaten.');
    reply(meili, {});
    await search('xyzz');
    expect(q('.fav-lb-search-results').textContent).toBe('Geen resultaten.');

    vi.spyOn(console, 'error').mockImplementation(() => {});
    reply(meili, {}, 500);
    await search('abc');
    expect(q('.fav-lb-search-results').textContent).toBe('Zoeken mislukt.');

    await search('a');
    expect(q('.fav-lb-search-results').innerHTML).toBe('');
  });

  it('closes the search panel with Escape or a click elsewhere', () => {
    lb.open([scan(1)], 0);
    click('.fav-lb-search-btn');
    key('Escape');
    expect(q('.fav-lb-search-panel').classList.contains('fav-open')).toBe(false);
    click('.fav-lb-search-btn');
    q('.fav-lb-search-input').click();
    expect(q('.fav-lb-search-panel').classList.contains('fav-open')).toBe(true);
    document.body.click();
    expect(q('.fav-lb-search-panel').classList.contains('fav-open')).toBe(false);
  });

  it('replaces text in every page on the server', async () => {
    lb.open([scan(1)], 0);
    click('.fav-lb-replace-all-btn');
    await flush();
    expect(confirmMock).not.toHaveBeenCalled();

    q<HTMLInputElement>('.fav-lb-search-input').value = 'oud';
    q<HTMLInputElement>('.fav-lb-replace-input').value = 'nieuw';
    q<HTMLInputElement>('.fav-lb-search-regex').checked = true;
    q<HTMLInputElement>('.fav-lb-search-word').checked = true;
    confirmMock.mockReturnValueOnce(false);
    click('.fav-lb-replace-all-btn');
    await flush();
    expect(posted).toHaveLength(0);

    reply('scan/replace', { total_replacements: 4, pages_changed: ['1', '2'] });
    click('.fav-lb-replace-all-btn');
    await flush();
    expect(posted.at(-1)!.body).toEqual({
      collection: 'boek',
      query: 'oud',
      replacement: 'nieuw',
      regex: true,
      case_sensitive: false,
      whole_word: true,
    });
    expect(alertMock).toHaveBeenCalledWith("4 vervanging(en) doorgevoerd in 2 pagina('s).");

    reply('scan/replace', {});
    click('.fav-lb-replace-all-btn');
    await flush();
    expect(alertMock).toHaveBeenLastCalledWith("0 vervanging(en) doorgevoerd in 0 pagina('s).");
    reply('scan/replace', { message: 'Ongeldige regex' }, 400);
    click('.fav-lb-replace-all-btn');
    await flush();
    expect(alertMock).toHaveBeenLastCalledWith('Ongeldige regex');
    reply('scan/replace', {}, 500);
    click('.fav-lb-replace-all-btn');
    await flush();
    expect(alertMock).toHaveBeenLastCalledWith('Vervangen mislukt.');
  });
});

describe('OCR of a selection', () => {
  function selectRegion(box: { left: number; top: number; width: number; height: number }) {
    const outer = q('.fav-lb-img-outer');
    outer.getBoundingClientRect = () => ({ left: 0, top: 0, width: 500, height: 500 }) as DOMRect;
    q('.fav-lb-img').getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 200 }) as DOMRect;
    q('.fav-lb-crop-rect').getBoundingClientRect = () => ({ ...box, right: 0, bottom: 0 }) as DOMRect;
    pointer(outer, 'pointerdown', { button: 0, pointerId: 3, clientX: box.left, clientY: box.top });
    pointer(outer, 'pointermove', { pointerId: 3, clientX: box.left + box.width, clientY: box.top + box.height });
    pointer(outer, 'pointerup', { pointerId: 3 });
  }

  it('OCRs the selected region on the server and inserts the result', async () => {
    lb.open([scan(1)], 0);
    expect(q('.fav-lb-crop-tools').style.display).toBe('');
    click('.fav-lb-crop-toggle');
    expect(q('.fav-lb-img-outer').classList.contains('fav-lb-crop-active')).toBe(true);

    reply('scan/crop-ocr', { text: 'gevonden', crop_img_url: 'https://site.test/crop.png', engine: 'docai' });
    selectRegion({ left: 40, top: 20, width: 80, height: 40 });
    await flush();
    expect(posted.at(-1)!.body).toEqual({
      collection: 'boek',
      page_number: 1,
      crop: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
      engine: 'docai',
    });
    expect(q('.fav-lb-crop-result').style.display).toBe('flex');
    expect(q('.fav-lb-crop-result-header span').textContent).toBe('OCR-resultaat (Document AI)');
    expect(q<HTMLTextAreaElement>('.fav-lb-crop-text').value).toBe('gevonden');

    // Inserted at the cursor, which is at the end after opening the editor.
    click('.fav-lb-crop-insert');
    expect(textarea().value).toBe('Tekst 1gevonden');
    expect(q('.fav-lb-crop-result').style.display).toBe('none');
  });

  it('reports a failed OCR and the Tesseract engine', async () => {
    lb.open([scan(1)], 0);
    click('.fav-lb-crop-toggle');
    reply('scan/crop-ocr', { message: 'Te klein' }, 400);
    selectRegion({ left: 0, top: 0, width: 50, height: 50 });
    await flush();
    expect(q('.fav-lb-crop-status').textContent).toBe('Te klein');
    reply('scan/crop-ocr', {}, 500);
    selectRegion({ left: 0, top: 0, width: 50, height: 50 });
    await flush();
    expect(q('.fav-lb-crop-status').textContent).toBe('OCR mislukt.');

    reply('scan/crop-ocr', { engine: 'tesseract' });
    selectRegion({ left: 0, top: 0, width: 50, height: 50 });
    await flush();
    expect(q('.fav-lb-crop-result-header span').textContent).toBe('OCR-resultaat (Tesseract)');
    click('.fav-lb-crop-close');
    expect(q('.fav-lb-crop-result').style.display).toBe('none');
    q<HTMLTextAreaElement>('.fav-lb-crop-text').value = '';
    click('.fav-lb-crop-insert');
    expect(q('.fav-lb-edit-wrap').style.display).toBe('none');
  });

  it('ignores a tiny selection, other buttons, and clicks outside crop mode', async () => {
    lb.open([scan(1)], 0);
    selectRegion({ left: 0, top: 0, width: 50, height: 50 });
    click('.fav-lb-crop-toggle');
    selectRegion({ left: 0, top: 0, width: 4, height: 50 });
    pointer(q('.fav-lb-img-outer'), 'pointerdown', { button: 2, pointerId: 4 });
    pointer(q('.fav-lb-crop-engine'), 'pointerdown', { button: 0, pointerId: 4 });
    pointer(q('.fav-lb-img-outer'), 'pointerdown', { button: 0, pointerId: 5, clientX: 1, clientY: 1 });
    pointer(q('.fav-lb-img-outer'), 'pointercancel', { pointerId: 5 });
    expect(q('.fav-lb-crop-rect').style.display).toBe('none');
    await flush();
    expect(posted).toHaveLength(0);

    const plus = document.querySelectorAll<HTMLButtonElement>('.fav-lb-iz .fav-lb-zbtn')[2]!;
    plus.click();
    pointer(q('.fav-lb-img-wrap'), 'pointerdown', { pointerType: 'mouse', pointerId: 6, button: 0 });
    expect(q('.fav-lb-img-wrap').classList.contains('fav-lb-panning')).toBe(false);
    click('.fav-lb-crop-toggle');
    expect(q('.fav-lb-crop-rect').style.display).toBe('none');
  });

  it('OCRs the selection in a local container', async () => {
    localStorage.setItem('avpvhFavOcrEngine', 'local');
    localStorage.setItem('avpvhFavLocalOcrUrl', 'http://127.0.0.1:5001/v1/convert/file');
    lb.open([scan(1)], 0);
    const engine = q<HTMLSelectElement>('.fav-lb-crop-engine');
    const urlInput = q<HTMLInputElement>('.fav-lb-crop-local-url');
    expect(engine.value).toBe('local');
    expect(urlInput.value).toBe('http://127.0.0.1:5001/v1/convert/file');
    expect(urlInput.style.display).toBe('');
    Object.defineProperties(q('.fav-lb-img'), { naturalWidth: { value: 400 }, naturalHeight: { value: 200 } });
    click('.fav-lb-crop-toggle');

    reply('http://127.0.0.1:5001/v1/convert/file', { document: { text_content: ' lokaal ' } });
    selectRegion({ left: 0, top: 0, width: 100, height: 100 });
    await flush();
    expect(q<HTMLTextAreaElement>('.fav-lb-crop-text').value).toBe('lokaal');
    expect(q<HTMLImageElement>('.fav-lb-crop-preview').src).toBe('data:image/png;base64,AA');

    reply('http://127.0.0.1:5001/v1/convert/file', { document: { md_content: '# md' } });
    selectRegion({ left: 0, top: 0, width: 100, height: 100 });
    await flush();
    expect(q<HTMLTextAreaElement>('.fav-lb-crop-text').value).toBe('# md');

    reply('http://127.0.0.1:5001/v1/convert/file', { detail: 'Bezig' }, 503);
    selectRegion({ left: 0, top: 0, width: 100, height: 100 });
    await flush();
    expect(q('.fav-lb-crop-status').textContent).toBe('Bezig');
    reply('http://127.0.0.1:5001/v1/convert/file', {}, 503);
    selectRegion({ left: 0, top: 0, width: 100, height: 100 });
    await flush();
    expect(q('.fav-lb-crop-status').textContent).toBe('Lokale OCR mislukt.');
    replies['http://127.0.0.1:5001/v1/convert/file'] = { reject: true };
    selectRegion({ left: 0, top: 0, width: 100, height: 100 });
    await flush();
    expect(q('.fav-lb-crop-status').textContent).toContain('Kon docling-serve niet bereiken');

    const toBlob = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb: BlobCallback) => cb(null));
    selectRegion({ left: 0, top: 0, width: 100, height: 100 });
    await flush();
    toBlob.mockRestore();
    expect(q('.fav-lb-crop-status').textContent).toBe('Kon selectie niet uitsnijden.');

    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    selectRegion({ left: 0, top: 0, width: 100, height: 100 });
    await flush();
    getContext.mockRestore();
    expect(q('.fav-lb-crop-status').textContent).toBe('Kon selectie niet uitsnijden.');

    urlInput.value = 'http://example.org/';
    urlInput.dispatchEvent(new Event('change'));
    expect(localStorage.getItem('avpvhFavLocalOcrUrl')).toBeNull();
    selectRegion({ left: 0, top: 0, width: 100, height: 100 });
    await flush();
    expect(q('.fav-lb-crop-status').textContent).toContain('Alleen lokale adressen');
    urlInput.value = ' ';
    selectRegion({ left: 0, top: 0, width: 100, height: 100 });
    await flush();
    expect(q('.fav-lb-crop-status').textContent).toBe('Vul eerst het adres van docling-serve in.');

    urlInput.value = 'http://localhost:9000/x';
    urlInput.dispatchEvent(new Event('change'));
    expect(localStorage.getItem('avpvhFavLocalOcrUrl')).toBe('http://localhost:9000/x');
    engine.value = 'docai';
    engine.dispatchEvent(new Event('change'));
    expect(localStorage.getItem('avpvhFavOcrEngine')).toBe('docai');
    expect(urlInput.style.display).toBe('none');
  });

  it('does not OCR an item without a page', async () => {
    lb.open([scan(1), { url: 'https://site.test/x.jpg', caption: 'x', text: '', collection: 'boek' }], 0);
    click('.fav-lb-crop-toggle');
    click('.fav-lb-next');
    click('.fav-lb-crop-toggle');
    selectRegion({ left: 0, top: 0, width: 100, height: 100 });
    await flush();
    expect(posted).toHaveLength(0);
  });
});
