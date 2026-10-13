import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  StopTableSchema,
  YakuListSchema,
  ReelConfigSchema,
  TuningSchema,
  SECOND_STOP_ORDERS,
  THIRD_STOP_FINALS,
} from '../../src/data/schemas';
import { StopTableLookup } from '../../src/core/StopTable';
import { StopController } from '../../src/core/StopController';
import { SlipResolver } from '../../src/productions/SlipResolver';
import { TenpaiDetector } from '../../src/productions/TenpaiDetector';
import {
  flagIdsFor,
  searchController,
  secondStopRequest,
  thirdStopRequest,
} from '../tools/gen-stop-table.test';

/**
 * 停止テーブルの第2・第3停止が、**全押し順・全停止位置・全押下位置**で探索と同じ値になるか。
 *
 * 表は探索（`StopController` に第1停止の表だけを持たせたもの）の答えを写して焼くので、
 * 一致しなければ「表が古い（配列・役・制御を変えて焼き直していない）」か「表引きの添字の
 * 取り違え」のどちらか。表を使う制御と使わない制御に同じ要求を投げて突き合わせるので、
 * 最終停止のリーチ目の寄せ（表の値にもう一度かかる）が冪等であることもここで確かめられる。
 *
 * 突き合わせる要求は、ゲーム本体が出す形（内部役ID とその許可リスト、ボーナス中は
 * 1枚役のこぼし先が加わる）。ビタチャンス・フリーズは表より前で決まるので対象外。
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

describe('停止テーブル（第2・第3停止）＝探索', () => {
  const tuning = TuningSchema.parse(readJson(`${DATA}/tuning/default.json`));
  const pullIn = tuning.assist.pullInCells;

  for (const chapter of CHAPTERS) {
    it(`${chapter}: 全押し順で表引きと探索が一致する`, () => {
      const table = StopTableSchema.parse(readJson(`${DATA}/stops/${chapter}.json`));
      const yakuList = YakuListSchema.parse(readJson(`${DATA}/yaku/${chapter}.json`));
      const reelCfg = ReelConfigSchema.parse(readJson(`${DATA}/reels/${chapter}.json`));
      const reels = reelCfg.reels.map((r) => r.cells);
      const n = reels[0].length;
      const resolver = new SlipResolver(yakuList, { assistMaxCells: pullIn });

      // 表が全押し順・全内部役ぶん揃っていること（欠けていると黙って探索へ落ちる）
      const roleIds = yakuList.internalRoles.map((r) => r.id).sort();
      for (const t of [table.secondStop, table.bonusSecondStop]) {
        expect(t, '第2停止の表').toBeDefined();
        for (const key of SECOND_STOP_ORDERS) {
          expect(Object.keys(t![key]).sort(), `第2停止 ${key}`).toEqual(roleIds);
        }
      }
      for (const t of [table.thirdStop, table.bonusThirdStop]) {
        expect(t, '第3停止の表').toBeDefined();
        for (const key of THIRD_STOP_FINALS) {
          expect(Object.keys(t![key]).sort(), `第3停止 ${key}`).toEqual(roleIds);
        }
      }

      const lookup = new StopTableLookup(table);
      const tabled = new StopController({
        yakuList,
        slipResolver: resolver,
        tenpaiDetector: new TenpaiDetector(yakuList),
        stopTable: lookup,
        pullInCells: pullIn,
        reels,
      });
      const search = searchController(yakuList, reels, resolver, pullIn, table.firstStop, chapter);

      const mismatches: string[] = [];
      let checked = 0;
      /** 表を引いて値が返らなかった数（0でなければ表引きをすり抜けて探索に落ちている）。 */
      let misses = 0;
      for (const bonus of [false, true]) {
        for (const role of yakuList.internalRoles) {
          const flagIds = flagIdsFor(yakuList, role.id, bonus);
          for (const key of SECOND_STOP_ORDERS) {
            const first = Number(key[0]);
            const reel = Number(key[1]);
            for (let p0 = 0; p0 < n; p0++) {
              for (let press = 0; press < n; press++) {
                const req = secondStopRequest(reels, first, p0, reel, press, flagIds, role.id);
                if (lookup.secondStopSlip(role.id, first, p0, reel, press, bonus) === null) misses++;
                const a = tabled.resolveSlip(req);
                const b = search.resolveSlip(req);
                checked++;
                if (a !== b) mismatches.push(`第2 ${key} ${role.id} bonus=${bonus} p=${p0} press=${press}: 表${a} 探索${b}`);
              }
            }
          }
          for (const key of THIRD_STOP_FINALS) {
            const reel = Number(key);
            for (let pa = 0; pa < n; pa++) {
              for (let pb = 0; pb < n; pb++) {
                for (let press = 0; press < n; press++) {
                  const req = thirdStopRequest(reels, reel, pa, pb, press, flagIds, role.id);
                  if (lookup.thirdStopSlip(role.id, reel, req.stoppedPositions!, press, bonus) === null) misses++;
                  const a = tabled.resolveSlip(req);
                  const b = search.resolveSlip(req);
                  checked++;
                  if (a !== b) mismatches.push(`第3 →${key} ${role.id} bonus=${bonus} ${pa},${pb} press=${press}: 表${a} 探索${b}`);
                }
              }
            }
          }
        }
      }
      expect(checked).toBe(
        2 * yakuList.internalRoles.length * (SECOND_STOP_ORDERS.length * n * n + THIRD_STOP_FINALS.length * n * n * n),
      );
      expect(misses, '表引きで値が返らない').toBe(0);
      expect(mismatches.slice(0, 10), `食い違い ${mismatches.length} 件`).toEqual([]);
    }, 600000);
  }
});
