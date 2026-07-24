import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  SlipResolver,
  type VisibleColumn,
} from '../../src/productions/SlipResolver';
import { TenpaiDetector, type TenpaiLine } from '../../src/productions/TenpaiDetector';
import {
  InternalRoleLottery,
  pressOrderSatisfied,
} from '../../src/productions/InternalRoleLottery';
import { YakuJudge } from '../../src/core/YakuJudge';
import { PayoutCalc } from '../../src/core/PayoutCalc';
import { resolveInternalRoleHits } from '../../src/core/RoleResolver';
import { PAYLINES, type Grid3x3, type Vertical } from '../../src/core/Paylines';
import {
  PayoutSchema,
  TuningSchema,
  YakuListSchema,
  ReelConfigSchema,
  type Payout,
  type Tuning,
  type Yaku,
  type YakuList,
  type ShisaTier,
  type InternalRoleState,
} from '../../src/data/schemas';

/**
 * 出玉シミュレーター（フェーズC）。
 * 本番のクラス（内部役抽選 / 引き込み・蹴り / テンパイ検出 / 役判定 / 配当）をそのまま使い、
 * main.ts の停止制御・払い出し組み立てだけを移植して1万G単位で回す。
 *
 * 実行: SIM=1 npx vitest run tests/sim/payout-sim.test.ts
 * 通常の npm test では skip される（重いため）。
 */

const RUN = process.env.SIM === '1';
const DIR = dirname(fileURLToPath(import.meta.url));
const DATA = resolve(DIR, '../../data');
const readJson = (p: string) => JSON.parse(readFileSync(p, 'utf-8'));

const CHAPTERS = [
  'hiragana_food',
  'hiragana_verb',
  'katakana_animal',
  'security',
  'yasai',
] as const;

/** 決定的な擬似乱数（結果の再現性のため） */
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

interface Skill {
  name: string;
  /** 押下タイミング誤差の標準偏差（ms） */
  sigmaMs: number;
  /** 押し順ナビに従える確率 */
  naviFollow: number;
}

// 押し順ナビは「どのリールを先に止めるか」を明示するだけで目押し精度を要さないため、
// 初心者でも大半は従える前提に置く（従えない分は取りこぼして1枚役へ落ちる）。
const SKILLS: Skill[] = [
  { name: '初心者', sigmaMs: 100, naviFollow: 0.75 },
  { name: '中級', sigmaMs: 50, naviFollow: 0.92 },
  { name: '上級', sigmaMs: 25, naviFollow: 1.0 },
  { name: '神', sigmaMs: 10, naviFollow: 1.0 },
];

const VERTICALS: readonly Vertical[] = ['top', 'middle', 'bottom'];

function visCol(cells: readonly string[], pos: number): VisibleColumn {
  const n = cells.length;
  return {
    top: cells[(pos + 1) % n],
    middle: cells[pos],
    bottom: cells[((pos - 1) % n + n) % n],
  };
}

function buildGrid(cols: readonly VisibleColumn[]): Grid3x3 {
  return [
    [cols[0].top, cols[1].top, cols[2].top],
    [cols[0].middle, cols[1].middle, cols[2].middle],
    [cols[0].bottom, cols[1].bottom, cols[2].bottom],
  ];
}

interface Result {
  spins: number;
  totalBet: number;
  totalWin: number;
  /** 通常時（ボーナス中以外）だけの投入・払い出し */
  normalBet: number;
  normalWin: number;
  big: number;
  reg: number;
  bonusSpins: number;
  bigPayout: number;
  regPayout: number;
  pushRoles: number;
  pushHit: number;
  singleWins: number;
}

