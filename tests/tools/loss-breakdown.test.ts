import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  SlipResolver,
  type SlipContext,
  type VisibleColumn,
} from '../../src/productions/SlipResolver';
import { TenpaiDetector } from '../../src/productions/TenpaiDetector';
import { InternalRoleLottery } from '../../src/productions/InternalRoleLottery';
import { YakuJudge } from '../../src/core/YakuJudge';
import { PayoutCalc } from '../../src/core/PayoutCalc';
import { RoundResolver } from '../../src/core/RoundResolver';
import { EffectEligibility } from '../../src/productions/EffectEligibility';
import { StopTableLookup } from '../../src/core/StopTable';
import { StopController } from '../../src/core/StopController';
import { ReachEyes } from '../../src/core/ReachEyes';
import {
  PAYLINES,
  PRIMARY_PAYLINE,
  primaryRowOf,
  visibleAt,
  type Grid3x3,
  type Payline,
  type Vertical,
} from '../../src/core/Paylines';
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
  type InternalRoleState,
} from '../../src/data/schemas';

/**
 * 取りこぼしの内訳を測る計測用ツール（payout-sim の loop を計装したもの）。
 *
 *   LOSS=1 npx vitest run tests/tools/loss-breakdown.test.ts --disable-console-intercept
 *   LOSS=1 PRIMARY_LINE=bottom STOPS_DIR=/path/to/stops-bottom npx vitest run ...
 *
 * 出力は「どこで役を落としたか」の分解:
 *   通常時/ボーナス中 × 第N停止 × 内部役 × 失敗理由
 * 失敗理由:
 *   a_窓外   : 引き込み窓(4コマ)内に必要な図柄が無い
 *   b_ロック : 図柄は窓内にあるが、その位置で非当選役が揃うため引き込めない
 *   c_表     : クリーンな引き込み先があるのに停止テーブルが別の値を返した
 *   d_1枚役  : 1枚役が先に成立してしまった（横取り）
 *   e_他     : 上記以外（蹴りに落ちた等）
 */

const RUN = process.env.LOSS === '1';
const DIR = dirname(fileURLToPath(import.meta.url));
const DATA = resolve(DIR, '../../data');
const STOPS = process.env.STOPS_DIR ?? `${DATA}/stops`;
const REELS = process.env.REELS_DIR ?? `${DATA}/reels`;
const readJson = (p: string) => JSON.parse(readFileSync(p, 'utf-8'));

const CHAPTERS = [
  'hiragana_food',
  'hiragana_verb',
  'katakana_animal',
  'security',
  'yasai',
] as const;

const SPINS = Number(process.env.SPINS ?? 200000);
const SIGMA_MS = Number(process.env.SIGMA_MS ?? 50);
const READ_REACH = Number(process.env.READ_REACH ?? 0.6);

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function visCol(cells: readonly string[], pos: number): VisibleColumn {
  const n = cells.length;
  return {
    top: cells[(pos + 1) % n],
    middle: cells[pos],
    bottom: cells[(((pos - 1) % n) + n) % n],
  };
}

function buildGrid(cols: readonly VisibleColumn[]): Grid3x3 {
  return [
    [cols[0].top, cols[1].top, cols[2].top],
    [cols[0].middle, cols[1].middle, cols[2].middle],
    [cols[0].bottom, cols[1].bottom, cols[2].bottom],
  ];
}

const ROWV: readonly Vertical[] = ['top', 'middle', 'bottom'];

