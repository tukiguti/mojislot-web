import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  SlipResolver,
  type VisibleColumn,
} from '../../src/productions/SlipResolver';
import { TenpaiDetector, type TenpaiLine } from '../../src/productions/TenpaiDetector';
import { InternalRoleLottery } from '../../src/productions/InternalRoleLottery';
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
}

const SKILLS: Skill[] = [
  { name: '初心者', sigmaMs: 100 },
  { name: '中級', sigmaMs: 50 },
  { name: '上級', sigmaMs: 25 },
  { name: '神', sigmaMs: 10 },
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
  singleWins: number;
  shisaSpins: number;
  shisaEscalated: number;
  /** 確定告知ランプ（通常抽選）で確定したボーナス数 */
  lampBonus: number;
  /** チェリー重複で確定したボーナス数 */
  cherryBonus: number;
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
    assistMaxCells: tuning.assist.pullInCells,
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
  const allYakuWithSingle: Yaku[] = [...allYaku, ...yakuList.singleYaku];
  const sigmaCells = (skill.sigmaMs * tuning.reelSpeed) / 1000;

  const gauss = (): number => {
    // Box-Muller
    const u = Math.max(rng(), 1e-9);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
  };

  const shisaTiersForYaku = (y: Yaku): ShisaTier[] =>
    tuning.assist.shisaTiers.filter((t) => t.targets.includes(y.category));

  /** この tier で当たりうる役（main.ts shisaCandidateYakus と同じ逆算）。 */
  const shisaCandidatesFor = (
    tier: ShisaTier,
    state: InternalRoleState,
  ): Yaku[] => {
    const seen = new Set<string>();
    const out: Yaku[] = [];
    for (const role of yakuList.internalRoles) {
      if (!role.displayYakuId || role.rate[state] <= 0) continue;
      if (seen.has(role.displayYakuId)) continue;
      const y = yakuById.get(role.displayYakuId);
      if (!y) continue;
      if (!tier.targets.includes(y.category)) continue;
      seen.add(y.id);
      out.push(y);
    }
    return out;
  };

  const eligibleEffects = (y: Yaku, bonusActive: boolean): ('shisa' | 'quiz' | 'aim')[] =>
    (['shisa', 'quiz', 'aim'] as const).filter((e) => {
      if (e === 'shisa') return shisaTiersForYaku(y).length > 0;
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
    singleWins: 0,
    shisaSpins: 0, shisaEscalated: 0, lampBonus: 0, cherryBonus: 0,
  };

  let missStreak = 0;
  let streak = 0;
  let bonusRemaining = 0;
  let curBonusKind: 'big' | 'reg' | null = null;
  let curBonusPayout = 0;
  /** 確定告知ランプ／チェリー重複の持ち越し（次ゲーム以降ボーナス確定）。 */
  let pendingBonus: 'big' | 'reg' | null = null;

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

    // 確定告知ランプの通常抽選（通常時のみ・持ち越し中は引かない）。
    if (!pendingBonus && !bonusActive && rng() < tuning.announceLamp.rate) {
      pendingBonus = rng() < tuning.announceLamp.bigRatio ? 'big' : 'reg';
      res.lampBonus++;
    }
    // 持ち越し中は内部役を確定役へ強制し、演出は抑止（ランプが出ているため）。
    const heldYaku =
      pendingBonus && !bonusActive
        ? (pendingBonus === 'big' ? yakuList.premiumYaku[0] : yakuList.bonusYaku[0]) ?? null
        : null;
    const role = heldYaku ? lottery.forYaku(heldYaku) : lottery.draw(state);
    const yaku = role.yakuId ? (yakuById.get(role.yakuId) ?? null) : null;
    const rates =
      state === 'bonus'
        ? tuning.effectRates.bonus
        : state === 'rescue'
          ? tuning.effectRates.rescue
          : tuning.effectRates.default;

    let effect: 'none' | 'shisa' | 'quiz' | 'aim';
    if (heldYaku) {
      effect = 'none';
    } else if (yaku) {
      const cands = eligibleEffects(yaku, bonusActive);
      effect = cands.length ? pickWeighted(cands, (e) => rates[e]) : 'none';
    } else {
      effect = 'none';
    }
    const shisaTier =
      effect === 'shisa' && yaku
        ? pickWeighted(shisaTiersForYaku(yaku), (t) => t.weight)
        : null;

    // 本作は順押し前提（左→中→右）。押し順は停止制御の入力であって役ではない。
    const seq = [0, 1, 2];

    const stopped: (VisibleColumn | null)[] = [null, null, null];
    const stopOrder: number[] = [];
    const isAimLike = effect === 'aim' || effect === 'quiz';
    const singleIds = yakuList.singleYaku.map((y) => y.id);
    // main.ts activeFlagYakuIds と同じ: miss=[] / single・押し順ミス=1枚役グループ / 通常=[表示役]
    const flagIdsNow = (): string[] => {
      if (role.kind === 'miss') return [];
      if (role.kind === 'single') return singleIds;
      return role.yakuId ? [role.yakuId] : [];
    };
    const singleSpill = (): boolean => role.kind === 'single';

    // 示唆は「どれかな…？」＝プレイヤーは候補から1つを選んで狙う（正解は知らない）。
    // 発展（内部役の図柄が中段に来る）以降は、明かされた役を狙える。
    let shisaGuess: Yaku | null = null;
    if (effect === 'shisa' && shisaTier && yaku) {
      const cands = shisaCandidatesFor(shisaTier, state);
      shisaGuess = cands.length > 0 ? cands[Math.floor(rng() * cands.length)] : yaku;
    }
    let escalated = false;
    let stopN = 0;
    for (const idx of seq) {
      stopOrder.push(idx);
      const flagId = role.yakuId;
      const target = flagId ? (yakuById.get(flagId) ?? null) : null;
      const cells = reels[idx];

      // 押下位置：狙う図柄があれば「その図柄が中段に来る位置」を狙い、腕に応じた誤差を乗せる
      let basePos: number;
      // 示唆で未発展の間は「自分が選んだ候補」を狙う（外していれば引き込みは効かない）。
      const aimYaku =
        effect === 'shisa' && !escalated ? shisaGuess : target;
      const sym = effect !== 'none' && aimYaku ? aimYaku.symbols[idx] : undefined;
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

      // --- resolveStopSlip 相当（引き込み対象も窓も内部役だけで決まる）---
      let slipCells = 0;
      const flagIds = flagIdsNow();
      const targets = flagIds
        .map((id) => allYakuWithSingle.find((y) => y.id === id))
        .filter((y): y is Yaku => y !== undefined);
      const actx = (b: number) => ({
        reelIndex: idx,
        basePosition: b,
        strip: { id: `r${idx}`, cells },
        stoppedVisibles: stopped,
        exceptYakuIds: flagIds,
      });
      if (targets.length > 0) {
        const tenpai = tenpaiDetector.detect(stopped);
        if (tenpai && tenpai.missingReelIndex === idx) {
          let bestSlip = 0, bestScore = -1;
          const CAT_RANK: Record<Yaku['category'], number> =
            { premium: 3, bonus: 2, core: 1, cherry: 0, single: 0 };
          for (const l of tenpai.lines as TenpaiLine[]) {
            if (!flagIds.includes(l.yaku.id)) continue;
            const sres = slip.resolveAssist(
              actx(basePos), l.yaku.symbols[idx]!, l.vertical, tuning.assist.pullInCells,
            );
            if (sres === null) continue;
            const score = CAT_RANK[l.yaku.category] * 100 +
              (tuning.assist.pullInCells - sres) * 4 + (l.vertical === 'middle' ? 1 : 0);
            if (score > bestScore) { bestScore = score; bestSlip = sres; }
          }
          slipCells = bestSlip;
        }
        if (slipCells === 0) {
          let best: number | null = null;
          for (const y of targets) {
            const sym = y.symbols[idx];
            if (sym === undefined) continue;
            const consistent = stopped.every(
              (v, i2) => v === null || i2 === idx || y.symbols[i2] === undefined || v.middle === y.symbols[i2],
            );
            if (!consistent) continue;
            const hint = slip.resolveAssist(actx(basePos), sym, 'middle', tuning.assist.pullInCells);
            if (hint !== null && (best === null || hint < best)) best = hint;
          }
          if (best !== null) slipCells = best;
        }
      }
      if (slipCells === 0) {
        slipCells = slip.resolveKick({
          reelIndex: idx,
          basePosition: basePos,
          strip: { id: `r${idx}`, cells },
          stoppedVisibles: stopped,
          exceptYakuIds: flagIds,
        });
      }
      stopped[idx] = visCol(cells, (basePos + slipCells) % N);
      stopN++;
      // 示唆→「狙え！」への発展：最終停止より前に内部役の図柄が中段へ来たか。
      if (effect === 'shisa' && !escalated && stopN < 3 && yaku) {
        const sy = yaku.symbols[idx];
        if (sy !== undefined && stopped[idx]!.middle === sy) escalated = true;
      }
    }
    if (effect === 'shisa') {
      res.shisaSpins++;
      if (escalated) res.shisaEscalated++;
    }

    // --- 判定・払い出し ---
    const grid = buildGrid(stopped as VisibleColumn[]);
    const allowedHits = resolveInternalRoleHits(
      flagIdsNow(),
      judge.judgeAll(grid).hits,
    );
    const singleHits = allowedHits.filter((h) => h.yaku.category === 'single');
    const hits = allowedHits.filter((h) => h.yaku.category !== 'single');
    const willHit = hits.length > 0;
    const streakAfter = willHit ? streak + 1 : 0;
    const streakMult = calc.streakMult(streakAfter);
    let win = calc.calcMulti(hits, bonusActive, streakMult);

    if (singleHits.length > 0) {
      win += payout.baseMultiplier.single;
      res.singleWins++;
    }
    const flagId = role.yakuId;
    if ((effect === 'aim' || effect === 'quiz') && flagId) {
      win += calc.aimBonus(hits.filter((h) => h.yaku.id === flagId), bonusActive, streakMult);
    }

    const isPremiumNow = hits.some((h) => h.yaku.category === 'premium');
    const isRegNow = !isPremiumNow && hits.some((h) => h.yaku.category === 'bonus');
    // 持ち越しを回収したら消灯。
    if (pendingBonus && (isPremiumNow || isRegNow)) pendingBonus = null;
    // チェリー重複：チェリーが実際に揃った時だけ抽選し、次ゲーム以降ボーナス確定。
    if (
      !pendingBonus &&
      !bonusActive &&
      hits.some((h) => h.yaku.category === 'cherry') &&
      rng() < tuning.cherryBonus.rate
    ) {
      pendingBonus = rng() < tuning.cherryBonus.bigRatio ? 'big' : 'reg';
      res.cherryBonus++;
    }

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
    lines.push('腕      機械割   通常時純増  ボ中純増  突入(1/G)  BIG平均  REG平均  示唆発展  ランプ  チェリー重複');
    for (const skill of SKILLS) {
      let bet = 0, win = 0, nbet = 0, nwin = 0, big = 0, reg = 0;
      let bspins = 0, bigPay = 0, regPay = 0;
      let spins = 0;
      let shisaSpins = 0, shisaEsc = 0, lampB = 0, cherryB = 0;
      CHAPTERS.forEach((ch, i) => {
        const r = runChapter(ch, skill, SPINS / CHAPTERS.length, 12345 + i * 977);
        bet += r.totalBet; win += r.totalWin;
        nbet += r.normalBet; nwin += r.normalWin;
        big += r.big; reg += r.reg;
        bspins += r.bonusSpins; bigPay += r.bigPayout; regPay += r.regPayout;
        shisaSpins += r.shisaSpins; shisaEsc += r.shisaEscalated;
        lampB += r.lampBonus; cherryB += r.cherryBonus;
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
        `${((shisaEsc / Math.max(1, shisaSpins)) * 100).toFixed(0).padStart(7)}% ` +
        `${(lampB / Math.max(1, big + reg) * 100).toFixed(0).padStart(5)}% ` +
        `${(cherryB / Math.max(1, big + reg) * 100).toFixed(0).padStart(9)}%`,
      );
    }
    console.log('\n===== 出玉シミュレーション（' + SPINS + 'G/腕・全5章）=====\n' + lines.join('\n'));
    expect(lines.length).toBeGreaterThan(1);
  }, 600000);
});
