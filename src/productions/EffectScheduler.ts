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
 * リール速度（コマ/秒）。全演出共通＝30コマ/秒に固定（演出による速度変動は使わない）。
 * 1コマ = 1000/30 ≈ 33ms（60fps では 2フレーム/コマ）。1周 = 21/30 = 0.7 秒。
 * 実機は1分80回転未満＝最速0.75秒/周（1コマ≈36ms）。本実装も実機並みに合わせた（旧20＝1周1.05秒から変更）。
 * ビタ成功窓は別途 tuning.bitaWindowMs（既定±12ms）。33ms/コマでは中心±約0.36コマ相当。
 */
export const REEL_BASE_SPEED = 30;
