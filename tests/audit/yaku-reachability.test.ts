import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  ReelConfigSchema,
  StopTableSchema,
  TuningSchema,
  YakuListSchema,
} from '../../src/data/schemas';
import { YakuJudge } from '../../src/core/YakuJudge';
import { StopController } from '../../src/core/StopController';
import { StopTableLookup } from '../../src/core/StopTable';
import { SlipResolver, type VisibleColumn } from '../../src/productions/SlipResolver';
import { TenpaiDetector } from '../../src/productions/TenpaiDetector';
import type { Grid3x3 } from '../../src/core/Paylines';

/**
 * 役の到達性監査：**当選した役がちゃんと揃えられるか**。
 *
 * [26](reel-guarantee) は逆向きの保証で、「当選していない役が出目に出ないこと」を見る。
 * その反対側——「当選しているのに絶対に揃わない」——は誰も見ていなかった。
 *
 * 実際にそれで壊れた。八百屋章のREGを一時「ナスビ」にした時、チェリー「ナス」と
 * 左中2文字が同じになった。チェリーは右が不問なのでREGを揃えると必ず同時に揃うが、
 * REG当選時のチェリーは非当選役なので蹴られる。結果REGを置ける位置が消え、成立率が
 * **0%** になった。当選しても揃わない＝永久に持ち越し、持ち越し中は無告知なので演出も
 * 出なくなり、章が丸ごと機能停止していた。全テストは通ったままで、出玉シミュレーションの
 * 数字が下がって初めて気づいた。
 *
 * 1枚役も同じ理由で見る。内部役の2割が1枚役なので、引き込みが届かないと出玉に直撃する。
 * 一度コマ数の少ない文字ばかりで組んで成立率が 10% まで落ちたことがある。
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
const N = 21;

/** ボーナス役の下限。蹴りの都合で100%にはならないが、半分は狙って取れること。 */
const BONUS_MIN = 0.5;
/** 1枚役の下限。手を付けていない章が 44〜55% なので、その半分強を割ったら異常。 */
const SINGLE_MIN = 0.3;

function grid(stopped: readonly VisibleColumn[]): Grid3x3 {
  return [
    [stopped[0].top, stopped[1].top, stopped[2].top],
    [stopped[0].middle, stopped[1].middle, stopped[2].middle],
    [stopped[0].bottom, stopped[1].bottom, stopped[2].bottom],
  ];
}

describe('役の到達性監査：当選した役が狙って揃うか', () => {
  it('ボーナス役と1枚役が、押下位置を選べば成立する', () => {
    const report: string[] = [];
    for (const chapter of CHAPTERS) {
      const yakuList = YakuListSchema.parse(readJson(`${DATA}/yaku/${chapter}.json`));
      const reelCfg = ReelConfigSchema.parse(readJson(`${DATA}/reels/${chapter}.json`));
      const tuning = TuningSchema.parse(readJson(`${DATA}/tuning/default.json`));
      const stopTable = StopTableSchema.parse(readJson(`${DATA}/stops/${chapter}.json`));
      const cells = reelCfg.reels.map((r) => r.cells);
      const judge = new YakuJudge(yakuList);
      const ctrl = new StopController({
        yakuList,
        slipResolver: new SlipResolver(yakuList, {
          assistMaxCells: tuning.assist.pullInCells,
        }),
        tenpaiDetector: new TenpaiDetector(yakuList),
        stopTable: new StopTableLookup(stopTable),
        pullInCells: 4,
      });

      /** press で3リール止めた結果の出目。 */
      const play = (press: readonly number[], flagIds: string[], flagKey: string): Grid3x3 => {
        const stopped: (VisibleColumn | null)[] = [null, null, null];
        for (let i = 0; i < 3; i++) {
          const slip = ctrl.resolveSlip({
            reelIndex: i,
            basePosition: press[i],
            strip: reelCfg.reels[i],
            stoppedVisibles: stopped,
            flagYakuIds: flagIds,
            flagKey,
          });
          const pos = (press[i] + slip) % N;
          stopped[i] = {
            top: cells[i][(pos + 1) % N],
            middle: cells[i][pos],
            bottom: cells[i][(pos + N - 1) % N],
          };
        }
        return grid(stopped as VisibleColumn[]);
      };

      // ボーナス役：その文字が中段に来る位置だけを総当たり（＝狙って押した時）
      for (const y of [...yakuList.bonusYaku, ...yakuList.premiumYaku]) {
        const role = yakuList.internalRoles.find(
          (r) => r.displayYakuId === y.id && !r.freeze,
        );
        const flagKey = role?.id ?? y.id;
        const posList = y.symbols.map((s, i) =>
          cells[i].map((c, p) => (c === s ? p : -1)).filter((p) => p >= 0),
        );
        let hit = 0;
        let tried = 0;
        for (const p0 of posList[0]) {
          for (const p1 of posList[1]) {
            for (const p2 of posList[2] ?? [0]) {
              tried++;
              if (judge.judgeAll(play([p0, p1, p2], [y.id], flagKey)).hits
                .some((h) => h.yaku.id === y.id)) hit++;
            }
          }
        }
        const rate = tried > 0 ? hit / tried : 0;
        report.push(`${chapter} ${y.name}: ${hit}/${tried} = ${(rate * 100).toFixed(0)}%`);
        expect(rate, `${chapter} の ${y.name} が狙って揃わない`).toBeGreaterThanOrEqual(BONUS_MIN);
      }

      // 1枚役：single フラグでは「どれか」が揃えばよい。全押下位置で測る。
      const singleIds = yakuList.singleYaku.map((y) => y.id);
      const singleSet = new Set(singleIds);
      let sHit = 0;
      for (let p0 = 0; p0 < N; p0++) {
        for (let p1 = 0; p1 < N; p1++) {
          for (let p2 = 0; p2 < N; p2++) {
            if (judge.judgeAll(play([p0, p1, p2], singleIds, 'single')).hits
              .some((h) => singleSet.has(h.yaku.id))) sHit++;
          }
        }
      }
      const sRate = sHit / (N * N * N);
      report.push(`${chapter} 1枚役: ${(sRate * 100).toFixed(0)}%`);
      expect(sRate, `${chapter} の1枚役が引き込みで揃わない`).toBeGreaterThanOrEqual(SINGLE_MIN);
    }
    console.log('\n===== 役の到達性 =====\n' + report.join('\n'));
  }, 120000);
});
