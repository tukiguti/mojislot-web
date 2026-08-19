import { Observable } from '../lib/Observable';
import type { ReelStrip } from '../data/schemas';

export type ReelState = 'idle' | 'spinning' | 'stopped';

const DEFAULT_SPEED = 20;

export interface StopResult {
  position: number;
  centerSymbol: string;
  pressedAtMs: number;
  /** 押下位置と中心セルとのズレ（絶対値, ms 換算）。0 に近いほどビタ押し */
  errorMs: number;
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
   * @param slipCells 押下位置からの引き込みコマ数（>=0）。SlipResolver が決定する。
   */
  stop(pressedAtMs: number, slipCells = 0): StopResult {
    if (this.state.get() === 'spinning') {
      const total = this.strip.cells.length;
      const rawPos = this.position;
      const errorCells = Math.abs(rawPos - Math.round(rawPos));
      const errorMs = this.speed > 0 ? (errorCells * 1000) / this.speed : 0;
      const snapped =
        (((Math.round(rawPos) + slipCells) % total) + total) % total;
      this.position = snapped;
      this.state.set('stopped');
      return {
        position: snapped,
        centerSymbol: this.strip.cells[snapped],
        pressedAtMs,
        errorMs,
      };
    }
    return this.snapshot(pressedAtMs);
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
      errorMs: 0,
    };
  }
}
