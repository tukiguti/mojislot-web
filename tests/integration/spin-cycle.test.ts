import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  PayoutSchema,
  ReelConfigSchema,
  StopTableSchema,
  TuningSchema,
  YakuListSchema,
  type Yaku,
} from '../../src/data/schemas';
import { CoinWallet } from '../../src/core/CoinWallet';
import { PayoutCalc } from '../../src/core/PayoutCalc';
import { YakuJudge } from '../../src/core/YakuJudge';
import { ReachEyes } from '../../src/core/ReachEyes';
import { RoundResolver } from '../../src/core/RoundResolver';
import { StopController } from '../../src/core/StopController';
import { StopTableLookup } from '../../src/core/StopTable';
import { SlipResolver, type VisibleColumn } from '../../src/productions/SlipResolver';
import { TenpaiDetector } from '../../src/productions/TenpaiDetector';
import { BonusZone } from '../../src/productions/BonusZone';
import { BonusSession } from '../../src/productions/BonusSession';
import { primaryRowOf, visibleAt, type Grid3x3 } from '../../src/core/Paylines';

/**
 * BET → レバー → 3リール停止 → 配当 → ボーナス突入 → 消化 → 終了リザルト
 * までを1本のゲームループとして通す統合テスト。
 *
 * 単体テストは各クラスの中身を保証するが、**それらを繋ぐ順序**は保証しない。
 * 実際このセッションだけでも「残数消費を配当判定より先にやると最終ゲームが
 * ボーナス扱いから外れる」「突入ゲームの払い出しを二重に数える」といった
 * 配線のミスが起こり得た。ここはその配線を固定するためのテスト。
 *
 * main.ts は Pixi と DOM に依存していて node では動かないので、main.ts が
 * 組み立てているのと**同じ実クラス・同じ順序**をここで再現する。
 */

const DIR = dirname(fileURLToPath(import.meta.url));
const DATA = resolve(DIR, '../../data');
const readJson = (p: string) => JSON.parse(readFileSync(p, 'utf-8'));

const CHAPTER = 'hiragana_food';
const yakuList = YakuListSchema.parse(readJson(`${DATA}/yaku/${CHAPTER}.json`));
const reelCfg = ReelConfigSchema.parse(readJson(`${DATA}/reels/${CHAPTER}.json`));
const payout = PayoutSchema.parse(readJson(`${DATA}/payouts/default.json`));
const tuning = TuningSchema.parse(readJson(`${DATA}/tuning/default.json`));
const stopTable = StopTableSchema.parse(readJson(`${DATA}/stops/${CHAPTER}.json`));

/** main.ts と同じ組み立て。ここが実物と食い違うとテストの意味が無くなる。 */
function newGame() {
  const calc = new PayoutCalc(payout);
  const judge = new YakuJudge(yakuList);
  const reachEyes = new ReachEyes(null, yakuList);
  const stopController = new StopController({
    yakuList,
    slipResolver: new SlipResolver(yakuList, {
      assistMaxCells: tuning.assist.pullInCells,
    }),
    tenpaiDetector: new TenpaiDetector(yakuList),
    stopTable: new StopTableLookup(stopTable),
    pullInCells: tuning.assist.pullInCells,
  });
  const roundResolver = new RoundResolver({
    judge,
    calc,
    reachEyes,
    singlePayout: payout.baseMultiplier.single,
    bitaMultiplier: payout.bitaMultiplier,
  });
  const zone = new BonusZone({
    spinsPerBonus: tuning.bonus.spinsPerBig,
    spinsPerReg: tuning.bonus.spinsPerReg,
    bonusEffectRates: tuning.effectRates.bonus,
  });
  const session = new BonusSession(zone);
  const wallet = new CoinWallet(0);
  wallet.lend(1000);
  return { calc, roundResolver, stopController, zone, session, wallet };
}

type Game = ReturnType<typeof newGame>;

const strips = reelCfg.reels.map((r, i) => ({ id: `r${i}`, cells: r.cells }));
const CELLS = strips[0].cells.length;
/** 押下位置の探索で出目を判定するための判定器（ゲーム状態には触らない）。 */
const judge = new YakuJudge(yakuList);

