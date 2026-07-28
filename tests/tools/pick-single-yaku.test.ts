import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  ReelConfigSchema,
  StopTableSchema,
  YakuListSchema,
  type Yaku,
  type YakuList,
} from '../../src/data/schemas';
import { YakuJudge } from '../../src/core/YakuJudge';
import { StopController } from '../../src/core/StopController';
import { StopTableLookup } from '../../src/core/StopTable';
import { SlipResolver, type VisibleColumn } from '../../src/productions/SlipResolver';
import { TenpaiDetector } from '../../src/productions/TenpaiDetector';
import type { Grid3x3 } from '../../src/core/Paylines';
import {
  flagYakusFor,
  bonusOnlySymbols,
  computeFirstStopSlip,
} from './gen-stop-table.test';

/**
 * 1枚役の選定ツール。`SINGLE=1 OPT_CHAPTERS=<章> npx vitest run tests/tools/pick-single-yaku.test.ts`
 *
 * 1枚役は「既存文字の、単語にならない3文字」で、当選時は引き込みで揃える。
 * ここが弱いと内部役の2割（＝1枚役フラグ）がまるごと死ぬので、出玉に直撃する。
 * 逆にコマ数の多い文字ばかりで組むと②（揃って見えるのに0枚）が復活する。
 *
 * 以前は手で選んでいて、コマ数の積が36〜48という経験則しか残っていなかった。
 * 配列を焼きなますと積が変わるので、経験則だけでは足りず実際に測る必要がある
 * （寿司島への差し替えでは、積で選んだ組が到達率27.5%＝閾値割れになった）。
 *
 * 手順: 候補を単独で測って上位を絞り、その組み合わせを群として測り、
 *       到達率の高い順に②＝0 を確かめて最初に通ったものを採用する。
 */

const RUN = process.env.SINGLE === '1';
const DIR = dirname(fileURLToPath(import.meta.url));
const DATA = resolve(DIR, '../../data');
const readJson = (p: string) => JSON.parse(readFileSync(p, 'utf-8'));
const CHAPTER = process.env.OPT_CHAPTERS ?? 'hiragana_food';
const N = 21;
const PULL_IN = 4;
/** 単独評価の上位からいくつを組み合わせ探索に回すか。 */
const TOP_K = Number(process.env.SINGLE_TOPK ?? 12);
/** 到達率の高い順に②を確かめる上限。引き込みが強い組ほど②も出やすいので深く見る。 */
const LEAK_TRIES = Number(process.env.SINGLE_TRIES ?? 30);
const STOP_ORDERS = [
  [0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0],
];

function visCol(cells: readonly string[], pos: number): VisibleColumn {
  return {
    top: cells[(pos + 1) % N],
    middle: cells[pos],
    bottom: cells[((pos - 1) % N + N) % N],
  };
}

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
  return { mode: 'pick', firstStop };
}

