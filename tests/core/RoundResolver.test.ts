import { describe, expect, it } from 'vitest';
import { RoundResolver } from '../../src/core/RoundResolver';
import { PayoutCalc } from '../../src/core/PayoutCalc';
import { YakuJudge } from '../../src/core/YakuJudge';
import { ReachEyes } from '../../src/core/ReachEyes';
import type { Grid3x3 } from '../../src/core/Paylines';
import type { Payout, YakuList } from '../../src/data/schemas';

/**
 * 全停止時の払い出し合成。
 *
 * 単純な足し算に見えて、崩れても気づきにくい規則が入っている：
 *  - 1枚役は倍率非適用・1Gあたり1枚まで（こぼしが美味しくなると連を狙わなくなる）
 *  - 予告役の達成ボーナスは通常配当への**上乗せ**（置き換えではない）
 *  - 連チャン倍率は成立**後**の数で評価（達成スピンから恩恵が乗る）
 * ここが狂うと出玉率だけがじわじわずれる。
 */

const YAKU: YakuList = {
  coreYaku: [
    { id: 'core_a', name: 'あいう', symbols: ['あ', 'い', 'う'], category: 'core' },
    { id: 'core_b', name: 'かきく', symbols: ['か', 'き', 'く'], category: 'core' },
  ],
  premiumYaku: [
    { id: 'prem', name: 'すしや', symbols: ['す', 'し', 'や'], category: 'premium' },
  ],
  bonusYaku: [
    { id: 'reg', name: 'すしだ', symbols: ['す', 'し', 'だ'], category: 'bonus' },
  ],
  cherryYaku: [
    { id: 'cherry', name: 'もも', symbols: ['も', 'も'], category: 'cherry' },
  ],
  singleYaku: [
    { id: 'one', name: 'とふん', symbols: ['と', 'ふ', 'ん'], category: 'single' },
  ],
  internalRoles: [],
} as unknown as YakuList;

const PAYOUT: Payout = {
  betPerSpin: 3,
  baseMultiplier: { core: 5, premium: 34, bonus: 14, cherry: 4, single: 1 },
  bonusZoneMultiplier: 2.2,
  initialCoins: 0,
  streakTiers: [
    { minStreak: 2, mult: 1.25 },
    { minStreak: 3, mult: 1.5 },
  ],
  maxComboMultiplier: 4.5,
  aimBonusMultiplier: 1.5,
  bitaMultiplier: 2,
} as unknown as Payout;

const resolver = new RoundResolver({
  judge: new YakuJudge(YAKU),
  calc: new PayoutCalc(PAYOUT),
  reachEyes: new ReachEyes(null, YAKU),
  singlePayout: PAYOUT.baseMultiplier.single,
  bitaMultiplier: PAYOUT.bitaMultiplier,
});

/** 中段だけに役を並べ、上下はどの役にもならない文字で埋めたグリッド。 */
const middleOnly = (a: string, b: string, c: string): Grid3x3 => [
  ['ぬ', 'ぬ', 'ぬ'],
  [a, b, c],
  ['ぬ', 'ぬ', 'ぬ'],
];

/** 既定は「引き込みに助けられた」状態。ビタ押しの検証は slipCells を明示する。 */
const resolve = (grid: Grid3x3, flags: string[], opts: Partial<{
  bonusActive: boolean;
  streakBefore: number;
  noticeYakuId: string | null;
  slipCells: number[];
}> = {}) =>
  resolver.resolve({
    grid,
    flagYakuIds: flags,
    bonusActive: opts.bonusActive ?? false,
    streakBefore: opts.streakBefore ?? 0,
    noticeYakuId: opts.noticeYakuId ?? null,
    slipCells: opts.slipCells ?? [1, 1, 1],
  });

