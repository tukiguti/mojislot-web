import { setMotionBlurStrength } from '../render/ReelView';
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
  triggerAnnounceLamp(): void;
  fillEffects(): void;
}

/** リール速度の保存キー（main.ts の reelSpeed() と共有）。 */
export const REEL_SPEED_KEY = 'mojislot.reelSpeed.v1';
/** モーションブラー強さの保存キー。 */
export const MOTION_BLUR_KEY = 'mojislot.motionBlur.v1';

/**
 * リール速度スライダーの範囲（コマ/秒）。
 * 下限20＝モーションブラー実装前の速度。上限28＝実機（ジャグラー等）の 0.75秒/周。
 * 見やすさは人によるので、この範囲でプレイヤー自身に選ばせる。
 */
const MIN_REEL_SPEED = 20;
const MAX_REEL_SPEED = 28;
/** リール1本のコマ数（1周の秒数表示に使う）。 */
const REEL_CELLS = 21;

export class SettingsOverlay {
  private readonly root: HTMLElement;
  private debugActions: DebugActions | null = null;
  private visible = false;
  /** 速度変更を即時反映するためのコールバック（main.ts が回転中のエンジンへ流す）。 */
  private onReelSpeedChange: ((speed: number) => void) | null = null;

  /** 現在のリール速度（localStorage 優先・未設定なら data/tuning の既定）。 */
  private get reelSpeed(): number {
    const saved = Number(localStorage.getItem(REEL_SPEED_KEY));
    return Number.isFinite(saved) && saved > 0 ? saved : this.defaultReelSpeed;
  }

  /** 現在のブラー強さ（localStorage 優先・未設定なら data/tuning の既定）。 */
  private get motionBlurStrength(): number {
    const raw = localStorage.getItem(MOTION_BLUR_KEY);
    const saved = Number(raw);
    return raw !== null && Number.isFinite(saved) && saved >= 0
      ? saved
      : this.defaultMotionBlur;
  }

  constructor(
    private readonly wallet: CoinWallet,
    private readonly initialCoins: number,
    private readonly playStats: PlayStats,
    private readonly zukanState: ZukanState,
    private readonly challengeTracker: ChallengeTracker,
    private readonly debugVisible: boolean,
    private readonly defaultReelSpeed: number = 24,
    private readonly defaultMotionBlur: number = 0.34,
  ) {
    const root = document.getElementById('settings-overlay');
    if (!root) throw new Error('#settings-overlay not found');
    this.root = root;

    // ミッションの有効/無効は「遊ぶ」セットアップ（PlaySetup）で確定する。
    // ゲーム内では切替えない（プレイ前に決めた設定が骨抜きにならないよう一本化）。
    this.root.innerHTML = `
      <div class="settings-modal">
        <div class="settings-header">
          <h2>設定</h2>
          <button class="settings-close" type="button">×</button>
        </div>
        <div class="settings-section">
          <div class="settings-section-label">リール速度</div>
          <div class="slider-row">
            <span class="slider-end">遅い</span>
            <input class="slider speed-slider" type="range"
              min="${MIN_REEL_SPEED}" max="${MAX_REEL_SPEED}" step="1" />
            <span class="slider-end">速い</span>
          </div>
          <div class="slider-value"><b class="speed-value"></b></div>
          <div class="settings-note">速いほど目押しはシビアになります（1コマの通過時間が短くなる）。実機は28コマ/秒。</div>
        </div>
        <div class="settings-section">
          <div class="settings-section-label">回転中のブラー（残像）</div>
          <div class="slider-row">
            <span class="slider-end">くっきり</span>
            <input class="slider blur-slider" type="range" min="0" max="1" step="0.02" />
            <span class="slider-end">なめらか</span>
          </div>
          <div class="slider-value"><b class="blur-value"></b></div>
          <div class="settings-note">実機の残像を再現します。強いほど滑らかに見えますが、図柄は読みにくくなります。</div>
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
            <button data-debug="lamp" type="button">確定ランプ</button>
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

    // リール速度スライダー：ドラッグ中も即時反映（回転中のリールにも流す）。
    const speedSlider = this.root.querySelector<HTMLInputElement>('.speed-slider')!;
    const speedValue = this.root.querySelector<HTMLElement>('.speed-value')!;
    const renderSpeed = (v: number) => {
      // 1周 = 21コマ ÷ 速度。1コマの通過時間 = 1000 ÷ 速度（目押しのシビアさの目安）。
      speedValue.textContent =
        `${v} コマ/秒　1周 ${(REEL_CELLS / v).toFixed(2)}秒　1コマ ${(1000 / v).toFixed(0)}ms`;
    };
    speedSlider.value = String(this.reelSpeed);
    renderSpeed(this.reelSpeed);
    speedSlider.addEventListener('input', () => {
      const v = Number(speedSlider.value);
      localStorage.setItem(REEL_SPEED_KEY, String(v));
      renderSpeed(v);
      this.onReelSpeedChange?.(v);
    });

    // ブラースライダー：ReelView が毎フレーム参照するモジュール変数を差し替えるだけ（即時反映）。
    const blurSlider = this.root.querySelector<HTMLInputElement>('.blur-slider')!;
    const blurValue = this.root.querySelector<HTMLElement>('.blur-value')!;
    const renderBlur = (v: number) => {
      blurValue.textContent = v <= 0 ? 'ブラーなし' : v.toFixed(2);
    };
    blurSlider.value = String(this.motionBlurStrength);
    renderBlur(this.motionBlurStrength);
    setMotionBlurStrength(this.motionBlurStrength);
    blurSlider.addEventListener('input', () => {
      const v = Number(blurSlider.value);
      localStorage.setItem(MOTION_BLUR_KEY, String(v));
      renderBlur(v);
      setMotionBlurStrength(v);
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
          case 'lamp':
            this.debugActions.triggerAnnounceLamp();
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

  /** リール速度が変わった時に呼ばれるコールバックを登録（回転中のエンジンへ即時反映する）。 */
  setReelSpeedListener(fn: (speed: number) => void): void {
    this.onReelSpeedChange = fn;
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