/** 集計用のカウンタ束。すべて「章をまたいで足す」。 */
interface Acc {
  spins: number;
  bonusSpins: number;
  bet: number;
  win: number;
  normalBet: number;
  normalWin: number;
  big: number;
  reg: number;
  bigPayout: number;
  regPayout: number;
  /** 内部役ごと: [抽選回数, 成立回数, 払出合計]。通常時/ボーナス中で別キー。 */
  byRole: Map<string, [number, number, number]>;
  /** 失敗内訳: key = `${phase}|${kind}|${stopNo}|${reason}` */
  fail: Map<string, number>;
  /** 失敗した停止の可能性クロス集計。 */
  fail2: Map<string, number>;
  /** ライン別の成立数と払出（主ライン vs それ以外）。 */
  byLine: Map<string, [number, number]>;
  /** 狙った停止の押下誤差 err × リール × 生存: key=`${reel}|${err}` → [試行, 生存] */
  aimErr: Map<string, [number, number]>;
  /** 1ゲームで何本のラインが成立したか: key=`${phase}|${category}|${本数}` */
  multi: Map<string, number>;
  /** ボーナス中の1枚役こぼし枚数。 */
  spillCoins: number;
  spillSpins: number;
  /** 引き込みが「そもそも成功した」stop 数（分母つき）: key=`${phase}|${stopNo}` → [試行, 生存] */
  stopTrials: Map<string, [number, number]>;
}

function newAcc(): Acc {
  return {
    spins: 0, bonusSpins: 0, bet: 0, win: 0, normalBet: 0, normalWin: 0,
    big: 0, reg: 0, bigPayout: 0, regPayout: 0,
    byRole: new Map(), fail: new Map(), fail2: new Map(), byLine: new Map(),
    aimErr: new Map(), multi: new Map(), spillCoins: 0, spillSpins: 0, stopTrials: new Map(),
  };
}

const bump = (m: Map<string, number>, k: string, v = 1) =>
  m.set(k, (m.get(k) ?? 0) + v);

