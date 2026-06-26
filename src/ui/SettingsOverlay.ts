import type { CoinWallet } from '../core/CoinWallet';
import type { PlayStats } from '../productions/PlayStats';
import type { ZukanState } from '../productions/ZukanState';
import type { ChallengeTracker } from '../productions/Challenges';

/**
 * 設定モーダル：ミッション/表示/リセット/（任意で）デバッグ操作を集約。
 * 台（章）の切替は「遊ぶ」セットアップ（PlaySetup）へ移設したのでここには無い。
 * デバッグ section は debugVisible（遊ぶ設定の `mojislot.debugVisible.v1`）が true の時だけ出す。
 */

export interface DebugActions {
  triggerBonus(): void;
  triggerRegular(): void;
  triggerShisa(): void;
  triggerQuiz(): void;
  triggerWinTest(): void;
  triggerTenpaiSe(): void;
  triggerCutin(): void;
  triggerAim(): void;
  triggerFreeze(): void;
  fillEffects(): void;
}

export class SettingsOverlay {
  private readonly root: HTMLElement;
  private debugActions: DebugActions | null = null;
  private visible = false;

  constructor(
    private readonly wallet: CoinWallet,
    private readonly initialCoins: number,
    private readonly playStats: PlayStats,
    private readonly zukanState: ZukanState,
    private readonly challengeTracker: ChallengeTracker,
    private readonly debugVisible: boolean,
  ) {
    const root = document.getElementById('settings-overlay');
    if (!root) throw new Error('#settings-overlay not found');
    this.root = root;

    // ミッション報酬の有無は「遊ぶ」セットアップ（PlaySetup）で確定する。
    // ゲーム内では切替えない（プレイ前に決めた設定が骨抜きにならないよう一本化）。
    this.root.innerHTML = `
      <div class="settings-modal">
        <div class="settings-header">
          <h2>設定</h2>
          <button class="settings-close" type="button">×</button>
        </div>
        <div class="settings-section">
          <div class="settings-section-label">表示</div>
          <label class="toggle-row">
            <span class="toggle-text">
              <span class="toggle-title">リールに文字を表示</span>
              <span class="toggle-sub">OFFで図柄のみ（実機風）／ONでかな文字も表示（学習用）</span>
            </span>
            <input type="checkbox" class="reel-glyphs-toggle">
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
        ${
          this.debugVisible
            ? `<div class="settings-section">
          <div class="settings-section-label">デバッグ（演出を強制発動）</div>
          <div class="zukan-debug-buttons">
            <button data-debug="bonus" type="button">BIG BONUS</button>
            <button data-debug="regular" type="button">REG BONUS</button>
            <button data-debug="freeze" type="button">フリーズ</button>
            <button data-debug="cutin" type="button">カットイン</button>
            <button data-debug="aim" type="button">狙え！予告</button>
            <button data-debug="shisa" type="button">示唆発動</button>
            <button data-debug="quiz" type="button">クイズ発動</button>
            <button data-debug="tenpai" type="button">テンパイSE</button>
            <button data-debug="win" type="button">役成立演出</button>
            <button data-debug="effects" type="button">全画面FX</button>
          </div>
        </div>`
            : ''
        }
        <div class="zukan-hint">[,] で閉じる</div>
      </div>
    `;

    // コイン追加（メダル貸出）は右のサンド（#unit-panel）へ移設。main.ts で配線。

    const closeBtn = this.root.querySelector<HTMLButtonElement>('.settings-close')!;
    closeBtn.addEventListener('click', () => this.close());

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
          case 'regular':
            this.debugActions.triggerRegular();
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
          case 'freeze':
            this.debugActions.triggerFreeze();
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

  /** 「リールに文字を表示」トグルを配線（初期値＋変更コールバック） */
  setReelGlyphsControl(initial: boolean, onChange: (show: boolean) => void): void {
    const toggle = this.root.querySelector<HTMLInputElement>('.reel-glyphs-toggle');
    if (!toggle) return;
    toggle.checked = initial;
    toggle.addEventListener('change', () => onChange(toggle.checked));
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
