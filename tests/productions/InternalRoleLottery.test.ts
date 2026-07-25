import { describe, expect, it } from 'vitest';
import type { InternalRole, InternalRoleRate, YakuList } from '../../src/data/schemas';
import { InternalRoleLottery } from '../../src/productions/InternalRoleLottery';

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
): InternalRole => ({ id, kind, displayYakuId, rate: rate(value), freeze: false });

/** フリーズを発動する強レア役（実機の「フリーズ＝フラグ連動」）。 */
const freezeRole = (
  id: string,
  displayYakuId: string,
  value: number,
): InternalRole => ({
  id,
  kind: 'big',
  displayYakuId,
  rate: rate(value),
  freeze: true,
});

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


  it('forYaku は指定した表示役の内部役を返す（強制演出用）', () => {
    const list: YakuList = {
      ...yakuList,
      internalRoles: [role('bell_any', 'core', 'bell', 1.0)],
    };
    const lottery = new InternalRoleLottery(list, () => 0);
    const bell = list.coreYaku.find((y) => y.id === 'bell')!;
    expect(lottery.forYaku(bell)).toMatchObject({ roleId: 'bell_any', yakuId: 'bell' });
  });

  describe('フリーズ役（強レア役）', () => {
    // 同じ表示役(big)に通常のBIGとフリーズ役をぶら下げる＝実機の「フリーズ専用フラグ」
    const withFreeze: YakuList = {
      ...yakuList,
      internalRoles: [
        role('miss', 'miss', null, 0.5),
        role('big', 'big', 'big', 0.3),
        freezeRole('big_freeze', 'big', 0.2),
      ],
    };
    const big = withFreeze.premiumYaku.find((y) => y.id === 'big')!;

    it('抽選で引けば freeze フラグが立つ', () => {
      // 累積 miss(0.5) → big(0.8) → big_freeze(1.0)。0.9 は最後に落ちる
      const lottery = new InternalRoleLottery(withFreeze, () => 0.9);
      expect(lottery.draw('default')).toMatchObject({
        roleId: 'big_freeze',
        freeze: true,
      });
    });

    it('通常のBIGでは freeze フラグが立たない', () => {
      const lottery = new InternalRoleLottery(withFreeze, () => 0.6);
      expect(lottery.draw('default')).toMatchObject({
        roleId: 'big',
        freeze: false,
      });
    });

    it('forYaku はフリーズ役を選ばない（告知や持ち越しの消化で暴発させない）', () => {
      const lottery = new InternalRoleLottery(withFreeze, () => 0);
      expect(lottery.forYaku(big)).toMatchObject({
        roleId: 'big',
        freeze: false,
      });
    });

    it('freezeRole でフリーズ役を直接引ける（デバッグ強制用）', () => {
      const lottery = new InternalRoleLottery(withFreeze, () => 0);
      expect(lottery.freezeRole()).toMatchObject({
        roleId: 'big_freeze',
        freeze: true,
      });
      // フリーズ役が無い章では null（＝強制しても何も起きない）
      expect(new InternalRoleLottery(yakuList, () => 0).freezeRole()).toBeNull();
    });
  });
});

