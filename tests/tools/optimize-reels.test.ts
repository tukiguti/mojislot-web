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
 * 目的関数 = ②の件数（主）＋ 図柄の最大間隔（副・引き込み到達性）。
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
): number[] {
  const yakus = [
    ...yakuList.coreYaku,
    ...yakuList.cherryYaku,
    ...yakuList.bonusYaku,
    ...yakuList.premiumYaku,
  ];
  return yakus.map((y) => {
    const role = yakuList.internalRoles.find(
      (r) => r.displayYakuId === y.id && !r.freeze,
    );
    const flagKey = role?.id ?? y.id;
    let hit = 0;
    let tried = 0;
    for (let p0 = 0; p0 < N; p0 += step) {
      for (let p1 = 0; p1 < N; p1 += step) {
        for (let p2 = 0; p2 < N; p2 += step) {
          tried++;
          const grid = playPress(controller, reels, [p0, p1, p2], [y.id], flagKey);
          if (judge.judgeAll(grid).hits.some((h) => h.yaku.id === y.id)) hit++;
        }
      }
    }
    return tried > 0 ? hit / tried : 0;
  });
}

/**
 * 到達率からスコアを作る（**大きいほど良い**）。
 * 平均だけだと一部の役が極端に狙いにくいまま放置されるので最小値を重く見る
 * （28章の「どの役も同じくらい狙いやすい」を配列側で担保する）。
 */
function reachScore(rates: readonly number[]): number {
  const avg = rates.reduce((a, b) => a + b, 0) / rates.length;
  return avg + 2 * Math.min(...rates);
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

function valid(reel: string[], pool: string[]): boolean {
  const counts = new Map<string, number>();
  for (const c of reel) counts.set(c, (counts.get(c) ?? 0) + 1);
  return pool.every((c) => (counts.get(c) ?? 0) >= 2);
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
        let curReach = reachScore(reachableRates(yakuList, cur, curCtrl, judge, REACH_STEP));
        let best = cur.map((r) => [...r]);
        let bestLeaks = curLeaks;
        let bestGap = curGap;
        let bestReach = curReach;
        const t0 = Date.now();
        console.log(
          `\n[${chapter}] 初期 ②=${curLeaks} 間隔=${curGap} 到達=${curReach.toFixed(4)}` +
            (REACH_MODE ? ` (reachモード・主ライン ${PRIMARY_PAYLINE.id})` : ''),
        );

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
          if (!valid(next[i], pools[i])) continue;

          const T = 6 * Math.pow(0.02 / 6, iter / MAX_ITER);
          const nextCtrl = makeController(yakuList, next, resolver);
          const leaks = countLeaks(
            yakuList, next, resolver, judge, curLeaks + 40, nextCtrl, SCAN_ORDERS, SCAN_STEP,
          );
          const gap = gapPenalty(next, pools);
          const reach = reachScore(
            reachableRates(yakuList, next, nextCtrl, judge, REACH_STEP),
          );
          // reach モードでは②を**ハード制約**にし（1件でも大ペナルティ）、
          // その上で到達率を上げる。既定モードは従来どおり②＋間隔。
          const d = REACH_MODE
            ? (leaks - curLeaks) * 100000 - (reach - curReach) * 10000
            : (leaks - curLeaks) * 100 + (gap - curGap);
          if (d < 0 || rng() < Math.exp(-d / (T * 100))) {
            cur = next;
            curLeaks = leaks;
            curGap = gap;
            curReach = reach;
            const improved = REACH_MODE
              ? leaks === 0 && (bestLeaks > 0 || reach > bestReach)
              : leaks < bestLeaks || (leaks === bestLeaks && gap < bestGap);
            if (improved) {
              best = next.map((r) => [...r]);
              bestLeaks = leaks;
              bestGap = gap;
              bestReach = reach;
              console.log(
                `  iter=${iter} ②=${leaks} 間隔=${gap} 到達=${reach.toFixed(4)} (${((Date.now() - t0) / 1000).toFixed(0)}s)`,
              );
            }
          }
        }

        console.log(
          `[${chapter}] 結果 ②=${bestLeaks} 間隔=${bestGap} 到達=${bestReach.toFixed(4)} ${((Date.now() - t0) / 1000).toFixed(0)}s`,
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
        if (verified === 0) {
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
          console.log(`[${chapter}] ②が残ったので書き出さない`);
        }
      }
    },
    3600_000,
  );
});
