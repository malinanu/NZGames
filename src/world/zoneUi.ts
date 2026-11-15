import { brand } from '../shared/brand';
import { icon } from './icons';

export interface EndCard {
  title: string;
  /** Big score line, e.g. "15 pts". */
  score: string;
  /** Emoji-free result strip rendered as chips; also used for the share text. */
  grid?: { label: string; tone: 'good' | 'great' | 'bad' | 'neutral' }[];
  /** Plain-text share grid (emoji allowed here: it is for the user's own message). */
  shareGrid?: string;
  note?: string;
  /** Extra HTML (e.g. Trap Line's chorus list). */
  extra?: string;
}

/**
 * The shared game HUD: a title bar with stat chips, an optional bottom sheet, toasts and
 * the end card. Zones fill these slots instead of building their own chrome, so every game
 * looks like part of the same world.
 */
export class ZoneUi {
  private readonly el: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly statsEl: HTMLElement;
  private readonly sheetEl: HTMLElement;
  private readonly hintEl: HTMLElement;
  private readonly toastEl: HTMLElement;
  private readonly endEl: HTMLElement;
  private toastTimer = 0;
  private onLeave: () => void = () => {};
  private onReplay: () => void = () => {};
  private zoneTitle = '';

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'zone-ui';
    this.el.hidden = true;
    this.el.innerHTML = `
      <div class="zone-top">
        <button class="icon-btn" data-leave aria-label="Back to the world">${icon('back')}</button>
        <div class="zone-title"></div>
        <div class="zone-stats"></div>
      </div>
      <div class="zone-hint" hidden></div>
      <div class="zone-sheet" hidden></div>
      <div class="toast" role="status" aria-live="polite"></div>
      <div class="end" hidden>
        <div class="end-card" role="dialog" aria-modal="true" aria-labelledby="end-title">
          <h2 id="end-title"></h2>
          <div class="end-score"></div>
          <div class="end-grid"></div>
          <div class="end-extra"></div>
          <p class="end-note"></p>
          <div class="end-actions">
            <button class="btn btn-primary" data-share>${icon('share')}<span>Share result</span></button>
            <button class="btn" data-replay>${icon('replay')}<span>Play again</span></button>
            <button class="btn btn-ghost" data-leave>${icon('walk')}<span>Back to the world</span></button>
          </div>
          <p class="presented">Presented by ${brand.presenter} ${brand.campaign}</p>
        </div>
      </div>`;
    document.body.appendChild(this.el);
    this.titleEl = this.el.querySelector('.zone-title')!;
    this.statsEl = this.el.querySelector('.zone-stats')!;
    this.sheetEl = this.el.querySelector('.zone-sheet')!;
    this.hintEl = this.el.querySelector('.zone-hint')!;
    this.toastEl = this.el.querySelector('.toast')!;
    this.endEl = this.el.querySelector('.end')!;
    for (const b of this.el.querySelectorAll('[data-leave]')) b.addEventListener('click', () => this.onLeave());
    this.el.querySelector('[data-replay]')!.addEventListener('click', () => this.onReplay());
  }

  open(title: string, handlers: { leave: () => void; replay: () => void }): void {
    this.zoneTitle = title;
    this.onLeave = handlers.leave;
    this.onReplay = handlers.replay;
    this.titleEl.textContent = title;
    this.statsEl.innerHTML = '';
    this.sheet(null);
    this.hint(null);
    this.endEl.hidden = true;
    this.el.hidden = false;
  }

  close(): void {
    this.el.hidden = true;
    this.endEl.hidden = true;
    this.toastEl.classList.remove('show');
  }

  /** Small labelled values in the top bar. */
  stats(items: { label: string; value: string }[]): void {
    this.statsEl.innerHTML = items
      .map((s) => `<div class="stat"><span class="stat-value">${s.value}</span><span class="stat-label">${s.label}</span></div>`)
      .join('');
  }

  /** Subtitle under the title (e.g. "Hole 2 of 5 · Chilly bin"). */
  subtitle(text: string): void {
    this.titleEl.innerHTML = `<span>${this.zoneTitle}</span><small>${text}</small>`;
  }

  /** Bottom sheet for controls. Pass null to hide. */
  sheet(content: HTMLElement | string | null): HTMLElement {
    this.sheetEl.replaceChildren();
    if (content === null) {
      this.sheetEl.hidden = true;
    } else {
      if (typeof content === 'string') this.sheetEl.innerHTML = content;
      else this.sheetEl.appendChild(content);
      this.sheetEl.hidden = false;
    }
    return this.sheetEl;
  }

  hint(text: string | null): void {
    this.hintEl.hidden = !text;
    if (text) this.hintEl.textContent = text;
  }

  toast(text: string, tone: 'good' | 'bad' | 'info' = 'info', ms = 1600): void {
    this.toastEl.textContent = text;
    this.toastEl.dataset.tone = tone;
    this.toastEl.classList.add('show');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('show'), ms);
  }

  end(card: EndCard, shareLabel: string): void {
    this.sheet(null);
    this.hint(null);
    this.endEl.querySelector('h2')!.textContent = card.title;
    this.endEl.querySelector('.end-score')!.textContent = card.score;
    this.endEl.querySelector('.end-grid')!.innerHTML = (card.grid ?? [])
      .map((g) => `<span class="pip pip-${g.tone}">${g.label}</span>`)
      .join('');
    this.endEl.querySelector('.end-extra')!.innerHTML = card.extra ?? '';
    this.endEl.querySelector('.end-note')!.textContent = card.note ?? '';
    const share = this.endEl.querySelector<HTMLButtonElement>('[data-share]')!;
    share.querySelector('span')!.textContent = 'Share result';
    const text = `${this.zoneTitle} · ${shareLabel}\n${card.shareGrid ?? ''} ${card.score}\nKiwi Christmas Games`;
    share.onclick = async () => {
      const url = location.origin + location.pathname;
      try {
        if (navigator.share) await navigator.share({ text, url });
        else {
          await navigator.clipboard.writeText(`${text}\n${url}`);
          share.querySelector('span')!.textContent = 'Copied';
        }
      } catch {
        // Share sheet dismissed.
      }
    };
    this.endEl.hidden = false;
    share.focus({ preventScroll: true });
  }

  hideEnd(): void {
    this.endEl.hidden = true;
  }
}
