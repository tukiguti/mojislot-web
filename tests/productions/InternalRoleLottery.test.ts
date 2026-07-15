import { describe, expect, it } from 'vitest';
import type { InternalRoleRates, YakuList } from '../../src/data/schemas';
import { InternalRoleLottery } from '../../src/productions/InternalRoleLottery';

const yakuList: YakuList = {
  mode: 'test',
  coreYaku: [
    {
      id: 'grape',
      name: 'ぶどう',
      symbols: ['ぶ', 'ど', 'う'],
      category: 'core',
      internalRoleKind: 'core',
    },
    {
      id: 'replay',
      name: 'リプレイ',
      symbols: ['り', 'ぷ', 'れ'],
      category: 'core',
      internalRoleKind: 'replay',
    },
    {
      id: 'bell',
      name: 'ベル',
      symbols: ['べ', 'る', 'る'],
      category: 'core',
      internalRoleKind: 'core',
    },
  ],
  cherryYaku: [
    {
      id: 'cherry',
      name: 'チェリー',
      symbols: ['ち', 'ぇ'],
      category: 'cherry',
      internalRoleKind: 'cherry',
    },
  ],
  bonusYaku: [
    {
      id: 'reg',
      name: 'REG',
      symbols: ['れ', 'ぐ', 'ぐ'],
      category: 'bonus',
      internalRoleKind: 'reg',
    },
  ],
  premiumYaku: [
    {
      id: 'big',
      name: 'BIG',
      symbols: ['び', 'っ', 'ぐ'],
      category: 'premium',
      internalRoleKind: 'big',
    },
  ],
};

const rates: InternalRoleRates = {
  miss: 0.5,
  replay: 0.1,
  core: 0.2,
  cherry: 0.1,
  reg: 0.05,
  big: 0.05,
};

const randomSequence = (...values: number[]) => {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)];
};

describe('InternalRoleLottery', () => {
  it('レートに従ってmissを返す', () => {
    const lottery = new InternalRoleLottery(yakuList, () => 0.1);
    expect(lottery.draw(rates)).toEqual({
      kind: 'miss',
      yakuId: null,
      yakuName: null,
    });
  });

  it('replayを具体的な役ID付きで返す', () => {
    const lottery = new InternalRoleLottery(yakuList, randomSequence(0.55, 0));
    expect(lottery.draw(rates)).toMatchObject({ kind: 'replay', yakuId: 'replay' });
  });

  it('デバッグ用抽選ではmissを候補から外す', () => {
    const lottery = new InternalRoleLottery(yakuList, randomSequence(0, 0));
    expect(lottery.draw(rates, { allowMiss: false }).kind).not.toBe('miss');
  });

  it('演出で表現できない役を候補から除外する', () => {
    const lottery = new InternalRoleLottery(yakuList, randomSequence(0.7, 0));
    const result = lottery.draw(rates, {
      allowMiss: false,
      yakuFilter: (yaku) => yaku.symbols.length === 3,
    });
    expect(result.yakuId).not.toBe('cherry');
  });

  it('同一種別の具体役は注入した重みで選ぶ', () => {
    const coreOnly: InternalRoleRates = {
      miss: 0,
      replay: 0,
      core: 1,
      cherry: 0,
      reg: 0,
      big: 0,
    };
    const lottery = new InternalRoleLottery(
      yakuList,
      randomSequence(0.5, 0.95),
      (yaku) => (yaku.id === 'grape' ? 9 : 1),
    );
    expect(lottery.draw(coreOnly).yakuId).toBe('bell');
  });
});
