export interface LightboxItem {
  url: string;
  caption: string;
  text: string;
}

export class Lightbox {
  private el: HTMLElement | null = null;
  private items: LightboxItem[] = [];
  private idx = 0;
  private imgZoom = 1;
  private txtZoom = 1;
  private onClose: (() => void) | null = null;

  private readonly keyHandler = (e: KeyboardEvent): void => {
    if (!this.el) return;
    if (e.key === 'ArrowLeft') this.show(this.idx - 1);
    if (e.key === 'ArrowRight') this.show(this.idx + 1);
    if (e.key === 'Escape') this.close();
  };

  open(items: LightboxItem[], startIdx: number, onClose?: () => void): void {
    this.close();
    this.items = items;
    this.imgZoom = 1;
    this.txtZoom = 1;
    this.onClose = onClose ?? null;

    this.el = document.createElement('div');
    this.el.className = 'fav-lb';
    this.el.innerHTML = `
      <div class="fav-lb-toolbar">
        <p class="fav-lb-caption"></p>
        <div style="display:flex;gap:.5em;align-items:center">
          <span class="fav-lb-counter"></span>
          <button class="fav-lb-btn fav-lb-close" title="Sluiten (Esc)">&#x2715;</button>
        </div>
      </div>
      <div class="fav-lb-body">
        <div class="fav-lb-nav"><button class="fav-lb-btn fav-lb-prev">&#x2039;</button></div>
        <div class="fav-lb-img-wrap">
          <img class="fav-lb-img" alt="">
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
        <div class="fav-lb-nav"><button class="fav-lb-btn fav-lb-next">&#x203A;</button></div>
      </div>`;

    document.body.appendChild(this.el);

    this.el.querySelector('.fav-lb-close')!.addEventListener('click', () => this.close());
    this.el.querySelector('.fav-lb-prev')!.addEventListener('click', () => this.show(this.idx - 1));
    this.el.querySelector('.fav-lb-next')!.addEventListener('click', () => this.show(this.idx + 1));

    const izBtns = Array.from(this.el.querySelectorAll<HTMLButtonElement>('.fav-lb-iz .fav-lb-zbtn'));
    izBtns[0]?.addEventListener('click', () => this.setImgZoom(this.imgZoom / 1.3));
    izBtns[1]?.addEventListener('click', () => this.setImgZoom(1));
    izBtns[2]?.addEventListener('click', () => this.setImgZoom(this.imgZoom * 1.3));

    const tzBtns = Array.from(this.el.querySelectorAll<HTMLButtonElement>('.fav-lb-text-bar .fav-lb-zbtn'));
    tzBtns[0]?.addEventListener('click', () => this.setTxtZoom(this.txtZoom / 1.2));
    tzBtns[1]?.addEventListener('click', () => this.setTxtZoom(1));
    tzBtns[2]?.addEventListener('click', () => this.setTxtZoom(this.txtZoom * 1.2));

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

    document.addEventListener('keydown', this.keyHandler);
    this.show(startIdx);
  }

  close(): void {
    if (!this.el) return;
    document.body.removeChild(this.el);
    this.el = null;
    document.removeEventListener('keydown', this.keyHandler);
    this.onClose?.();
  }

  private show(idx: number): void {
    this.idx = Math.max(0, Math.min(this.items.length - 1, idx));
    const item = this.items[this.idx]!;
    const el = this.el!;

    (el.querySelector('.fav-lb-img') as HTMLImageElement).src = item.url;
    el.querySelector('.fav-lb-caption')!.textContent = item.caption;
    el.querySelector('.fav-lb-counter')!.textContent = `${this.idx + 1} / ${this.items.length}`;
    (el.querySelector('.fav-lb-prev') as HTMLButtonElement).disabled = this.idx === 0;
    (el.querySelector('.fav-lb-next') as HTMLButtonElement).disabled = this.idx === this.items.length - 1;

    const content = el.querySelector('.fav-lb-text-content')!;
    content.innerHTML = item.text || '<span class="fav-lb-text-empty">Geen tekst beschikbaar.</span>';
    content.scrollTop = 0;
  }

  private setImgZoom(z: number): void {
    this.imgZoom = Math.max(0.2, Math.min(8, z));
    (this.el!.querySelector('.fav-lb-img') as HTMLElement).style.transform = `scale(${this.imgZoom})`;
  }

  private setTxtZoom(z: number): void {
    this.txtZoom = Math.max(0.5, Math.min(3, z));
    (this.el!.querySelector('.fav-lb-text-content') as HTMLElement).style.fontSize = `${this.txtZoom * 0.72}em`;
  }
}
