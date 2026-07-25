import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { SlipResolver, type VisibleColumn } from '../../src/productions/SlipResolver';
import { TenpaiDetector } from '../../src/productions/TenpaiDetector';
import {
  StopTableSchema,
  YakuListSchema,
  ReelConfigSchema,
  TuningSchema,
  type Yaku,
  type YakuList,
} from '../../src/data/schemas';
import { StopTableLookup } from '../../src/core/StopTable';
import type { Grid3x3 } from '../../src/core/Paylines';

/**
 * リーチ目の抽出。
 *
 *   REACH=1 npx vitest run tests/tools/find-reach-eyes.test.ts
 *
 * 実機のリーチ目は「そのフラグの時にしか制御上あり得ない出目」であって、
 * designer が絵を描くものではなく**制御の副産物**である。
 * ここでは全フラグ × 全押し順 × 全押下位置を実際の停止制御で回し、
 * 出現した最終出目（3x3グリッド）を集計して
 *   - ボーナスフラグ（reg/big）でしか出ない出目 ＝ リーチ目
 *   - どのフラグでも出る出目            ＝ 通常のハズレ目
 * に仕分ける。持ち越し中（無告知）にこれが出れば「まだフラグが生きている」合図になる。
 */

const RUN = process.env.REACH === '1';
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

const STOP_ORDERS: readonly (readonly number[])[] = [
  [0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0],
];

function visCol(cells: readonly string[], pos: number): VisibleColumn {
  const n = cells.length;
  return {
    top: cells[(pos + 1) % n],
    middle: cells[pos],
    bottom: cells[((pos - 1) % n + n) % n],
  };
}

function gridKey(cols: readonly VisibleColumn[]): string {
  return cols.map((c) => `${c.top}${c.middle}${c.bottom}`).join('|');
}

function flagYakusFor(yakuList: YakuList, flagKey: string): Yaku[] {
  if (flagKey === 'miss') return [];
  if (flagKey === 'single') return [...yakuList.singleYaku];
  const all = [
    ...yakuList.coreYaku,
    ...yakuList.cherryYaku,
    ...yakuList.bonusYaku,
    ...yakuList.premiumYaku,
  ];
  const role = yakuList.internalRoles.find((r) => r.id === flagKey);
  const y = all.find((v) => v.id === (role?.displayYakuId ?? flagKey));
  return y ? [y] : [];
}

