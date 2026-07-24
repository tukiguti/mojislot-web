import { describe, it, expect, vi, afterEach } from 'vitest';
import { SlipResolver } from '../../src/productions/SlipResolver';
import type { ReelStrip, YakuList } from '../../src/data/schemas';

// 中段=pos, 上段=pos+1, 下段=pos-1（Paylines.VERTICAL_OFFSET）。
const strip = (cells: string[]): ReelStrip => ({ id: 'r', cells });

const yakuList = (
  premium: string[][],
  bonus: string[][] = [],
  core: string[][] = [],
  cherry: string[][] = [],
): YakuList => ({
  mode: 'test',
  coreYaku: core.map((s, i) => ({ id: `c${i}`, name: `c${i}`, symbols: s, category: 'core' })),
  premiumYaku: premium.map((s, i) => ({ id: `p${i}`, name: `p${i}`, symbols: s, category: 'premium' })),
  bonusYaku: bonus.map((s, i) => ({ id: `b${i}`, name: `b${i}`, symbols: s, category: 'bonus' })),
  cherryYaku: cherry.map((s, i) => ({ id: `ch${i}`, name: `ch${i}`, symbols: s, category: 'cherry' })),
  singleYaku: [],
  // 蹴りの検証では抽選しないので、内部役はハズレ1件だけ置く（スキーマ上の合計＝1）。
  internalRoles: [
    { id: 'miss', kind: 'miss', displayYakuId: null, pressOrder: null, rate: { default: 1, rescue: 1, bonus: 1 } },
  ],
});

afterEach(() => vi.restoreAllMocks());

describe('SlipResolver.resolveAssist', () => {
  const r = new SlipResolver(yakuList([['X', 'Y', 'Z']]));
  // 他リール未停止＝引き込みガードのロック判定は自リールのみで評価される。
  const ctx = (cells: string[], basePosition = 0) => ({
    reelIndex: 0,
    basePosition,
    strip: strip(cells),
    stoppedVisibles: [null, null, null] as const,
    exceptYakuIds: ['p0'],
  });

  it('中段に target が来る最小の順方向コマ数を返す', () => {
    // cells: 0=A 1=B 2=T 3=C → basePos0 から middle で T は offset2
    expect(r.resolveAssist(ctx(['A', 'B', 'T', 'C', 'D', 'E']), 'T', 'middle', 4)).toBe(2);
  });

  it('押下位置に既に target があれば 0', () => {
    expect(r.resolveAssist(ctx(['T', 'B', 'C', 'D', 'E', 'F']), 'T', 'middle', 4)).toBe(0);
  });

  it('maxCells 窓の外なら null（補助なし＝自力ミス）', () => {
    // T は offset5 にあり、maxCells=4 では届かない
    expect(r.resolveAssist(ctx(['A', 'B', 'C', 'D', 'E', 'T']), 'T', 'middle', 4)).toBeNull();
  });

  it('maxCells 省略時は options.assistMaxCells（既定4）を使う', () => {
    expect(r.resolveAssist(ctx(['A', 'B', 'C', 'D', 'T', 'F']), 'T', 'middle')).toBe(4); // offset4
    expect(r.resolveAssist(ctx(['A', 'B', 'C', 'D', 'E', 'T']), 'T', 'middle')).toBeNull(); // offset5 > 4
  });

  it('options.assistMaxCells を上書きできる', () => {
    const r8 = new SlipResolver(yakuList([['X', 'Y', 'Z']]), { assistMaxCells: 8 });
    expect(r8.resolveAssist(ctx(['A', 'B', 'C', 'D', 'E', 'T', 'G']), 'T', 'middle')).toBe(5);
  });

  it('非当選役がロックする引き込み位置はスキップし、次のクリーン位置を選ぶ', () => {
    // 当選役 p0(X,Y,Z) の X を中リール(reel1)…ではなく簡潔に reel0 で検証：
    // 非当選役 c0(C,D,E) が完成してしまう位置は飛ばす。
    // reel1/reel2 停止済み: 中段 D,E ＝ reel0 の中段が C になると c0 がロック。
    // cells: offset1 の位置で middle=T だが top/bottom は関係なし。C が middle に来る offset は除外。
    const rc = new SlipResolver(yakuList([['X', 'Y', 'Z']], [], [['C', 'D', 'E']]));
    const c = {
      reelIndex: 0,
      basePosition: 0,
      // pos0: mid=C（c0ロック→スキップ）/ pos1: mid=T（クリーン→採用）
      strip: strip(['C', 'T', 'A', 'B', 'F', 'G']),
      stoppedVisibles: [
        null,
        { top: 'm', middle: 'D', bottom: 'm' },
        { top: 'm', middle: 'E', bottom: 'm' },
      ] as const,
      exceptYakuIds: ['p0'],
    };
    // target 'C' を頼んでも pos0 は非当選役 c0 がロックするため選ばれない
    expect(rc.resolveAssist(c, 'C', 'middle', 4)).toBeNull();
    // target 'T' は pos1 がクリーンなのでそのまま
    expect(rc.resolveAssist(c, 'T', 'middle', 4)).toBe(1);
  });
});

