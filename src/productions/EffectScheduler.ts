export type EffectType = 'none' | 'shisa' | 'quiz';

export interface EffectRates {
  none: number;
  shisa: number;
  quiz: number;
}

export const DEFAULT_RATES: EffectRates = {
  none: 0.7,
  shisa: 0.2,
  quiz: 0.1,
};

/**
 * ハマり救済時のレート（連続ハズレが規定値を超えた時に使う）。
 * 通常 30% だった「示唆 or クイズ発生」を 70% に押し上げる。
 */
export const RESCUE_RATES: EffectRates = {
  none: 0.3,
  shisa: 0.45,
  quiz: 0.25,
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
    return 'quiz';
  }
}

/**
 * リール速度（コマ/秒）。実機準拠で全演出共通の固定値。
 * 1コマ通過 = 1/27 ≒ 0.037 秒（実機規定値）。
 * 21コマ × 1/27 ≒ 0.78 秒/周 で「目押しリズム」が実機と一致。
 * 演出による速度変動はゲーム性を曖昧にするため使わない。
 */
export const REEL_SPEED_BY_EFFECT: Record<EffectType, number> = {
  none: 27,
  shisa: 27,
  quiz: 27,
};