function runChapter(chapter: string, skill: Skill, spins: number, seed: number): Result {
  const yakuList: YakuList = YakuListSchema.parse(readJson(`${DATA}/yaku/${chapter}.json`));
  const reelCfg = ReelConfigSchema.parse(readJson(`${DATA}/reels/${chapter}.json`));
  const payout: Payout = PayoutSchema.parse(readJson(`${DATA}/payouts/default.json`));
  const tuning: Tuning = TuningSchema.parse(readJson(`${DATA}/tuning/default.json`));
  const quizzes = readJson(`${DATA}/quizzes/${chapter}.json`).quizzes as {
    answerYakuId: string;
  }[];

  const rng = makeRng(seed);
  const lottery = new InternalRoleLottery(yakuList, rng);
  const slip = new SlipResolver(yakuList, {
    assistMaxCells: tuning.assist.assistMaxCells,
  });
  const tenpaiDetector = new TenpaiDetector(yakuList);
  const judge = new YakuJudge(yakuList);
  const calc = new PayoutCalc(payout);

  const reels = reelCfg.reels.map((r) => r.cells);
  const N = reels[0].length;
  const allYaku: Yaku[] = [
    ...yakuList.coreYaku,
    ...yakuList.cherryYaku,
    ...yakuList.bonusYaku,
    ...yakuList.premiumYaku,
  ];
  const yakuById = new Map(allYaku.map((y) => [y.id, y]));
  const sigmaCells = (skill.sigmaMs * tuning.reelSpeed) / 1000;

  const gauss = (): number => {
    // Box-Muller
    const u = Math.max(rng(), 1e-9);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
  };

  const shisaTiersForYaku = (y: Yaku, bonusActive: boolean): ShisaTier[] => {
    const tiers =
      (bonusActive ? tuning.bonus.shisaTiers : undefined) ?? tuning.assist.shisaTiers;
    if (y.category === 'premium') return tiers.filter((t) => t.premiumCells > 0);
    if (y.category === 'bonus') {
      const regOnly = tiers.filter((t) => t.bonusCells > 0 && t.premiumCells === 0);
      return regOnly.length > 0 ? regOnly : tiers.filter((t) => t.bonusCells > 0);
    }
    return tiers.filter((t) => t.coreCells > 0);
  };

  const eligibleEffects = (y: Yaku, bonusActive: boolean): ('shisa' | 'quiz' | 'aim')[] =>
    (['shisa', 'quiz', 'aim'] as const).filter((e) => {
      if (e === 'shisa') return shisaTiersForYaku(y, bonusActive).length > 0;
      if (e === 'quiz') return quizzes.some((q) => q.answerYakuId === y.id);
      return y.symbols.length === 3;
    });

  const pickWeighted = <T,>(items: readonly T[], w: (t: T) => number): T => {
    const total = items.reduce((s, i) => s + Math.max(0, w(i)), 0);
    if (total <= 0) return items[0];
    let c = rng() * total;
    for (const i of items) {
      c -= Math.max(0, w(i));
      if (c < 0) return i;
    }
    return items[items.length - 1];
  };

  const res: Result = {
    spins: 0, totalBet: 0, totalWin: 0, normalBet: 0, normalWin: 0,
    big: 0, reg: 0, bonusSpins: 0, bigPayout: 0, regPayout: 0,
    pushRoles: 0, pushHit: 0, singleWins: 0,
  };

  let missStreak = 0;
  let streak = 0;
  let bonusRemaining = 0;
  let curBonusKind: 'big' | 'reg' | null = null;
  let curBonusPayout = 0;

  for (let g = 0; g < spins; g++) {
    const bonusActive = bonusRemaining > 0;
    const state: InternalRoleState = bonusActive
      ? 'bonus'
      : missStreak >= tuning.rescueMissThreshold
        ? 'rescue'
        : 'default';
    res.spins++;
    res.totalBet += calc.bet;
    if (bonusActive) res.bonusSpins++;
    else res.normalBet += calc.bet;

    const role = lottery.draw(state);
    const yaku = role.yakuId ? (yakuById.get(role.yakuId) ?? null) : null;
    const rates =
      state === 'bonus'
        ? tuning.effectRates.bonus
        : state === 'rescue'
          ? tuning.effectRates.rescue
          : tuning.effectRates.default;

    let effect: 'none' | 'shisa' | 'quiz' | 'aim' | 'push';
    if (role.pressOrder) {
      effect = 'push';
      res.pushRoles++;
    } else if (yaku) {
      const cands = eligibleEffects(yaku, bonusActive);
      effect = cands.length ? pickWeighted(cands, (e) => rates[e]) : 'none';
    } else {
      effect = 'none';
    }
    const shisaTier =
      effect === 'shisa' && yaku
        ? pickWeighted(shisaTiersForYaku(yaku, bonusActive), (t) => t.weight)
        : null;

    // 押し順（デフォルト順押し／ナビに従えるかは腕）
    let seq = [0, 1, 2];
    if (role.pressOrder && rng() < skill.naviFollow) {
      seq =
        role.pressOrder.type === 'exact'
          ? [...role.pressOrder.order]
          : [role.pressOrder.reel, ...[0, 1, 2].filter((r) => r !== role.pressOrder!.reel)];
    }

    const stopped: (VisibleColumn | null)[] = [null, null, null];
    const stopOrder: number[] = [];
    const isAimLike = effect === 'aim' || effect === 'quiz' || effect === 'push';

    for (const idx of seq) {
      stopOrder.push(idx);
      const flagId = pressOrderSatisfied(role.pressOrder, stopOrder) ? role.yakuId : null;
      const target = flagId ? (yakuById.get(flagId) ?? null) : null;
      const cells = reels[idx];

      // 押下位置：狙う図柄があれば「その図柄が中段に来る位置」を狙い、腕に応じた誤差を乗せる
      let basePos: number;
      const sym = effect !== 'none' && target ? target.symbols[idx] : undefined;
      if (sym === undefined) {
        basePos = Math.floor(rng() * N);
      } else {
        const start = Math.floor(rng() * N);
        let intended = start;
        for (let d = 0; d < N; d++) {
          const p = (start + d) % N;
          if (cells[p] === sym) { intended = p; break; }
        }
        const err = Math.round(gauss() * sigmaCells);
        basePos = (((intended + err) % N) + N) % N;
      }

      // --- resolveStopSlip 相当 ---
      let slipCells = 0;
      const tenpai = tenpaiDetector.detect(stopped);
      if (tenpai && tenpai.missingReelIndex === idx) {
        let bestSlip = 0, bestScore = -1;
        const CAT_RANK: Record<Yaku['category'], number> =
          { premium: 3, bonus: 2, core: 1, cherry: 0 };
        for (const l of tenpai.lines as TenpaiLine[]) {
          if (effect === 'none' || l.yaku.id !== flagId) continue;
          const maxCells = isAimLike
            ? tuning.assist.noticeAssistMaxCells
            : effect === 'shisa' && shisaTier
              ? (l.yaku.category === 'premium'
                  ? shisaTier.premiumCells
                  : l.yaku.category === 'bonus'
                    ? shisaTier.bonusCells
                    : shisaTier.coreCells)
              : tuning.assist.assistMaxCells;
          if (maxCells <= 0) continue;
          const s = slip.resolveAssist(
            { id: `r${idx}`, cells }, basePos, l.yaku.symbols[idx]!, l.vertical, maxCells,
          );
          if (s === null) continue;
          const score = CAT_RANK[l.yaku.category] * 100 + (maxCells - s) * 4 +
            (l.vertical === 'middle' ? 1 : 0);
          if (score > bestScore) { bestScore = score; bestSlip = s; }
        }
        slipCells = bestSlip;
      } else if (isAimLike && target) {
        const s2 = target.symbols[idx];
        if (s2 !== undefined) {
          const hint = slip.resolveAssist(
            { id: `r${idx}`, cells }, basePos, s2, 'middle', tuning.assist.aimHintMaxCells,
          );
          if (hint !== null) slipCells = hint;
        }
      }
      if (slipCells === 0) {
        const wantsTenpai =
          role.kind === 'single' || !pressOrderSatisfied(role.pressOrder, stopOrder);
        slipCells = slip.resolveKick({
          reelIndex: idx,
          basePosition: basePos,
          strip: { id: `r${idx}`, cells },
          stoppedVisibles: stopped,
          exceptYakuId: flagId ?? undefined,
          prefer: wantsTenpai ? 'tenpai' : 'blank',
        });
      }
      stopped[idx] = visCol(cells, (basePos + slipCells) % N);
    }

    // --- 判定・払い出し ---
    const grid = buildGrid(stopped as VisibleColumn[]);
    const flagId = pressOrderSatisfied(role.pressOrder, stopOrder) ? role.yakuId : null;
    const hits = resolveInternalRoleHits(flagId, judge.judgeAll(grid).hits);
    const willHit = hits.length > 0;
    const streakAfter = willHit ? streak + 1 : 0;
    const streakMult = calc.streakMult(streakAfter);
    let win = calc.calcMulti(hits, bonusActive, streakMult);

    const nearMiss = PAYLINES.some((line) => {
      const cs = line.cells.map(([r, c]) => grid[r][c]);
      return allYaku.some((y) => {
        if (y.symbols.length !== 3) return false;
        let m = 0;
        for (let i = 0; i < 3; i++) if (y.symbols[i] === cs[i]) m++;
        return m === 2;
      });
    });
    const wantsSingle =
      role.kind === 'single' || !pressOrderSatisfied(role.pressOrder, stopOrder);
    if (hits.length === 0 && wantsSingle && nearMiss) {
      win += payout.baseMultiplier.single;
      res.singleWins++;
    }
    if ((effect === 'aim' || effect === 'quiz') && flagId) {
      win += calc.aimBonus(hits.filter((h) => h.yaku.id === flagId), bonusActive, streakMult);
    }
    if (role.pressOrder && willHit) res.pushHit++;

    streak = streakAfter;
    missStreak = willHit ? 0 : missStreak + 1;
    res.totalWin += win;
    if (bonusActive) curBonusPayout += win;
    else res.normalWin += win;

    // ボーナス突入／おかわり
    const isPremium = hits.some((h) => h.yaku.category === 'premium');
    const isReg = !isPremium && hits.some((h) => h.yaku.category === 'bonus');
    if (isPremium || isReg) {
      if (!bonusActive) {
        curBonusKind = isPremium ? 'big' : 'reg';
        curBonusPayout = 0;
        if (isPremium) res.big++; else res.reg++;
      }
      bonusRemaining += isPremium ? tuning.bonus.spinsPerBig : tuning.bonus.spinsPerReg;
    }
    if (bonusActive) {
      bonusRemaining--;
      if (bonusRemaining === 0) {
        if (curBonusKind === 'big') res.bigPayout += curBonusPayout;
        else if (curBonusKind === 'reg') res.regPayout += curBonusPayout;
        curBonusKind = null; curBonusPayout = 0;
      }
    }
  }
  return res;
}

