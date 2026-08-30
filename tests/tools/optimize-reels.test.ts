import { describe, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { SlipResolver, type VisibleColumn } from '../../src/productions/SlipResolver';
import { YakuJudge } from '../../src/core/YakuJudge';
import { StopController } from '../../src/core/StopController';
import { StopTableLookup } from '../../src/core/StopTable';
import { TenpaiDetector } from '../../src/productions/TenpaiDetector';
import {
  YakuListSchema,
  ReelConfigSchema,
  TuningSchema,
  StopTableSchema,
  type YakuList,
} from '../../src/data/schemas';
import {
  PRIMARY_PAYLINE,
  primaryRowOf,
  visibleAt,
  type Grid3x3,
  type Vertical,
} from '../../src/core/Paylines';
import { flagYakusFor, bonusOnlySymbols, computeFirstStopSlip } from './gen-stop-table.test';

/**
 * リール配列の再最適化（②＝「揃って見えるのに0枚」をゼロにする）。
 *
 *   OPT=1 npx vitest run tests/tools/optimize-reels.test.ts --disable-console-intercept
 *   OPT=1 OPT_CHAPTERS=security OPT_ITER=800 npx vitest run ...
 *
 * 役を差し替えると、文字の重なり方が変わって②が復活する（[26] の焼きなましは
 * その時の役セットに対する解でしかない）。ここはその再探索を**リポジトリに残す**ためのもの。
 * 前回はスクリプトが残っておらず、役を変えるたびに手法から書き直す羽目になった。
 *
 * 目的関数 = ②の件数（主）＋ 横3ライン同時テンパイの件数（ハード制約・②と同じ重み）
 * ＋ 図柄の最大間隔（副・引き込み到達性）。
 * 近傍 = 同一リール内のスワップ／文字の置換（枚数が動く）。制約 = 各文字が最低2枚。
 */

const RUN = process.env.OPT === '1';
const DIR = dirname(fileURLToPath(import.meta.url));
const DATA = resolve(DIR, '../../data');
const readJson = (p: string) => JSON.parse(readFileSync(p, 'utf-8'));

const CHAPTERS = (
  process.env.OPT_CHAPTERS ?? 'hiragana_food,katakana_animal,security,yasai'
).split(',');
const MAX_ITER = Number(process.env.OPT_ITER ?? 600);
const PULL_IN = 4;
const N = 21;
/**
 * `OPT_MODE=reach` で「②＝0 を保ったまま**狙いやすさ**を上げる」モードになる。
 *
 * 既定モードは②をゼロにした時点で打ち切る。5ラインなら他のラインへ逃げられるので
 * それで足りていたが、1ライン化すると逃げ場が無く、有効ライン上に役の文字が
 * 来るかどうかが取りこぼしに直結する。そこを配列側で最適化するためのモード。
 */
const REACH_MODE = process.env.OPT_MODE === 'reach';
/**
 * 到達率を測るときの押下位置の間引き幅。21³ を毎イテレーション回すと重いので、
 * 焼きなまし中は 3 コマおき（7³＝343通り）で方向づけだけする。
 * 最終確認は `OPT_REACH_STEP=1` で全数を回して確かめる。
 */
const REACH_STEP = Number(process.env.OPT_REACH_STEP ?? 3);
/**
 * ②評価を間引く設定。**既定は間引かない（全数・全押し順）。**
 *
 * 速くするために押し順を順押しだけに絞り、押下位置を2コマおきにして試したが、
 * **②を見逃す**。実測で「間引き評価では②＝0、全数検証では②＝227件」となり、
 * しかも227件は**すべて逆押し由来**だった。押し順を削ると②が逆押しに逃げるので、
 * ここは削れない。
 *
 * 環境変数は実験用に残してあるが、使うと②を見逃す。使った場合でも
 * 書き出し前の全数検証で止まるので、壊れた配列が採用されることはない。
 */
const SCAN_STEP = Number(process.env.OPT_LEAK_STEP ?? 1);


const STOP_ORDERS: readonly (readonly number[])[] = [
  [0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0],
];

/** ②評価で試す停止順。既定は全6通り（`OPT_LEAK_ORDERS=first` で順押しのみ＝実験用）。 */
const SCAN_ORDERS: readonly (readonly number[])[] =
  process.env.OPT_LEAK_ORDERS === 'first' ? [[0, 1, 2]] : STOP_ORDERS;

function visCol(cells: readonly string[], pos: number): VisibleColumn {
  return {
    top: cells[(pos + 1) % N],
    middle: cells[pos],
    bottom: cells[((pos - 1) % N + N) % N],
  };
}

/** 配列から第1停止テーブルを組む（gen-stop-table と同じ計算）。 */
function buildStopTable(yakuList: YakuList, reels: string[][], resolver: SlipResolver) {
  const firstStop: Record<string, number[][]> = {};
  for (const role of yakuList.internalRoles) {
    const targets = flagYakusFor(yakuList, role.id);
    const isBonusFlag = role.kind === 'reg' || role.kind === 'big';
    firstStop[role.id] = [0, 1, 2].map((reel) => {
      const cells = reels[reel];
      const forbidden = isBonusFlag
        ? new Set<string>()
        : bonusOnlySymbols(yakuList, reel);
      return Array.from({ length: N }, (_, press) => {
        const slip = computeFirstStopSlip(resolver, targets, cells, reel, press, PULL_IN);
        if (forbidden.size === 0) return slip;
        // ボーナス専用図柄を主ライン上に残さない（gen-stop-table と同じ規則）。
        const row = primaryRowOf(reel);
        for (let d = 0; d <= PULL_IN; d++) {
          const cand = (slip + d) % (PULL_IN + 1);
          if (!forbidden.has(visibleAt(cells, (press + cand) % N, row))) return cand;
        }
        return slip;
      });
    });
  }
  return { mode: 'opt', firstStop };
}

/** その配列に対する停止制御一式（②の計測と到達率の計測で共有する）。 */
function makeController(
  yakuList: YakuList,
  reels: string[][],
  resolver: SlipResolver,
): StopController {
  return new StopController({
    yakuList,
    slipResolver: resolver,
    tenpaiDetector: new TenpaiDetector(yakuList),
    stopTable: new StopTableLookup(
      StopTableSchema.parse(buildStopTable(yakuList, reels, resolver)),
    ),
    pullInCells: PULL_IN,
  });
}

/** press[] で3リールを順に止めた結果の出目。 */
function playPress(
  controller: StopController,
  reels: string[][],
  press: readonly number[],
  flagIds: readonly string[],
  flagKey: string,
  order: readonly number[] = [0, 1, 2],
): Grid3x3 {
  const stopped: (VisibleColumn | null)[] = [null, null, null];
  for (const idx of order) {
    const slip = controller.resolveSlip({
      reelIndex: idx,
      basePosition: press[idx],
      strip: { id: `r${idx}`, cells: reels[idx] },
      stoppedVisibles: stopped,
      flagYakuIds: flagIds,
      flagKey,
    });
    stopped[idx] = visCol(reels[idx], (press[idx] + slip) % N);
  }
  const s = stopped as VisibleColumn[];
  return [
    [s[0].top, s[1].top, s[2].top],
    [s[0].middle, s[1].middle, s[2].middle],
    [s[0].bottom, s[1].bottom, s[2].bottom],
  ];
}

/**
 * ②の件数。cutoff を超えた時点で打ち切る（焼きなましの棄却は早い方が速い）。
 *
 * **打ち切りは②が出る配列でしか効かない。** ②＝0を保っている間は最後まで
 * 回りきるので、②が出にくい島ほど1イテレーションが重くなる（セキュリティ島は
 * 他島の20倍＝1回64秒だった）。焼きなまし中は `orders` を順押しのみ・`step` を
 * 2以上にして間引き、方向づけだけする。**最終確認は必ず全数・全押し順で回すこと。**
 *
 * @param orders 試す停止順（既定は全6通り）
 * @param step   押下位置の間引き幅（既定は1＝全数）
 */
function countLeaks(
  yakuList: YakuList,
  reels: string[][],
  resolver: SlipResolver,
  judge: YakuJudge,
  cutoff = Infinity,
  controller = makeController(yakuList, reels, resolver),
  orders: readonly (readonly number[])[] = STOP_ORDERS,
  step = 1,
): number {
  const flags: { label: string; ids: string[] }[] = [
    { label: 'miss', ids: [] },
    ...[
      ...yakuList.coreYaku,
      ...yakuList.cherryYaku,
      ...yakuList.bonusYaku,
      ...yakuList.premiumYaku,
    ].map((y) => ({ label: y.id, ids: [y.id] })),
    { label: 'single', ids: yakuList.singleYaku.map((y) => y.id) },
  ];

  let leaks = 0;
  for (const flag of flags) {
    const idSet = new Set(flag.ids);
    for (const order of orders) {
      for (let p0 = 0; p0 < N; p0 += step) {
        for (let p1 = 0; p1 < N; p1 += step) {
          for (let p2 = 0; p2 < N; p2 += step) {
            const press = [p0, p1, p2];
            const stopped: (VisibleColumn | null)[] = [null, null, null];
            for (const idx of order) {
              const slip = controller.resolveSlip({
                reelIndex: idx,
                basePosition: press[idx],
                strip: { id: `r${idx}`, cells: reels[idx] },
                stoppedVisibles: stopped,
                flagYakuIds: flag.ids,
                flagKey: flag.label,
              });
              stopped[idx] = visCol(reels[idx], (press[idx] + slip) % N);
            }
            const s = stopped as VisibleColumn[];
            const grid: Grid3x3 = [
              [s[0].top, s[1].top, s[2].top],
              [s[0].middle, s[1].middle, s[2].middle],
              [s[0].bottom, s[1].bottom, s[2].bottom],
            ];
            if (judge.judgeAll(grid).hits.some((h) => !idSet.has(h.yaku.id))) {
              leaks++;
              if (leaks > cutoff) return leaks;
            }
          }
        }
      }
    }
  }
  return leaks;
}

/**
 * 各役が**実際に揃う**押下位置の割合（0..1）。
 *
 * 「図柄がその行に届くか」だけを見ると足りない。届く位置でも、そこで非当選役が
 * ロックすると引き込みが拒否されて蹴りに落ちるからで、その分は取りこぼしになる。
 * だから停止制御を実際に通して出目を作り、役が成立したかで数える。
 *
 * 図柄の届き方はリールが円環である以上**主ラインの行に依存しない**（上段を見ようと
 * 下段を見ようと「4コマ以内に来る押下位置の割合」は同じ）。主ラインごとに差が出るのは
 * この蹴り込みの部分だけなので、ここを測らないと焼きなましが主ラインを区別できない。
 *
 * 焼きなまし中は押下位置を `step` コマおきに間引く（21³ を毎回回すと重すぎる）。
 */
function reachableRates(
  yakuList: YakuList,
  reels: string[][],
  controller: StopController,
  judge: YakuJudge,
  step: number,
  /**
   * ボーナス中として測る。許可リストに1枚役（こぼし先）が加わるので、当選役の
   * 引き込みが1枚役に横取りされないかまで含めて評価できる。ボーナス中は純増が
   * 通常時の10倍以上あり出玉の主戦場なので、ここを見ないと目的関数が実態とずれる。
   */
  asBonus = false,
): number[] {
  const yakus = [
    ...yakuList.coreYaku,
    ...yakuList.cherryYaku,
    ...yakuList.bonusYaku,
    ...yakuList.premiumYaku,
  ];
  const rates = yakus.map((y) => {
    const role = yakuList.internalRoles.find(
      (r) => r.displayYakuId === y.id && !r.freeze,
    );
    const flagKey = role?.id ?? y.id;
    // ボーナス中は1枚役が「こぼし先」として許可リストに加わる（設計: 31章）。
    const flagIds = asBonus
      ? [y.id, ...yakuList.singleYaku.map((s) => s.id)]
      : [y.id];
    let hit = 0;
    let tried = 0;
    for (let p0 = 0; p0 < N; p0 += step) {
      for (let p1 = 0; p1 < N; p1 += step) {
        for (let p2 = 0; p2 < N; p2 += step) {
          tried++;
          const grid = playPress(controller, reels, [p0, p1, p2], flagIds, flagKey);
          if (judge.judgeAll(grid).hits.some((h) => h.yaku.id === y.id)) hit++;
        }
      }
    }
    return tried > 0 ? hit / tried : 0;
  });

  // 1枚役は**グループのどれかが揃えばよい**ので、個別ではなくまとめて測る。
  // ハズレを統合した結果、当選率43%と単独で最大の役になった。ここを評価から
  // 外していたせいで到達率が 55%→29% まで落ち、こぼしの受け皿が機能しなくなった。
  const singleIds = new Set(yakuList.singleYaku.map((s) => s.id));
  let sHit = 0;
  let sTried = 0;
  if (singleIds.size > 0) {
    const ids = [...singleIds];
    for (let p0 = 0; p0 < N; p0 += step) {
      for (let p1 = 0; p1 < N; p1 += step) {
        for (let p2 = 0; p2 < N; p2 += step) {
          sTried++;
          const grid = playPress(controller, reels, [p0, p1, p2], ids, 'single');
          if (judge.judgeAll(grid).hits.some((h) => singleIds.has(h.yaku.id))) sHit++;
        }
      }
    }
  }
  return [...rates, sTried > 0 ? sHit / sTried : 1];
}

/**
 * 各役の当選率（通常時）。到達率の重みに使う。
 * 末尾は1枚役グループぶん（`reachableRates` の返り値と並びを合わせる）。
 */
function yakuWeights(yakuList: YakuList, yakus: readonly Yaku[]): number[] {
  const each = yakus.map((y) =>
    yakuList.internalRoles
      .filter((r) => r.displayYakuId === y.id)
      .reduce((a, r) => a + (r.rate?.default ?? 0), 0),
  );
  const single = yakuList.internalRoles
    .filter((r) => r.kind === 'single')
    .reduce((a, r) => a + (r.rate?.default ?? 0), 0);
  return [...each, single];
}

/**
 * 到達率からスコアを作る（**大きいほど良い**）。
 *
 * **当選率で重み付けする。** 等価に扱うと、出現率0.09%のBIGを伸ばして16.8%の
 * 小役を犠牲にする、という最適化が起きる。実際それで下段主ラインの配列が
 * 「無重みスコアは互角なのに機械割が2割低い」状態になった（頻出小役 31%→26%・
 * 稀なBIG 52%→64%）。小役4種で全体の約50%を占めるので、ここが出玉を決める。
 *
 * 最小値も少し見る。全部を重み任せにすると、稀な役が極端に狙えないまま放置され、
 * 「当たったのに揃わない」という体験が残る（28章の「どの役も同じくらい狙いやすい」）。
 */
function reachScore(
  rates: readonly number[],
  weights: readonly number[],
): number {
  const total = weights.reduce((a, b) => a + b, 0);
  const weighted =
    total > 0
      ? rates.reduce((a, r, i) => a + r * weights[i], 0) / total
      : rates.reduce((a, b) => a + b, 0) / rates.length;
  return weighted + 0.5 * Math.min(...rates);
}

/** 図柄の最大間隔の合計（小さいほど引き込みが届きやすい）。 */
function gapPenalty(reels: string[][], pools: string[][]): number {
  let total = 0;
  for (let i = 0; i < 3; i++) {
    for (const c of pools[i]) {
      const pos: number[] = [];
      reels[i].forEach((v, k) => {
        if (v === c) pos.push(k);
      });
      let worst = 0;
      for (let k = 0; k < pos.length; k++) {
        worst = Math.max(worst, (pos[(k + 1) % pos.length] - pos[k] + N) % N);
      }
      total += worst;
    }
  }
  return total;
}

/**
 * 横3ライン同時テンパイの件数（第1×第2リールの全停止位置 21×21 のうち、
 * 上段・中段・下段が**同時に**テンパイする位置の数）。**0 がハード制約**。
 *
 * 第1・第2リールで役の並び順が揃っていると、ある停止位置で3行が一斉にテンパイして
 * 見た目が不自然になり、どのラインが生きているかを読む余地も消える（2本同時は残す）。
 * ②（揃って見えるのに0枚）と同じで、出玉にもテストにも出ないまま静かに壊れるので、
 * 焼きなましの目的関数でも②と同じ重みのハード制約として扱う。
 * 監査は tests/audit/horizontal-tenpai.test.ts。
 */
function countTripleTenpai(yakuList: YakuList, reels: string[][]): number {
  // 3文字役の「左＋中」の先頭2文字＝第3リール待ちのテンパイ形。
  // 2文字役（チェリー）は左中だけで既に成立していてテンパイではないので数えない。
  const prefixes = new Set(
    [...yakuList.coreYaku, ...yakuList.premiumYaku, ...yakuList.bonusYaku]
      .filter((y) => y.symbols.length >= 3)
      .map((y) => `${y.symbols[0]} ${y.symbols[1]}`),
  );
  const rows: Vertical[] = ['top', 'middle', 'bottom'];
  let triples = 0;
  for (let p0 = 0; p0 < N; p0++) {
    for (let p1 = 0; p1 < N; p1++) {
      const a = visCol(reels[0], p0);
      const b = visCol(reels[1], p1);
      if (rows.every((r) => prefixes.has(`${a[r]} ${b[r]}`))) triples++;
    }
  }
  return triples;
}

/**
 * 各文字が最低2枚あるか。**ボーナス専用図柄だけは1枚でよい。**
 *
 * 実機のジャグラーも7は1リールに1枚しかない。稀にしか使わない図柄を2枚置くと
 * 配列を圧迫するし、1枚だから狙う価値が出る。小役は毎ゲーム引くので2枚要る。
 */
function valid(reel: string[], pool: string[], bonusOnly: ReadonlySet<string>): boolean {
  const counts = new Map<string, number>();
  for (const c of reel) counts.set(c, (counts.get(c) ?? 0) + 1);
  return pool.every((c) => (counts.get(c) ?? 0) >= (bonusOnly.has(c) ? 1 : 2));
}

/** その文字がボーナス（BIG/REG）にしか使われないか。 */
function bonusOnlySymbols(yakuList: YakuList, reel: number): Set<string> {
  const s = new Set<string>();
  for (const y of [...yakuList.premiumYaku, ...yakuList.bonusYaku]) {
    const c = y.symbols[reel];
    if (c !== undefined) s.add(c);
  }
  for (const y of [...yakuList.coreYaku, ...yakuList.cherryYaku, ...yakuList.singleYaku]) {
    const c = y.symbols[reel];
    if (c !== undefined) s.delete(c);
  }
  return s;
}

/**
 * **基準となる押下位置**があるか（第1・第2リール）。
 *
 * 実機の「左枠上に赤7を狙え」と同じで、そこを押せばボーナスもチェリーも
 * 取りこぼさない位置を作る。遅れが出ても「ボーナスかチェリーか分からないから
 * どちらを狙えばいいか決まらない」という状態を無くすため。
 *
 * BIG1用とBIG2用の**2箇所**を要求する（どちらを狙ってもよい）。REGはBIG1と
 * 頭2文字を共有するので、BIG1の基準位置でREGも拾える。
 *
 * 返すのは違反数（0が合格）。全部が届く位置が多すぎる場合も罰する——どこを
 * 押しても拾えるなら、打ち方を覚える価値が無くなる。
 */
function basePositionPenalty(yakuList: YakuList, reels: string[][]): number {
  const cherry = yakuList.cherryYaku[0];
  const bigs = yakuList.premiumYaku;
  if (!cherry || bigs.length < 2) return 0;
  let bad = 0;
  for (const r of [0, 1]) {
    const cs = cherry.symbols[r];
    const reachAt = (press: number): Set<string> =>
      new Set(Array.from({ length: PULL_IN + 1 }, (_, s) => reels[r][(press + s) % N]));
    const covers = (sym: string | undefined): number[] =>
      sym === undefined
        ? []
        : Array.from({ length: N }, (_, p) => p).filter((p) => {
            const w = reachAt(p);
            return w.has(sym) && (cs === undefined || w.has(cs));
          });
    for (const b of bigs.slice(0, 2)) {
      if (covers(b.symbols[r]).length === 0) bad += 1; // 基準位置が無い
    }
    // 3つとも届く位置＝BIG1でもBIG2でも同じ場所、が多いと打ち方が1点に潰れる。
    // 少しはあってよいが、多いと「どこでも拾える」になるので上限を置く。
    const all = Array.from({ length: N }, (_, p) => p).filter((p) => {
      const w = reachAt(p);
      return bigs.slice(0, 2).every((b) => {
        const s = b.symbols[r];
        return s !== undefined && w.has(s);
      }) && (cs === undefined || w.has(cs));
    });
    if (all.length > 3) bad += all.length - 3;
  }
  return bad;
}

/**
 * 到達率が種類ごとの帯に収まっているか。返すのは帯からの逸脱の合計（0が合格）。
 *
 * 上限が要るのは、**適当に押しても揃うなら目押しの意味が消える**ため。
 * 下限が要るのは、当たったのに揃わない体験を残さないため。
 * 順序（ボーナス < チェリー < 小役）も見る。絶対値より順序のほうが安定する。
 */
const REACH_BAND: Record<string, [number, number]> = {
  premium: [0.20, 0.35],
  bonus: [0.20, 0.35],
  cherry: [0.30, 0.45],
  core: [0.30, 0.55],
};

function bandPenalty(yakus: readonly Yaku[], rates: readonly number[]): number {
  let pen = 0;
  const byCat: Record<string, number[]> = { premium: [], bonus: [], cherry: [], core: [] };
  yakus.forEach((y, i) => {
    const band = REACH_BAND[y.category];
    const r = rates[i];
    if (!band || r === undefined) return;
    byCat[y.category]?.push(r);
    if (r < band[0]) pen += band[0] - r;
    if (r > band[1]) pen += r - band[1];
  });
  // 順序：ボーナスの最大 < チェリーの最小、チェリーの最大 < 小役の最小
  const bonusMax = Math.max(0, ...byCat.premium, ...byCat.bonus);
  const cherryMin = byCat.cherry.length ? Math.min(...byCat.cherry) : Infinity;
  const cherryMax = byCat.cherry.length ? Math.max(...byCat.cherry) : 0;
  const coreMin = byCat.core.length ? Math.min(...byCat.core) : Infinity;
  if (bonusMax > cherryMin) pen += bonusMax - cherryMin;
  if (cherryMax > coreMin) pen += cherryMax - coreMin;
  return pen;
}

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

describe.skipIf(!RUN)('リール配列の再最適化', () => {
  it(
    '②がゼロになる配列を探し、data/reels へ書き出す',
    () => {
      const tuning = TuningSchema.parse(readJson(`${DATA}/tuning/default.json`));
      for (const chapter of CHAPTERS) {
        const yakuList = YakuListSchema.parse(readJson(`${DATA}/yaku/${chapter}.json`));
        const reelCfg = ReelConfigSchema.parse(readJson(`${DATA}/reels/${chapter}.json`));
        const resolver = new SlipResolver(yakuList, {
          assistMaxCells: tuning.assist.pullInCells,
        });
        const judge = new YakuJudge(yakuList);

        let cur = reelCfg.reels.map((r) => [...r.cells]);
        const pools = cur.map((r) => [...new Set(r)]);
        let curCtrl = makeController(yakuList, cur, resolver);
        let curLeaks = countLeaks(
          yakuList, cur, resolver, judge, Infinity, curCtrl, SCAN_ORDERS, SCAN_STEP,
        );
        let curGap = gapPenalty(cur, pools);
        let curTriples = countTripleTenpai(yakuList, cur);
        // 到達率の重み（当選率）は配列を変えても不変なので一度だけ作る。
        const scoreYakus = [
          ...yakuList.coreYaku,
          ...yakuList.cherryYaku,
          ...yakuList.bonusYaku,
          ...yakuList.premiumYaku,
        ];
        const weights = yakuWeights(yakuList, scoreYakus);
        /** 到達率の帯を見る対象（1枚役グループは帯の外なので除く）。 */
        const scoredYakus = scoreYakus;
        /** ボーナス専用図柄はリールに1枚でよい（実機の7と同じ）。 */
        const bonusOnly = [0, 1, 2].map((r) => bonusOnlySymbols(yakuList, r));
        let curRates = reachableRates(yakuList, cur, curCtrl, judge, REACH_STEP);
        let curReach = reachScore(curRates, weights);
        let curBases = basePositionPenalty(yakuList, cur);
        let curBand = bandPenalty(scoredYakus, curRates);
        let best = cur.map((r) => [...r]);
        let bestLeaks = curLeaks;
        let bestGap = curGap;
        let bestReach = curReach;
        let bestTriples = curTriples;
        let bestBases = curBases;
        let bestBand = curBand;
        const t0 = Date.now();
        console.log(
          `\n[${chapter}] 初期 ②=${curLeaks} 3本同時=${curTriples} 基準=${curBases} 帯=${curBand.toFixed(3)} 到達=${curReach.toFixed(4)}` +
            (REACH_MODE ? ` (reachモード・主ライン ${PRIMARY_PAYLINE.id})` : ''),
        );
        if (process.env.OPT_DETAIL === '2') {
          // 通常時とボーナス中で到達率がどう違うかを見る。ボーナス中は純増が
          // 10倍以上あるので、ここが落ちていると出玉に直結する。
          const nml = reachableRates(yakuList, cur, curCtrl, judge, REACH_STEP);
          const bns = reachableRates(yakuList, cur, curCtrl, judge, REACH_STEP, true);
          const avg = (a: number[]) => a.reduce((x, y2) => x + y2, 0) / a.length;
          console.log(
            `  通常時 平均${(avg(nml) * 100).toFixed(1)}%  ` +
              `ボーナス中 平均${(avg(bns) * 100).toFixed(1)}%`,
          );
        }
        if (process.env.OPT_DETAIL === '1') {
          // 役ごとの到達率。平均が同じでも「どの役が弱いか」で出玉は変わる
          // （小役は頻出・BIGは稀なので、重みが違う）。
          const detail = [
            ...yakuList.coreYaku,
            ...yakuList.cherryYaku,
            ...yakuList.bonusYaku,
            ...yakuList.premiumYaku,
          ];
          const rates = reachableRates(yakuList, cur, curCtrl, judge, REACH_STEP);
          console.log(
            '  ' +
              detail
                .map((y, i) => `${y.name}:${(rates[i] * 100).toFixed(0)}%`)
                .join(' ') +
              ` 1枚役:${(rates[detail.length] * 100).toFixed(0)}%`,
          );
        }

        const rng = makeRng(20260727);
        // reach モードは②＝0でも打ち切らない（そこからが本番なので）。
        for (let iter = 0; iter < MAX_ITER && (REACH_MODE || bestLeaks > 0); iter++) {
          const next = cur.map((r) => [...r]);
          const i = Math.floor(rng() * 3);
          if (rng() < 0.5) {
            const a = Math.floor(rng() * N);
            const b = Math.floor(rng() * N);
            [next[i][a], next[i][b]] = [next[i][b], next[i][a]];
          } else {
            const p = Math.floor(rng() * N);
            next[i][p] = pools[i][Math.floor(rng() * pools[i].length)];
          }
          if (!valid(next[i], pools[i], bonusOnly[i])) continue;

          const T = 6 * Math.pow(0.02 / 6, iter / MAX_ITER);
          const nextCtrl = makeController(yakuList, next, resolver);
          const leaks = countLeaks(
            yakuList, next, resolver, judge, curLeaks + 40, nextCtrl, SCAN_ORDERS, SCAN_STEP,
          );
          const gap = gapPenalty(next, pools);
          const rates = reachableRates(yakuList, next, nextCtrl, judge, REACH_STEP);
          const reach = reachScore(rates, weights);
          const triples = countTripleTenpai(yakuList, next);
          const bases = basePositionPenalty(yakuList, next);
          const band = bandPenalty(scoredYakus, rates);
          // reach モードでは②を**ハード制約**にし（1件でも大ペナルティ）、
          // その上で到達率を上げる。既定モードは従来どおり②＋間隔。
          // 横3ライン同時テンパイ（triples）は②と同じ重みのハード制約。
          // ハード制約（②・3本同時・基準位置）は同じ重み。到達率の帯はその次に重い
          // ——上限が無いと「適当に押しても揃う」方向へ最適化が走るため。
          const d = REACH_MODE
            ? (leaks - curLeaks) * 100000 +
              (triples - curTriples) * 100000 +
              (bases - curBases) * 100000 +
              (band - curBand) * 30000 -
              (reach - curReach) * 10000
            : (leaks - curLeaks) * 100 +
              (triples - curTriples) * 100 +
              (bases - curBases) * 100 +
              (band - curBand) * 30 +
              (gap - curGap);
          if (d < 0 || rng() < Math.exp(-d / (T * 100))) {
            cur = next;
            curLeaks = leaks;
            curGap = gap;
            curReach = reach;
            curTriples = triples;
            curBases = bases;
            curBand = band;
            const hardOk = leaks === 0 && triples === 0 && bases === 0;
            const improved = REACH_MODE
              ? hardOk &&
                (bestLeaks > 0 || bestTriples > 0 || bestBases > 0 ||
                 band < bestBand - 1e-9 ||
                 (Math.abs(band - bestBand) < 1e-9 && reach > bestReach))
              : leaks + triples + bases < bestLeaks + bestTriples + bestBases ||
                (leaks === bestLeaks && triples === bestTriples && bases === bestBases &&
                 (band < bestBand - 1e-9 ||
                  (Math.abs(band - bestBand) < 1e-9 && gap < bestGap)));
            if (improved) {
              best = next.map((r) => [...r]);
              bestLeaks = leaks;
              bestGap = gap;
              bestReach = reach;
              bestTriples = triples;
              bestBases = bases;
              bestBand = band;
              console.log(
                `  iter=${iter} ②=${leaks} 3本同時=${triples} 基準=${bases} 帯=${band.toFixed(3)} 到達=${reach.toFixed(4)} (${((Date.now() - t0) / 1000).toFixed(0)}s)`,
              );
            }
          }
        }

        console.log(
          `[${chapter}] 結果 ②=${bestLeaks} 3本同時=${bestTriples} 間隔=${bestGap} 到達=${bestReach.toFixed(4)} ${((Date.now() - t0) / 1000).toFixed(0)}s`,
        );
        // 焼きなまし中は間引いて評価しているので、**採用する配列は全数・全押し順で
        // 検証し直す**。間引きで見逃した②がここで出たら書き出さない。
        const verified =
          bestLeaks === 0
            ? countLeaks(yakuList, best, resolver, judge)
            : bestLeaks;
        if (verified !== bestLeaks) {
          console.log(
            `[${chapter}] 全数検証で②=${verified}（間引き評価では0だった）`,
          );
        }
        // 横3ライン同時テンパイが残っている配列も書き出さない（②と同じ扱い）。
        if (verified === 0 && bestTriples > 0) {
          console.log(`[${chapter}] 横3ライン同時テンパイが${bestTriples}件残っている`);
        }
        if (verified === 0 && bestTriples === 0) {
          const out = {
            mode: chapter,
            reels: best.map((cells, i) => ({ id: reelCfg.reels[i].id, cells })),
          };
          const lines = ['{', `  "mode": "${chapter}",`, '  "reels": ['];
          out.reels.forEach((r, i) => {
            const arr = r.cells.map((c) => `"${c}"`).join(', ');
            lines.push('    {', `      "id": "${r.id}",`, `      "cells": [${arr}]`,
              i < 2 ? '    },' : '    }');
          });
          lines.push('  ]', '}');
          writeFileSync(`${DATA}/reels/${chapter}.json`, `${lines.join('\n')}\n`, 'utf-8');
          console.log(`[${chapter}] 書き出した`);
        } else {
          console.log(`[${chapter}] ②か横3ライン同時テンパイが残ったので書き出さない`);
        }
      }
    },
    3600_000,
  );
});
