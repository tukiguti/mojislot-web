import { describe, it, expect, vi, afterEach } from 'vitest';
import { SlipResolver } from '../../src/productions/SlipResolver';
import type { ReelStrip, YakuList } from '../../src/data/schemas';

// 中段=pos, 上段=pos+1, 下段=pos-1（Paylines.VERTICAL_OFFSET）。
const strip = (cells: string[]): ReelStrip => ({ id: 'r', cells });
const testRate = { default: 0, rescue: 0, bonus: 0 } as const;

const yakuList = (
  premium: string[][],
  bonus: string[][] = [],
  core: string[][] = [],
): YakuList => ({
  mode: 'test',
  internalRoleMissRate: testRate,
  coreYaku: core.map((s, i) => ({ id: `c${i}`, name: `c${i}`, symbols: s, category: 'core', internalRoleKind: 'core', internalRoleRate: testRate })),
  premiumYaku: premium.map((s, i) => ({ id: `p${i}`, name: `p${i}`, symbols: s, category: 'premium', internalRoleKind: 'big', internalRoleRate: testRate })),
  bonusYaku: bonus.map((s, i) => ({ id: `b${i}`, name: `b${i}`, symbols: s, category: 'bonus', internalRoleKind: 'reg', internalRoleRate: testRate })),
  cherryYaku: [],
});

afterEach(() => vi.restoreAllMocks());

describe('SlipResolver.resolveAssist', () => {
  const r = new SlipResolver(yakuList([['X', 'Y', 'Z']]));

  it('中段に target が来る最小の順方向コマ数を返す', () => {
    // cells: 0=A 1=B 2=T 3=C → basePos0 から middle で T は offset2
    const s = strip(['A', 'B', 'T', 'C', 'D', 'E']);
    expect(r.resolveAssist(s, 0, 'T', 'middle', 4)).toBe(2);
  });

  it('押下位置に既に target があれば 0', () => {
    const s = strip(['T', 'B', 'C', 'D', 'E', 'F']);
    expect(r.resolveAssist(s, 0, 'T', 'middle', 4)).toBe(0);
  });

  it('maxCells 窓の外なら null（補助なし＝自力ミス）', () => {
    // T は offset5 にあり、maxCells=4 では届かない
    const s = strip(['A', 'B', 'C', 'D', 'E', 'T']);
    expect(r.resolveAssist(s, 0, 'T', 'middle', 4)).toBeNull();
  });

  it('maxCells 省略時は options.assistMaxCells（既定4）を使う', () => {
    const s = strip(['A', 'B', 'C', 'D', 'T', 'F']); // offset4
    expect(r.resolveAssist(s, 0, 'T', 'middle')).toBe(4);
    const s2 = strip(['A', 'B', 'C', 'D', 'E', 'T']); // offset5 > 4 → null
    expect(r.resolveAssist(s2, 0, 'T', 'middle')).toBeNull();
  });

  it('options.assistMaxCells を上書きできる', () => {
    const r8 = new SlipResolver(yakuList([['X', 'Y', 'Z']]), { assistMaxCells: 8 });
    const s = strip(['A', 'B', 'C', 'D', 'E', 'T', 'G']); // offset5
    expect(r8.resolveAssist(s, 0, 'T', 'middle')).toBe(5);
  });
});

describe('SlipResolver.resolveKick', () => {
  // 中段一直線で premium(X,Y,Z) が揃いそうな状況を作る。
  // 左(reel0) を X に止めると、中(Y)・右(Z) 停止済みで middle ラインが X,Y,Z に揃う。
  const r = new SlipResolver(yakuList([['X', 'Y', 'Z']]), { kickProbability: 1, kickMaxCells: 2 });
  const ctxBase = {
    reelIndex: 0,
    strip: strip(['X', 'A', 'B', 'C']), // basePos0=X(揃う)、offset1=A(揃わない)
    stoppedVisibles: [
      null,
      { top: 'm', middle: 'Y', bottom: 'm' },
      { top: 'm', middle: 'Z', bottom: 'm' },
    ] as const,
  };

  it('予告外の premium が揃いそうなら順方向に蹴る（確率1で発動）', () => {
    const kick = r.resolveKick({ ...ctxBase, basePosition: 0 });
    expect(kick).toBe(1); // offset1(A) で揃わなくなる
  });

  it('kickProbability=0 なら蹴らない（0）', () => {
    const r0 = new SlipResolver(yakuList([['X', 'Y', 'Z']]), { kickProbability: 0 });
    expect(r0.resolveKick({ ...ctxBase, basePosition: 0 })).toBe(0);
  });

  it('exceptYakuId（予告役）は蹴らない', () => {
    const kick = r.resolveKick({ ...ctxBase, basePosition: 0, exceptYakuId: 'p0' });
    expect(kick).toBe(0);
  });
});

describe('SlipResolver.resolveKick（演出なしの小役蹴り）', () => {
  // core(C,D,E) が中段で揃いそうな状況。premium は関与しない。
  const r = new SlipResolver(yakuList([['X', 'Y', 'Z']], [], [['C', 'D', 'E']]));
  const ctxBase = {
    reelIndex: 0,
    basePosition: 0,
    strip: strip(['C', 'A', 'B', 'F']), // basePos0=C(揃う)、offset1=A(揃わない)
    stoppedVisibles: [
      null,
      { top: 'm', middle: 'D', bottom: 'm' },
      { top: 'm', middle: 'E', bottom: 'm' },
    ] as const,
  };

  it('kickCore なしなら小役は蹴らない（従来どおり素直に止まる）', () => {
    expect(r.resolveKick({ ...ctxBase, kickProbability: 1 })).toBe(0);
  });

  it('kickCore=true なら小役も蹴る（演出なしスピン＝獲れない）', () => {
    const kick = r.resolveKick({
      ...ctxBase,
      kickCore: true,
      kickProbability: 1,
      kickMaxCells: 4,
    });
    expect(kick).toBe(1);
  });

  it('kickProbability を下回れば蹴らない＝たまに揃う', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.9); // 0.9 >= 0.8 → 発動しない
    const kick = r.resolveKick({
      ...ctxBase,
      kickCore: true,
      kickProbability: 0.8,
      kickMaxCells: 4,
    });
    expect(kick).toBe(0);
  });

  it('窓内に「揃わない位置」が無ければ蹴らない（偶発成立）', () => {
    const kick = r.resolveKick({
      ...ctxBase,
      strip: strip(['C', 'C', 'C', 'C']), // どこに止めても C＝揃ってしまう
      kickCore: true,
      kickProbability: 1,
      kickMaxCells: 4,
    });
    expect(kick).toBe(0);
  });
});