const findYaku = (id: string): Yaku =>
  [
    ...yakuList.coreYaku,
    ...yakuList.premiumYaku,
    ...yakuList.bonusYaku,
    ...yakuList.cherryYaku,
    ...yakuList.singleYaku,
  ].find((y) => y.id === id)!;

/**
 * **主ライン上**が sym になる押下位置をすべて返す。
 * 中段固定にすると、主ラインが斜めの時に狙うはずのない位置を押すことになる。
 */
const posForMiddle = (reel: number, sym: string): number[] => {
  const row = primaryRowOf(reel);
  const found: number[] = [];
  for (let p = 0; p < CELLS; p++) {
    if (visibleAt(strips[reel].cells, p, row) === sym) found.push(p);
  }
  if (found.length === 0) throw new Error(`リール${reel}に「${sym}」が無い`);
  return found;
};

/**
 * その役が**実際に揃う**押下位置を探す。
 *
 * 主ラインに図柄が来る位置で押しても、そこで別の役（1枚役など）が他のラインに
 * 揃ってしまうと蹴りが働いて当選役を逃す。狙って揃う割合は7〜9割なので、
 * 「主ラインに来る位置なら必ず揃う」を前提にするとテストが配列依存で落ちる。
 * ここでは候補を総当たりして、成立する組み合わせを1つ選ぶ。
 */
function pressThatHits(g: Game, yakuId: string, flagKey: string): number[] {
  const y = findYaku(yakuId);
  const cands = y.symbols.map((s, i) => posForMiddle(i, s));
  for (const p0 of cands[0]) {
    for (const p1 of cands[1] ?? [0]) {
      for (const p2 of cands[2] ?? [0]) {
        const press = [p0, p1, p2];
        // 状態を汚さずに出目だけ作る（BET も払い出しもしない）
        const stopped: (VisibleColumn | null)[] = [null, null, null];
        for (let reel = 0; reel < 3; reel++) {
          const slip = g.stopController.resolveSlip({
            reelIndex: reel,
            basePosition: press[reel],
            strip: strips[reel],
            stoppedVisibles: stopped,
            flagYakuIds: [yakuId],
            flagKey,
          });
          const pos = (press[reel] + slip) % CELLS;
          stopped[reel] = {
            top: visibleAt(strips[reel].cells, pos, 'top'),
            middle: visibleAt(strips[reel].cells, pos, 'middle'),
            bottom: visibleAt(strips[reel].cells, pos, 'bottom'),
          };
        }
        const s = stopped as VisibleColumn[];
        const grid: Grid3x3 = [
          [s[0].top, s[1].top, s[2].top],
          [s[0].middle, s[1].middle, s[2].middle],
          [s[0].bottom, s[1].bottom, s[2].bottom],
        ];
        if (judge.judgeAll(grid).hits.some((h) => h.yaku.id === yakuId)) return press;
      }
    }
  }
  throw new Error(`${yakuId} が揃う押下位置が見つからない（配列の到達性を疑うこと）`);
}

interface SpinOptions {
  /** 出目に出てよい役ID（miss は空配列）。 */
  flagYakuIds: string[];
  /** 停止テーブルを引くキー（内部役ID）。 */
  flagKey: string | null;
  /** 各リールの押下位置。省略時は当選役の中段を狙う。 */
  press?: number[];
}

/**
 * 1ゲームを最後まで進める。main.ts の placeBet → pullLever → stopReel×3 →
 * 全停止判定 → BonusSession.settle と**同じ順序**で呼ぶ。
 */
