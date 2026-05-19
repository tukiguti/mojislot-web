import { Observable } from '../lib/Observable';
import type { ReelStrip } from '../data/schemas';

export type ReelState = 'idle' | 'spinning' | 'stopped';

const DEFAULT_SPEED = 30;

export interface StopResult {
  position: number;
  centerSymbol: string;
  pressedAtMs: number;
}

export class ReelEngine {
  readonly state = new Observable<ReelState>('idle');
  position = 0;
  private speed = DEFAULT_SPEED;
  private lastTickMs: number | null = null;

  constructor(public readonly strip: ReelStrip) {}

  spin(): void {
    if (this.state.get() === 'spinning') return;
    this.state.set('spinning');
    this.lastTickMs = null;
  }

  setSpeed(speed: number): void {
    this.speed = Math.max(0, speed);
  }

  stop(pressedAtMs: number): StopResult {
    if (this.state.get() === 'spinning') {
      const snapped = Math.round(this.position) % this.strip.cells.length;
      this.position = snapped;
      this.state.set('stopped');
    }
    return this.snapshot(pressedAtMs);
  }

  reset(): void {
    this.position = 0;
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
    this.position = (this.position + this.speed * deltaSec) % total;
    this.lastTickMs = nowMs;
  }

  private snapshot(pressedAtMs: number): StopResult {
    const total = this.strip.cells.length;
    const idx = ((Math.round(this.position) % total) + total) % total;
    return {
      position: this.position,
      centerSymbol: this.strip.cells[idx],
      pressedAtMs,
    };
  }
}
