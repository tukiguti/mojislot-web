import type { Payout, Yaku } from '../data/schemas';

export class PayoutCalc {
  constructor(private readonly payout: Payout) {}

  get bet(): number {
    return this.payout.betPerSpin;
  }

  /**
   * @param yaku        判定された役
   * @param bonusActive ボーナス中か（true なら bonusZoneMultiplier 適用）
   * @param streakMult  連チャン倍率（1.0 / 1.2 / 1.5 / 2.0 など）
   */
  calc(yaku: Yaku | null, bonusActive = false, streakMult = 1): number {
    if (!yaku) return 0;
    const base = this.payout.baseMultiplier[yaku.category];
    const mult =
      base *
      (bonusActive ? this.payout.bonusZoneMultiplier : 1) *
      Math.max(1, streakMult);
    return Math.floor(this.payout.betPerSpin * mult);
  }
}

/**
 * 連チャン数に応じた配当倍率を返す。
 * 「成立後の streak」で評価することで、3連達成スピンから恩恵が乗る。
 */
export function streakMultiplier(streakAfterThisSpin: number): number {
  if (streakAfterThisSpin >= 10) return 2.0;
  if (streakAfterThisSpin >= 5) return 1.5;
  if (streakAfterThisSpin >= 3) return 1.2;
  return 1;
}