function playSpin(g: Game, opts: SpinOptions) {
  // --- BET ---
  const ok = g.wallet.bet(g.calc.bet);
  expect(ok, 'BETできる残高がある').toBe(true);
  g.session.beginSpin();

  // --- 停止（順押し）---
  const stopped: (VisibleColumn | null)[] = [null, null, null];
  const slipCells = [0, 0, 0];
  for (let reel = 0; reel < 3; reel++) {
    const basePosition = opts.press?.[reel] ?? 0;
    const slip = g.stopController.resolveSlip({
      reelIndex: reel,
      basePosition,
      strip: strips[reel],
      stoppedVisibles: stopped,
      flagYakuIds: opts.flagYakuIds,
      flagKey: opts.flagKey,
    });
    slipCells[reel] = slip;
    const pos = (basePosition + slip) % CELLS;
    stopped[reel] = {
      top: visibleAt(strips[reel].cells, pos, 'top'),
      middle: visibleAt(strips[reel].cells, pos, 'middle'),
      bottom: visibleAt(strips[reel].cells, pos, 'bottom'),
    };
  }

  // --- 全停止判定 ---
  const grid: Grid3x3 = [
    [stopped[0]!.top, stopped[1]!.top, stopped[2]!.top],
    [stopped[0]!.middle, stopped[1]!.middle, stopped[2]!.middle],
    [stopped[0]!.bottom, stopped[1]!.bottom, stopped[2]!.bottom],
  ];
  const outcome = g.roundResolver.resolve({
    grid,
    flagYakuIds: opts.flagYakuIds,
    bonusActive: g.session.spinActive,
    streakBefore: 0,
    noticeYakuId: null,
    slipCells,
  });
  if (outcome.win > 0) g.wallet.win(outcome.win);

  // --- ボーナス突入（払い出し確定後）---
  let entry = null;
  if (outcome.isPremium) entry = g.session.enter('big');
  else if (outcome.isRegular) entry = g.session.enter('reg');

  // --- 締め（残数消費・獲得集計・終了判定は最後）---
  const runEnd = g.session.settle(outcome.win);
  g.session.resetSpin();
  return { outcome, entry, runEnd, grid, slipCells };
}

/** 当選役をそのまま狙って1ゲーム回す（実際に揃う押下位置を選ぶ）。 */
const spinAiming = (g: Game, yakuId: string, flagKey: string) =>
  playSpin(g, {
    flagYakuIds: [yakuId],
    flagKey,
    press: pressThatHits(g, yakuId, flagKey),
  });

/**
 * 通しの検証に使う代表の小役。役IDを直書きすると章を作り直すたびにテストが落ちるので
 * 「1番目の小役」で参照する（寿司島への差し替えで budou が消えて実際に落ちた）。
 */
const CORE = yakuList.coreYaku[0].id;

