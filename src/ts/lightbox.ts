import * as pdfjsLib from 'pdfjs-dist';

// Vite's `?url` asset imports don't resolve correctly in this IIFE lib build,
// so derive the worker's URL from wherever this script itself was loaded from
// (search.iife.js and pdf.worker.js are always deployed side by side). Served
// as .js rather than .mjs since some servers map .mjs to a MIME type Chrome
// refuses to execute as a module script. Reuses search.iife.js's own cache-
// busting ?ver= query so the worker isn't served stale from cache after a
// deploy — it must always match the pdfjs-dist version bundled into this file.
const thisScriptUrl = (document.currentScript as HTMLScriptElement | null)?.src;
let workerSrc = 'pdf.worker.js';
if (thisScriptUrl) {
  const base = new URL(thisScriptUrl);
  const worker = new URL('pdf.worker.js', base);
  worker.search = base.search;
  workerSrc = worker.href;
}
pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

export interface LightboxItem {
  url: string;
  caption: string;
  text: string;
  kind?: 'image' | 'pdf';
  page?: number;
  highlightTerms?: string[];
  isMatch?: boolean;
}

interface HighlightRect {
  xFrac: number;
  yFrac: number;
  wFrac: number;
  hFrac: number;
}

export class Lightbox {
  private el: HTMLElement | null = null;
  private items: LightboxItem[] = [];
  private idx = 0;
  private imgZoom = 1;
  private txtZoom = 1;
  private onClose: (() => void) | null = null;
  private pdfDocs = new Map<string, pdfjsLib.PDFDocumentLoadingTask>();
  private currentBlobUrl: string | null = null;
  private showToken = 0;
  private highlightRects: HighlightRect[] = [];
  private hiddenPanel: 'img' | 'text' | null = null;

  private static readonly FULLSCREEN_ENTER_SVG =
    '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg>';
  private static readonly FULLSCREEN_EXIT_SVG =
    '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor"><path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z"/></svg>';

  private readonly fullscreenHandler = (): void => {
    const btn = this.el?.querySelector('.fav-lb-fullscreen');
    if (!btn) return;
    btn.innerHTML = document.fullscreenElement === this.el
      ? Lightbox.FULLSCREEN_EXIT_SVG
      : Lightbox.FULLSCREEN_ENTER_SVG;
  };