function makeController(yakuList: YakuList, reels: string[][]) {
  const resolver = new SlipResolver(yakuList, { assistMaxCells: PULL_IN });
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

function play(
  ctrl: StopController,
  reels: string[][],
  press: readonly number[],
  order: readonly number[],
  ids: readonly string[],
  key: string,
): Grid3x3 {
  const stopped: (VisibleColumn | null)[] = [null, null, null];
  for (const i of order) {
    const slip = ctrl.resolveSlip({
      reelIndex: i,
      basePosition: press[i],
      strip: { id: `r${i}`, cells: reels[i] },
      stoppedVisibles: stopped,
      flagYakuIds: ids,
      flagKey: key,
    });
    stopped[i] = visCol(reels[i], (press[i] + slip) % N);
  }
  const s = stopped as VisibleColumn[];
  return [
    [s[0].top, s[1].top, s[2].top],
    [s[0].middle, s[1].middle, s[2].middle],
    [s[0].bottom, s[1].bottom, s[2].bottom],
  ];
}

/** 順押しで全押下位置を試し、1枚役グループのどれかが揃う割合。 */
function singleRate(yakuList: YakuList, reels: string[][]): number {
  const ctrl = makeController(yakuList, reels);
  const judge = new YakuJudge(yakuList);
  const ids = new Set(yakuList.singleYaku.map((y) => y.id));
  let hit = 0;
  for (let p0 = 0; p0 < N; p0++) {
    for (let p1 = 0; p1 < N; p1++) {
      for (let p2 = 0; p2 < N; p2++) {
        const grid = play(ctrl, reels, [p0, p1, p2], [0, 1, 2], [...ids], 'single');
        if (judge.judgeAll(grid).hits.some((h) => ids.has(h.yaku.id))) hit++;
      }
    }
  }
  return hit / (N * N * N);
}

/** ②（当選していない役が出目に残る）の件数。全フラグ・全停止順で見る。 */
function countLeaks(yakuList: YakuList, reels: string[][], cutoff = Infinity): number {
  const ctrl = makeController(yakuList, reels);
  const judge = new YakuJudge(yakuList);
  const flags: { key: string; ids: string[] }[] = [
    { key: 'miss', ids: [] },
    ...[
      ...yakuList.coreYaku,
      ...yakuList.cherryYaku,
      ...yakuList.bonusYaku,
      ...yakuList.premiumYaku,
    ].map((y) => ({ key: y.id, ids: [y.id] })),
    { key: 'single', ids: yakuList.singleYaku.map((y) => y.id) },
  ];
  let leaks = 0;
  for (const flag of flags) {
    const idSet = new Set(flag.ids);
    for (const order of STOP_ORDERS) {
      for (let p0 = 0; p0 < N; p0++) {
        for (let p1 = 0; p1 < N; p1++) {
          for (let p2 = 0; p2 < N; p2++) {
            const grid = play(ctrl, reels, [p0, p1, p2], order, flag.ids, flag.key);
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

function withSingles(base: YakuList, words: readonly string[]): YakuList {
  return {
    ...base,
    singleYaku: words.map((w, i) => ({
      id: `single_${'abcdefg'[i]}`,
      name: w,
      symbols: [...w],
      category: 'single' as const,
    })),
  };
}

describe.skipIf(!RUN)('1枚役の選定', () => {
  it('到達率が最大で②＝0 になる3語を選ぶ', () => {
    const base = YakuListSchema.parse(readJson(`${DATA}/yaku/${CHAPTER}.json`));
    const reelCfg = ReelConfigSchema.parse(readJson(`${DATA}/reels/${CHAPTER}.json`));
    const reels = reelCfg.reels.map((r) => [...r.cells]);
    const chars = reels.map((r) => [...new Set(r)].sort());
    const real = new Set(
      [...base.coreYaku, ...base.cherryYaku, ...base.bonusYaku, ...base.premiumYaku]
        .map((y: Yaku) => y.symbols.join('')),
    );

    // 単独での到達率を全候補について測る
    const solo: { word: string; rate: number }[] = [];
    for (const a of chars[0]) {
      for (const b of chars[1]) {
        for (const c of chars[2]) {
          const w = a + b + c;
          if (real.has(w)) continue;
          solo.push({ word: w, rate: singleRate(withSingles(base, [w]), reels) });
        }
      }
    }
    solo.sort((x, y) => y.rate - x.rate);
    console.log(
      `\n[${CHAPTER}] 単独の到達率 上位${TOP_K}\n` +
      solo.slice(0, TOP_K)
        .map((s) => `  ${s.word} ${(s.rate * 100).toFixed(1)}%`).join('\n'),
    );

    // 上位から3語の組を作り、群としての到達率で並べる
    const pool = solo.slice(0, TOP_K).map((s) => s.word);
    const trios: { words: string[]; rate: number }[] = [];
    for (let i = 0; i < pool.length; i++) {
      for (let j = i + 1; j < pool.length; j++) {
        for (let k = j + 1; k < pool.length; k++) {
          const words = [pool[i], pool[j], pool[k]];
          trios.push({ words, rate: singleRate(withSingles(base, words), reels) });
        }
      }
    }
    trios.sort((x, y) => y.rate - x.rate);

    // 到達率の高い順に②＝0 を確かめ、最初に通ったものを採用
    let chosen: { words: string[]; rate: number } | null = null;
    const tried: string[] = [];
    for (const t of trios.slice(0, LEAK_TRIES)) {
      const leaks = countLeaks(withSingles(base, t.words), reels, 0);
      if (leaks === 0) {
        tried.push(`  ${t.words.join('/')} 到達${(t.rate * 100).toFixed(1)}% ②=0 ← 採用`);
        chosen = t;
        break;
      }
      tried.push(`  ${t.words.join('/')} 到達${(t.rate * 100).toFixed(1)}% ②あり`);
    }
    console.log(
      `\n[${CHAPTER}] 組の評価（到達率の高い順・${tried.length}件目で決着）\n`
      + tried.slice(-12).join('\n'),
    );
    console.log(
      chosen
        ? `\n[${CHAPTER}] 採用: ${chosen.words.join(' / ')}  到達率 ${(chosen.rate * 100).toFixed(1)}%`
        : `\n[${CHAPTER}] ②＝0 になる組が上位30に無い。TOP_K を増やすか配列を焼きなまし直す`,
    );
    expect(chosen).not.toBeNull();
  }, 1800000);
});
