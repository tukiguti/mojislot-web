import {
  getVisibleChapters,
  getCurrentChapterId,
  setCurrentChapterId,
} from '../data/chapters';
import { bonusRate, readAllMachineDays } from '../productions/MachineData';

/**
 * 「遊ぶ」セットアップ：台（章）選択 ＋ プレイ設定（4トグル）。
 * 「この台で遊ぶ」で章とプレイ設定を確定 → onLaunch（main-entry が #/game へ reload 起動）。
 *
 * プレイ設定の保存先（既存コードが読む正本に合わせる）:
 *  - ミッション       localStorage `mojislot.challengesEnabled.v1`（ChallengeTracker が読む / 既定ON）
 *  - デバッグボタン   localStorage `mojislot.debugVisible.v1`（SettingsOverlay が読む / 既定OFF）
 *  - AUTOモード       sessionStorage `mojislot.playSetup.v1` = {auto}（main.ts が読む / 既定あり・永続化しない）
 */
export interface PlaySetupCallbacks {
  onLaunch: () => void;
  onBack: () => void;
}

const MISSIONS_KEY = 'mojislot.challengesEnabled.v1';
const REEL_ART_KEY = 'mojislot.reelArt.v1';
const DEBUG_KEY = 'mojislot.debugVisible.v1';
const PLAY_SETUP_KEY = 'mojislot.playSetup.v1';

/** sessionStorage の AUTO 有無を読む（既定: あり=true）。 */
function readAutoEnabled(): boolean {
  try {
    const raw = sessionStorage.getItem(PLAY_SETUP_KEY);
    if (!raw) return true;
    const parsed = JSON.parse(raw) as { auto?: unknown };
    return parsed.auto !== false;
  } catch {
    return true;
  }
}

export function mountPlaySetup(cb: PlaySetupCallbacks): void {
  const root = document.getElementById('view-play');
  if (!root) return;

  const chapters = getVisibleChapters();
  let selectedId = getCurrentChapterId();
  const ART = `${import.meta.env.BASE_URL}art/`;

  // 既存の正本から各トグルの初期状態を読む
  const missionsOn = localStorage.getItem(MISSIONS_KEY) !== '0'; // 既定ON
  const artOn = localStorage.getItem(REEL_ART_KEY) === 'image'; // 既定OFF=文字のみ
  const debugOn = localStorage.getItem(DEBUG_KEY) === '1'; // 既定OFF
  const autoOn = readAutoEnabled(); // 既定あり

  // 実機のホールと同じで、台の上にデータカウンターが出ている。
  // 設定は見えないので、プレイヤーはこの数字と示唆演出だけで台を選ぶ。
  const days = readAllMachineDays(
    chapters.map((c) => c.id),
    new Date(),
  );
  const counter = (id: string): string => {
    const d = days.get(id);
    if (!d || d.spins === 0) {
      return `<span class="machine-counter machine-counter-empty">本日まだ回っていない</span>`;
    }
    const rate = bonusRate(d);
    const sign = d.sahmai > 0 ? '+' : '';
    return `
      <span class="machine-counter">
        <span class="mc-cell"><b>${d.big}</b><i>BIG</i></span>
        <span class="mc-cell"><b>${d.reg}</b><i>REG</i></span>
        <span class="mc-cell"><b>${d.spins}</b><i>回転</i></span>
        <span class="mc-cell${d.sinceBonus >= 200 ? ' mc-hot' : ''}"><b>${d.sinceBonus}</b><i>ハマり</i></span>
        <span class="mc-cell"><b class="${d.sahmai >= 0 ? 'num-plus' : 'num-minus'}">${sign}${d.sahmai}</b><i>差枚</i></span>
        <span class="mc-cell"><b>${rate === null ? '—' : '1/' + rate.toFixed(0)}</b><i>合成</i></span>
      </span>`;
  };

  const cards = chapters
    .map(
      (c) => `
      <button class="machine-card${c.id === selectedId ? ' active' : ''}" data-chapter="${c.id}" type="button">
        <span class="machine-thumb" style="background-image:url('${ART}cutin_${c.id}.webp')"></span>
        <span class="machine-name">${c.name}</span>
        ${counter(c.id)}
        <span class="machine-desc">${c.description}</span>
      </button>`,
    )
    .join('');

  const toggle = (
    opt: string,
    title: string,
    sub: string,
    on: boolean,
  ): string => `
      <label class="toggle-row">
        <span class="toggle-text">
          <span class="toggle-title">${title}</span>
          <span class="toggle-sub">${sub}</span>
        </span>
        <input type="checkbox" data-opt="${opt}" ${on ? 'checked' : ''}>
        <span class="toggle-switch"></span>
      </label>`;

  root.innerHTML = `
    <div class="setup">
      <header class="setup-head">
        <button class="setup-back" data-act="back" type="button">← TOP</button>
        <h1 class="setup-title" data-view-title>台を選ぶ</h1>
      </header>
      <p class="setup-lead">設定は台ごとに日替わり。数字と演出から読むしかない。</p>
      <div class="machine-grid">${cards}</div>
      <section class="setup-options" aria-label="プレイ設定">
        <div class="setup-options-title">プレイ設定</div>
        ${toggle('missions', 'ミッション', '達成状況を記録してトーストで通知', missionsOn)}
        ${toggle('reelart', 'リール絵柄に画像を使う', '既定OFF＝色タイル＋文字。ONで図柄画像（作り直し中）。要リロード', artOn)}
        ${toggle('auto', 'AUTOモード', 'ONでAUTOボタンを表示（自動消化）', autoOn)}
        ${toggle('debug', 'デバッグボタン', '設定内に演出の強制発動ボタンを表示', debugOn)}
      </section>
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

  const isChecked = (opt: string): boolean =>
    root.querySelector<HTMLInputElement>(`input[data-opt="${opt}"]`)?.checked ??
    false;

  const persistSettings = (): void => {
    try {
      localStorage.setItem(MISSIONS_KEY, isChecked('missions') ? '1' : '0');
      localStorage.setItem(REEL_ART_KEY, isChecked('reelart') ? 'image' : 'plain');
      localStorage.setItem(DEBUG_KEY, isChecked('debug') ? '1' : '0');
      sessionStorage.setItem(
        PLAY_SETUP_KEY,
        JSON.stringify({ auto: isChecked('auto') }),
      );
    } catch {
      /* storage 不可でもゲーム開始は妨げない */
    }
  };

  root.querySelector('[data-act="back"]')?.addEventListener('click', cb.onBack);
  root.querySelector('[data-act="launch"]')?.addEventListener('click', () => {
    setCurrentChapterId(selectedId);
    persistSettings();
    cb.onLaunch();
  });
}
