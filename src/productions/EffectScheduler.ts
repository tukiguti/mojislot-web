export type EffectType = 'none' | 'shisa' | 'quiz' | 'aim';

export interface EffectRates {
  none: number;
  shisa: number;
  quiz: number;
  /** レバーオン時に「狙え！◯◯◯」と特定役を予告する示唆演出 */
  aim: number;
}

export const DEFAULT_RATES: EffectRates = {
  none: 0.6,
  shisa: 0.2,
  quiz: 0.1,
  aim: 0.1,
};

/**
 * ハマり救済時のレート（連続ハズレが規定値を超えた時に使う）。
 * 通常 40% だった「演出発生」を 70% に押し上げる。
 */
export const RESCUE_RATES: EffectRates = {
  none: 0.3,
  shisa: 0.35,
  quiz: 0.2,
  aim: 0.15,
};

/** 救済発動の連続ハズレしきい値 */
export const RESCUE_MISS_THRESHOLD = 30;

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
 * リール速度（コマ/秒）。全演出共通＝20コマ/秒に固定。
 * 1コマ = 1000/20 = 50ms（60fps では 3フレーム/コマ）。1周 = 21/20 = 1.05 秒。
 * 実機は1分80回転未満＝最速0.75秒/周（1コマ≈36ms）。本ゲームは目押ししやすさ優先でやや遅め。
 * ビタ成功窓は別途 BITA_MS=12（中心¼コマ＝±12ms）。演出による速度変動は使わない。
 */
export const REEL_SPEED_BY_EFFECT: Record<EffectType, number> = {
  none: 20,
  shisa: 20,
  quiz: 20,
  aim: 20,
};