describe('RoundResolver', () => {
  it('内部役と一致しない出目は成立させない（出目＝フラグ）', () => {
    const r = resolve(middleOnly('あ', 'い', 'う'), []);
    expect(r.hits).toHaveLength(0);
    expect(r.win).toBe(0);
    expect(r.streakAfter).toBe(0);
  });

  it('通常役の払い出しは base のみ', () => {
    const r = resolve(middleOnly('あ', 'い', 'う'), ['core_a']);
    expect(r.willHit).toBe(true);
    expect(r).toMatchObject({ base: 5, singleWin: 0, noticeBonus: 0, win: 5 });
  });

  it('1枚役は倍率を掛けず、連チャンにも乗せない', () => {
    const r = resolve(middleOnly('と', 'ふ', 'ん'), ['one'], {
      bonusActive: true,
      streakBefore: 10,
    });
    expect(r.singleHits).toHaveLength(1);
    expect(r.hits).toHaveLength(0);
    // ボーナス中でも連チャン中でも固定1枚。連チャンは伸びない（willHit=false）。
    expect(r).toMatchObject({ win: 1, singleWin: 1, base: 0, willHit: false });
    expect(r.streakAfter).toBe(0);
  });

  it('連チャン倍率は成立後の数で評価する', () => {
    // streakBefore=1 → このゲームで2連目 → 1.25倍
    const r = resolve(middleOnly('あ', 'い', 'う'), ['core_a'], {
      streakBefore: 1,
    });
    expect(r.streakAfter).toBe(2);
    expect(r.streakMult).toBe(1.25);
    expect(r.win).toBe(Math.floor(5 * 1.25)); // 6
  });

  it('ボーナス倍率と連チャン倍率は積算し、上限で頭打ちになる', () => {
    const r = resolve(middleOnly('あ', 'い', 'う'), ['core_a'], {
      bonusActive: true,
      streakBefore: 2, // 3連 → 1.5倍
    });
    // 2.2 × 1.5 = 3.3（上限4.5未満なのでそのまま）
    expect(r.win).toBe(Math.floor(5 * 3.3));
  });

  it('予告役の的中は通常配当への上乗せ（置き換えではない）', () => {
    const r = resolve(middleOnly('あ', 'い', 'う'), ['core_a'], {
      noticeYakuId: 'core_a',
    });
    expect(r.base).toBe(5);
    expect(r.noticeBonus).toBe(Math.floor(5 * 0.5)); // 2
    expect(r.win).toBe(7);
  });

  it('予告役が外れたら上乗せは付かない', () => {
    const r = resolve(middleOnly('あ', 'い', 'う'), ['core_a'], {
      noticeYakuId: 'core_b',
    });
    expect(r.noticeBonus).toBe(0);
    expect(r.win).toBe(5);
  });

  it('プレミアム成立はBIG、レギュラー役はREGとして返す', () => {
    const big = resolve(middleOnly('す', 'し', 'や'), ['prem']);
    expect(big).toMatchObject({ isPremium: true, isRegular: false });
    expect(big.premiumHit?.yaku.id).toBe('prem');

    const reg = resolve(middleOnly('す', 'し', 'だ'), ['reg']);
    expect(reg).toMatchObject({ isPremium: false, isRegular: true });
    expect(reg.bonusHit?.yaku.id).toBe('reg');
  });

  it('チェリー成立を重複抽選の契機として返す', () => {
    const r = resolve(middleOnly('も', 'も', 'ぬ'), ['cherry']);
    expect(r.cherryHit).toBe(true);
    expect(r.win).toBe(4);
  });

  it('何か揃っている時はリーチ目を判定しない', () => {
    const r = resolve(middleOnly('あ', 'い', 'う'), ['core_a']);
    expect(r.reachKind).toBeNull();
  });

  describe('ビタ押し（引き込みなし＝完全自力）', () => {
    it('必要なリールを全部自力で止めたらボーナスが付く', () => {
      const r = resolve(middleOnly('あ', 'い', 'う'), ['core_a'], {
        slipCells: [0, 0, 0],
      });
      expect(r.bitaPerfect).toBe(true);
      expect(r).toMatchObject({ base: 5, bitaBonus: 5, win: 10 }); // ×2 の上乗せ分
    });

    it('1本でも助けられたら付かない', () => {
      const r = resolve(middleOnly('あ', 'い', 'う'), ['core_a'], {
        slipCells: [0, 1, 0],
      });
      expect(r).toMatchObject({
        bitaPerfect: false,
        bitaBonus: 0,
        win: 5,
        selfStoppedReels: 2,
        requiredReels: 3,
      });
    });

    it('チェリー（2文字役）は右リールを要求しない', () => {
      // 右が滑っていてもチェリーの成立には無関係なのでビタ成立
      const r = resolve(middleOnly('も', 'も', 'ぬ'), ['cherry'], {
        slipCells: [0, 0, 3],
      });
      expect(r).toMatchObject({
        requiredReels: 2,
        selfStoppedReels: 2,
        bitaPerfect: true,
      });
      expect(r.bitaBonus).toBe(4); // base 4 の×2上乗せ分
    });

    it('ハズレではビタ押しにならない', () => {
      const r = resolve(middleOnly('あ', 'い', 'う'), [], {
        slipCells: [0, 0, 0],
      });
      expect(r).toMatchObject({
        bitaPerfect: false,
        bitaBonus: 0,
        requiredReels: 0,
      });
    });

    it('ボーナス倍率・連チャン倍率が乗った配当に対して上乗せされる', () => {
      const r = resolve(middleOnly('あ', 'い', 'う'), ['core_a'], {
        slipCells: [0, 0, 0],
        bonusActive: true,
        streakBefore: 2, // 3連 → 1.5倍
      });
      const base = Math.floor(5 * 2.2 * 1.5); // 16
      expect(r.base).toBe(base);
      expect(r.bitaBonus).toBe(base); // ×2 の上乗せ分
      expect(r.win).toBe(base * 2);
    });
  });
});
