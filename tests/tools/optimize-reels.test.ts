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
import type { Grid3x3 } from '../../src/core/Paylines';
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

const STOP_ORDERS: readonly (readonly number[])[] = [
  [0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0],
];

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
        for (let d = 0; d <= PULL_IN; d++) {
          const cand = (slip + d) % (PULL_IN + 1);
          if (!forbidden.has(cells[(press + cand) % N])) return cand;
        }
        return slip;
      });
    });
  }
  return { mode: 'opt', firstStop };
}

/** ②の件数。cutoff を超えた時点で打ち切る（焼きなましの棄却は早い方が速い）。 */
function countLeaks(
  yakuList: YakuList,
  reels: string[][],
  resolver: SlipResolver,
  judge: YakuJudge,
  cutoff = Infinity,
): number {
  const stopTable = new StopTableLookup(
    StopTableSchema.parse(buildStopTable(yakuList, reels, resolver)),
  );
  const controller = new StopController({
    yakuList,
    slipResolver: resolver,
    tenpaiDetector: new TenpaiDetector(yakuList),
    stopTable,
    pullInCells: PULL_IN,
  });
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
    for (const order of STOP_ORDERS) {
      for (let p0 = 0; p0 < N; p0++) {
        for (let p1 = 0; p1 < N; p1++) {
          for (let p2 = 0; p2 < N; p2++) {
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
        let curLeaks = countLeaks(yakuList, cur, resolver, judge);
        let curGap = gapPenalty(cur, pools);
        let best = cur.map((r) => [...r]);
        let bestLeaks = curLeaks;
        let bestGap = curGap;
        const t0 = Date.now();
        console.log(`\n[${chapter}] 初期 ②=${curLeaks} 間隔=${curGap}`);

        const rng = makeRng(20260727);
        for (let iter = 0; iter < MAX_ITER && bestLeaks > 0; iter++) {
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
          const leaks = countLeaks(yakuList, next, resolver, judge, curLeaks + 40);
          const gap = gapPenalty(next, pools);
          const d = (leaks - curLeaks) * 100 + (gap - curGap);
          if (d < 0 || rng() < Math.exp(-d / (T * 100))) {
            cur = next;
            curLeaks = leaks;
            curGap = gap;
            if (leaks < bestLeaks || (leaks === bestLeaks && gap < bestGap)) {
              best = next.map((r) => [...r]);
              bestLeaks = leaks;
              bestGap = gap;
              console.log(`  iter=${iter} ②=${leaks} 間隔=${gap} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
            }
          }
        }

        console.log(`[${chapter}] 結果 ②=${bestLeaks} 間隔=${bestGap} ${((Date.now() - t0) / 1000).toFixed(0)}s`);
        if (bestLeaks === 0) {
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
