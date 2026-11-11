import { describe, expect, it } from 'vitest';
import { forfeitsMissedBonus, type BonusMissContext } from '../../src/productions/BonusForfeit';

const base: BonusMissContext = {
  effect: 'none',
  shownYakuId: null,
  flaggedYakuId: 'shake',
  shisaEscalated: false,
  shisaCandidateCount: 0,
};

describe('forfeitsMissedBonus（取りこぼしたボーナスを持ち越すか）', () => {
  it('無演出なら持ち越す', () => {
    expect(forfeitsMissedBonus(base)).toBe(false);
  });

  it('狙え・クイズがそのボーナスを指していたら消える', () => {
    expect(forfeitsMissedBonus({ ...base, effect: 'aim', shownYakuId: 'shake' })).toBe(true);
    expect(forfeitsMissedBonus({ ...base, effect: 'quiz', shownYakuId: 'shake' })).toBe(true);
  });

  it('演出が別の役（矛盾の小役・外れの狙え）を指していたら持ち越す', () => {
    expect(forfeitsMissedBonus({ ...base, effect: 'aim', shownYakuId: 'maguro' })).toBe(false);
    expect(forfeitsMissedBonus({ ...base, effect: 'quiz', shownYakuId: 'tarako' })).toBe(false);
    expect(
      forfeitsMissedBonus({ ...base, effect: 'shisa', shownYakuId: 'iwashi', shisaEscalated: true, shisaCandidateCount: 4 }),
    ).toBe(false);
  });

  it('示唆は候補が複数のまま発展しなければ持ち越す（BIG1・BIG2・REG のどれか分からない）', () => {
    expect(
      forfeitsMissedBonus({ ...base, effect: 'shisa', shownYakuId: 'shake', shisaCandidateCount: 3 }),
    ).toBe(false);
  });

  it('示唆が発展した、または候補が1つなら消える', () => {
    expect(
      forfeitsMissedBonus({ ...base, effect: 'shisa', shownYakuId: 'shake', shisaEscalated: true, shisaCandidateCount: 3 }),
    ).toBe(true);
    expect(
      forfeitsMissedBonus({ ...base, effect: 'shisa', shownYakuId: 'shake', shisaCandidateCount: 1 }),
    ).toBe(true);
  });
});
