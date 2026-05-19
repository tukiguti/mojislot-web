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

export class EffectScheduler {
  constructor(private readonly rates: EffectRates = DEFAULT_RATES) {}

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
 *  - quiz: 遅い（クイズ補助、補助レベル+2相当）
 */
export const REEL_SPEED_BY_EFFECT: Record<EffectType, number> = {
  none: 30,
  shisa: 18,
  quiz: 10,
};
