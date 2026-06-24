import type { Payout, Yaku } from '../data/schemas';
import type { PaylineHit } from './YakuJudge';

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

  /**
   * 複数ペイラインヒットの合計払い出し。
   * 同じ役が複数ラインで揃った場合もライン毎にカウント。
   */
  calcMulti(
    hits: readonly PaylineHit[],
    bonusActive = false,
    streakMult = 1,
  ): number {
    let total = 0;
    for (const h of hits) {
      total += this.calc(h.yaku, bonusActive, streakMult);
    }
    return total;
  }

  /**
   * 連チャン（コンボ）数に応じた配当倍率を返す。
   * 「成立後の streak」で評価することで、達成スピンから恩恵が乗る。
   * payout.streakTiers を「最大一致」で評価（しきい値の並び順に依存しない）。
   * 該当なしは 1。
   */
  streakMult(streakAfterThisSpin: number): number {
    let best = 1;
    for (const tier of this.payout.streakTiers) {
      if (streakAfterThisSpin >= tier.minStreak && tier.mult > best) {
        best = tier.mult;
      }
    }
    return best;
  }

  /**
   * 「狙え！」予告役が成立した時の達成ボーナス（上乗せ分のみ）。
   * 予告役が揃ったライン群の配当 × (aimBonusMultiplier − 1) を floor して返す。
   * 予告役が揃っていない（空配列）なら 0。
   */
  aimBonus(
    hits: readonly PaylineHit[],
    bonusActive = false,
    streakMult = 1,
  ): number {
    const base = this.calcMulti(hits, bonusActive, streakMult);
    return Math.floor(base * (this.payout.aimBonusMultiplier - 1));
  }
}

