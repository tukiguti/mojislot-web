import { describe, expect, it } from 'vitest';
import type { InternalRoleRate, YakuList } from '../../src/data/schemas';
import { InternalRoleLottery } from '../../src/productions/InternalRoleLottery';

const rate = (value: number): InternalRoleRate => ({
  default: value,
  rescue: value,
  bonus: value,
});

const yakuList: YakuList = {
  mode: 'test',
  internalRoleMissRate: rate(0.5),
  coreYaku: [
    {
      id: 'grape',
      name: 'ぶどう',
      symbols: ['ぶ', 'ど', 'う'],
      category: 'core',
      internalRoleKind: 'core',
      internalRoleRate: rate(0.1),
    },
    {
      id: 'replay',
      name: 'リプレイ',
      symbols: ['り', 'ぷ', 'れ'],
      category: 'core',
      internalRoleKind: 'replay',
      internalRoleRate: rate(0.1),
    },
    {
      id: 'bell',
      name: 'ベル',
      symbols: ['べ', 'る', 'る'],
      category: 'core',
      internalRoleKind: 'core',
      internalRoleRate: rate(0.1),
    },
  ],
  cherryYaku: [
    {
      id: 'cherry',
      name: 'チェリー',
      symbols: ['ち', 'ぇ'],
      category: 'cherry',
      internalRoleKind: 'cherry',
      internalRoleRate: rate(0.1),
    },
  ],
  bonusYaku: [
    {
      id: 'reg',
      name: 'REG',
      symbols: ['れ', 'ぐ', 'ぐ'],
      category: 'bonus',
      internalRoleKind: 'reg',
      internalRoleRate: rate(0.05),
    },
  ],
  premiumYaku: [
    {
      id: 'big',
      name: 'BIG',
      symbols: ['び', 'っ', 'ぐ'],
      category: 'premium',
      internalRoleKind: 'big',
      internalRoleRate: rate(0.05),
    },
  ],
};

const randomSequence = (...values: number[]) => {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)];
};

describe('InternalRoleLottery', () => {
  it('レートに従ってmissを返す', () => {
    const lottery = new InternalRoleLottery(yakuList, () => 0.1);
    expect(lottery.draw('default')).toEqual({
      kind: 'miss',
      yakuId: null,
      yakuName: null,
    });
  });

  it('replayを具体的な役ID付きで返す', () => {
    const lottery = new InternalRoleLottery(yakuList, () => 0.65);
    expect(lottery.draw('default')).toMatchObject({ kind: 'replay', yakuId: 'replay' });
  });

  it('デバッグ用抽選ではmissを候補から外す', () => {
    const lottery = new InternalRoleLottery(yakuList, randomSequence(0, 0));
    expect(lottery.draw('default', { allowMiss: false }).kind).not.toBe('miss');
  });

  it('演出で表現できない役を候補から除外する', () => {
    const lottery = new InternalRoleLottery(yakuList, randomSequence(0.7, 0));
    const result = lottery.draw('default', {
      allowMiss: false,
      yakuFilter: (yaku) => yaku.symbols.length === 3,
    });
    expect(result.yakuId).not.toBe('cherry');
  });

  it('同じcore種別でも役ごとの設定確率で直接選ぶ', () => {
    const directRates: YakuList = {
      ...yakuList,
      internalRoleMissRate: rate(0),
      coreYaku: yakuList.coreYaku.map((yaku) => ({
        ...yaku,
        internalRoleRate: rate(
          yaku.id === 'grape' ? 0.9 : yaku.id === 'bell' ? 0.1 : 0,
        ),
      })),
      cherryYaku: yakuList.cherryYaku.map((yaku) => ({
        ...yaku,
        internalRoleRate: rate(0),
      })),
      bonusYaku: yakuList.bonusYaku.map((yaku) => ({
        ...yaku,
        internalRoleRate: rate(0),
      })),
      premiumYaku: yakuList.premiumYaku.map((yaku) => ({
        ...yaku,
        internalRoleRate: rate(0),
      })),
    };
    const lottery = new InternalRoleLottery(directRates, () => 0.95);
    expect(lottery.draw('default').yakuId).toBe('bell');
  });
});
