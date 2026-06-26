// 戦の計測タイマー（サンド下部）。
// フリー=カウントアップ（手動停止）／プリセット分数=カウントダウン（到達で自動停止）。
// 開始時の差枚を基準に「分速(差枚/分)」と「区間差枚」を出す（時速は出さない）。
// 外部依存は差枚の取得のみ。計数（count-btn）で締める時に stop() を呼ぶ。

interface SahmaiSource {
  /** 現在の差枚（持メダル − 投資累計） */
  sahmai(): number;
}

// 計測開始直後は差枚デルタが小さく分速が暴れるので、一定時間まで「—」
const RATE_MIN_MS = 10_000;

function fmtClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function setRate(el: HTMLElement | null, value: number | null, unit: string): void {
  if (!el) return;
  if (value === null) {
    el.textContent = '—';
    el.classList.remove('plus', 'minus');
    return;
  }
  const rounded = Math.round(value);
  el.textContent = `${rounded > 0 ? '+' : ''}${rounded}${unit}`;
  el.classList.toggle('plus', rounded > 0);
  el.classList.toggle('minus', rounded < 0);
}

export class RunTimer {
  private readonly el = {
    box: document.querySelector<HTMLElement>('.unit-timer'),
    clock: document.getElementById('timer-elapsed'),
    min: document.getElementById('timer-min'),
    total: document.getElementById('timer-total'),
    toggle: document.getElementById('timer-toggle') as HTMLButtonElement | null,
    reset: document.getElementById('timer-reset'),
    presets: document.getElementById('timer-presets'),
  };
  private running = false;
  private startMs = 0;
  private baseSahmai = 0;
  private durationMs = 0; // 0=フリー(カウントアップ)、>0=その時間でカウントダウン→自動停止
  private interval: number | null = null;

  constructor(private readonly wallet: SahmaiSource) {
    this.bindControls();
  }

  // 分速＝開始時からの差枚デルタ÷経過分。baseMs を渡すとその時間で割る（カウントダウン確定用）。
  private renderMinRate(elapsedMs: number, baseMs?: number): void {
    const delta = this.wallet.sahmai() - this.baseSahmai;
    if (baseMs || elapsedMs >= RATE_MIN_MS) {
      setRate(this.el.min, delta / ((baseMs ?? elapsedMs) / 60_000), '/分');
    } else {
      setRate(this.el.min, null, '');
    }
  }

  // 区間差枚＝開始からの差枚デルタ（累計）。分速と違い値が暴れないので即時表示。
  private renderTotal(): void {
    setRate(this.el.total, this.wallet.sahmai() - this.baseSahmai, '枚');
  }

  private render(): void {
    if (!this.running) return;
    const elapsedMs = Date.now() - this.startMs;
    if (this.durationMs > 0) {
      const remaining = this.durationMs - elapsedMs;
      if (remaining <= 0) {
        // セット時間に到達：00:00 固定＋その間の分速を確定して自動停止
        if (this.el.clock) this.el.clock.textContent = '00:00';
        this.renderMinRate(elapsedMs, this.durationMs);
        this.renderTotal();
        this.stop();
        return;
      }
      if (this.el.clock) this.el.clock.textContent = fmtClock(remaining); // 残り時間
    } else if (this.el.clock) {
      this.el.clock.textContent = fmtClock(elapsedMs); // 経過時間
    }
    this.renderMinRate(elapsedMs);
    this.renderTotal();
  }

  private start(): void {
    this.running = true;
    this.startMs = Date.now();
    this.baseSahmai = this.wallet.sahmai();
    this.el.box?.classList.add('running');
    if (this.el.toggle) {
      this.el.toggle.textContent = '計測停止';
      this.el.toggle.classList.add('on');
    }
    if (this.el.clock) {
      this.el.clock.textContent = fmtClock(this.durationMs); // カウントダウンはセット時間から
    }
    setRate(this.el.min, null, '');
    setRate(this.el.total, 0, '枚');
    this.interval = window.setInterval(() => this.render(), 1000);
  }

  /** 計測停止＝その時点の表示（残り/経過・分速）を固定。計数（count-btn）からも呼ぶ。 */
  stop(): void {
    this.running = false;
    if (this.interval !== null) {
      window.clearInterval(this.interval);
      this.interval = null;
    }
    this.el.box?.classList.remove('running');
    if (this.el.toggle) {
      this.el.toggle.textContent = '計測開始';
      this.el.toggle.classList.remove('on');
    }
  }

  private bindControls(): void {
    // プリセット分数の選択（計測中は変更不可）。data-min="0"=フリー。
    this.el.presets
      ?.querySelectorAll<HTMLButtonElement>('.timer-preset')
      .forEach((btn) => {
        btn.addEventListener('click', () => {
          if (this.running) return;
          this.durationMs = Number(btn.dataset.min ?? '0') * 60_000;
          this.el.presets
            ?.querySelectorAll('.timer-preset')
            .forEach((b) => b.classList.toggle('active', b === btn));
          if (this.el.clock) this.el.clock.textContent = fmtClock(this.durationMs);
        });
      });
    this.el.toggle?.addEventListener('click', () => {
      if (this.running) this.stop();
      else this.start();
    });
    this.el.reset?.addEventListener('click', () => {
      this.stop();
      this.startMs = 0;
      if (this.el.clock) this.el.clock.textContent = fmtClock(this.durationMs);
      setRate(this.el.min, null, '');
      setRate(this.el.total, null, '');
    });
  }
}
