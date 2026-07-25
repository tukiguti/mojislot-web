import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  StopTableSchema,
  YakuListSchema,
  ReelConfigSchema,
  TuningSchema,
} from '../../src/data/schemas';
import { StopTableLookup } from '../../src/core/StopTable';

/**
 * 停止テーブル（第1停止）の構造検証。
 *
 * 中身の値は**手で書き換えてよい**ので「生成結果と一致すること」は検証しない。
 * 代わりに、ゲームが破綻しない条件だけを守らせる：
 *  - 全内部役ぶんの行があること（引けない役があると既定制御へ落ちて設計が効かない）
 *  - 3リール × 21コマ ぶんの列があること
 *  - スベリコマ数が実機準拠の 0〜4 に収まること
 * 「出目＝フラグ」の②ゼロ保証は第2・第3停止の蹴りが守るので、
 * ここを書き換えても崩れない（tests/audit/reel-guarantee がテーブル経由で検証する）。
 */

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

describe('停止テーブル（第1停止）', () => {
  const tuning = TuningSchema.parse(readJson(`${DATA}/tuning/default.json`));

  for (const chapter of CHAPTERS) {
    it(`${chapter}: 全内部役ぶんの行があり、スベリが0〜${tuning.assist.pullInCells}に収まる`, () => {
      const table = StopTableSchema.parse(readJson(`${DATA}/stops/${chapter}.json`));
      const yakuList = YakuListSchema.parse(readJson(`${DATA}/yaku/${chapter}.json`));
      const reelCfg = ReelConfigSchema.parse(readJson(`${DATA}/reels/${chapter}.json`));
      const cells = reelCfg.reels[0].cells.length;

      expect(table.mode).toBe(chapter);
      // 内部役の取りこぼしが無いこと
      const roleIds = yakuList.internalRoles.map((r) => r.id).sort();
      expect(Object.keys(table.firstStop).sort()).toEqual(roleIds);

      for (const [flag, reels] of Object.entries(table.firstStop)) {
        expect(reels, `${flag}: リール数`).toHaveLength(3);
        for (const row of reels) {
          expect(row, `${flag}: コマ数`).toHaveLength(cells);
          for (const slip of row) {
            expect(slip).toBeGreaterThanOrEqual(0);
            expect(slip).toBeLessThanOrEqual(tuning.assist.pullInCells);
          }
        }
      }
    });
  }

  it('表に無い内部役は null を返し、既定制御へフォールバックする', () => {
    const table = StopTableSchema.parse(
      readJson(`${DATA}/stops/hiragana_food.json`),
    );
    const lookup = new StopTableLookup(table);
    expect(lookup.firstStopSlip('存在しない役', 0, 0)).toBeNull();
    expect(lookup.firstStopSlip('miss', 0, 999)).toBeNull();
    expect(lookup.firstStopSlip('miss', 0, 0)).toBe(0);
    expect(new StopTableLookup(null).firstStopSlip('miss', 0, 0)).toBeNull();
  });
});
