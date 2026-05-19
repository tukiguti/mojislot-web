import type { Payout, Yaku } from '../data/schemas';

export class PayoutCalc {
  constructor(private readonly payout: Payout) {}

  get bet(): number {
    return this.payout.betPerSpin;
  }

  calc(yaku: Yaku | null, bonusActive = false): number {
    if (!yaku) return 0;
    const base = this.payout.baseMultiplier[yaku.category];
    const mult = bonusActive ? base * this.payout.bonusZoneMultiplier : base;
    return Math.floor(this.payout.betPerSpin * mult);
  }
}
