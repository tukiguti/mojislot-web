import { describe, it, expect } from 'vitest';
import { PayoutCalc } from '../../src/core/PayoutCalc';
import type { Payout, Yaku } from '../../src/data/schemas';
import type { PaylineHit } from '../../src/core/YakuJudge';

// テスト専用の固定 Payout（実データ default.json の変更で壊れないよう独立）。
const PAYOUT: Payout = {
  betPerSpin: 3,
  baseMultiplier: { core: 5, premium: 25, bonus: 6, cherry: 2 },
  bonusZoneMultiplier: 2.5,
  initialCoins: 0,
  // しきい値の並び順に依存しないことを確かめるため、あえて昇順でない順で渡す。
  streakTiers: [
    { minStreak: 12, mult: 3.0 },
    { minStreak: 2, mult: 1.2 },
    { minStreak: 5, mult: 2.0 },
  ],
  aimBonusMultiplier: 1.5,
};

const yaku = (category: Yaku['category']): Yaku => ({
  id: category,
  name: category,
  symbols: ['あ', 'い', 'う'],
  category,
});

const hit = (category: Yaku['category']): PaylineHit => ({
  paylineId: 'middle',
  paylineName: '中段',
  yaku: yaku(category),
  symbols: ['あ', 'い', 'う'],
});

describe('PayoutCalc.calc', () => {
  const calc = new PayoutCalc(PAYOUT);

  it('bet は betPerSpin を返す', () => {
    expect(calc.bet).toBe(3);
  });

  it('通常時の払い出し = bet × baseMultiplier', () => {
    expect(calc.calc(yaku('cherry'))).toBe(6); // 3×2
    expect(calc.calc(yaku('core'))).toBe(15); // 3×5
    expect(calc.calc(yaku('bonus'))).toBe(18); // 3×6
    expect(calc.calc(yaku('premium'))).toBe(75); // 3×25
  });

  it('役なしは 0', () => {
    expect(calc.calc(null)).toBe(0);
  });

  it('ボーナス中は bonusZoneMultiplier が掛かる（floor）', () => {
    expect(calc.calc(yaku('core'), true)).toBe(37); // floor(3×5×2.5)=37
  });

  it('コンボ倍率が掛かる', () => {
    expect(calc.calc(yaku('core'), false, 2.0)).toBe(30); // 3×5×2.0
  });

  it('ボーナス中×コンボの相乗（floor）', () => {
    expect(calc.calc(yaku('core'), true, 2.5)).toBe(93); // floor(3×5×2.5×2.5)=93
  });
});

describe('PayoutCalc.calcMulti', () => {
  const calc = new PayoutCalc(PAYOUT);

  it('複数ラインを線形合算する', () => {
    expect(calc.calcMulti([hit('core'), hit('core')])).toBe(30); // 15×2
    expect(calc.calcMulti([hit('core'), hit('cherry')])).toBe(21); // 15+6
  });

  it('空配列は 0', () => {
    expect(calc.calcMulti([])).toBe(0);
  });
});

describe('PayoutCalc.streakMult', () => {
  const calc = new PayoutCalc(PAYOUT);

  it('しきい値未満は 1', () => {
    expect(calc.streakMult(0)).toBe(1);
    expect(calc.streakMult(1)).toBe(1);
  });

  it('しきい値の並び順に依存せず最大一致を採用', () => {
    expect(calc.streakMult(2)).toBe(1.2);
    expect(calc.streakMult(4)).toBe(1.2);
    expect(calc.streakMult(5)).toBe(2.0);
    expect(calc.streakMult(11)).toBe(2.0);
    expect(calc.streakMult(12)).toBe(3.0);
    expect(calc.streakMult(99)).toBe(3.0);
  });
});

describe('PayoutCalc.aimBonus', () => {
  const calc = new PayoutCalc(PAYOUT);

  it('予告役が揃ったライン配当 ×(mult−1) の floor（上乗せ分のみ）', () => {
    expect(calc.aimBonus([hit('core')])).toBe(7); // floor(15×0.5)
    expect(calc.aimBonus([hit('core'), hit('core')])).toBe(15); // 30×0.5
  });

  it('ボーナス中・コンボ込みの配当に対して上乗せ', () => {
    expect(calc.aimBonus([hit('core')], true, 2.0)).toBe(37); // floor(75×0.5)
  });

  it('予告役が揃っていない（空配列）なら 0', () => {
    expect(calc.aimBonus([])).toBe(0);
  });
});