describe('SlipResolver.resolveKick（テーブル制御：決定的・全非当選役）', () => {
  // 中段一直線で premium(X,Y,Z) が揃いそうな状況を作る。
  // 左(reel0) を X に止めると、中(Y)・右(Z) 停止済みで middle ラインが X,Y,Z に揃う。
  const r = new SlipResolver(yakuList([['X', 'Y', 'Z']]));
  const ctxBase = {
    reelIndex: 0,
    strip: strip(['X', 'A', 'B', 'C']), // basePos0=X(揃う)、offset1=A(揃わない)
    stoppedVisibles: [
      null,
      { top: 'm', middle: 'Y', bottom: 'm' },
      { top: 'm', middle: 'Z', bottom: 'm' },
    ] as const,
  };

  it('非当選役が揃いそうなら順方向に決定的に蹴る（確率抽選は無い）', () => {
    // 何度呼んでも同じ結果（決定的）。
    for (let i = 0; i < 5; i++) {
      expect(r.resolveKick({ ...ctxBase, basePosition: 0 })).toBe(1);
    }
  });

  it('exceptYakuIds（当選役）は蹴らない＝出目に出てよい', () => {
    const kick = r.resolveKick({ ...ctxBase, basePosition: 0, exceptYakuIds: ['p0'] });
    expect(kick).toBe(0);
  });

  it('押下位置で非当選役が揃わないならそのまま止める（0）', () => {
    // basePos1: middle=A で揃わない → 蹴り不要。
    expect(r.resolveKick({ ...ctxBase, basePosition: 1 })).toBe(0);
  });

  it('小役(core)も蹴る＝全役が蹴り対象（演出の有無に依らない）', () => {
    const rc = new SlipResolver(yakuList([['X', 'Y', 'Z']], [], [['C', 'D', 'E']]));
    const kick = rc.resolveKick({
      reelIndex: 0,
      basePosition: 0,
      strip: strip(['C', 'A', 'B', 'F']), // base=C(core揃う)、offset1=A(揃わない)
      stoppedVisibles: [
        null,
        { top: 'm', middle: 'D', bottom: 'm' },
        { top: 'm', middle: 'E', bottom: 'm' },
      ],
    });
    expect(kick).toBe(1);
  });

  it('チェリー(2文字役・左+中)も蹴る＝偶発の左+中揃いを避ける', () => {
    // reel1(中)を停止。左は既に P。中で Q を止めると左+中でチェリー成立。
    const rch = new SlipResolver(yakuList([['X', 'Y', 'Z']], [], [], [['P', 'Q']]));
    const kick = rch.resolveKick({
      reelIndex: 1,
      basePosition: 0,
      strip: strip(['Q', 'A', 'B', 'C']), // base=Q(cherry成立)、offset1=A(回避)
      stoppedVisibles: [
        { top: 'x', middle: 'P', bottom: 'x' },
        null,
        null,
      ],
    });
    expect(kick).toBe(1);
  });

  it('当選役が押下位置で自力成立していれば、それを壊さない位置へ蹴る', () => {
    // premium(X,Y,Z)=当選役が中段で成立、かつ core(C,D,E)=非当選役が上段で偶発成立。
    // 当選役を保ったまま core だけ外れる位置(offset2)へ蹴る。
    const rp = new SlipResolver(yakuList([['X', 'Y', 'Z']], [], [['C', 'D', 'E']]));
    const kick = rp.resolveKick({
      reelIndex: 0,
      basePosition: 0,
      // mid=cells[pos] / top=cells[pos+1] / bottom=cells[pos-1]
      // pos0: mid=X(premium✓) top=C(core✓・非当選) → 蹴りたい
      // pos1: mid=C(premium×) → 当選役が消える
      // pos2: mid=X(premium✓) top=G(core×) → 当選役を保ってクリーン
      strip: strip(['X', 'C', 'X', 'G', 'H', 'I']),
      stoppedVisibles: [
        null,
        { top: 'D', middle: 'Y', bottom: 'm' },
        { top: 'E', middle: 'Z', bottom: 'm' },
      ],
      exceptYakuIds: ['p0'],
    });
    expect(kick).toBe(2);
  });

  it('窓内に「非当選役が揃わない位置」が無ければ蹴らない（配列不足時のフォールバック）', () => {
    const rc = new SlipResolver(yakuList([['X', 'Y', 'Z']], [], [['C', 'D', 'E']]));
    const kick = rc.resolveKick({
      reelIndex: 0,
      basePosition: 0,
      strip: strip(['C', 'C', 'C', 'C', 'C']), // どこに止めても中段C＝core揃い
      stoppedVisibles: [
        null,
        { top: 'm', middle: 'D', bottom: 'm' },
        { top: 'm', middle: 'E', bottom: 'm' },
      ],
    });
    expect(kick).toBe(0);
  });
});
