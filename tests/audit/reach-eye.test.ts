import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { SlipResolver, type VisibleColumn } from '../../src/productions/SlipResolver';
import { YakuJudge } from '../../src/core/YakuJudge';
import type { Grid3x3, Vertical } from '../../src/core/Paylines';
import { StopTableSchema, type ReelConfig, type YakuList } from '../../src/data/schemas';
import { StopTableLookup } from '../../src/core/StopTable';
import { StopController } from '../../src/core/StopController';
import { TenpaiDetector } from '../../src/productions/TenpaiDetector';

/**
 * リーチ目の監査（2026-10-13・spec/reach-eyes.md）。
 *
 * リーチ目＝小役がテンパイしたのに、最後のリールでその図柄が1段ずれて止まり揃わない形。
 * ずれる段は、テンパイしたラインで要る段が中段なら下段、それ以外なら中段。
 *
 *  - ボーナスのフラグがある内部役で、この形がどれだけ出るか（押し方しだいで届かない分がある）
 *  - ボーナスのフラグが無い内部役で、目押しのずれから同じ形になる割合。制御はなるべく避けるが、
 *    小役の図柄が密な配列では0にできない。演出の出ていたゲームでは画面に「失敗」と出して
 *    リーチ目（白いフラッシュ）と見分けさせる（2026-10-13）
 *
 * 全押下位置(21^3)×全停止順(6)×全内部役を総当たりする。
 */

const DIR = dirname(fileURLToPath(import.meta.url));
const DATA = resolve(DIR, '../../data');
const CHAPTERS = [
  'hiragana_food',
  'hiragana_verb',
  'katakana_animal',
  'security',
  'yasai',
] as const;

const readJson = <T>(p: string): T => JSON.parse(readFileSync(p, 'utf-8')) as T;

function visCol(cells: readonly string[], pos: number): VisibleColumn {
  const n = cells.length;
  return {
    top: cells[(pos + 1) % n],
    middle: cells[pos],
    bottom: cells[((pos - 1) % n + n) % n],
  };
}

function buildGrid(cols: readonly VisibleColumn[]): Grid3x3 {
  return [
    [cols[0].top, cols[1].top, cols[2].top],
    [cols[0].middle, cols[1].middle, cols[2].middle],
    [cols[0].bottom, cols[1].bottom, cols[2].bottom],
  ];
}

const STOP_ORDERS: readonly (readonly number[])[] = [
  [0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0],
];

const reachRows = (lineRow: Vertical): readonly Vertical[] =>
  lineRow === 'middle' ? ['bottom'] : ['middle'];

