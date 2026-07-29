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
import { RoundResolver } from '../../src/core/RoundResolver';
import { EffectEligibility } from '../../src/productions/EffectEligibility';
import {
  applySetting,
  applySettingToEffects,
  SETTINGS,
  type Setting,
} from '../../src/productions/MachineSetting';
import { StopTableLookup } from '../../src/core/StopTable';
import { StopController } from '../../src/core/StopController';
import { ReachEyes } from '../../src/core/ReachEyes';
import { PAYLINES, type Grid3x3, type Vertical } from '../../src/core/Paylines';
import {
  PayoutSchema,
  TuningSchema,
  YakuListSchema,
  ReelConfigSchema,
  StopTableSchema,
  ReachEyeTableSchema,
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
  /** 持ち越し中のリーチ目に気づいて狙える確率（出目を読む力）。 */
  readReach: number;
}

const SKILLS: Skill[] = [
  { name: '初心者', sigmaMs: 100, readReach: 0.2 },
  { name: '中級', sigmaMs: 50, readReach: 0.6 },
  { name: '上級', sigmaMs: 25, readReach: 0.9 },
  { name: '神', sigmaMs: 10, readReach: 1.0 },
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
  /** 持ち越し中のゲーム数 */
  carriedSpins: number;
  /** そのうち全体出目がリーチ目だったゲーム数 */
  carriedReach: number;
  /** そのうち「中段にボーナス専用図柄」が出たゲーム数（一発リーチ目） */
  carriedMiddleTell: number;
  /** 非ボーナスフラグなのに中段告知が出たゲーム数（＝誤告知） */
  falseTellSpins: number;
  /** 非ボーナスフラグなのに第1停止で中段告知が出たゲーム数 */
  falseTellFirst: number;
  /** 非ボーナスフラグの総ゲーム数 */
  nonBonusSpins: number;
  /** 確定告知ランプ（通常抽選）で確定したボーナス数 */
  lampBonus: number;
  /** チェリー重複で確定したボーナス数 */
  cherryBonus: number;
  /** 役が成立したゲーム数（1枚役を除く） */
  hitSpins: number;
  /** ボーナス中に当選役を揃えられなかったゲーム数（＝こぼし） */
  bonusMissSpins: number;
  /**
   * ボーナス中の演出別 [ゲーム数, 揃えられなかった数]。
   * 「どの演出で取りこぼしているか」を見る。示唆は色しか出さず候補から選ばせるので、
   * 発展しなかった時の外しがここに集まる（＝演出設計の判断材料）。
   */
  bonusByEffect: Map<string, [number, number]>;
  /** そのうち1枚役へ落ちたゲーム数。ボーナス中の1枚役は抽選されないのでこれが全部 */
  bonusSpillWins: number;
  /**
   * 役の成立に貢献したリールのうち、引き込みも蹴りも働かず**自力で止めた**本数の分布。
   * 「引き込みなし＝ビタ押し」判定を出玉へ反映するかの検討材料。
   * index 0..3 が本数（0本＝全部ゲームに助けられた／3本＝完全自力）。
   */
  bitaReels: [number, number, number, number];
  /** 貢献リールが全部 slip=0 だったゲーム数（＝完全自力の成立）。 */
  bitaPerfect: number;
  /**
   * 役ID → [成立数, そのうちビタ押しだった数]。
   * 「どの役も同じくらい狙いやすい」を配列で作るための計測（設計: 28章）。
   */
  perYaku: Map<string, [number, number]>;
}

