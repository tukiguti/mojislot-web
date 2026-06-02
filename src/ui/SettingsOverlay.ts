import {
  getVisibleChapters,
  isSecretUnlocked,
  setCurrentChapterId,
} from '../data/chapters';
import type { CoinWallet } from '../core/CoinWallet';
import type { PlayStats } from '../productions/PlayStats';
import type { ZukanState } from '../productions/ZukanState';
import type { ChallengeTracker } from '../productions/Challenges';

/**
 * 設定モーダル：章切替・リセット・デバッグ操作を集約。
 * 図鑑モーダルから分離して、図鑑側はスクロールの邪魔を減らす。
 */

export interface DebugActions {
  triggerBonus(): void;
  triggerShisa(): void;
  triggerQuiz(): void;
  triggerWinTest(): void;
  triggerTenpaiSe(): void;
  triggerCutin(): void;
  triggerAim(): void;
  fillEffects(): void;
}

export class SettingsOverlay {
  private readonly root: HTMLElement;
  private debugActions: DebugActions | null = null;
  private visible = false;

  constructor(
    private readonly currentChapterId: string,
    private readonly wallet: CoinWallet,
    private readonly initialCoins: number,
    private readonly playStats: PlayStats,
    private readonly zukanState: ZukanState,
    private readonly challengeTracker: ChallengeTracker,
  ) {
    const root = document.getElementById('settings-overlay');
    if (!root) throw new Error('#settings-overlay not found');
    this.root = root;

    const visibleChapters = getVisibleChapters();
    const chapterButtons = visibleChapters
      .map(
        (c) =>
          `<button class="chapter-btn ${c.id === this.currentChapterId ? 'active' : ''}" data-chapter="${c.id}" type="button" title="${c.description}">${c.name}</button>`,
      )
      .join('');

    const missionsEnabled = this.challengeTracker.enabled.get();
    const secretHint = isSecretUnlocked()
      ? '<div class="settings-section-hint">🔓 隠し章が解除されています</div>'
      : '';

    this.root.innerHTML = `
      <div class="settings-modal">
        <div class="settings-header">
          <h2>設定</h2>
          <button class="settings-close" type="button">×</button>
        </div>
        <div class="settings-section">
          <div class="settings-section-label">章を選択</div>
          <div class="settings-section-hint">切替するとリロードされます</div>
          ${secretHint}
          <div class="zukan-chapters-list">${chapterButtons}</div>
        </div>
        <div class="settings-section">
          <div class="settings-section-label">コインを追加</div>
          <div class="settings-section-hint">プレイ用のコインをここから補充できます</div>
          <div class="coin-add-buttons">
            <button class="coin-add" data-amount="100" type="button">+100</button>
            <button class="coin-add" data-amount="500" type="button">+500</button>
            <button class="coin-add" data-amount="1000" type="button">+1000</button>
            <button class="coin-add" data-amount="5000" type="button">+5000</button>
          </div>
        </div>
        <div class="settings-section">
          <div class="settings-section-label">ミッション</div>
          <label class="toggle-row">
            <span class="toggle-text">
              <span class="toggle-title">ミッション報酬を有効化</span>
              <span class="toggle-sub">OFFにすると達成チェック・報酬コイン・トーストが止まります</span>
            </span>
            <input type="checkbox" class="missions-toggle" ${missionsEnabled ? 'checked' : ''}>
            <span class="toggle-switch"></span>
          </label>
        </div>
        <div class="settings-section">
          <div class="settings-section-label">リセット</div>
          <div class="zukan-reset">
            <button class="reset-coin" type="button">コインを${this.initialCoins}に戻す</button>
            <button class="reset-all" type="button">全データをリセット</button>
          </div>
        </div>
        <div class="settings-section">
          <div class="settings-section-label">デバッグ（演出を強制発動）</div>
          <div class="zukan-debug-buttons">
            <button data-debug="bonus" type="button">BONUS突入</button>
            <button data-debug="cutin" type="button">カットイン</button>
            <button data-debug="aim" type="button">狙え！予告</button>
            <button data-debug="shisa" type="button">示唆発動</button>
            <button data-debug="quiz" type="button">クイズ発動</button>
            <button data-debug="tenpai" type="button">テンパイSE</button>
            <button data-debug="win" type="button">役成立演出</button>
            <button data-debug="effects" type="button">全画面FX</button>
          </div>
        </div>
        <div class="zukan-hint">[,] で閉じる</div>
      </div>
    `;

    // コイン追加ボタンの配線
    const coinAddBtns =
      this.root.querySelectorAll<HTMLButtonElement>('.coin-add');
    coinAddBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const n = Number(btn.dataset.amount ?? '0');
        if (n > 0) this.wallet.win(n);
      });
    });

    const closeBtn = this.root.querySelector<HTMLButtonElement>('.settings-close')!;
    closeBtn.addEventListener('click', () => this.close());

    const chapterBtns =
      this.root.querySelectorAll<HTMLButtonElement>('.chapter-btn');
    chapterBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.chapter;
        if (!id || id === this.currentChapterId) return;
        setCurrentChapterId(id);
        window.location.reload();
      });
    });

    const missionsToggle = this.root.querySelector<HTMLInputElement>(
      '.missions-toggle',
    )!;
    missionsToggle.addEventListener('change', () => {
      this.challengeTracker.setEnabled(missionsToggle.checked);
    });
    // 外部から変更されたときもUIを同期
    this.challengeTracker.enabled.subscribe((v) => {
      missionsToggle.checked = v;
    });

    const resetCoinBtn = this.root.querySelector<HTMLButtonElement>('.reset-coin')!;
    resetCoinBtn.addEventListener('click', () => {
      this.wallet.reset(this.initialCoins);
    });

    const resetAllBtn = this.root.querySelector<HTMLButtonElement>('.reset-all')!;
    resetAllBtn.addEventListener('click', () => {
      if (!window.confirm('図鑑・統計・ミッション・コインを全てリセットしますか？')) return;
      this.zukanState.reset();
      this.playStats.reset();
      this.challengeTracker.reset();
      this.wallet.reset(this.initialCoins);
    });

    const debugBtns = this.root.querySelectorAll<HTMLButtonElement>(
      '.zukan-debug-buttons button',
    );
    debugBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        if (!this.debugActions) return;
        const action = btn.dataset.debug;
        switch (action) {
          case 'bonus':
            this.debugActions.triggerBonus();
            break;
          case 'shisa':
            this.debugActions.triggerShisa();
            break;
          case 'quiz':
            this.debugActions.triggerQuiz();
            break;
          case 'cutin':
            this.debugActions.triggerCutin();
            break;
          case 'aim':
            this.debugActions.triggerAim();
            break;
          case 'tenpai':
            this.debugActions.triggerTenpaiSe();
            break;
          case 'win':
            this.debugActions.triggerWinTest();
            break;
          case 'effects':
            this.debugActions.fillEffects();
            break;
        }
      });
    });

    this.close();
  }

  setDebugActions(actions: DebugActions): void {
    this.debugActions = actions;
  }

  open(): void {
    this.visible = true;
    this.root.hidden = false;
  }

  close(): void {
    this.visible = false;
    this.root.hidden = true;
  }

  toggle(): void {
    if (this.visible) this.close();
    else this.open();
  }
}