describe('リーチ目の監査', () => {
  it('ボーナスのフラグがあればリーチ目が出る。無い時に同じ形になる割合を数える', () => {
    const summary: string[] = [];
    const falseExamples: string[] = [];
    let shownTotal = 0;
    let chanceTotal = 0;

    for (const chapter of CHAPTERS) {
      const yakuList = readJson<YakuList>(`${DATA}/yaku/${chapter}.json`);
      const reelCfg = readJson<ReelConfig>(`${DATA}/reels/${chapter}.json`);
      const reels = reelCfg.reels.map((r) => r.cells);
      const N = reels[0].length;
      const judge = new YakuJudge(yakuList);
      const tenpai = new TenpaiDetector(yakuList);
      const controller = new StopController({
        yakuList,
        slipResolver: new SlipResolver(yakuList),
        tenpaiDetector: tenpai,
        stopTable: new StopTableLookup(
          StopTableSchema.parse(readJson(`${DATA}/stops/${chapter}.json`)),
        ),
        pullInCells: 4,
        reels,
      });

      /** ボーナスのフラグが無く、小役がテンパイして何も揃わなかった局面の数と、そのうち同じ形になった数。 */
      let nonChances = 0;
      let falseReach = 0;
      let nonSeq = 0;
      let falseSeq = 0;
      /** ボーナスのフラグで、小役がテンパイして何も揃わなかった局面の数と、そのうちリーチ目になった数。 */
      let bonusChances = 0;
      let bonusShown = 0;
      /** 順押しだけの同じ数（ゲームは順押し前提）。 */
      let seqChances = 0;
      let seqShown = 0;

      for (const role of yakuList.internalRoles) {
        const bonus = role.kind === 'big' || role.kind === 'reg' || Boolean(role.carry);
        const flagIds =
          role.kind === 'single'
            ? yakuList.singleYaku.map((y) => y.id)
            : role.displayYakuId
              ? [role.displayYakuId]
              : [];
        for (const order of STOP_ORDERS) {
          const seq = order.join('') === '012';
          const last = order[2];
          for (let p0 = 0; p0 < N; p0++) {
            for (let p1 = 0; p1 < N; p1++) {
              for (let p2 = 0; p2 < N; p2++) {
                const press = [p0, p1, p2];
                const stopped: (VisibleColumn | null)[] = [null, null, null];
                const finalPos = [0, 0, 0];
                let lines: { symbol: string; rows: readonly Vertical[] }[] = [];
                for (const idx of order) {
                  if (idx === last) {
                    const tp = tenpai.detect(stopped);
                    lines = (tp?.lines ?? [])
                      .filter((l) => l.yaku.category === 'core' && !flagIds.includes(l.yaku.id))
                      .map((l) => ({ symbol: l.yaku.symbols[last], rows: reachRows(l.vertical) }));
                  }
                  const slip = controller.resolveSlip({
                    reelIndex: idx,
                    basePosition: press[idx],
                    strip: { id: `r${idx}`, cells: reels[idx] },
                    stoppedVisibles: stopped,
                    stoppedPositions: stopped.map((v, i) => (v ? finalPos[i] : null)),
                    flagYakuIds: flagIds,
                    flagKey: role.id,
                  });
                  const fp = (press[idx] + slip) % N;
                  finalPos[idx] = fp;
                  stopped[idx] = visCol(reels[idx], fp);
                }
                if (lines.length === 0) continue;
                if (judge.judgeAll(buildGrid(stopped as VisibleColumn[])).hits.length > 0) continue;
                const col = stopped[last]!;
                const shown = lines.some((l) => l.rows.some((r) => col[r] === l.symbol));
                if (bonus) {
                  bonusChances++;
                  if (shown) bonusShown++;
                  if (seq) {
                    seqChances++;
                    if (shown) seqShown++;
                  }
                } else {
                  nonChances++;
                  if (seq) nonSeq++;
                }
                if (!bonus && shown) {
                  falseReach++;
                  if (seq) falseSeq++;
                  if (falseExamples.length < 10) {
                    falseExamples.push(
                      `${chapter} role=${role.id} order=${order.join('>')} press=${press.join(',')}`,
                    );
                  }
                }
              }
            }
          }
        }
      }
      shownTotal += bonusShown;
      chanceTotal += bonusChances;
      const pct = (a: number, b: number) => (b > 0 ? ((a / b) * 100).toFixed(1) : '-');
      summary.push(
        `${chapter}: ボーナスありで出た ${bonusShown}/${bonusChances}` +
          ` (${pct(bonusShown, bonusChances)}%・順押し ${pct(seqShown, seqChances)}%)` +
          ` / ボーナスなしで同じ形 ${falseReach}/${nonChances}` +
          ` (${pct(falseReach, nonChances)}%・順押し ${pct(falseSeq, nonSeq)}%)`,
      );
    }

    console.log('\n===== リーチ目の監査 =====\n' + summary.join('\n'));
    if (falseExamples.length > 0) {
      console.log('\n----- ボーナスなしで同じ形になった例 -----\n' + falseExamples.join('\n'));
    }
    // 2026-10-13 の実測は5島とも約77%。制御を変えて大きく下がったら気づけるようにする
    expect(shownTotal / chanceTotal).toBeGreaterThan(0.7);
  }, 1_800_000);
});
