import {
  getVisibleChapters,
  getCurrentChapterId,
  setCurrentChapterId,
} from '../data/chapters';

/**
 * 「遊ぶ」セットアップ：台（章）選択。
 * ※プレイ設定トグル（ミッション/リール文字/デバッグ/AUTO）は P4 で追加。
 * 「この台で遊ぶ」で章を確定 → onLaunch（main-entry が #/game へ reload 起動）。
 */
export interface PlaySetupCallbacks {
  onLaunch: () => void;
  onBack: () => void;
}

export function mountPlaySetup(cb: PlaySetupCallbacks): void {
  const root = document.getElementById('view-play');
  if (!root) return;

  const chapters = getVisibleChapters();
  let selectedId = getCurrentChapterId();
  const ART = `${import.meta.env.BASE_URL}art/`;

  const cards = chapters
    .map(
      (c) => `
      <button class="machine-card${c.id === selectedId ? ' active' : ''}" data-chapter="${c.id}" type="button">
        <span class="machine-thumb" style="background-image:url('${ART}cutin_${c.id}.webp')"></span>
        <span class="machine-name">${c.name}</span>
        <span class="machine-desc">${c.description}</span>
      </button>`,
    )
    .join('');

  root.innerHTML = `
    <div class="setup">
      <header class="setup-head">
        <button class="setup-back" data-act="back" type="button">← TOP</button>
        <h1 class="setup-title" data-view-title>台を選ぶ</h1>
      </header>
      <div class="machine-grid">${cards}</div>
      <footer class="setup-foot">
        <button class="setup-launch" data-act="launch" type="button">この台で遊ぶ ▶</button>
      </footer>
    </div>
  `;

  const grid = root.querySelector('.machine-grid');
  grid?.querySelectorAll<HTMLButtonElement>('.machine-card').forEach((btn) => {
    btn.addEventListener('click', () => {
      selectedId = btn.dataset.chapter ?? selectedId;
      grid
        .querySelectorAll('.machine-card')
        .forEach((b) => b.classList.toggle('active', b === btn));
    });
  });

  root.querySelector('[data-act="back"]')?.addEventListener('click', cb.onBack);
  root.querySelector('[data-act="launch"]')?.addEventListener('click', () => {
    setCurrentChapterId(selectedId);
    cb.onLaunch();
  });
}
