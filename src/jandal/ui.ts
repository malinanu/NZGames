import type { brand as Brand } from '../shared/brand';
import { FLICKS_PER_HOLE } from './course';

export type HoleResult = 'ace' | 'landed' | 'legend' | 'miss';

const EMOJI: Record<HoleResult, string> = { ace: '⭐', landed: '🩴', legend: '🤩', miss: '❌' };
const STORAGE_PREFIX = 'jandal-flip:';

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id}`);
  return node as T;
}

/** DOM overlay: hole/flick status, toasts, and the end-of-course share card. */
export class Hud {
  private toastTimer = 0;
  private replay: () => void = () => {};

  constructor(
    private readonly brandConfig: typeof Brand,
    private readonly courseLabel: string,
  ) {
    el('brand').textContent = `${brandConfig.presenter} ${brandConfig.campaign}`;
    el('course-label').textContent = `Jandal of the Day · ${courseLabel}`;
    el('replay').addEventListener('click', () => this.replay());
  }

  ready(): void {
    el('loading').hidden = true;
    el('hud').hidden = false;
    el('hint').hidden = false;
  }

  onReplay(fn: () => void): void {
    this.replay = fn;
  }

  hideHint(): void {
    el('hint').hidden = true;
  }

  setHole(index: number, total: number, label: string, flicksLeft: number, score: number): void {
    el('hole').textContent = `Hole ${index + 1}/${total} · ${label}`;
    el('score').textContent = `${score} pts`;
    el('flicks').textContent = '🩴'.repeat(flicksLeft) + '·'.repeat(FLICKS_PER_HOLE - flicksLeft);
  }

  toast(text: string, tone: 'good' | 'bad'): void {
    const node = el('toast');
    node.textContent = text;
    node.dataset.tone = tone;
    node.classList.add('show');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => node.classList.remove('show'), 1500);
  }

  showEnd(results: HoleResult[], score: number, seed: string, isDaily: boolean): void {
    const grid = results.map((r) => EMOJI[r]).join('');
    let best = score;
    if (isDaily) {
      try {
        const key = `${STORAGE_PREFIX}${seed}`;
        const prev = Number(localStorage.getItem(key) ?? 0);
        best = Math.max(prev, score);
        localStorage.setItem(key, String(best));
      } catch {
        // Private mode or storage blocked: the game still works, just without a saved best.
      }
    }
    el('end-grid').textContent = grid;
    el('end-score').textContent = `${score} pts`;
    el('end-best').textContent = best > score ? `Your best today: ${best} pts` : 'Come back tomorrow for a new course';
    el('hud').hidden = true;
    el('end').hidden = false;

    const shareText = `Jandal Flip 🩴 ${this.courseLabel}\n${grid} ${score} pts\n${this.brandConfig.presenter} ${this.brandConfig.campaign}`;
    const share = el<HTMLButtonElement>('share');
    share.onclick = async () => {
      const url = location.origin + location.pathname;
      try {
        if (navigator.share) await navigator.share({ text: shareText, url });
        else {
          await navigator.clipboard.writeText(`${shareText}\n${url}`);
          share.textContent = 'Copied!';
        }
      } catch {
        // Share sheet dismissed: nothing to do.
      }
    };
  }
}
