import * as pdfjsLib from 'pdfjs-dist';
import { renderMarkdown, renderPlain, looksLikeMarkdown } from './markdown';
import type { FavConfig } from './types';

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
  sourceUrl?: string;
  caption: string;
  text: string;
  // The other rendering of the same source text — plain if `text` is
  // Markdown-rendered, or Markdown-rendered if `text` is plain — so the
  // viewer can override an auto-detection that guessed wrong either way.
  textAlt?: string;
  kind?: 'image' | 'pdf' | 'text';
  page?: number;
  highlightTerms?: string[];
  isMatch?: boolean;
  // The raw, unrendered source text and the scan collection it belongs to —
  // only present for scan pages, and only needed so the edit panel has
  // something to save back to `${restRoot}scan/edit`. Absent (e.g. chat
  // transcripts, xlsx rows) means this item isn't editable.
  collection?: string;
  rawText?: string;
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
  // Pan offset in screen pixels, applied outside the scale in the transform
  // (translate(panX,panY) scale(imgZoom)) so drag deltas map 1:1 without
  // dividing by zoom. Native overflow-scroll doesn't pick up a transform's
  // visual overflow here, so panning is tracked explicitly instead of via
  // scrollLeft/scrollTop.
  private panX = 0;
  private panY = 0;
  private txtZoom = 1;
  private onClose: (() => void) | null = null;
  private pdfDocs = new Map<string, pdfjsLib.PDFDocumentLoadingTask>();
  // Rendered PDF pages are expensive (canvas render at 2x scale + PNG encode),
  // so cache the blob URL per (doc, page) — revisiting a page you already
  // viewed this session should be instant, not a full re-render. Bounded so
  // paging through a long document doesn't grow memory without limit; the
  // highlight terms aren't part of the key since they're drawn as a separate
  // overlay layer, not baked into the rendered image (see findHighlightRects).
  private pageImageCache = new Map<string, string>();
  private static readonly PAGE_CACHE_LIMIT = 24;
  private showToken = 0;
  private highlightRects: HighlightRect[] = [];
  private hiddenPanel: 'img' | 'text' | null = null;
  private showingAltText = false;
  private editing = false;
  private saving = false;

  constructor(private readonly cfg: FavConfig) {}

  // Prefer the original publisher/repository URL over our own hosted copy for
  // "open externally" actions (navigation, not the in-page PDF.js render,
  // which must keep using item.url — CORS and matching page numbers only
  // work reliably against our own copy).
  private static openPdfHref(item: LightboxItem): string {
    if (item.sourceUrl) return item.sourceUrl;
    return item.page != null ? `${item.url}#page=${item.page}` : item.url;
  }

  // Remembers the user's preferred image/text split across lightbox opens
  // and page loads — landscape (side-by-side) and portrait (stacked) are
  // tracked separately since a good width fraction isn't a good height
  // fraction.
  private static readonly SPLIT_KEY_LANDSCAPE = 'avpvh-fav-lb-split-landscape';
  private static readonly SPLIT_KEY_PORTRAIT = 'avpvh-fav-lb-split-portrait';

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
      const step = 80;
      this.panX -= e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
      this.panY -= e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
      this.applyImgTransform();
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
    this.panX = 0;
    this.panY = 0;
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
          <button class="fav-lb-btn fav-lb-icon fav-lb-edit" title="Tekst bewerken" style="display:none">
            <svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34a.9959.9959 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
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
        <div class="fav-lb-resizer"></div>
        <div class="fav-lb-text-wrap">
          <div class="fav-lb-text-bar">Tekst &nbsp;
            <button class="fav-lb-zbtn">&#x2212;</button>
            <button class="fav-lb-zbtn">A</button>
            <button class="fav-lb-zbtn">+</button>
            <button class="fav-lb-zbtn fav-lb-format-toggle" style="display:none;width:auto;padding:0 .5em" title="Wissel tussen opgemaakte en platte tekstweergave"></button>
          </div>
          <div class="fav-lb-text-content"></div>
          <div class="fav-lb-edit-wrap" style="display:none">
            <textarea class="fav-lb-edit-textarea" spellcheck="true" lang="nl"></textarea>
            <div class="fav-lb-edit-bar">
              <span class="fav-lb-edit-status"></span>
              <button class="fav-lb-btn fav-lb-edit-cancel">Annuleren</button>
              <button class="fav-lb-btn fav-lb-btn-primary fav-lb-edit-save">Opslaan</button>
            </div>
          </div>
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

    this.el.querySelector('.fav-lb-edit')!.addEventListener('click', () => this.enterEditMode());
    this.el.querySelector('.fav-lb-edit-cancel')!.addEventListener('click', () => this.exitEditMode());
    this.el.querySelector('.fav-lb-edit-save')!.addEventListener('click', () => void this.saveEdit());

    this.el.querySelector('.fav-lb-fullscreen')!.addEventListener('click', () => {
      if (document.fullscreenElement) void document.exitFullscreen();
      else void this.el!.requestFullscreen();
    });
    document.addEventListener('fullscreenchange', this.fullscreenHandler);

    const izBtns = Array.from(this.el.querySelectorAll<HTMLButtonElement>('.fav-lb-iz .fav-lb-zbtn'));
    izBtns[0]?.addEventListener('click', () => this.zoomTowardCenter(this.imgZoom / 1.3));
    izBtns[1]?.addEventListener('click', () => { this.panX = 0; this.panY = 0; this.setImgZoom(1); });
    izBtns[2]?.addEventListener('click', () => this.zoomTowardCenter(this.imgZoom * 1.3));

    const tzBtns = Array.from(this.el.querySelectorAll<HTMLButtonElement>('.fav-lb-text-bar .fav-lb-zbtn:not(.fav-lb-format-toggle)'));
    tzBtns[0]?.addEventListener('click', () => this.setTxtZoom(this.txtZoom / 1.2));
    tzBtns[1]?.addEventListener('click', () => this.setTxtZoom(1));
    tzBtns[2]?.addEventListener('click', () => this.setTxtZoom(this.txtZoom * 1.2));

    this.el.querySelector('.fav-lb-format-toggle')!.addEventListener('click', () => {
      this.showingAltText = !this.showingAltText;
      this.renderTextContent();
    });

    this.el.querySelector('.fav-lb-img')!.addEventListener('load', () => this.renderHighlights());

    this.el.querySelector('.fav-lb-img')!.addEventListener('contextmenu', (e: Event) => {
      const item = this.items[this.idx];
      if (item?.kind !== 'pdf') return;
      e.preventDefault();
      window.open(Lightbox.openPdfHref(item), '_blank', 'noopener,noreferrer');
    });

    this.el.querySelector('.fav-lb-img-wrap')!.addEventListener('wheel', (e: Event) => {
      const we = e as WheelEvent;
      if (!we.ctrlKey) return;
      we.preventDefault();
      this.zoomAt(this.imgZoom * (we.deltaY < 0 ? 1.1 : 0.9), we.clientX, we.clientY);
    }, { passive: false });

    this.el.querySelector('.fav-lb-text-content')!.addEventListener('wheel', (e: Event) => {
      const we = e as WheelEvent;
      if (!we.ctrlKey) return;
      we.preventDefault();
      this.setTxtZoom(this.txtZoom * (we.deltaY < 0 ? 1.1 : 0.9));
    }, { passive: false });

    // Touch gestures on the image, mirroring the keyboard scheme: swipe
    // left/right pages, swipe up/down jumps to the next/previous search
    // result, and a two-finger pinch zooms (centered on the pinch midpoint)
    // — all only while not already zoomed in, where a single-finger drag
    // instead pans. Panning is tracked explicitly (panX/panY), not via
    // native scroll — a transform-scaled image doesn't register as
    // overflowing .fav-lb-img-wrap, so scrollLeft/scrollTop never had
    // anything to scroll to.
    let touchStartX = 0;
    let touchStartY = 0;
    let panStartX = 0;
    let panStartY = 0;
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
        panStartX = this.panX;
        panStartY = this.panY;
      } else {
        touchMode = 'none';
      }
    }, { passive: true });

    imgWrapEl.addEventListener('touchmove', (e: Event) => {
      const te = e as TouchEvent;
      if (touchMode === 'pinch' && te.touches.length === 2 && pinchStartDist > 0) {
        e.preventDefault(); // suppress the browser's own page-pinch-zoom
        const t0 = te.touches[0]!;
        const t1 = te.touches[1]!;
        const ratio = touchDist(t0, t1) / pinchStartDist;
        this.zoomAt(pinchStartZoom * ratio, (t0.clientX + t1.clientX) / 2, (t0.clientY + t1.clientY) / 2);
        return;
      }
      if (touchMode === 'swipe' && this.imgZoom > 1.01) {
        e.preventDefault();
        const touch = te.touches[0];
        if (!touch) return;
        imgWrapEl.classList.add('fav-lb-panning');
        this.panX = panStartX + (touch.clientX - touchStartX);
        this.panY = panStartY + (touch.clientY - touchStartY);
        this.applyImgTransform();
      }
    }, { passive: false });

    const touchEnd = (e: Event): void => {
      imgWrapEl.classList.remove('fav-lb-panning');
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
    imgWrapEl.addEventListener('touchcancel', () => { touchMode = 'none'; imgWrapEl.classList.remove('fav-lb-panning'); }, { passive: true });

    // Mouse drag-to-pan, active only while zoomed in. pointerType is checked
    // so this doesn't double-handle touch input, which the handlers above
    // already own.
    let dragging = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let dragPanStartX = 0;
    let dragPanStartY = 0;
    imgWrapEl.addEventListener('pointerdown', (e: Event) => {
      const pe = e as PointerEvent;
      if (pe.pointerType !== 'mouse' || this.imgZoom <= 1.01) return;
      dragging = true;
      dragStartX = pe.clientX;
      dragStartY = pe.clientY;
      dragPanStartX = this.panX;
      dragPanStartY = this.panY;
      imgWrapEl.setPointerCapture(pe.pointerId);
      imgWrapEl.classList.add('fav-lb-panning');
    });
    imgWrapEl.addEventListener('pointermove', (e: Event) => {
      if (!dragging) return;
      const pe = e as PointerEvent;
      this.panX = dragPanStartX + (pe.clientX - dragStartX);
      this.panY = dragPanStartY + (pe.clientY - dragStartY);
      this.applyImgTransform();
    });
    const stopDragPan = (e: Event): void => {
      if (!dragging) return;
      dragging = false;
      imgWrapEl.classList.remove('fav-lb-panning');
      const pe = e as PointerEvent;
      if (imgWrapEl.hasPointerCapture(pe.pointerId)) imgWrapEl.releasePointerCapture(pe.pointerId);
    };
    imgWrapEl.addEventListener('pointerup', stopDragPan);
    imgWrapEl.addEventListener('pointercancel', stopDragPan);

    this.setupResizer();

    document.addEventListener('keydown', this.keyHandler);
    this.show(startIdx);
  }

  private static isLandscape(): boolean {
    return window.matchMedia('(orientation: landscape)').matches;
  }

  private static splitStorageKey(): string {
    return Lightbox.isLandscape() ? Lightbox.SPLIT_KEY_LANDSCAPE : Lightbox.SPLIT_KEY_PORTRAIT;
  }

  private applySplitFrac(frac: number): void {
    const textWrap = this.el!.querySelector('.fav-lb-text-wrap') as HTMLElement;
    if (Lightbox.isLandscape()) { textWrap.style.width = `${frac * 100}%`; textWrap.style.height = ''; }
    else { textWrap.style.height = `${frac * 100}%`; textWrap.style.width = ''; }
  }

  // Re-applies the saved (or CSS-default) split — used whenever an item with
  // an image panel is shown, since a text-only item in between (see below)
  // temporarily overrides the text panel to full width/height.
  private restoreSplit(): void {
    const saved = parseFloat(localStorage.getItem(Lightbox.splitStorageKey()) ?? '');
    if (!isNaN(saved) && saved > 0 && saved < 1) this.applySplitFrac(saved);
    else {
      const textWrap = this.el!.querySelector('.fav-lb-text-wrap') as HTMLElement;
      textWrap.style.width = '';
      textWrap.style.height = '';
    }
  }

  // Lets the user drag the bar between the image and text panels instead of
  // being stuck with a fixed split — persisted per-orientation so it stays
  // put across pages and future opens, not just the current view.
  private setupResizer(): void {
    const el = this.el!;
    const resizer = el.querySelector('.fav-lb-resizer') as HTMLElement;
    const body = el.querySelector('.fav-lb-body') as HTMLElement;

    this.restoreSplit();

    resizer.addEventListener('pointerdown', (e: PointerEvent) => {
      resizer.setPointerCapture(e.pointerId);
      resizer.classList.add('fav-lb-resizing');
    });
    resizer.addEventListener('pointermove', (e: PointerEvent) => {
      if (!resizer.hasPointerCapture(e.pointerId)) return;
      const rect = body.getBoundingClientRect();
      const landscape = Lightbox.isLandscape();
      const raw = landscape
        ? (rect.right - e.clientX) / rect.width
        : (rect.bottom - e.clientY) / rect.height;
      const frac = Math.max(0.15, Math.min(0.8, raw));
      this.applySplitFrac(frac);
      localStorage.setItem(Lightbox.splitStorageKey(), String(frac));
    });
    const stopDrag = (e: PointerEvent): void => {
      if (resizer.hasPointerCapture(e.pointerId)) resizer.releasePointerCapture(e.pointerId);
      resizer.classList.remove('fav-lb-resizing');
    };
    resizer.addEventListener('pointerup', stopDrag);
    resizer.addEventListener('pointercancel', stopDrag);
  }

  // Only one panel can be hidden at a time — hiding both would leave nothing
  // to look at, so hiding one implicitly restores the other.
  private togglePanel(which: 'img' | 'text'): void {
    this.hiddenPanel = this.hiddenPanel === which ? null : which;
    const el = this.el!;
    (el.querySelector('.fav-lb-img-outer') as HTMLElement).style.display = this.hiddenPanel === 'img' ? 'none' : '';
    (el.querySelector('.fav-lb-text-wrap') as HTMLElement).style.display = this.hiddenPanel === 'text' ? 'none' : '';
    (el.querySelector('.fav-lb-resizer') as HTMLElement).style.display = this.hiddenPanel ? 'none' : '';
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
    this.pageImageCache.forEach(url => URL.revokeObjectURL(url));
    this.pageImageCache.clear();
    this.pdfDocs.forEach(task => { void task.destroy().catch(() => undefined); });
    this.pdfDocs.clear();
    this.onClose?.();
  }

  private show(idx: number): void {
    this.idx = Math.max(0, Math.min(this.items.length - 1, idx));
    const item = this.items[this.idx]!;
    const el = this.el!;
    const token = ++this.showToken;

    // A page navigation always leaves edit mode — an in-progress edit on
    // the previous page shouldn't silently carry over to this one.
    this.editing = false;
    (el.querySelector('.fav-lb-edit-wrap') as HTMLElement).style.display = 'none';
    (el.querySelector('.fav-lb-text-content') as HTMLElement).style.display = '';
    const editBtn = el.querySelector('.fav-lb-edit') as HTMLButtonElement;
    editBtn.style.display = this.cfg.canEdit && item.collection != null && item.page != null ? '' : 'none';

    const imgEl = el.querySelector('.fav-lb-img') as HTMLImageElement;
    const loadingEl = el.querySelector('.fav-lb-loading') as HTMLElement;
    const imgOuterEl = el.querySelector('.fav-lb-img-outer') as HTMLElement;
    const toggleImgBtn = el.querySelector('.fav-lb-toggle-img') as HTMLButtonElement;
    const toggleTextBtn = el.querySelector('.fav-lb-toggle-text') as HTMLButtonElement;

    this.highlightRects = [];
    this.renderHighlights();

    // Text-only items (e.g. a born-digital .md transcript with no scan
    // image) have nothing to show in the image panel at all — hide it
    // outright rather than trying to load a url that was never a real
    // image, regardless of the toolbar's img/text toggle state. Both
    // toggle buttons are hidden too, since there's nothing to toggle:
    // the text panel is the only content and must stay visible.
    const hasImage = item.kind !== 'text';
    toggleImgBtn.style.display = hasImage ? '' : 'none';
    toggleTextBtn.style.display = hasImage ? '' : 'none';

    const textWrapEl = el.querySelector('.fav-lb-text-wrap') as HTMLElement;
    const resizerEl = el.querySelector('.fav-lb-resizer') as HTMLElement;
    if (!hasImage) {
      imgEl.style.display = 'none';
      loadingEl.style.display = 'none';
      imgOuterEl.style.display = 'none';
      textWrapEl.style.display = ''; // override any leftover hiddenPanel:'text' from a prior item
      resizerEl.style.display = 'none';
      // With img-outer removed from the flex row/column, text-wrap would
      // otherwise stay pinned at whatever split fraction was last set,
      // leaving the rest of the body as dead space instead of being
      // centered/full — force it to fill the whole panel instead.
      textWrapEl.style.width = '100%';
      textWrapEl.style.height = '100%';
    } else {
      textWrapEl.style.display = this.hiddenPanel === 'text' ? 'none' : '';
      imgOuterEl.style.display = this.hiddenPanel === 'img' ? 'none' : '';
      resizerEl.style.display = this.hiddenPanel ? 'none' : '';
      this.restoreSplit();
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
    }

    const openPdfEl = el.querySelector('.fav-lb-open-pdf') as HTMLAnchorElement;
    if (item.kind === 'pdf') {
      openPdfEl.href = Lightbox.openPdfHref(item);
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

    this.showingAltText = false;
    this.renderTextContent();
  }

  private renderTextContent(): void {
    const el = this.el!;
    const item = this.items[this.idx];
    const content = el.querySelector('.fav-lb-text-content')!;
    const shown = (this.showingAltText ? item?.textAlt : undefined) ?? item?.text ?? '';
    content.innerHTML = shown || '<span class="fav-lb-text-empty">Geen tekst beschikbaar.</span>';
    content.scrollTop = 0;

    const toggleBtn = el.querySelector('.fav-lb-format-toggle') as HTMLButtonElement;
    if (item?.textAlt) {
      toggleBtn.style.display = '';
      toggleBtn.textContent = this.showingAltText ? 'Opgemaakt' : 'Platte tekst';
    } else {
      toggleBtn.style.display = 'none';
    }
  }

  private enterEditMode(): void {
    const el = this.el!;
    const item = this.items[this.idx];
    if (!item || item.collection == null || item.page == null) return;
    this.editing = true;
    if (this.hiddenPanel === 'text') this.togglePanel('text');
    (el.querySelector('.fav-lb-text-content') as HTMLElement).style.display = 'none';
    (el.querySelector('.fav-lb-edit-wrap') as HTMLElement).style.display = 'flex';
    const textarea = el.querySelector('.fav-lb-edit-textarea') as HTMLTextAreaElement;
    textarea.value = item.rawText ?? '';
    (el.querySelector('.fav-lb-edit-status') as HTMLElement).textContent = '';
    textarea.focus();
  }

  private exitEditMode(): void {
    const el = this.el!;
    this.editing = false;
    (el.querySelector('.fav-lb-edit-wrap') as HTMLElement).style.display = 'none';
    (el.querySelector('.fav-lb-text-content') as HTMLElement).style.display = '';
  }

  private async saveEdit(): Promise<void> {
    if (this.saving) return;
    const el = this.el!;
    const item = this.items[this.idx];
    if (!item || item.collection == null || item.page == null) return;
    const textarea = el.querySelector('.fav-lb-edit-textarea') as HTMLTextAreaElement;
    const statusEl = el.querySelector('.fav-lb-edit-status') as HTMLElement;
    const saveBtn = el.querySelector('.fav-lb-edit-save') as HTMLButtonElement;

    this.saving = true;
    saveBtn.disabled = true;
    statusEl.textContent = 'Opslaan…';
    try {
      const res = await fetch(`${this.cfg.restRoot}scan/edit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': this.cfg.editNonce },
        body: JSON.stringify({ collection: item.collection, page_number: item.page, text: textarea.value }),
      });
      const data = await res.json().catch(() => ({})) as { text?: string; text_format?: string; message?: string };
      if (!res.ok) {
        statusEl.textContent = data.message || 'Opslaan mislukt.';
        return;
      }
      const text = data.text ?? textarea.value;
      const isMd = data.text_format === 'md' || looksLikeMarkdown(text);
      item.rawText = text;
      item.text = isMd ? renderMarkdown(text) : renderPlain(text);
      item.textAlt = isMd ? renderPlain(text) : renderMarkdown(text);
      this.showingAltText = false;
      this.exitEditMode();
      this.renderTextContent();
    } catch {
      statusEl.textContent = 'Opslaan mislukt.';
    } finally {
      this.saving = false;
      saveBtn.disabled = false;
    }
  }

  private setImage(src: string): void {
    const imgEl = this.el!.querySelector('.fav-lb-img') as HTMLImageElement;
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

      // Rects are cheap (a text-content scan) and depend on the current
      // search, so always recompute them — but reuse the rendered image
      // itself when this exact page was already rendered this session.
      const rects = await this.findHighlightRects(page, viewport, terms);
      const cacheKey = `${url}#${pageNum}`;
      const cached = this.pageImageCache.get(cacheKey);
      if (cached) {
        this.pageImageCache.delete(cacheKey); // bump recency for the LRU cap
        this.pageImageCache.set(cacheKey, cached);
        return { blobUrl: cached, rects };
      }

      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext('2d')!;
      await page.render({ canvasContext: ctx, viewport }).promise;

      const blobUrl = await new Promise<string | null>(resolve => {
        canvas.toBlob(blob => resolve(blob ? URL.createObjectURL(blob) : null), 'image/png');
      });
      if (blobUrl) this.cachePageImage(cacheKey, blobUrl);
      return { blobUrl, rects };
    } catch (err) {
      console.error('[avpvh-find-and-view] PDF page render failed:', err);
      return { blobUrl: null, rects: [] };
    }
  }

  private cachePageImage(key: string, blobUrl: string): void {
    this.pageImageCache.set(key, blobUrl);
    if (this.pageImageCache.size <= Lightbox.PAGE_CACHE_LIMIT) return;
    const oldestKey = this.pageImageCache.keys().next().value;
    if (oldestKey === undefined) return;
    URL.revokeObjectURL(this.pageImageCache.get(oldestKey)!);
    this.pageImageCache.delete(oldestKey);
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
    this.applyImgTransform();
    // Cursor hints that the image is now draggable, matching the drag-to-pan
    // handlers set up in open() — only meaningful once zoomed in.
    this.el!.querySelector('.fav-lb-img-wrap')!.classList.toggle('fav-lb-zoomed', this.imgZoom > 1.01);
  }

  private applyImgTransform(): void {
    const t = `translate(${this.panX}px, ${this.panY}px) scale(${this.imgZoom})`;
    (this.el!.querySelector('.fav-lb-img') as HTMLElement).style.transform = t;
    (this.el!.querySelector('.fav-lb-highlights') as HTMLElement).style.transform = t;
  }

  // Zooms to newZoom while keeping whatever point is under (clientX, clientY)
  // fixed on screen — the standard "zoom to cursor" behavior for wheel/pinch
  // zoom. transform-origin is the element's own center, so the math is done
  // relative to .fav-lb-img-wrap's center (the image is flex-centered there,
  // and that position doesn't move when the image's own transform changes).
  private zoomAt(newZoom: number, clientX: number, clientY: number): void {
    const clamped = Math.max(0.2, Math.min(8, newZoom));
    const rect = (this.el!.querySelector('.fav-lb-img-wrap') as HTMLElement).getBoundingClientRect();
    const ax = clientX - (rect.left + rect.width / 2);
    const ay = clientY - (rect.top + rect.height / 2);
    const k = clamped / this.imgZoom;
    this.panX = ax + k * (this.panX - ax);
    this.panY = ay + k * (this.panY - ay);
    this.setImgZoom(clamped);
  }

  // Button-triggered zoom has no cursor position to anchor to — zoom toward
  // the current view's own center instead, which just scales the existing
  // pan proportionally and keeps whatever's centered, centered.
  private zoomTowardCenter(newZoom: number): void {
    const rect = (this.el!.querySelector('.fav-lb-img-wrap') as HTMLElement).getBoundingClientRect();
    this.zoomAt(newZoom, rect.left + rect.width / 2, rect.top + rect.height / 2);
  }

  private setTxtZoom(z: number): void {
    this.txtZoom = Math.max(0.5, Math.min(3, z));
    (this.el!.querySelector('.fav-lb-text-content') as HTMLElement).style.fontSize = `${this.txtZoom * 0.72}em`;
  }
}
