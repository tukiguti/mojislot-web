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

  /**
   * 内部役を表現できる演出候補だけから、現在レートを重みとして再抽選する。
   * 内部役missは呼び出し側でnone固定にするため、通常はshisa/quiz/aimを渡す。
   */
  rollAvailable(available: readonly EffectType[]): EffectType {
    const unique = [...new Set(available)];
    const weighted = unique
      .map((effect) => ({ effect, weight: this.rates[effect] }))
      .filter((entry) => entry.weight > 0);
    const total = weighted.reduce((sum, entry) => sum + entry.weight, 0);
    if (total <= 0) return 'none';
    let cursor = Math.random() * total;
    for (const entry of weighted) {
      cursor -= entry.weight;
      if (cursor < 0) return entry.effect;
    }
    return weighted[weighted.length - 1].effect;
  }
}

/**
 * リール速度のフォールバック（コマ/秒）。実運用の既定値は data/tuning が正。
 * 24コマ/秒では1コマ約42ms、21コマを約0.88秒で1周する。
 */
export const REEL_BASE_SPEED = 24;
