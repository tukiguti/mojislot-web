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
import { ReachEyes } from '../../src/core/ReachEyes';
import { StopController } from '../../src/core/StopController';
import { StopTableLookup } from '../../src/core/StopTable';
import { SlipResolver, type VisibleColumn } from '../../src/productions/SlipResolver';
import { TenpaiDetector } from '../../src/productions/TenpaiDetector';
import { primaryRowOf, visibleAt } from '../../src/core/Paylines';

/**
 * 1確（一発リーチ目）の監査：**非ボーナスフラグで誤告知が出ないこと**。
 *
 * 第1停止したリールの**主ライン上**に「ボーナス役にしか使われない図柄」が
 * 止まったら、その場でボーナス確定——というのが1確（`main.ts` の `stopReel` が
 * `reachEyes.isBonusOnlyOnPrimary` で判定している）。告知が成立する前提は
 * **非ボーナスフラグではその図柄を第1停止の主ラインに置かない**の一点で、これが
 * 崩れると「確定と言われたのに何も来ない」という一番やってはいけない嘘になる。
 *
 * 担保しているのは停止テーブル（`data/stops/*.json`）だが、**保証ではなく
 * best-effort**。生成側（`tests/tools/gen-stop-table.test.ts` の第1停止生成）は
 * 禁止図柄を避ける位置を0〜4コマから探すだけで、窓内が全滅すれば元のスベリを
 * そのまま返して諦める。出玉シミュレーションでは20万G×4腕で誤告知0件だったが、
 * それは**その配列での実測値**であって不変条件ではなく、リール配列を焼きなまし
 * 直せば静かに壊れ得る。壊れても画面上は「たまに嘘をつく告知」にしか見えない。
 *
 * そこで全章 × 全非ボーナスフラグ × 第1停止リール3種 × 全押下位置21を総当たりし、
 * 中段にボーナス専用図柄が残る組み合わせが0件であることを毎回確かめる。
 *
 * 対象を**第1停止だけ**に絞るのは告知側と同じ理由。第2・第3停止はアルゴリズム
 * 任せで専用図柄が普通に中段へ来るため、そもそも告知しない。ボーナス中は必ず
 * 演出が出て `currentEffect === 'none'` を満たさず告知経路に入らないので、
 * フラグ集合も通常時のもの（1枚役のこぼし先を足さない形）だけを見ればよい。
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
/** 第1停止し得るリール（順押しに限らず、どれを最初に止めてもよい）。 */
const FIRST_REELS = [0, 1, 2] as const;

interface Misfire {
  chapter: string;
  flag: string;
  reel: number;
  press: number;
  symbol: string;
}

describe('1確の監査：非ボーナスフラグで中段告知が誤爆しないか', () => {
  it('全章・全非ボーナスフラグ・全第1停止リール・全押下位置で誤告知0件', () => {
    const summary: string[] = [];
    const misfires: Misfire[] = [];
    let combos = 0;

    for (const chapter of CHAPTERS) {
      const yakuList = YakuListSchema.parse(readJson(`${DATA}/yaku/${chapter}.json`));
      const reelCfg = ReelConfigSchema.parse(readJson(`${DATA}/reels/${chapter}.json`));
      const tuning = TuningSchema.parse(readJson(`${DATA}/tuning/default.json`));
      const cells = reelCfg.reels.map((r) => r.cells);
      // 告知そのものの判定器。リーチ目表は使わないので null でよい（中段告知は
      // 出目表ではなく yakuList から作る「ボーナス専用図柄」集合だけで決まる）。
      const reachEyes = new ReachEyes(null, yakuList);
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

      const singleIds = yakuList.singleYaku.map((y) => y.id);
      // 非ボーナスフラグ＝内部役のうち reg / big 以外（miss / single / core / cherry）。
      // フラグ集合の作り方は main.ts の activeFlagYakuIds と同じ規則にする。
      const flags = yakuList.internalRoles
        .filter((role) => role.kind !== 'reg' && role.kind !== 'big')
        .map((role) => ({
          key: role.id,
          ids:
            role.kind === 'miss'
              ? []
              : role.kind === 'single'
                ? singleIds
                : role.displayYakuId
                  ? [role.displayYakuId]
                  : [],
        }));

      let chapterMisfires = 0;
      for (const flag of flags) {
        for (const reel of FIRST_REELS) {
          for (let press = 0; press < N; press++) {
            // 第1停止なので他リールはすべて未停止。
            const stopped: readonly (VisibleColumn | null)[] = [null, null, null];
            const slip = ctrl.resolveSlip({
              reelIndex: reel,
              basePosition: press,
              strip: reelCfg.reels[reel],
              stoppedVisibles: stopped,
              flagYakuIds: flag.ids,
              flagKey: flag.key,
            });
            // 主ライン上の図柄を見る（斜めならリールごとに行が変わる）。
            const middle = visibleAt(
              cells[reel],
              (press + slip) % N,
              primaryRowOf(reel),
            );
            combos++;
            if (reachEyes.isBonusOnlyOnPrimary(reel, middle)) {
              chapterMisfires++;
              if (misfires.length < 40) {
                misfires.push({
                  chapter,
                  flag: flag.key,
                  reel,
                  press,
                  symbol: middle,
                });
              }
            }
          }
        }
      }
      summary.push(
        `${chapter}: 誤告知 ${chapterMisfires} 件 / ${flags.length}フラグ×3リール×${N}押下位置`,
      );
    }

    console.log(
      `\n===== 1確の監査 結果（総当たり ${combos} 通り）=====\n` +
        summary.join('\n'),
    );
    const detail = misfires
      .map(
        (m) =>
          `${m.chapter} flag=${m.flag} reel=${m.reel} press=${m.press} → 中段「${m.symbol}」`,
      )
      .join('\n');
    expect(
      misfires.length,
      `非ボーナスフラグなのに第1停止の中段がボーナス専用図柄になった（最大40件表示）:\n${detail}`,
    ).toBe(0);
  }, 60000);
});
