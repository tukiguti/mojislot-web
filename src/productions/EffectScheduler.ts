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
 * 演出タイプに応じたリール速度（コマ/秒）。
 * 速いほど狙いにくく、遅いほどビタ押ししやすい。
 *  - none: 通常速度（ほぼ運勝負）
 *  - shisa: やや遅い（示唆あり、補助レベル+1相当）
 *  - quiz: 中速（クイズ補助、ビタ狙いは依然容易ではない）
 */
export const REEL_SPEED_BY_EFFECT: Record<EffectType, number> = {
  none: 30,
  shisa: 18,
  quiz: 15,
};