describe('1ゲームの通し（BET→停止→配当→ボーナス）', () => {
  it('BETでコインが減り、成立した分だけ増える', () => {
    const g = newGame();
    const before = g.wallet.coins.get();
    const { outcome } = spinAiming(g, CORE, CORE);
    expect(outcome.willHit, '小役を狙って揃う').toBe(true);
    expect(g.wallet.coins.get()).toBe(before - g.calc.bet + outcome.win);
  });

  it('ハズレでは出目が揃わず、コインはBET分だけ減る', () => {
    const g = newGame();
    const before = g.wallet.coins.get();
    // miss フラグ（flagYakuIds が空）＝全役が蹴りの対象
    const { outcome } = playSpin(g, {
      flagYakuIds: [],
      flagKey: 'miss',
      press: [0, 0, 0],
    });
    expect(outcome.hits).toHaveLength(0);
    expect(outcome.win).toBe(0);
    expect(g.wallet.coins.get()).toBe(before - g.calc.bet);
  });

  it('BIG成立で突入し、規定ゲーム数を消化しきると終了リザルトが出る', () => {
    const g = newGame();
    const big = yakuList.premiumYaku[0];
    const bigRole = yakuList.internalRoles.find(
      (r) => r.displayYakuId === big.id && !r.freeze,
    )!;

    const first = spinAiming(g, big.id, bigRole.id);
    expect(first.outcome.isPremium, 'BIG役が揃う').toBe(true);
    expect(first.entry).toMatchObject({ isAddition: false });
    expect(first.runEnd, '突入ゲームでは終了しない').toBeNull();
    expect(g.zone.isActive()).toBe(true);
    expect(g.zone.remaining.get()).toBe(tuning.bonus.spinsPerBig);

    // 消化：規定ゲーム数ぶん回すと、最後の1回で終了リザルトが返る
    let end = null;
    let bonusWin = 0;
    for (let i = 0; i < tuning.bonus.spinsPerBig; i++) {
      expect(end, `${i}G目でまだ終わっていない`).toBeNull();
      const r = spinAiming(g, CORE, CORE);
      bonusWin += r.outcome.win;
      end = r.runEnd;
    }
    expect(end).not.toBeNull();
    expect(end!.kind).toBe('big');
    // 突入役の払い出しは区間の獲得に含めない＝消化中の合計と一致する
    expect(end!.payout).toBe(bonusWin);
    expect(g.zone.isActive()).toBe(false);
  });

  it('ボーナス中は最終ゲームまで配当倍率が乗る', () => {
    const g = newGame();
    // **最安小役では検証できない。** 3枚 × 倍率1.25 = 3.75 は切り捨てで3枚のまま
    // （倍率は補助で、ボーナス中の恩恵は毎ゲーム当選と小役当選率1.9倍が主）。
    // 倍率が実際に効くのは枚数の大きい小役なので、そちらで見る。
    const rich = yakuList.coreYaku[yakuList.coreYaku.length - 1].id;
    const normal = spinAiming(g, rich, rich).outcome.win;

    const big = yakuList.premiumYaku[0];
    const bigRole = yakuList.internalRoles.find(
      (r) => r.displayYakuId === big.id && !r.freeze,
    )!;
    spinAiming(g, big.id, bigRole.id);

    const wins: number[] = [];
    for (let i = 0; i < tuning.bonus.spinsPerBig; i++) {
      wins.push(spinAiming(g, rich, rich).outcome.win);
    }
    // 残り1Gになる最終ゲームも含め、全ゲームが通常時より多い
    expect(wins).toHaveLength(tuning.bonus.spinsPerBig);
    for (const [i, w] of wins.entries()) {
      expect(w, `${i + 1}G目もボーナス倍率が乗る`).toBeGreaterThan(normal);
    }
  });

  it('ボーナス中の再当選は上乗せになり、区間の獲得は途切れない', () => {
    const g = newGame();
    const big = yakuList.premiumYaku[0];
    const bigRole = yakuList.internalRoles.find(
      (r) => r.displayYakuId === big.id && !r.freeze,
    )!;

    spinAiming(g, big.id, bigRole.id); // 突入
    const add = spinAiming(g, big.id, bigRole.id); // 消化中の再当選
    expect(add.entry).toMatchObject({ isAddition: true });
    // 上乗せぶん残数が増える（消化した1Gを差し引いても増えている）
    expect(g.zone.remaining.get()).toBe(tuning.bonus.spinsPerBig * 2 - 1);

    // おかわりゲームの払い出しは（突入ゲームではないので）区間の獲得に入る
    let end = null;
    let rest = 0;
    while (end === null) {
      const r = spinAiming(g, CORE, CORE);
      rest += r.outcome.win;
      end = r.runEnd;
    }
    expect(end!.payout).toBe(add.outcome.win + rest);
  });

  it('ビタ押し（引き込みなし）で狙うと上乗せが付く', () => {
    const g = newGame();
    const r = spinAiming(g, CORE, CORE);
    // 中段をピタリと狙っているので引き込みは不要
    expect(r.slipCells).toEqual([0, 0, 0]);
    expect(r.outcome.bitaPerfect).toBe(true);
    expect(r.outcome.bitaBonus).toBeGreaterThan(0);
    expect(r.outcome.win).toBe(r.outcome.base + r.outcome.bitaBonus);
  });

  it('狙いを外すと引き込みで揃うが、ビタ押しは付かない', () => {
    const g = newGame();
    // 各リールを「揃う押下位置」の2コマ手前で押す＝引き込みに助けてもらう
    const press = pressThatHits(g, CORE, CORE).map(
      (p) => (p - 2 + CELLS) % CELLS,
    );
    const r = playSpin(g, { flagYakuIds: [CORE], flagKey: CORE, press });
    expect(r.outcome.willHit, '引き込みで揃う').toBe(true);
    expect(r.slipCells.some((n) => n > 0), '引き込みが働いた').toBe(true);
    expect(r.outcome.bitaPerfect).toBe(false);
    expect(r.outcome.bitaBonus).toBe(0);
  });

  it('残高が尽きたらBETできない', () => {
    const g = newGame();
    g.wallet.reset(g.calc.bet - 1);
    expect(g.wallet.bet(g.calc.bet)).toBe(false);
  });
});
