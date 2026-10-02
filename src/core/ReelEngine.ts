import { Observable } from '../lib/Observable';
import type { ReelStrip } from '../data/schemas';

export type ReelState = 'idle' | 'spinning' | 'stopped';

const DEFAULT_SPEED = 20;

export interface StopResult {
  position: number;
  centerSymbol: string;
  pressedAtMs: number;
  /** 押した瞬間から止まるまでに見た目で進む量（コマ）。端数の送り＋滑り */
  slideCells: number;
  /** その移動にかかる時間（ms）。回っていた速さのまま進む */
  slideMs: number;
}

export class ReelEngine {
  readonly state = new Observable<ReelState>('idle');
  position = 0;
  private speed = DEFAULT_SPEED;
  private lastTickMs: number | null = null;
  /** 加速にかける時間（ms）。0 なら加速なし。 */
  private rampMs = 0;
  /** 定速に達する時刻。最初の tick で決まる（spin の時点では now を知らない）。 */
  private spunUpAt: number | null = null;
  /** 停止の見た目の移動（滑り）。論理上の position は押した瞬間に確定している。 */
  private slide: { from: number; cells: number; startMs: number; ms: number } | null = null;

  constructor(public readonly strip: ReelStrip) {}

  /**
   * 回し始める。
   *
   * @param rampMs 定速までの加速にかける時間（ms）。実機はレバーONから
   *   リールが定速になるまで停止操作を受け付けない。0 なら即定速（シミュレータ用）。
   * @param nowMs レバーONの時刻。加速の終わりをここで確定させる。最初の tick で
   *   決めると、タブが背景に回って ticker が止まっている間は加速が終わらない。
   */
  spin(rampMs = 0, nowMs = 0): void {
    if (this.state.get() === 'spinning') return;
    this.slide = null;
    this.state.set('spinning');
    this.lastTickMs = null;
    this.rampMs = rampMs;
    this.spunUpAt = rampMs > 0 ? nowMs + rampMs : null;
  }

  setSpeed(speed: number): void {
    this.speed = Math.max(0, speed);
  }

  get currentSpeed(): number {
    return this.speed;
  }

  /**
   * 今押したら**滑り0で止まるコマ**。リールは前へしか進まないので、
   * 中段を通り過ぎかけているコマではなく、**次に中段へ来るコマ**になる。
   *
   * 〔2026-10-02〕以前は最寄りのコマへ丸めていて、半コマ過ぎたところで押すと
   * リールが最大半コマ**後ろへ戻って**止まっていた。実機のリールは逆回転しない。
   */
  pressPosition(): number {
    const total = this.strip.cells.length;
    // 浮動小数の誤差で「ちょうど整数」を次のコマへ送らないよう、わずかに引いてから切り上げる
    const p = Math.ceil(this.position - 1e-6);
    return ((p % total) + total) % total;
  }

  /**
   * @param slipCells 押下位置からの引き込みコマ数（>=0）。SlipResolver が決定する。
   * @param nowMs     見た目の滑りを始める時刻（表示側の時計。省略時は滑りを描かない）
   */
  stop(pressedAtMs: number, slipCells = 0, nowMs?: number): StopResult {
    if (this.state.get() === 'spinning') {
      const total = this.strip.cells.length;
      const rawPos = this.position;
      const base = this.pressPosition();
      const snapped = (((base + slipCells) % total) + total) % total;
      // 押した瞬間の位置から、止まる位置まで**前へ**進む量。端数（次のコマまで）＋滑り。
      const cells = (((snapped - rawPos) % total) + total) % total;
      const ms = this.speed > 0 ? (cells * 1000) / this.speed : 0;
      this.slide =
        nowMs !== undefined && ms > 0 ? { from: rawPos, cells, startMs: nowMs, ms } : null;
      this.position = snapped;
      this.state.set('stopped');
      return {
        position: snapped,
        centerSymbol: this.strip.cells[snapped],
        pressedAtMs,
        slideCells: cells,
        slideMs: ms,
      };
    }
    return this.snapshot(pressedAtMs);
  }

  /**
   * 描画する位置。止めた直後は、押した位置から止まる位置まで**回っていた速さのまま
   * 進む**（滑りが見える）。論理上の位置（`position`）は押した瞬間に確定しているので、
   * 出目の判定はこれを待たない。
   */
  displayPosition(nowMs: number): number {
    const sl = this.slide;
    if (!sl) return this.position;
    const t = (nowMs - sl.startMs) / sl.ms;
    if (t >= 1) {
      this.slide = null;
      return this.position;
    }
    const total = this.strip.cells.length;
    return (sl.from + sl.cells * Math.max(0, t)) % total;
  }

  /** 見た目の滑りが残っている時間（ms）。止まり切っていれば 0。 */
  slideRemainingMs(nowMs: number): number {
    const sl = this.slide;
    if (!sl) return 0;
    return Math.max(0, sl.startMs + sl.ms - nowMs);
  }

  reset(): void {
    // position は維持。実機スロット同様、前回の停止位置から次のスピンが始まる。
    // state のみ idle に戻して次のレバー可能状態へ。
    this.state.set('idle');
  }

  tick(nowMs: number): void {
    if (this.state.get() !== 'spinning') {
      this.lastTickMs = nowMs;
      return;
    }
    if (this.lastTickMs === null) {
      this.lastTickMs = nowMs;
      return;
    }
    const deltaSec = (nowMs - this.lastTickMs) / 1000;
    const total = this.strip.cells.length;
    // 加速中は速度を線形に上げる。**目押しはできない状態**なので、
    // 加速の形が出目に効くことはない（停止操作は定速まで受け付けない）。
    const ratio =
      this.rampMs > 0 && this.spunUpAt !== null && nowMs < this.spunUpAt
        ? 1 - (this.spunUpAt - nowMs) / this.rampMs
        : 1;
    this.position = (this.position + this.speed * ratio * deltaSec) % total;
    this.lastTickMs = nowMs;
  }

  private snapshot(pressedAtMs: number): StopResult {
    const total = this.strip.cells.length;
    const idx = ((Math.round(this.position) % total) + total) % total;
    return {
      position: this.position,
      centerSymbol: this.strip.cells[idx],
      pressedAtMs,
      slideCells: 0,
      slideMs: 0,
    };
  }
}
