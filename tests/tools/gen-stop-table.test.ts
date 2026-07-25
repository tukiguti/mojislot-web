import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { SlipResolver, type VisibleColumn } from '../../src/productions/SlipResolver';
import {
  YakuListSchema,
  ReelConfigSchema,
  TuningSchema,
  type Yaku,
  type YakuList,
} from '../../src/data/schemas';

/**
 * 停止テーブル（第1停止）の生成。
 *
 *   GEN=1 npx vitest run tests/tools/gen-stop-table.test.ts
 *
 * 現行の停止制御（当選役を pullInCells 以内で中段へ引き込む）から
 * `data/stops/<章>.json` を書き出す。**生成後は手で書き換えてよい**。
 * 第1停止ではどの役もロックし得ないため蹴りは発火せず、ここは完全に自由に
 * 設計できる（リーチ目・入り目の起点）。②ゼロ保証は第2・第3停止の蹴りが守り、
 * 監査テストが全押下位置で検証する。
 */

const RUN = process.env.GEN === '1';
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

/** 内部役ID → その役が出目に出してよい役（1枚役はグループ全体）。 */
export function flagYakusFor(yakuList: YakuList, flagKey: string): Yaku[] {
  if (flagKey === 'miss') return [];
  if (flagKey === 'single') return [...yakuList.singleYaku];
  const all = [
    ...yakuList.coreYaku,
    ...yakuList.cherryYaku,
    ...yakuList.bonusYaku,
    ...yakuList.premiumYaku,
  ];
  const role = yakuList.internalRoles.find((r) => r.id === flagKey);
  const id = role?.displayYakuId ?? flagKey;
  const y = all.find((v) => v.id === id);
  return y ? [y] : [];
}

/** 第1停止（他リール未停止）のスベリコマ数を現行制御から計算する。 */
export function computeFirstStopSlip(
  resolver: SlipResolver,
  targets: readonly Yaku[],
  cells: readonly string[],
  reel: number,
  press: number,
  pullInCells: number,
): number {
  if (targets.length === 0) return 0; // ハズレ：第1停止では蹴りが効かない＝押した位置で止まる
  const stopped: (VisibleColumn | null)[] = [null, null, null];
  const ctx = {
    reelIndex: reel,
    basePosition: press,
    strip: { id: `r${reel}`, cells: [...cells] },
    stoppedVisibles: stopped,
    exceptYakuIds: targets.map((y) => y.id),
  };
  let best: number | null = null;
  for (const y of targets) {
    const sym = y.symbols[reel];
    if (sym === undefined) continue;
    const slip = resolver.resolveAssist(ctx, sym, 'middle', pullInCells);
    if (slip !== null && (best === null || slip < best)) best = slip;
  }
  return best ?? 0;
}

describe.skipIf(!RUN)('停止テーブル生成', () => {
  it('全章の第1停止テーブルを data/stops へ書き出す', () => {
    const tuning = TuningSchema.parse(readJson(`${DATA}/tuning/default.json`));
    mkdirSync(`${DATA}/stops`, { recursive: true });
    for (const chapter of CHAPTERS) {
      const yakuList = YakuListSchema.parse(readJson(`${DATA}/yaku/${chapter}.json`));
      const reelCfg = ReelConfigSchema.parse(readJson(`${DATA}/reels/${chapter}.json`));
      const reels = reelCfg.reels.map((r) => r.cells);
      const resolver = new SlipResolver(yakuList, {
        assistMaxCells: tuning.assist.pullInCells,
      });

      const firstStop: Record<string, number[][]> = {};
      for (const role of yakuList.internalRoles) {
        const targets = flagYakusFor(yakuList, role.id);
        firstStop[role.id] = [0, 1, 2].map((reel) =>
          Array.from({ length: reels[reel].length }, (_, press) =>
            computeFirstStopSlip(
              resolver,
              targets,
              reels[reel],
              reel,
              press,
              tuning.assist.pullInCells,
            ),
          ),
        );
      }
      const out = { mode: chapter, firstStop };
      writeFileSync(
        `${DATA}/stops/${chapter}.json`,
        `${JSON.stringify(out, null, 2)}\n`,
        'utf-8',
      );
      expect(Object.keys(firstStop).length).toBe(yakuList.internalRoles.length);
    }
  });
});