describe.skipIf(!RUN)('出玉シミュレーション（新モデル）', () => {
  it('腕別の機械割・突入率・ボーナス平均を測る', () => {
    const SPINS = 200000;
    const lines: string[] = [];
    lines.push('腕      機械割   通常時純増  ボ中純増  突入(1/G)  BIG平均  REG平均  押し順的中');
    for (const skill of SKILLS) {
      let bet = 0, win = 0, nbet = 0, nwin = 0, big = 0, reg = 0;
      let bspins = 0, bigPay = 0, regPay = 0;
      let pushRoles = 0, pushHit = 0, spins = 0;
      CHAPTERS.forEach((ch, i) => {
        const r = runChapter(ch, skill, SPINS / CHAPTERS.length, 12345 + i * 977);
        bet += r.totalBet; win += r.totalWin;
        nbet += r.normalBet; nwin += r.normalWin;
        big += r.big; reg += r.reg;
        bspins += r.bonusSpins; bigPay += r.bigPayout; regPay += r.regPayout;
        pushRoles += r.pushRoles; pushHit += r.pushHit;
        spins += r.spins;
      });
      const rtp = (win / bet) * 100;
      const normalSpins = spins - bspins;
      const normalNet = (nwin - nbet) / Math.max(1, normalSpins);
      const bonusNet = ((win - nwin) - (bet - nbet)) / Math.max(1, bspins);
      const entry = big + reg > 0 ? spins / (big + reg) : Infinity;
      lines.push(
        `${skill.name.padEnd(5)} ${rtp.toFixed(1).padStart(6)}% ${normalNet.toFixed(2).padStart(9)}枚 ` +
        `${bonusNet.toFixed(2).padStart(7)}枚 ${('1/' + entry.toFixed(0)).padStart(9)} ` +
        `${(bigPay / Math.max(1, big)).toFixed(0).padStart(6)}枚 ${(regPay / Math.max(1, reg)).toFixed(0).padStart(6)}枚 ` +
        `${((pushHit / Math.max(1, pushRoles)) * 100).toFixed(0).padStart(9)}%`,
      );
    }
    console.log('\n===== 出玉シミュレーション（' + SPINS + 'G/腕・全5章）=====\n' + lines.join('\n'));
    expect(lines.length).toBeGreaterThan(1);
  }, 600000);
});