  private readonly keyHandler = (e: KeyboardEvent): void => {
    if (!this.el) return;
    const arrowKeys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
    if (arrowKeys.includes(e.key) && this.imgZoom > 1.01) {
      // Zoomed in: arrows pan the image instead of navigating, since
      // that's what you actually want once you can no longer see the
      // whole page — otherwise there'd be no keyboard way to pan at all.
      e.preventDefault();
      const wrap = this.el.querySelector('.fav-lb-img-wrap') as HTMLElement;
      const step = 80;
      wrap.scrollBy({
        left: e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0,
        top: e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0,
        behavior: 'smooth',
      });
      return;
    }
    if (e.key === 'ArrowLeft') this.show(this.idx - 1);
    if (e.key === 'ArrowRight') this.show(this.idx + 1);
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault(); // otherwise scrolls the text panel instead
      const i = this.findMatchIdx(e.key === 'ArrowUp' ? -1 : 1);
      if (i >= 0) this.show(i);
    }
    if (e.key === 'Escape') this.close();
  };

  open(items: LightboxItem[], startIdx: number, onClose?: () => void): void {
    this.close();
    this.items = items;
    this.imgZoom = 1;
    this.txtZoom = 1;
    this.hiddenPanel = null;
    this.onClose = onClose ?? null;

    this.el = document.createElement('div');
    this.el.className = 'fav-lb';
    this.el.innerHTML = `
      <div class="fav-lb-toolbar">
        <p class="fav-lb-caption"></p>
        <div style="display:flex;gap:.5em;align-items:center;flex-wrap:wrap;justify-content:flex-end">
          <div class="fav-lb-match-nav" style="display:none;align-items:center;gap:.3em">
            <svg class="fav-lb-search-icon" viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor"><path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>
            <button class="fav-lb-btn fav-lb-icon fav-lb-prev-match" title="Vorige zoekresultaat (&#x2191;)">
              <svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor"><path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>
            </button>
            <span class="fav-lb-match-counter"></span>
            <button class="fav-lb-btn fav-lb-icon fav-lb-next-match" title="Volgende zoekresultaat (&#x2193;)">
              <svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>
            </button>
          </div>
          <div class="fav-lb-page-nav" style="display:flex;align-items:center;gap:.3em">
            <button class="fav-lb-btn fav-lb-icon fav-lb-prev" title="Vorige pagina (&#x2190;)">
              <svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor"><path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>
            </button>
            <span class="fav-lb-counter"></span>
            <button class="fav-lb-btn fav-lb-icon fav-lb-next" title="Volgende pagina (&#x2192;)">
              <svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>
            </button>
          </div>
          <button class="fav-lb-btn fav-lb-icon fav-lb-toggle-img" title="Pagina tonen/verbergen">
            <svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor"><path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/></svg>
          </button>
          <button class="fav-lb-btn fav-lb-icon fav-lb-toggle-text" title="Tekst tonen/verbergen">
            <svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor"><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>
          </button>
          <button class="fav-lb-btn fav-lb-icon fav-lb-fullscreen" title="Volledig scherm">
            <svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg>
          </button>
          <a class="fav-lb-btn fav-lb-icon fav-lb-open-pdf" href="#" target="_blank" rel="noopener noreferrer" title="PDF openen in nieuw tabblad" style="display:none">
            <svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor"><path d="M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/></svg>
          </a>
          <button class="fav-lb-btn fav-lb-close" title="Sluiten (Esc)">&#x2715;</button>
        </div>
      </div>
      <div class="fav-lb-body">
        <div class="fav-lb-img-outer">
          <div class="fav-lb-img-wrap">
            <img class="fav-lb-img" alt="">
            <div class="fav-lb-highlights"></div>
          </div>
          <div class="fav-lb-loading" style="display:none">Laden…</div>
          <div class="fav-lb-iz">
            <button class="fav-lb-zbtn">&#x2212;</button>
            <button class="fav-lb-zbtn">1:1</button>
            <button class="fav-lb-zbtn">+</button>
          </div>
        </div>
        <div class="fav-lb-text-wrap">
          <div class="fav-lb-text-bar">Tekst &nbsp;
            <button class="fav-lb-zbtn">&#x2212;</button>
            <button class="fav-lb-zbtn">A</button>
            <button class="fav-lb-zbtn">+</button>
          </div>
          <div class="fav-lb-text-content"></div>
        </div>
      </div>`;

    document.body.appendChild(this.el);

    this.el.querySelector('.fav-lb-close')!.addEventListener('click', () => this.close());
    this.el.querySelector('.fav-lb-prev')!.addEventListener('click', () => this.show(this.idx - 1));
    this.el.querySelector('.fav-lb-next')!.addEventListener('click', () => this.show(this.idx + 1));

    this.el.querySelector('.fav-lb-prev-match')!.addEventListener('click', () => {
      const i = this.findMatchIdx(-1);
      if (i >= 0) this.show(i);
    });
    this.el.querySelector('.fav-lb-next-match')!.addEventListener('click', () => {
      const i = this.findMatchIdx(1);
      if (i >= 0) this.show(i);
    });

    this.el.querySelector('.fav-lb-toggle-img')!.addEventListener('click', () => this.togglePanel('img'));
    this.el.querySelector('.fav-lb-toggle-text')!.addEventListener('click', () => this.togglePanel('text'));

    this.el.querySelector('.fav-lb-fullscreen')!.addEventListener('click', () => {
      if (document.fullscreenElement) void document.exitFullscreen();
      else void this.el!.requestFullscreen();
    });
    document.addEventListener('fullscreenchange', this.fullscreenHandler);

    const izBtns = Array.from(this.el.querySelectorAll<HTMLButtonElement>('.fav-lb-iz .fav-lb-zbtn'));
    izBtns[0]?.addEventListener('click', () => this.setImgZoom(this.imgZoom / 1.3));
    izBtns[1]?.addEventListener('click', () => this.setImgZoom(1));
    izBtns[2]?.addEventListener('click', () => this.setImgZoom(this.imgZoom * 1.3));

    const tzBtns = Array.from(this.el.querySelectorAll<HTMLButtonElement>('.fav-lb-text-bar .fav-lb-zbtn'));
    tzBtns[0]?.addEventListener('click', () => this.setTxtZoom(this.txtZoom / 1.2));
    tzBtns[1]?.addEventListener('click', () => this.setTxtZoom(1));
    tzBtns[2]?.addEventListener('click', () => this.setTxtZoom(this.txtZoom * 1.2));

    this.el.querySelector('.fav-lb-img')!.addEventListener('load', () => this.renderHighlights());

    this.el.querySelector('.fav-lb-img')!.addEventListener('contextmenu', (e: Event) => {
      const item = this.items[this.idx];
      if (item?.kind !== 'pdf') return;
      e.preventDefault();
      const href = item.page != null ? `${item.url}#page=${item.page}` : item.url;
      window.open(href, '_blank', 'noopener,noreferrer');
    });

    this.el.querySelector('.fav-lb-img-wrap')!.addEventListener('wheel', (e: Event) => {
      const we = e as WheelEvent;
      if (!we.ctrlKey) return;
      we.preventDefault();
      this.setImgZoom(this.imgZoom * (we.deltaY < 0 ? 1.1 : 0.9));
    }, { passive: false });

    this.el.querySelector('.fav-lb-text-content')!.addEventListener('wheel', (e: Event) => {
      const we = e as WheelEvent;
      if (!we.ctrlKey) return;
      we.preventDefault();
      this.setTxtZoom(this.txtZoom * (we.deltaY < 0 ? 1.1 : 0.9));
    }, { passive: false });

    // Touch gestures on the image, mirroring the keyboard scheme: swipe
    // left/right pages, swipe up/down jumps to the next/previous search
    // result, and a two-finger pinch zooms — all only while not already
    // zoomed in, where a single-finger drag instead pans (native scroll on
    // the now-scrollable .fav-lb-img-wrap).
    let touchStartX = 0;
    let touchStartY = 0;
    let touchMode: 'none' | 'swipe' | 'pinch' = 'none';
    let pinchStartDist = 0;
    let pinchStartZoom = 1;
    const touchDist = (a: Touch, b: Touch): number => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    const imgWrapEl = this.el.querySelector('.fav-lb-img-wrap')!;

    imgWrapEl.addEventListener('touchstart', (e: Event) => {
      const te = e as TouchEvent;
      if (te.touches.length === 2) {
        touchMode = 'pinch';
        pinchStartDist = touchDist(te.touches[0]!, te.touches[1]!);
        pinchStartZoom = this.imgZoom;
      } else if (te.touches.length === 1) {
        touchMode = 'swipe';
        touchStartX = te.touches[0]!.clientX;
        touchStartY = te.touches[0]!.clientY;
      } else {
        touchMode = 'none';
      }
    }, { passive: true });

    imgWrapEl.addEventListener('touchmove', (e: Event) => {
      const te = e as TouchEvent;
      if (touchMode !== 'pinch' || te.touches.length !== 2 || pinchStartDist <= 0) return;
      e.preventDefault(); // suppress the browser's own page-pinch-zoom
      const ratio = touchDist(te.touches[0]!, te.touches[1]!) / pinchStartDist;
      this.setImgZoom(pinchStartZoom * ratio);
    }, { passive: false });

    const touchEnd = (e: Event): void => {
      if (touchMode === 'pinch') {
        if ((e as TouchEvent).touches.length < 2) touchMode = 'none';
        return;
      }
      if (touchMode !== 'swipe' || this.imgZoom > 1.01) { touchMode = 'none'; return; }
      touchMode = 'none';
      const touch = (e as TouchEvent).changedTouches[0];
      if (!touch) return;
      const dx = touch.clientX - touchStartX;
      const dy = touch.clientY - touchStartY;
      if (Math.abs(dx) > Math.abs(dy) * 1.5 && Math.abs(dx) > 50) {
        this.show(this.idx + (dx < 0 ? 1 : -1));
      } else if (Math.abs(dy) > Math.abs(dx) * 1.5 && Math.abs(dy) > 50) {
        const i = this.findMatchIdx(dy < 0 ? -1 : 1);
        if (i >= 0) this.show(i);
      }
    };
    imgWrapEl.addEventListener('touchend', touchEnd, { passive: true });
    imgWrapEl.addEventListener('touchcancel', () => { touchMode = 'none'; }, { passive: true });

    document.addEventListener('keydown', this.keyHandler);
    this.show(startIdx);
  }

  // Only one panel can be hidden at a time — hiding both would leave nothing
  // to look at, so hiding one implicitly restores the other.
  private togglePanel(which: 'img' | 'text'): void {
    this.hiddenPanel = this.hiddenPanel === which ? null : which;
    const el = this.el!;
    (el.querySelector('.fav-lb-img-outer') as HTMLElement).style.display = this.hiddenPanel === 'img' ? 'none' : '';
    (el.querySelector('.fav-lb-text-wrap') as HTMLElement).style.display = this.hiddenPanel === 'text' ? 'none' : '';
    el.querySelector('.fav-lb-toggle-img')!.classList.toggle('fav-lb-active', this.hiddenPanel === 'img');
    el.querySelector('.fav-lb-toggle-text')!.classList.toggle('fav-lb-active', this.hiddenPanel === 'text');
    this.renderHighlights();
  }

  // Finds the next/previous item flagged as an actual search match, skipping
  // over the (also browsable via prev/next) pages that don't match — lets
  // "next search result" jump ahead through a whole PDF instead of stepping
  // through every single non-matching page in between.
  private findMatchIdx(direction: 1 | -1): number {
    let i = this.idx + direction;
    while (i >= 0 && i < this.items.length) {
      if (this.items[i]?.isMatch) return i;
      i += direction;
    }
    return -1;
  }

  close(): void {
    if (!this.el) return;
    if (document.fullscreenElement === this.el) void document.exitFullscreen();
    document.body.removeChild(this.el);
    this.el = null;
    document.removeEventListener('keydown', this.keyHandler);
    document.removeEventListener('fullscreenchange', this.fullscreenHandler);
    if (this.currentBlobUrl) URL.revokeObjectURL(this.currentBlobUrl);
    this.currentBlobUrl = null;
    this.pdfDocs.forEach(task => { void task.destroy().catch(() => undefined); });
    this.pdfDocs.clear();
    this.onClose?.();
  }

  private show(idx: number): void {
    this.idx = Math.max(0, Math.min(this.items.length - 1, idx));
    const item = this.items[this.idx]!;
    const el = this.el!;
    const token = ++this.showToken;

    const imgEl = el.querySelector('.fav-lb-img') as HTMLImageElement;
    const loadingEl = el.querySelector('.fav-lb-loading') as HTMLElement;

    this.highlightRects = [];
    this.renderHighlights();

    if (item.kind === 'pdf' && item.page != null) {
      imgEl.style.display = 'none';
      loadingEl.style.display = '';
      loadingEl.textContent = 'Laden…';
      this.renderPdfPage(item.url, item.page, item.highlightTerms ?? [])
        .then(({ blobUrl, rects }) => {
          if (token !== this.showToken) return; // superseded by newer navigation
          if (!blobUrl) { loadingEl.textContent = 'Kon PDF-pagina niet laden.'; return; }
          this.highlightRects = rects;
          this.setImage(blobUrl);
          imgEl.style.display = '';
          loadingEl.style.display = 'none';
        })
        .catch(() => {
          if (token !== this.showToken) return;
          loadingEl.textContent = 'Kon PDF-pagina niet laden.';
        });
    } else {
      loadingEl.style.display = 'none';
      imgEl.style.display = '';
      this.setImage(item.url);
    }

    const openPdfEl = el.querySelector('.fav-lb-open-pdf') as HTMLAnchorElement;
    if (item.kind === 'pdf') {
      openPdfEl.href = item.page != null ? `${item.url}#page=${item.page}` : item.url;
      openPdfEl.style.display = '';
    } else {
      openPdfEl.style.display = 'none';
    }

    el.querySelector('.fav-lb-caption')!.textContent = item.caption;
    el.querySelector('.fav-lb-counter')!.textContent = `${this.idx + 1} / ${this.items.length}`;
    (el.querySelector('.fav-lb-prev') as HTMLButtonElement).disabled = this.idx === 0;
    (el.querySelector('.fav-lb-next') as HTMLButtonElement).disabled = this.idx === this.items.length - 1;

    const matchCount = this.items.filter(it => it.isMatch).length;
    const matchNavEl = el.querySelector('.fav-lb-match-nav') as HTMLElement;
    matchNavEl.style.display = matchCount > 0 ? 'flex' : 'none';
    if (matchCount > 0) {
      const matchPos = this.items.slice(0, this.idx + 1).filter(it => it.isMatch).length;
      el.querySelector('.fav-lb-match-counter')!.textContent =
        item.isMatch ? `${matchPos}/${matchCount}` : `${matchCount}`;
      (el.querySelector('.fav-lb-prev-match') as HTMLButtonElement).disabled = this.findMatchIdx(-1) < 0;
      (el.querySelector('.fav-lb-next-match') as HTMLButtonElement).disabled = this.findMatchIdx(1) < 0;
    }

    const content = el.querySelector('.fav-lb-text-content')!;
    content.innerHTML = item.text || '<span class="fav-lb-text-empty">Geen tekst beschikbaar.</span>';
    content.scrollTop = 0;
  }

  private setImage(src: string): void {
    const imgEl = this.el!.querySelector('.fav-lb-img') as HTMLImageElement;
    if (this.currentBlobUrl) URL.revokeObjectURL(this.currentBlobUrl);
    this.currentBlobUrl = src.startsWith('blob:') ? src : null;
    imgEl.src = src;
  }

  private async renderPdfPage(
    url: string, pageNum: number, terms: string[],
  ): Promise<{ blobUrl: string | null; rects: HighlightRect[] }> {
    try {
      let task = this.pdfDocs.get(url);
      if (!task) {
        task = pdfjsLib.getDocument({ url });
        this.pdfDocs.set(url, task);
      }
      const doc = await task.promise;
      const page = await doc.getPage(pageNum);
      const viewport = page.getViewport({ scale: 2 });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext('2d')!;
      await page.render({ canvasContext: ctx, viewport }).promise;

      const rects = await this.findHighlightRects(page, viewport, terms);

      const blobUrl = await new Promise<string | null>(resolve => {
        canvas.toBlob(blob => resolve(blob ? URL.createObjectURL(blob) : null), 'image/png');
      });
      return { blobUrl, rects };
    } catch (err) {
      console.error('[avpvh-find-and-view] PDF page render failed:', err);
      return { blobUrl: null, rects: [] };
    }
  }

  // Highlights matched search terms directly on the rendered PDF page by
  // matching them against the page's extracted text items (independent of
  // the canvas render) and projecting each match's PDF-space transform
  // through the same viewport used for rendering, as fractions of the page
  // so positioning survives zoom/resize without re-running this lookup.
  private async findHighlightRects(
    page: pdfjsLib.PDFPageProxy, viewport: pdfjsLib.PageViewport, terms: string[],
  ): Promise<HighlightRect[]> {
    const lowerTerms = terms.map(t => t.toLowerCase()).filter(Boolean);
    if (!lowerTerms.length) return [];

    const rects: HighlightRect[] = [];
    const textContent = await page.getTextContent();
    for (const tItem of textContent.items) {
      if (!('str' in tItem) || !tItem.str) continue;
      const str = tItem.str.toLowerCase();
      if (!lowerTerms.some(t => str.includes(t))) continue;

      const tx = pdfjsLib.Util.transform(viewport.transform, tItem.transform);
      const height = Math.hypot(tx[2], tx[3]);
      const width = tItem.width * viewport.scale;
      const x = tx[4];
      const y = tx[5] - height;
      rects.push({
        xFrac: x / viewport.width,
        yFrac: y / viewport.height,
        wFrac: width / viewport.width,
        hFrac: height / viewport.height,
      });
    }
    return rects;
  }

  // Positions boxes using the image's untransformed layout box (offsetWidth/
  // offsetTop), not getBoundingClientRect(), so this is unaffected by the
  // zoom transform or its CSS transition — the highlights layer gets the
  // same transform applied to it in setImgZoom() and scales in lockstep via
  // CSS instead of needing to be recomputed on every zoom change.
  private renderHighlights(): void {
    const container = this.el?.querySelector('.fav-lb-highlights') as HTMLElement | null;
    if (!container) return;
    container.innerHTML = '';
    if (!this.highlightRects.length) return;

    const imgEl = this.el!.querySelector('.fav-lb-img') as HTMLImageElement;
    if (imgEl.style.display === 'none') return;
    const w = imgEl.offsetWidth;
    const h = imgEl.offsetHeight;
    if (!w || !h) return;
    const offsetX = imgEl.offsetLeft;
    const offsetY = imgEl.offsetTop;

    for (const r of this.highlightRects) {
      const box = document.createElement('div');
      box.className = 'fav-lb-highlight-box';
      box.style.left = `${offsetX + r.xFrac * w}px`;
      box.style.top = `${offsetY + r.yFrac * h}px`;
      box.style.width = `${r.wFrac * w}px`;
      box.style.height = `${r.hFrac * h}px`;
      container.appendChild(box);
    }
  }

  private setImgZoom(z: number): void {
    this.imgZoom = Math.max(0.2, Math.min(8, z));
    const scale = `scale(${this.imgZoom})`;
    (this.el!.querySelector('.fav-lb-img') as HTMLElement).style.transform = scale;
    (this.el!.querySelector('.fav-lb-highlights') as HTMLElement).style.transform = scale;
  }

  private setTxtZoom(z: number): void {
    this.txtZoom = Math.max(0.5, Math.min(3, z));
    (this.el!.querySelector('.fav-lb-text-content') as HTMLElement).style.fontSize = `${this.txtZoom * 0.72}em`;
  }
}
