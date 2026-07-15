import type { Challenge } from '../productions/Challenges';

/**
 * ミッション達成トースト。画面右上から滑り込んで来て自動で消える。
 * 複数同時達成にも対応：縦に積み上げる（DOM 上から順）。
 */

const STACK_OFFSET_Y = 84;
const queue: HTMLElement[] = [];

function recalcStack(): void {
  queue.forEach((el, i) => {
    el.style.top = `${72 + i * STACK_OFFSET_Y}px`;
  });
}

export function showMissionToast(challenge: Challenge): void {
  const el = document.createElement('div');
  el.className = 'mission-toast';
  el.innerHTML = `
    <div class="mission-toast-label">ミッション達成！</div>
    <div class="mission-toast-title">${escapeHtml(challenge.title)}</div>
  `;
  document.body.appendChild(el);
  queue.push(el);
  recalcStack();
  requestAnimationFrame(() => el.classList.add('show'));

  window.setTimeout(() => {
    el.classList.remove('show');
    window.setTimeout(() => {
      el.remove();
      const idx = queue.indexOf(el);
      if (idx !== -1) queue.splice(idx, 1);
      recalcStack();
    }, 320);
  }, 2800);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