function runChapter(
  chapter: string,
  skill: Skill,
  spins: number,
  seed: number,
  setting?: Setting,
): Result {
  const baseYaku: YakuList = YakuListSchema.parse(
    readJson(`${DATA}/yaku/${chapter}.json`),
  );
  const yakuList: YakuList = setting ? applySetting(baseYaku, setting) : baseYaku;
  const reelCfg = ReelConfigSchema.parse(readJson(`${DATA}/reels/${chapter}.json`));
  const payout: Payout = PayoutSchema.parse(readJson(`${DATA}/payouts/default.json`));
  const tuning: Tuning = TuningSchema.parse(readJson(`${DATA}/tuning/default.json`));
  // 設定差の主役は演出レート（無演出の割合）。本番と同じ関数で適用する。
  const effectRates = setting
    ? {
        default: applySettingToEffects(tuning.effectRates.default, setting),
        rescue: applySettingToEffects(tuning.effectRates.rescue, setting),
        bonus: tuning.effectRates.bonus,
      }
    : tuning.effectRates;
  const quizzes = readJson(`${DATA}/quizzes/${chapter}.json`).quizzes as {
    answerYakuId: string;
  }[];

  const rng = makeRng(seed);
  const lottery = new InternalRoleLottery(yakuList, rng);
  const slip = new SlipResolver(yakuList, {
    assistMaxCells: tuning.assist.pullInCells,
  });
  const tenpaiDetector = new TenpaiDetector(yakuList);
  const stopTable = new StopTableLookup(
    StopTableSchema.parse(readJson(`${DATA}/stops/${chapter}.json`)),
  );
  const stopController = new StopController({
    yakuList,
    slipResolver: slip,
    tenpaiDetector,
    stopTable,
    pullInCells: tuning.assist.pullInCells,
  });
  const reachEyes = new ReachEyes(
    ReachEyeTableSchema.parse(readJson(`${DATA}/reach/${chapter}.json`)),
    yakuList,
  );
  const judge = new YakuJudge(yakuList);
  const calc = new PayoutCalc(payout);
  const roundResolver = new RoundResolver({
    judge,
    calc,
    reachEyes,
    singlePayout: payout.baseMultiplier.single,
    bitaMultiplier: payout.bitaMultiplier,
  });

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

  // 演出の可否・示唆の色・候補役はゲーム本体と同じ実装を通す。
  const eligibility = new EffectEligibility({
    yakuList,
    quizzes,
    shisaTiers: tuning.assist.shisaTiers,
    reelCount: 3,
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
    hitSpins: 0,
    bonusMissSpins: 0,
    bonusSpillWins: 0,
    bonusByEffect: new Map<string, [number, number]>(),
    bitaReels: [0, 0, 0, 0],
    bitaPerfect: 0,
    perYaku: new Map<string, [number, number]>(),
    shisaSpins: 0, shisaEscalated: 0, lampBonus: 0, cherryBonus: 0,
    carriedSpins: 0, carriedReach: 0, carriedMiddleTell: 0,
    falseTellSpins: 0, falseTellFirst: 0, nonBonusSpins: 0,
  };

  let missStreak = 0;
  let streak = 0;
  let bonusRemaining = 0;
  let curBonusKind: 'big' | 'reg' | null = null;
  let curBonusPayout = 0;
  /** 確定告知ランプ／チェリー重複の持ち越し（次ゲーム以降ボーナス確定）。 */
  let pendingBonus: 'big' | 'reg' | null = null;
  /** こぼしたボーナスフラグの持ち越し（無告知・実機Aタイプ）。 */
  let heldBonusYaku: Yaku | null = null;

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
    const heldRoleId = pendingBonus
      ? yakuList.internalRoles.find(
          (r) =>
            r.displayYakuId ===
            (pendingBonus === 'big'
              ? yakuList.premiumYaku[0]?.id
              : yakuList.bonusYaku[0]?.id),
        )?.id ?? null
      : null;
    const heldYaku =
      pendingBonus && !bonusActive
        ? (pendingBonus === 'big' ? yakuList.premiumYaku[0] : yakuList.bonusYaku[0]) ?? null
        : null;
    const carried = !heldYaku && !bonusActive ? heldBonusYaku : null;
    const role = heldYaku
      ? lottery.forYaku(heldYaku)
      : carried
        ? lottery.forYaku(carried)
        : lottery.draw(state);
    const yaku = role.yakuId ? (yakuById.get(role.yakuId) ?? null) : null;
    const rates =
      state === 'bonus'
        ? effectRates.bonus
        : state === 'rescue'
          ? effectRates.rescue
          : effectRates.default;

    let effect: 'none' | 'shisa' | 'quiz' | 'aim';
    if (heldYaku || carried) {
      effect = 'none'; // 持ち越し中は無告知（出目＝リーチ目で察知する）
    } else if (yaku) {
      // EffectScheduler.rollAvailable と同じ抽選（候補に none を足して重み付き）。
      // 乱数だけ再現性のある rng に差し替えている。
      const cands: ('none' | 'shisa' | 'quiz' | 'aim')[] = [
        'none',
        ...eligibility.eligibleEffects(yaku),
      ];
      effect = pickWeighted(cands, (e) => rates[e]);
    } else {
      effect = 'none';
    }
    const shisaTier =
      effect === 'shisa' && yaku
        ? eligibility.pickTier(yaku, rng)
        : null;

    // 遅れ：ハズレ・1枚役では出ない＝出たら必ず何かが当たっている。
    // **無演出のゲームでだけ出す**（main.ts と同条件）。演出が出ていればボーナスかどうかは
    // 色や役名で分かっているので情報が増えず、青示唆に重なると読みにくくなる。
    // ボーナス中は none=0 でそもそも無演出が無く、持ち越し中は同じ役を毎ゲーム引き直す
    // ので鳴り続けてしまう。
    const delayRate = tuning.delay.rate;
    const delayed =
      effect === 'none' &&
      !bonusActive &&
      !carried &&
      !heldYaku &&
      rng() <
        (role.kind === 'core'
          ? delayRate.core
          : role.kind === 'cherry'
            ? delayRate.cherry
            : role.kind === 'reg'
              ? delayRate.reg
              : role.kind === 'big'
                ? delayRate.big
                : 0);

    // 本作は順押し前提（左→中→右）。押し順は停止制御の入力であって役ではない。
    // SEQ=2,1,0 のように指定すると押し順を変えて比較できる（検証用）。
    const seq = (process.env.SEQ ?? '0,1,2').split(',').map(Number);

    const stopped: (VisibleColumn | null)[] = [null, null, null];
    const slipPerReel: number[] = [0, 0, 0];
    /** このゲームで実際に役を狙えたか（演出で狙う役が分かっていたか）。 */
    let aimedThisSpin = false;
    const stopOrder: number[] = [];
    const isAimLike = effect === 'aim' || effect === 'quiz';
    const singleIds = yakuList.singleYaku.map((y) => y.id);
    // main.ts activeFlagYakuIds と同じ:
    // miss=[] / 1枚役フラグ=1枚役グループ / 通常=[表示役] / ボーナス中=[表示役, ...1枚役]
    const flagIdsNow = (): string[] => {
      if (role.kind === 'miss') return [];
      if (role.kind === 'single') return singleIds;
      if (!role.yakuId) return [];
      return bonusActive ? [role.yakuId, ...singleIds] : [role.yakuId];
    };
    const singleSpill = (): boolean => role.kind === 'single';

    // 示唆は「どれかな…？」＝プレイヤーは候補から1つを選んで狙う（正解は知らない）。
    // 発展（内部役の図柄が中段に来る）以降は、明かされた役を狙える。
    let shisaGuess: Yaku | null = null;
    if (effect === 'shisa' && shisaTier && yaku) {
      const cands = eligibility.candidatesFor(shisaTier, state);
      shisaGuess = cands.length > 0 ? cands[Math.floor(rng() * cands.length)] : yaku;
    }
    // 持ち越しに気づけるか（リーチ目の読み）。腕が上がるほど気づく。
    const carriedNoticed = !carried || rng() < skill.readReach;
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
      // 持ち越し中は無告知だが、リーチ目を読めたプレイヤーは狙える。
      // 読み取れる割合は腕に依存する（初心者ほど気づかず適当押し）。
      // 演出が無くても遅れが出ていれば「何かは当たっている」と分かる。役は絞れないので、
      // 遅れの内訳がボーナスへ寄っている以上、**ボーナス2つが共有する頭2文字**を狙うのが最善手。
      // それを「BIG1（REGと頭2文字が同じ側）を狙う」としてモデル化する。
      const delayGuess =
        delayed && effect === 'none' && !carried && !heldYaku
          ? (yakuList.premiumYaku[0] ?? null)
          : null;
      const aimYaku =
        effect === 'shisa' && !escalated
          ? shisaGuess
          : effect === 'none' && delayGuess && !carriedNoticed
            ? delayGuess
            : target ?? delayGuess;
      const canAim =
        effect !== 'none' ||
        delayGuess !== null ||
        (carried !== null && carriedNoticed) ||
        heldYaku !== null;
      if (canAim && aimYaku) aimedThisSpin = true;
      const sym = canAim && aimYaku ? aimYaku.symbols[idx] : undefined;
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

      // --- 停止制御（ゲーム本体と同じ StopController を使う）---
      const flagIds = flagIdsNow();
      const slipCellsRaw = stopController.resolveSlip({
        reelIndex: idx,
        basePosition: basePos,
        strip: { id: `r${idx}`, cells },
        stoppedVisibles: stopped,
        flagYakuIds: flagIds,
        flagKey: heldYaku ? heldRoleId : role.roleId,
      });
      const slipCells = slipCellsRaw;
      slipPerReel[idx] = slipCells;
      stopped[idx] = visCol(cells, (basePos + slipCells) % N);
      stopN++;
      // 示唆→「狙え！」への発展：最終停止より前に内部役の図柄が**窓のどこかへ**来たか。
      // main.ts と同じ条件。中段限定だと発展しない時に腕と無関係にほぼ落とすため緩めてある。
      if (effect === 'shisa' && !escalated && stopN < 3 && yaku) {
        const sy = yaku.symbols[idx];
        const v = stopped[idx]!;
        if (sy !== undefined && (v.top === sy || v.middle === sy || v.bottom === sy)) {
          escalated = true;
        }
      }
    }
    if (effect === 'shisa') {
      res.shisaSpins++;
      if (escalated) res.shisaEscalated++;
    }

    // --- 判定・払い出し ---
    const grid = buildGrid(stopped as VisibleColumn[]);
    const flagId = role.yakuId;
    // 判定・払い出しはゲーム本体と同じ RoundResolver を通す（合成規則を写さない）。
    const outcome = roundResolver.resolve({
      grid,
      flagYakuIds: flagIdsNow(),
      bonusActive,
      streakBefore: streak,
      noticeYakuId:
        (effect === 'aim' || effect === 'quiz') && flagId ? flagId : null,
      slipCells: slipPerReel,
    });
    const { hits, willHit, streakAfter, win } = outcome;
    if (outcome.singleHits.length > 0) res.singleWins++;
    // ボーナス中は1枚役を抽選しない。1枚役が出たなら当選役を外した結果（こぼし）。
    if (bonusActive) {
      // 示唆は発展したかどうかで狙えたかが変わるので、別の演出として数える。
      const key = effect === 'shisa' ? (escalated ? 'shisa+発展' : 'shisa') : effect;
      const cur = res.bonusByEffect.get(key) ?? [0, 0];
      cur[0]++;
      if (!willHit) cur[1]++;
      res.bonusByEffect.set(key, cur);
      if (!willHit) {
        res.bonusMissSpins++;
        if (outcome.singleHits.length > 0) res.bonusSpillWins++;
      }
    }

    // 「引き込みなし＝ビタ押し」の実測。成立に貢献したリールのうち自力停止の本数を数える。
    if (outcome.willHit) {
      res.hitSpins++;
      res.bitaReels[Math.min(3, outcome.selfStoppedReels)]++;
      if (outcome.bitaPerfect) res.bitaPerfect++;
      // 役ごとの到達度（同一ゲームで複数役が揃うことはほぼ無いので先頭で代表させる）
      // 狙っていないゲーム（演出なし＝何を狙うか分からない）は難易度の比較にならないので除く。
      if (aimedThisSpin) {
        const yid = outcome.hits[0].yaku.id;
        const cur = res.perYaku.get(yid) ?? [0, 0];
        cur[0]++;
        if (outcome.bitaPerfect) cur[1]++;
        res.perYaku.set(yid, cur);
      }
    }

    // 誤告知の計測：ボーナスフラグでないのに中段へ専用図柄が出たか
    const isBonusFlag =
      !!heldYaku || !!carried || role.kind === 'reg' || role.kind === 'big';
    if (!isBonusFlag) {
      res.nonBonusSpins++;
      if ([0, 1, 2].some((r) => reachEyes.isBonusOnlyAtMiddle(r, grid[1][r]))) {
        res.falseTellSpins++;
      }
      const firstReel = seq[0];
      if (reachEyes.isBonusOnlyAtMiddle(firstReel, grid[1][firstReel])) {
        res.falseTellFirst++;
      }
    }
    if (carried) {
      res.carriedSpins++;
      if (hits.length === 0 && reachEyes.detect(grid) !== null) res.carriedReach++;
      // 一発リーチ目：**第1停止**の中段がボーナス専用図柄なら、その場で確定告知になる。
      const fr = seq[0];
      if (reachEyes.isBonusOnlyAtMiddle(fr, grid[1][fr])) res.carriedMiddleTell++;
    }
    const isPremiumNow = hits.some((h) => h.yaku.category === 'premium');
    const isRegNow = !isPremiumNow && hits.some((h) => h.yaku.category === 'bonus');
    // 持ち越しを回収したら消灯。
    if (pendingBonus && (isPremiumNow || isRegNow)) pendingBonus = null;
    if (isPremiumNow || isRegNow) {
      heldBonusYaku = null;
    } else if (!pendingBonus && !bonusActive && yaku &&
               (yaku.category === 'premium' || yaku.category === 'bonus')) {
      heldBonusYaku = yaku;
    }
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
    lines.push('腕      機械割   通常時純増  ボ中純増  突入(1/G)  BIG平均  REG平均  示唆発展  ランプ  チェリー重複  持越G  中段告知  誤告知(全)  誤告知(第1)  ボ中こぼし  →1枚');
    for (const skill of SKILLS) {
      let bet = 0, win = 0, nbet = 0, nwin = 0, big = 0, reg = 0;
      let bspins = 0, bigPay = 0, regPay = 0;
      let spins = 0;
      let shisaSpins = 0, shisaEsc = 0, lampB = 0, cherryB = 0, carS = 0, carR = 0, carM = 0, fT = 0, fT1 = 0, nb = 0;
      let bMiss = 0, bSpill = 0;
      CHAPTERS.forEach((ch, i) => {
        const r = runChapter(ch, skill, SPINS / CHAPTERS.length, 12345 + i * 977);
        bMiss += r.bonusMissSpins; bSpill += r.bonusSpillWins;
        bet += r.totalBet; win += r.totalWin;
        nbet += r.normalBet; nwin += r.normalWin;
        big += r.big; reg += r.reg;
        bspins += r.bonusSpins; bigPay += r.bigPayout; regPay += r.regPayout;
        shisaSpins += r.shisaSpins; shisaEsc += r.shisaEscalated;
        lampB += r.lampBonus; cherryB += r.cherryBonus;
        carS += r.carriedSpins; carR += r.carriedReach; carM += r.carriedMiddleTell;
        fT += r.falseTellSpins; fT1 += r.falseTellFirst; nb += r.nonBonusSpins;
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
        `${(cherryB / Math.max(1, big + reg) * 100).toFixed(0).padStart(9)}% ` +
        `${carS.toString().padStart(6)} ` +
        `${((carM / Math.max(1, carS)) * 100).toFixed(1).padStart(7)}% ` +
        `${((fT / Math.max(1, nb)) * 100).toFixed(1).padStart(9)}% ` +
        `${fT1.toString().padStart(10)}件 ` +
        `${((bMiss / Math.max(1, bspins)) * 100).toFixed(1).padStart(9)}% ` +
        `${((bSpill / Math.max(1, bMiss)) * 100).toFixed(1).padStart(5)}%`,
      );
    }
    console.log('\n===== 出玉シミュレーション（' + SPINS + 'G/腕・全5章）=====\n' + lines.join('\n'));

    // 「引き込みなし＝ビタ押し」の到達度。成立ゲームのうち貢献リールを何本自力で止めたか。
    const bita: string[] = [];
    bita.push('腕      成立G     0本     1本     2本     3本   完全自力');
    for (const skill of SKILLS) {
      const acc = [0, 0, 0, 0];
      let hit = 0, perfect = 0;
      CHAPTERS.forEach((ch, i) => {
        const r = runChapter(ch, skill, SPINS / CHAPTERS.length, 12345 + i * 977);
        hit += r.hitSpins; perfect += r.bitaPerfect;
        r.bitaReels.forEach((n, k) => { acc[k] += n; });
      });
      const pct = (n: number) => ((n / Math.max(1, hit)) * 100).toFixed(1).padStart(6) + '%';
      bita.push(
        `${skill.name.padEnd(5)} ${hit.toString().padStart(6)} ` +
        acc.map(pct).join(' ') + ' ' + pct(perfect),
      );
    }
    console.log('\n===== 引き込みなし（自力停止）の到達度 =====\n' + bita.join('\n'));

    // ボーナス中はどの演出でも狙う役は分かっているはずなのに取りこぼしが残る。
    // その内訳＝演出設計（どこまで役を明かすか）の判断材料。
    const byEffect: string[] = [];
    byEffect.push('腕     演出          ボ中G    取りこぼし  ※ボーナス中のみ');
    for (const skill of SKILLS) {
      const acc = new Map<string, [number, number]>();
      CHAPTERS.forEach((ch, i) => {
        const r = runChapter(ch, skill, SPINS / CHAPTERS.length, 12345 + i * 977);
        for (const [k, v] of r.bonusByEffect) {
          const cur = acc.get(k) ?? [0, 0];
          cur[0] += v[0];
          cur[1] += v[1];
          acc.set(k, cur);
        }
      });
      const rows = [...acc.entries()].sort((a, b) => b[1][0] - a[1][0]);
      for (const [k, v] of rows) {
        byEffect.push(
          `${skill.name.padEnd(5)} ${k.padEnd(12)}${v[0].toString().padStart(7)}` +
          `${((v[1] / Math.max(1, v[0])) * 100).toFixed(1).padStart(10)}%`,
        );
      }
    }
    console.log('\n===== ボーナス中の演出別 取りこぼし =====\n' + byEffect.join('\n'));

    // 役ごとの狙いやすさ（上級で固定）。「どの役も同じくらい」を目指す指標。
    const skill = SKILLS.find((s) => s.name === '上級')!;
    const per: string[] = [];
    per.push('章 / 役          狙えた   ビタ    到達率   ※狙えたゲームのみ（演出で役が分かった時）');
    for (const ch of CHAPTERS) {
      const r = runChapter(ch, skill, SPINS / CHAPTERS.length, 12345);
      const rows = [...r.perYaku.entries()].sort((a, b) => b[1][0] - a[1][0]);
      const rates = rows.map(([, v]) => (v[1] / Math.max(1, v[0])) * 100);
      const lo = Math.min(...rates);
      const hi = Math.max(...rates);
      per.push(`-- ${ch}  （最小${lo.toFixed(1)}% 〜 最大${hi.toFixed(1)}% ＝ ${(hi / Math.max(0.01, lo)).toFixed(1)}倍）`);
      for (const [id, v] of rows) {
        per.push(
          `   ${id.padEnd(14)}${v[0].toString().padStart(6)}${v[1].toString().padStart(7)}` +
          `${((v[1] / Math.max(1, v[0])) * 100).toFixed(1).padStart(8)}%`,
        );
      }
    }
    console.log('\n===== 役ごとのビタ到達率（上級・章別） =====\n' + per.join('\n'));

    // 設定差。プレイヤーはこれを推測して台を選ぶので、
    // 「差はあるが数百ゲームでは見抜けない」くらいが狙い。
    const setLines: string[] = [];
    setLines.push('設定  初心者   中級    上級     神   |  突入(中級)');
    for (const st of SETTINGS) {
      const cells: string[] = [];
      let entrySpins = 0;
      let entryCount = 0;
      for (const sk of SKILLS) {
        let bet = 0, win = 0, spins = 0, big = 0, reg = 0;
        CHAPTERS.forEach((ch, i) => {
          const r = runChapter(ch, sk, SPINS / CHAPTERS.length, 12345 + i * 977, st);
          bet += r.totalBet; win += r.totalWin; spins += r.spins;
          big += r.big; reg += r.reg;
        });
        cells.push(((win / bet) * 100).toFixed(1).padStart(6) + '%');
        if (sk.name === '中級') { entrySpins = spins; entryCount = big + reg; }
      }
      setLines.push(
        `  ${st}  ${cells.join(' ')}  |  ` +
        ('1/' + (entrySpins / Math.max(1, entryCount)).toFixed(0)).padStart(8),
      );
    }
    console.log('\n===== 設定差（1〜6） =====\n' + setLines.join('\n'));
    expect(lines.length).toBeGreaterThan(1);
  }, 600000);
});
