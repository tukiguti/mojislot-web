export type EffectType = 'none' | 'shisa' | 'quiz' | 'aim';

export interface EffectRates {
  none: number;
  shisa: number;
  quiz: number;
  /** レバーオン時に「狙え！◯◯◯」と特定役を予告する示唆演出 */
  aim: number;
}

/**
 * EffectScheduler の既定レート（コンストラクタ未指定時のフォールバック）。
 * 実運用のレート（通常/救済/ボーナス中）と救済しきい値は data/tuning/default.json が正で、
 * main.ts が状況に応じて setRates で切り替える。
 */
export const DEFAULT_RATES: EffectRates = {
  none: 0.6,
  shisa: 0.2,
  quiz: 0.1,
  aim: 0.1,
};

export class EffectScheduler {
  constructor(private rates: EffectRates = DEFAULT_RATES) {}

  /** ボーナスゾーン中などで一時的に rates を切替えるために使う */
  setRates(rates: EffectRates): void {
    this.rates = rates;
  }

  roll(): EffectType {
    const r = Math.random();
    if (r < this.rates.none) return 'none';
    if (r < this.rates.none + this.rates.shisa) return 'shisa';
    if (r < this.rates.none + this.rates.shisa + this.rates.quiz) return 'quiz';
    return 'aim';
  }
}

/**
 * リール速度のフォールバック（コマ/秒）。実運用の既定値は data/tuning が正。
 * 24コマ/秒では1コマ約42ms、21コマを約0.88秒で1周する。
 */
export const REEL_BASE_SPEED = 24;
