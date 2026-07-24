import { describe, expect, it } from 'vitest';
import type { InternalRole, InternalRoleRate, YakuList } from '../../src/data/schemas';
import {
  InternalRoleLottery,
  pressOrderSatisfied,
} from '../../src/productions/InternalRoleLottery';

const rate = (value: number): InternalRoleRate => ({
  default: value,
  rescue: value,
  bonus: value,
});

const role = (
  id: string,
  kind: InternalRole['kind'],
  displayYakuId: string | null,
  value: number,
  pressOrder: InternalRole['pressOrder'] = null,
): InternalRole => ({ id, kind, displayYakuId, pressOrder, rate: rate(value) });

const yakuList: YakuList = {
  mode: 'test',
  coreYaku: [
    { id: 'grape', name: 'ぶどう', symbols: ['ぶ', 'ど', 'う'], category: 'core' },
    { id: 'replay', name: 'リプレイ', symbols: ['り', 'ぷ', 'れ'], category: 'core' },
    { id: 'bell', name: 'ベル', symbols: ['べ', 'る', 'る'], category: 'core' },
  ],
  cherryYaku: [
    { id: 'cherry', name: 'チェリー', symbols: ['ち', 'ぇ'], category: 'cherry' },
  ],
  bonusYaku: [
    { id: 'reg', name: 'REG', symbols: ['れ', 'ぐ', 'ぐ'], category: 'bonus' },
  ],
  premiumYaku: [
    { id: 'big', name: 'BIG', symbols: ['び', 'っ', 'ぐ'], category: 'premium' },
  ],
  internalRoles: [
    role('miss', 'miss', null, 0.4),
    role('single', 'single', null, 0.1),
    role('grape', 'core', 'grape', 0.1),
    role('replay', 'replay', 'replay', 0.1),
    // 同じ表示役(bell)に押し順違いの内部役をぶら下げる＝実機の押し順ベル群
    role('bell_l', 'core', 'bell', 0.1, { type: 'first', reel: 0 }),
    role('bell_r', 'core', 'bell', 0.1, { type: 'first', reel: 2 }),
    role('cherry', 'cherry', 'cherry', 0.05),
    role('reg', 'reg', 'reg', 0.03),
    role('big', 'big', 'big', 0.02),
  ],
};

const randomSequence = (...values: number[]) => {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)];
};

describe('InternalRoleLottery', () => {
  it('レートに従ってmissを返す', () => {
    const lottery = new InternalRoleLottery(yakuList, () => 0.1);
    expect(lottery.draw('default')).toMatchObject({
      kind: 'miss',
      yakuId: null,
    });
  });

  it('1枚役(single)は表示役を持たない', () => {
    // miss(0.4) の直後が single(0.1) → 累積 0.4..0.5
    const lottery = new InternalRoleLottery(yakuList, () => 0.45);
    const result = lottery.draw('default');
    expect(result.kind).toBe('single');
    expect(result.yakuId).toBeNull();
  });

  it('デバッグ用抽選ではmissを候補から外す', () => {
    const lottery = new InternalRoleLottery(yakuList, randomSequence(0, 0));
    expect(lottery.draw('default', { allowMiss: false }).kind).not.toBe('miss');
  });

  it('roleFilter で候補を絞れる（表示役なしを除外）', () => {
    const lottery = new InternalRoleLottery(yakuList, randomSequence(0.5, 0));
    const result = lottery.draw('default', {
      allowMiss: false,
      roleFilter: (_role, yaku) => yaku !== null && yaku.symbols.length === 3,
    });
    expect(result.yakuId).not.toBeNull();
    expect(result.yakuId).not.toBe('cherry');
  });

  it('押し順役は pressOrder を持ったまま返る', () => {
    const only: YakuList = {
      ...yakuList,
      internalRoles: [role('bell_r', 'core', 'bell', 1, { type: 'first', reel: 2 })],
    };
    const lottery = new InternalRoleLottery(only, () => 0.5);
    expect(lottery.draw('default')).toMatchObject({
      roleId: 'bell_r',
      yakuId: 'bell',
      pressOrder: { type: 'first', reel: 2 },
    });
  });

  it('forYaku は押し順不問の内部役を優先する（強制演出が必ず狙えるように）', () => {
    const list: YakuList = {
      ...yakuList,
      internalRoles: [
        role('bell_l', 'core', 'bell', 0.5, { type: 'first', reel: 0 }),
        role('bell_any', 'core', 'bell', 0.5),
      ],
    };
    const lottery = new InternalRoleLottery(list, () => 0);
    const bell = list.coreYaku.find((y) => y.id === 'bell')!;
    expect(lottery.forYaku(bell)).toMatchObject({
      roleId: 'bell_any',
      pressOrder: null,
    });
  });
});

describe('pressOrderSatisfied', () => {
  it('押し順なし(null)は常に満たす', () => {
    expect(pressOrderSatisfied(null, [2, 0, 1])).toBe(true);
  });

  it('first: 第1停止が一致すれば満たす', () => {
    const order = { type: 'first', reel: 1 } as const;
    expect(pressOrderSatisfied(order, [])).toBe(true); // まだ未確定
    expect(pressOrderSatisfied(order, [1])).toBe(true);
    expect(pressOrderSatisfied(order, [1, 0, 2])).toBe(true);
    expect(pressOrderSatisfied(order, [0])).toBe(false);
  });

  it('exact: 停止済みの並びが先頭一致であること', () => {
    const order = { type: 'exact', order: [2, 1, 0] } as const;
    expect(pressOrderSatisfied(order, [])).toBe(true);
    expect(pressOrderSatisfied(order, [2])).toBe(true);
    expect(pressOrderSatisfied(order, [2, 1])).toBe(true);
    expect(pressOrderSatisfied(order, [2, 1, 0])).toBe(true);
    expect(pressOrderSatisfied(order, [2, 0])).toBe(false);
    expect(pressOrderSatisfied(order, [1])).toBe(false);
  });
});