describe.skipIf(!RUN)('リーチ目の抽出', () => {
  it('ボーナスフラグでしか出ない出目を数える', () => {
    const tuning = TuningSchema.parse(readJson(`${DATA}/tuning/default.json`));
    const pull = tuning.assist.pullInCells;

    for (const chapter of CHAPTERS) {
      const yakuList = YakuListSchema.parse(readJson(`${DATA}/yaku/${chapter}.json`));
      const reelCfg = ReelConfigSchema.parse(readJson(`${DATA}/reels/${chapter}.json`));
      const reels = reelCfg.reels.map((r) => r.cells);
      const N = reels[0].length;
      const resolver = new SlipResolver(yakuList, { assistMaxCells: pull });
      const tenpaiDetector = new TenpaiDetector(yakuList);
      const stopTable = new StopTableLookup(
        StopTableSchema.parse(readJson(`${DATA}/stops/${chapter}.json`)),
      );

      /** 出目 → それが出せるフラグの集合 */
      const grids = new Map<string, Set<string>>();
      const bonusFlags = new Set(
        yakuList.internalRoles
          .filter((r) => r.kind === 'reg' || r.kind === 'big')
          .map((r) => r.id),
      );

      for (const role of yakuList.internalRoles) {
        const targets = flagYakusFor(yakuList, role.id);
        const flagIds = targets.map((y) => y.id);
        for (const order of STOP_ORDERS) {
          for (let p0 = 0; p0 < N; p0++) {
            for (let p1 = 0; p1 < N; p1++) {
              for (let p2 = 0; p2 < N; p2++) {
                const press = [p0, p1, p2];
                const stopped: (VisibleColumn | null)[] = [null, null, null];
                let step = 0;
                for (const idx of order) {
                  const base = press[idx];
                  const ctx = {
                    reelIndex: idx,
                    basePosition: base,
                    strip: { id: `r${idx}`, cells: reels[idx] },
                    stoppedVisibles: stopped,
                    exceptYakuIds: flagIds,
                  };
                  let slip: number | null =
                    step === 0 ? stopTable.firstStopSlip(role.id, idx, base) : null;
                  if (slip === null) {
                    slip = 0;
                    if (targets.length > 0) {
                      const tp = tenpaiDetector.detect(stopped);
                      if (tp && tp.missingReelIndex === idx) {
                        let best = 0;
                        for (const l of tp.lines) {
                          if (!flagIds.includes(l.yaku.id)) continue;
                          const sres = resolver.resolveAssist(
                            ctx, l.yaku.symbols[idx], l.vertical, pull,
                          );
                          if (sres !== null && (best === 0 || sres < best)) best = sres;
                        }
                        slip = best;
                      }
                      if (slip === 0) {
                        let best: number | null = null;
                        for (const y of targets) {
                          const sym = y.symbols[idx];
                          if (sym === undefined) continue;
                          const ok = stopped.every(
                            (v, i) =>
                              v === null || i === idx ||
                              y.symbols[i] === undefined || v.middle === y.symbols[i],
                          );
                          if (!ok) continue;
                          const h = resolver.resolveAssist(ctx, sym, 'middle', pull);
                          if (h !== null && (best === null || h < best)) best = h;
                        }
                        if (best !== null) slip = best;
                      }
                    }
                    if (slip === 0) slip = resolver.resolveKick(ctx);
                  }
                  step++;
                  stopped[idx] = visCol(reels[idx], (base + slip) % N);
                }
                const key = gridKey(stopped as VisibleColumn[]);
                let set = grids.get(key);
                if (!set) grids.set(key, (set = new Set()));
                set.add(role.id);
              }
            }
          }
        }
      }

      let reachOnly = 0;
      let regOnly = 0;
      let bigOnly = 0;
      const samples: string[] = [];
      for (const [key, flags] of grids) {
        const all = [...flags];
        if (all.length === 0 || !all.every((f) => bonusFlags.has(f))) continue;
        reachOnly++;
        const kinds = new Set(
          all.map((f) => yakuList.internalRoles.find((r) => r.id === f)?.kind),
        );
        if (kinds.size === 1 && kinds.has('reg')) regOnly++;
        if (kinds.size === 1 && kinds.has('big')) bigOnly++;
        if (samples.length < 5) samples.push(`${key}  ← ${all.join('/')}`);
      }

      // 抽出結果をデータ化：出目キー → 確定するボーナス種別（reg / big / both）
      const table: Record<string, 'reg' | 'big' | 'both'> = {};
      for (const [key, flags] of grids) {
        const all = [...flags];
        if (all.length === 0 || !all.every((f) => bonusFlags.has(f))) continue;
        const kinds = new Set(
          all.map((f) => yakuList.internalRoles.find((r) => r.id === f)?.kind),
        );
        table[key] =
          kinds.size === 1 && kinds.has('reg')
            ? 'reg'
            : kinds.size === 1 && kinds.has('big')
              ? 'big'
              : 'both';
      }
      mkdirSync(`${DATA}/reach`, { recursive: true });
      writeFileSync(
        `${DATA}/reach/${chapter}.json`,
        `${JSON.stringify({ mode: chapter, eyes: table }, null, 2)}\n`,
        'utf-8',
      );

      console.log(
        `\n${chapter}: 全出目 ${grids.size} 種 / リーチ目 ${reachOnly} 種` +
          `（REG限定 ${regOnly} / BIG限定 ${bigOnly}）`,
      );
      for (const s of samples) console.log(`   ${s}`);
      expect(grids.size).toBeGreaterThan(0);
    }
  }, 600000);
});

export type { Grid3x3 };