function runChapter(chapter: string, spins: number, seed: number, acc: Acc): void {
  const yakuList: YakuList = YakuListSchema.parse(
    readJson(`${DATA}/yaku/${chapter}.json`),
  );
  const reelCfg = ReelConfigSchema.parse(readJson(`${REELS}/${chapter}.json`));
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
  const stopTable = new StopTableLookup(
    StopTableSchema.parse(readJson(`${STOPS}/${chapter}.json`)),
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
  const singleYakus = yakuList.singleYaku;
  const singleIds = singleYakus.map((y) => y.id);
  const sigmaCells = (SIGMA_MS * tuning.reelSpeed) / 1000;
  const PULL = tuning.assist.pullInCells;

  const gauss = (): number => {
    const u = Math.max(rng(), 1e-9);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
  };

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

  const rowOnLine = (line: Payline, reel: number): number | undefined =>
    line.cells.find(([, col]) => col === reel)?.[0];

  let missStreak = 0;
  let streak = 0;
  let bonusRemaining = 0;
  let curBonusKind: 'big' | 'reg' | null = null;
  let curBonusPayout = 0;
  let pendingBonus: 'big' | 'reg' | null = null;
  let heldBonusYaku: Yaku | null = null;

  for (let g = 0; g < spins; g++) {
    const bonusActive = bonusRemaining > 0;
    const state: InternalRoleState = bonusActive
      ? 'bonus'
      : missStreak >= tuning.rescueMissThreshold
        ? 'rescue'
        : 'default';
    acc.spins++;
    acc.bet += calc.bet;
    if (bonusActive) acc.bonusSpins++;
    else acc.normalBet += calc.bet;

    if (!pendingBonus && !bonusActive && rng() < tuning.announceLamp.rate) {
      pendingBonus = rng() < tuning.announceLamp.bigRatio ? 'big' : 'reg';
    }
    const heldRoleId = pendingBonus
      ? (yakuList.internalRoles.find(
          (r) =>
            r.displayYakuId ===
            (pendingBonus === 'big'
              ? yakuList.premiumYaku[0]?.id
              : yakuList.bonusYaku[0]?.id),
        )?.id ?? null)
      : null;
    const heldYaku =
      pendingBonus && !bonusActive
        ? ((pendingBonus === 'big' ? yakuList.premiumYaku[0] : yakuList.bonusYaku[0]) ??
          null)
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
        ? tuning.effectRates.bonus
        : state === 'rescue'
          ? tuning.effectRates.rescue
          : tuning.effectRates.default;

    let effect: 'none' | 'shisa' | 'quiz' | 'aim';
    if (heldYaku || carried) {
      effect = 'none';
    } else if (yaku) {
      const cands: ('none' | 'shisa' | 'quiz' | 'aim')[] = [
        'none',
        ...eligibility.eligibleEffects(yaku),
      ];
      effect = pickWeighted(cands, (e) => rates[e]);
    } else {
      effect = 'none';
    }
    const shisaTier = effect === 'shisa' && yaku ? eligibility.pickTier(yaku, rng) : null;

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

    const seq = [0, 1, 2];
    const stopped: (VisibleColumn | null)[] = [null, null, null];
    const stoppedPos: (number | null)[] = [null, null, null];
    const slipPerReel: number[] = [0, 0, 0];

    const flagIdsNow = (): string[] => {
      if (role.kind === 'miss') return [];
      if (role.kind === 'single') return singleIds;
      if (!role.yakuId) return [];
      return bonusActive ? [role.yakuId, ...singleIds] : [role.yakuId];
    };

    let shisaGuess: Yaku | null = null;
    if (effect === 'shisa' && shisaTier && yaku) {
      const cands = eligibility.candidatesFor(shisaTier, state);
      shisaGuess = cands.length > 0 ? cands[Math.floor(rng() * cands.length)] : yaku;
    }
    const carriedNoticed = !carried || rng() < READ_REACH;
    let escalated = false;
    let stopN = 0;

    // --- 計装: 主となる「狙っている役」の生存ラインを追う ---
    const winTargets: Yaku[] =
      role.kind === 'single'
        ? [...singleYakus]
        : yaku
          ? [yaku]
          : [];
    const phase = bonusActive ? 'ボ中' : '通常';
    const kindLabel = role.kind;
    let alive: { y: Yaku; line: Payline }[] = winTargets.flatMap((y) =>
      PAYLINES.map((line) => ({ y, line })),
    );
    let failedAlready = winTargets.length === 0;

    for (const idx of seq) {
      const flagIds = flagIdsNow();
      const cells = reels[idx];

      const delayGuess =
        delayed && effect === 'none' && !carried && !heldYaku
          ? (yakuList.premiumYaku[0] ?? null)
          : null;
      const target = role.yakuId ? (yakuById.get(role.yakuId) ?? null) : null;
      const aimYaku =
        effect === 'shisa' && !escalated
          ? shisaGuess
          : effect === 'none' && delayGuess && !carriedNoticed
            ? delayGuess
            : (target ?? delayGuess);
      const canAim =
        effect !== 'none' ||
        delayGuess !== null ||
        (carried !== null && carriedNoticed) ||
        heldYaku !== null;
      const sym = canAim && aimYaku ? aimYaku.symbols[idx] : undefined;
      let aimErrThisStop: number | null = null;
      let basePos: number;
      if (sym === undefined) {
        basePos = Math.floor(rng() * N);
      } else {
        const row = primaryRowOf(idx);
        const start = Math.floor(rng() * N);
        let intended = start;
        for (let d = 0; d < N; d++) {
          const p = (start + d) % N;
          if (visibleAt(cells, p, row) === sym) {
            intended = p;
            break;
          }
        }
        const err = Math.round(gauss() * sigmaCells);
        basePos = (((intended + err) % N) + N) % N;
        aimErrThisStop = aimYaku === target ? err : null;
      }

      // --- 計装: この停止で何が可能だったか ---
      const aliveBeforeThis = alive.length;
      const ctx: SlipContext = {
        reelIndex: idx,
        basePosition: basePos,
        strip: { id: `r${idx}`, cells },
        stoppedVisibles: stopped,
        exceptYakuIds: flagIds,
      };
      let reachAny = false;
      let cleanAny = false;
      // 主ラインだけに限った版（制御が実際に狙う対象）
      let reachPri = false;
      let cleanPri = false;
      if (!failedAlready && alive.length > 0) {
        for (const { y, line } of alive) {
          const isPri = line.id === PRIMARY_PAYLINE.id;
          const s = y.symbols[idx];
          if (s === undefined) {
            reachAny = true;
            cleanAny = true;
            if (isPri) {
              reachPri = true;
              cleanPri = true;
            }
            continue;
          }
          const row = rowOnLine(line, idx);
          if (row === undefined) continue;
          const vert = ROWV[row];
          for (let off = 0; off <= PULL; off++) {
            if (visibleAt(cells, (basePos + off) % N, vert) === s) {
              reachAny = true;
              if (isPri) reachPri = true;
              break;
            }
          }
          const a = slip.resolveAssist(ctx, s, vert, PULL);
          if (a !== null) {
            cleanAny = true;
            if (isPri) cleanPri = true;
          }
        }
      }

      const slipCells = stopController.resolveSlip({
        reelIndex: idx,
        basePosition: basePos,
        strip: { id: `r${idx}`, cells },
        stoppedVisibles: stopped,
        stoppedPositions: stoppedPos,
        flagYakuIds: flagIds,
        flagKey: heldYaku ? heldRoleId : role.roleId,
      });
      slipPerReel[idx] = slipCells;
      const pos = (basePos + slipCells) % N;
      stopped[idx] = visCol(cells, pos);
      stoppedPos[idx] = pos;
      stopN++;

      // --- 計装: 生存ラインの更新と失敗の分類 ---
      if (!failedAlready) {
        const before = alive.length;
        alive = alive.filter(({ y, line }) => {
          const s = y.symbols[idx];
          if (s === undefined) return true;
          const row = rowOnLine(line, idx);
          if (row === undefined) return true;
          return visibleAt(cells, pos, ROWV[row]) === s;
        });
        if (aimErrThisStop !== null && aliveBeforeThis > 0) {
          const e = Math.max(-6, Math.min(6, aimErrThisStop));
          const ek = `reel${idx}|err=${e > 0 ? '+' + e : e}`;
          const a = acc.aimErr.get(ek) ?? [0, 0];
          a[0]++;
          if (alive.length > 0) a[1]++;
          acc.aimErr.set(ek, a);
        }
        const tk = `${phase}|${stopN}`;
        const t = acc.stopTrials.get(tk) ?? [0, 0];
        t[0]++;
        if (alive.length > 0) t[1]++;
        acc.stopTrials.set(tk, t);
        if (before > 0 && alive.length === 0) {
          failedAlready = true;
          // 1枚役が代わりに成立したか（横取り）
          const partial: (VisibleColumn | null)[] = [...stopped];
          const singleLanded = singleYakus.some((sy) =>
            PAYLINES.some((line) =>
              line.cells.slice(0, sy.symbols.length).every(([r, c]) => {
                const v = partial[c];
                return v !== null && v[ROWV[r]] === sy.symbols[c];
              }),
            ),
          );
          const isBonusSpill = bonusActive && role.kind !== 'single' && !!yaku;
          const fk = heldYaku ? heldRoleId : role.roleId;
          const tabled =
            stopN === 1
              ? stopTable.firstStopSlip(fk ?? '', idx, basePos)
              : stopN === 2
                ? stopTable.secondStopSlip(
                    fk ?? '',
                    stoppedPos[0] as number,
                    basePos,
                    isBonusSpill,
                  )
                : stopTable.thirdStopSlip(
                    fk ?? '',
                    stoppedPos[0] as number,
                    stoppedPos[1] as number,
                    basePos,
                    isBonusSpill,
                  );
          // 主ライン基準（制御が実際に狙う範囲）で分類する。
          // 主ラインに届かないが他ラインには届いた分は「f_他ライン限定」＝1本狙いの構造コスト。
          const reason = !reachPri
            ? reachAny
              ? 'f_他ラインのみ'
              : 'a_窓外'
            : !cleanPri
              ? cleanAny
                ? 'f_他ラインのみ'
                : 'b_ロック'
              : singleLanded
                ? 'd_1枚役'
                : tabled !== null && tabled === slipCells
                  ? 'c_表'
                  : 'e_他';
          bump(acc.fail, `${phase}|${kindLabel}|${stopN}停|${reason}`);
          bump(acc.fail2, `${phase}|${stopN}停|失敗`);
          if (reachAny) bump(acc.fail2, `${phase}|${stopN}停|窓内(全5ライン)`);
          if (reachPri) bump(acc.fail2, `${phase}|${stopN}停|窓内(主ライン)`);
          if (cleanAny) bump(acc.fail2, `${phase}|${stopN}停|クリーン(全5ライン)`);
          if (cleanPri) bump(acc.fail2, `${phase}|${stopN}停|クリーン(主ライン)`);
        }
      }

      if (effect === 'shisa' && !escalated && stopN < 3 && yaku) {
        const sy = yaku.symbols[idx];
        const v = stopped[idx]!;
        if (sy !== undefined && (v.top === sy || v.middle === sy || v.bottom === sy)) {
          escalated = true;
        }
      }
    }

    const grid = buildGrid(stopped as VisibleColumn[]);
    const flagId = role.yakuId;
    const outcome = roundResolver.resolve({
      grid,
      flagYakuIds: flagIdsNow(),
      bonusActive,
      streakBefore: streak,
      noticeYakuId: (effect === 'aim' || effect === 'quiz') && flagId ? flagId : null,
      slipCells: slipPerReel,
    });
    const { hits, willHit, streakAfter, win } = outcome;

    // 内部役ごとの成立率と払出
    const rk = `${phase}|${role.roleId}`;
    const r0 = acc.byRole.get(rk) ?? [0, 0, 0];
    r0[0]++;
    if (role.kind === 'single' ? outcome.singleHits.length > 0 : willHit) r0[1]++;
    r0[2] += win;
    acc.byRole.set(rk, r0);

    // ライン別
    for (const h of [...hits, ...outcome.singleHits]) {
      const key = `${h.paylineId === PRIMARY_PAYLINE.id ? '主' : '他'}|${h.paylineId}|${h.yaku.category}`;
      const cur = acc.byLine.get(key) ?? [0, 0];
      cur[0]++;
      cur[1] += calc.calc(h.yaku, bonusActive, outcome.streakMult);
      acc.byLine.set(key, cur);
    }

    // 1ゲームあたり何本のラインで成立したか（重複払いの実測）
    if (hits.length > 0) {
      const cat = hits[0].yaku.category;
      bump(acc.multi, `${phase}|${cat}|${hits.length}本`);
    }
    if (outcome.singleHits.length > 0) bump(acc.multi, `${phase}|single|${outcome.singleHits.length}本`);

    if (bonusActive && !willHit) {
      acc.spillSpins++;
      acc.spillCoins += outcome.singleWin;
    }

    streak = streakAfter;
    missStreak = willHit ? 0 : missStreak + 1;
    acc.win += win;
    if (bonusActive) curBonusPayout += win;
    else acc.normalWin += win;

    const isPremiumNow = hits.some((h) => h.yaku.category === 'premium');
    const isRegNow = !isPremiumNow && hits.some((h) => h.yaku.category === 'bonus');
    if (pendingBonus && (isPremiumNow || isRegNow)) pendingBonus = null;
    if (isPremiumNow || isRegNow) {
      heldBonusYaku = null;
    } else if (
      !pendingBonus &&
      !bonusActive &&
      yaku &&
      (yaku.category === 'premium' || yaku.category === 'bonus')
    ) {
      heldBonusYaku = yaku;
    }
    if (
      !pendingBonus &&
      !bonusActive &&
      hits.some((h) => h.yaku.category === 'cherry') &&
      rng() < tuning.cherryBonus.rate
    ) {
      pendingBonus = rng() < tuning.cherryBonus.bigRatio ? 'big' : 'reg';
    }

    if (isPremiumNow || isRegNow) {
      if (!bonusActive) {
        curBonusKind = isPremiumNow ? 'big' : 'reg';
        curBonusPayout = 0;
        if (isPremiumNow) acc.big++;
        else acc.reg++;
      }
      bonusRemaining += isPremiumNow ? tuning.bonus.spinsPerBig : tuning.bonus.spinsPerReg;
    }
    if (bonusActive) {
      bonusRemaining--;
      if (bonusRemaining === 0) {
        if (curBonusKind === 'big') acc.bigPayout += curBonusPayout;
        else if (curBonusKind === 'reg') acc.regPayout += curBonusPayout;
        curBonusKind = null;
        curBonusPayout = 0;
      }
    }
  }
}

describe.skipIf(!RUN)('取りこぼしの内訳', () => {
  it('主ラインごとに、どこで役を落としているかを分解する', () => {
    const acc = newAcc();
    CHAPTERS.forEach((ch, i) => {
      runChapter(ch, Math.floor(SPINS / CHAPTERS.length), 12345 + i * 977, acc);
    });

    const out: string[] = [];
    out.push(`主ライン=${PRIMARY_PAYLINE.id} 停止表=${STOPS} 配列=${REELS} ${SPINS}G`);
    const rtp = (acc.win / acc.bet) * 100;
    const normalSpins = acc.spins - acc.bonusSpins;
    const bonusWin = acc.win - acc.normalWin;
    const bonusBet = acc.bet - acc.normalBet;
    out.push(
      `機械割 ${rtp.toFixed(1)}%  通常時純増 ${((acc.normalWin - acc.normalBet) / Math.max(1, normalSpins)).toFixed(3)}枚/G  ` +
        `ボ中純増 ${((bonusWin - bonusBet) / Math.max(1, acc.bonusSpins)).toFixed(3)}枚/G`,
    );
    out.push(
      `突入 1/${(acc.spins / Math.max(1, acc.big + acc.reg)).toFixed(0)}  ` +
        `BIG平均 ${(acc.bigPayout / Math.max(1, acc.big)).toFixed(0)}枚  ` +
        `REG平均 ${(acc.regPayout / Math.max(1, acc.reg)).toFixed(0)}枚  ` +
        `ボ中G ${acc.bonusSpins}(${((acc.bonusSpins / acc.spins) * 100).toFixed(1)}%)`,
    );
    out.push(
      `ボ中こぼし ${((acc.spillSpins / Math.max(1, acc.bonusSpins)) * 100).toFixed(1)}%  ` +
        `そのうち1枚役回収 ${acc.spillCoins}枚`,
    );

    out.push('\n--- 内部役ごと（通常時 / ボーナス中）---');
    out.push('局面  内部役            抽選     成立    成立率     払出   枚/G');
    const roleRows = [...acc.byRole.entries()].sort((a, b) => {
      const [pa, ra] = a[0].split('|');
      const [pb, rb] = b[0].split('|');
      return pa === pb ? b[1][0] - a[1][0] : pa < pb ? -1 : 1;
    });
    for (const [k, v] of roleRows) {
      const [ph, rid] = k.split('|');
      out.push(
        `${ph.padEnd(5)} ${rid.padEnd(16)}${v[0].toString().padStart(7)}` +
          `${v[1].toString().padStart(9)}${((v[1] / Math.max(1, v[0])) * 100).toFixed(1).padStart(9)}%` +
          `${v[2].toString().padStart(9)}${(v[2] / Math.max(1, v[0])).toFixed(2).padStart(7)}`,
      );
    }

    out.push('\n--- 停止ごとの生存率（狙った役がまだ揃いうる割合）---');
    out.push('局面  停止   試行     生存    生存率');
    for (const [k, v] of [...acc.stopTrials.entries()].sort()) {
      const [ph, sn] = k.split('|');
      out.push(
        `${ph.padEnd(5)} 第${sn}${v[0].toString().padStart(8)}${v[1].toString().padStart(9)}` +
          `${((v[1] / Math.max(1, v[0])) * 100).toFixed(1).padStart(9)}%`,
      );
    }

    out.push('\n--- 失敗の内訳（局面 × 内部役kind × 第N停止 × 理由）---');
    const failRows = [...acc.fail.entries()].sort((a, b) => b[1] - a[1]);
    const totalFail = failRows.reduce((s, r) => s + r[1], 0);
    out.push(`合計 ${totalFail} 件`);
    out.push('局面  kind      停止   理由        件数     比率');
    for (const [k, v] of failRows) {
      const [ph, kind, sn, reason] = k.split('|');
      out.push(
        `${ph.padEnd(5)} ${kind.padEnd(9)} ${sn.padEnd(5)} ${reason.padEnd(10)}` +
          `${v.toString().padStart(7)}${((v / Math.max(1, totalFail)) * 100).toFixed(1).padStart(8)}%`,
      );
    }

    out.push('\n--- 理由の小計 ---');
    const byReason = new Map<string, number>();
    const byPhaseStop = new Map<string, number>();
    for (const [k, v] of acc.fail) {
      const [ph, , sn, reason] = k.split('|');
      bump(byReason, `${ph}|${reason}`, v);
      bump(byPhaseStop, `${ph}|${sn}`, v);
    }
    for (const [k, v] of [...byReason.entries()].sort()) {
      out.push(`${k.padEnd(16)}${v.toString().padStart(8)}${((v / Math.max(1, totalFail)) * 100).toFixed(1).padStart(8)}%`);
    }
    out.push('');
    for (const [k, v] of [...byPhaseStop.entries()].sort()) {
      out.push(`${k.padEnd(16)}${v.toString().padStart(8)}${((v / Math.max(1, totalFail)) * 100).toFixed(1).padStart(8)}%`);
    }

    out.push('\n--- 失敗停止の可能性クロス（分母=その局面/停止の失敗件数）---');
    for (const [k, v] of [...acc.fail2.entries()].sort()) {
      out.push(`${k.padEnd(34)}${v.toString().padStart(8)}`);
    }

    out.push('\n--- 狙った停止の押下誤差 err と生存率（err>0 = 押し遅れ）---');
    out.push('リール  err    試行      生存    生存率');
    for (const [k, v] of [...acc.aimErr.entries()].sort()) {
      const [rl, e] = k.split('|');
      out.push(
        `${rl.padEnd(7)}${e.padEnd(8)}${v[0].toString().padStart(7)}${v[1].toString().padStart(9)}` +
          `${((v[1] / Math.max(1, v[0])) * 100).toFixed(1).padStart(9)}%`,
      );
    }

    out.push('\n--- 1ゲームで成立したライン本数 ---');
    for (const [k, v] of [...acc.multi.entries()].sort()) {
      out.push(`${k.padEnd(24)}${v.toString().padStart(8)}`);
    }

    out.push('\n--- 成立ラインの内訳 ---');
    for (const [k, v] of [...acc.byLine.entries()].sort()) {
      out.push(`${k.padEnd(16)}${v[0].toString().padStart(8)}回${v[1].toString().padStart(9)}枚`);
    }

    console.log('\n' + out.join('\n'));
    expect(acc.spins).toBeGreaterThan(0);
  }, 900000);
});
