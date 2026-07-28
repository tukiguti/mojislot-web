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
 * ボーナス中のこぼし監査：**1枚役が当選役を横取りしないこと**。
 *
 * ボーナス中だけ1枚役を「こぼし先」として当選役と一緒に許可リストへ入れている
 * （設計: 31章）。当選役を引き込めなかった時だけ1枚役へ落ちて1枚、という意図だが、
 * 引き込み先の選択が「近い順」だけだと、1枚役の図柄がたまたま近いという理由で
 * **本来取れる小役を捨てて1枚に落とす**ことが起きる。出玉が静かに削れるうえ、
 * プレイヤーからは「ちゃんと押したのに1枚」にしか見えない壊れ方をする。
 *
 * StopController の CAT_RANK で1枚役を単独の最下位に置いて防いでいる。ここでは
 * 通常時（当選役のみ許可）とボーナス中（＋1枚役許可）を同じ押下位置で回し、
 * **通常時に揃った局面はボーナス中も必ず揃う**ことを確かめる。
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
/** 押下位置の総当たりは 21^3 = 9261 通り。停止順は本作の前提どおり順押し。 */
const STOP_ORDER = [0, 1, 2] as const;

function toGrid(stopped: readonly VisibleColumn[]): Grid3x3 {
  return [
    [stopped[0].top, stopped[1].top, stopped[2].top],
    [stopped[0].middle, stopped[1].middle, stopped[2].middle],
    [stopped[0].bottom, stopped[1].bottom, stopped[2].bottom],
  ];
}

describe('ボーナス中のこぼし監査', () => {
  it('1枚役を許可しても当選役の成立は減らない', () => {
    const report: string[] = [];
    for (const chapter of CHAPTERS) {
      const yakuList = YakuListSchema.parse(readJson(`${DATA}/yaku/${chapter}.json`));
      const reelCfg = ReelConfigSchema.parse(readJson(`${DATA}/reels/${chapter}.json`));
      const tuning = TuningSchema.parse(readJson(`${DATA}/tuning/default.json`));
      const cells = reelCfg.reels.map((r) => r.cells);
      const judge = new YakuJudge(yakuList);
      const ctrl = new StopController({
        yakuList,
        slipResolver: new SlipResolver(yakuList, {
          assistMaxCells: tuning.assist.pullInCells,
        }),
        tenpaiDetector: new TenpaiDetector(yakuList),
        stopTable: new StopTableLookup(
          StopTableSchema.parse(readJson(`${DATA}/stops/${chapter}.json`)),
        ),
        pullInCells: tuning.assist.pullInCells,
      });

      const play = (
        press: readonly number[],
        flagIds: readonly string[],
        flagKey: string,
      ): Grid3x3 => {
        const stopped: (VisibleColumn | null)[] = [null, null, null];
        for (const i of STOP_ORDER) {
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
        return toGrid(stopped as VisibleColumn[]);
      };

      const singleIds = yakuList.singleYaku.map((y) => y.id);
      const targets = [
        ...yakuList.coreYaku,
        ...yakuList.cherryYaku,
        ...yakuList.bonusYaku,
        ...yakuList.premiumYaku,
      ];

      for (const y of targets) {
        const role = yakuList.internalRoles.find(
          (r) => r.displayYakuId === y.id && !r.freeze,
        );
        const flagKey = role?.id ?? y.id;
        let normalHits = 0;
        let bonusHits = 0;
        let stolen = 0;
        for (let p0 = 0; p0 < N; p0++) {
          for (let p1 = 0; p1 < N; p1++) {
            for (let p2 = 0; p2 < N; p2++) {
              const press = [p0, p1, p2];
              const hitNormal = judge
                .judgeAll(play(press, [y.id], flagKey))
                .hits.some((h) => h.yaku.id === y.id);
              const hitBonus = judge
                .judgeAll(play(press, [y.id, ...singleIds], flagKey))
                .hits.some((h) => h.yaku.id === y.id);
              if (hitNormal) normalHits++;
              if (hitBonus) bonusHits++;
              if (hitNormal && !hitBonus) stolen++;
            }
          }
        }
        report.push(
          `${chapter} ${y.name}: 通常 ${normalHits} / ボ中 ${bonusHits}（横取り ${stolen}）`,
        );
        expect(
          stolen,
          `${chapter} の ${y.name} が1枚役に横取りされている`,
        ).toBe(0);
      }
    }
    console.log('\n===== ボーナス中のこぼし監査 =====\n' + report.join('\n'));
  }, 300000);
});
