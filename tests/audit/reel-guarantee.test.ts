import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { SlipResolver, type VisibleColumn } from '../../src/productions/SlipResolver';
import { YakuJudge } from '../../src/core/YakuJudge';
import type { Grid3x3 } from '../../src/core/Paylines';
import type { ReelConfig, YakuList } from '../../src/data/schemas';

/**
 * リール配列監査（フェーズ2）。
 * 実配列に対し、全押下位置(21^3)×全停止順(6)×全フラグ(miss+全役)を総当たりし、
 * 蹴り（テーブル制御）適用後の最終出目に「当選役(フラグ)以外の役」が残る＝②が
 * 発生するケースを数える。0 なら「出目＝フラグ」が窓4コマ内で完全保証されている。
 *
 * ※ 引き込み(assist)は当選役を揃える方向にしか働かず、非当選役の出現(②)を増やさない。
 *   したがって蹴り単独の監査が②の最悪ケースになる。
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

/** strip と position から可視3セル（top=pos+1 / middle=pos / bottom=pos-1）。 */
function visCol(cells: readonly string[], pos: number): VisibleColumn {
  const n = cells.length;
  return {
    top: cells[(pos + 1) % n],
    middle: cells[pos],
    bottom: cells[((pos - 1) % n + n) % n],
  };
}

const STOP_ORDERS: readonly (readonly number[])[] = [
  [0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0],
];

interface Leak {
  chapter: string;
  flag: string;
  order: readonly number[];
  press: readonly number[];
  yakuId: string;
  line: string;
}

describe('リール配列監査：出目＝フラグの保証（②が残らないか）', () => {
  it('全章・全押下位置・全停止順・全フラグで②が発生しない', () => {
    const summary: string[] = [];
    const leaks: Leak[] = [];

    for (const chapter of CHAPTERS) {
      const yakuList = readJson<YakuList>(`${DATA}/yaku/${chapter}.json`);
      const reelCfg = readJson<ReelConfig>(`${DATA}/reels/${chapter}.json`);
      const reels = reelCfg.reels.map((r) => r.cells);
      const N = reels[0].length; // 21
      const resolver = new SlipResolver(yakuList);
      const judge = new YakuJudge(yakuList);
      const flags: (string | null)[] = [
        null,
        ...[
          ...yakuList.coreYaku,
          ...yakuList.cherryYaku,
          ...yakuList.bonusYaku,
          ...yakuList.premiumYaku,
        ].map((y) => y.id),
      ];

      let games = 0;
      let leakGames = 0;
      const leakByFlag = new Map<string, number>();

      for (const flag of flags) {
        const flagKey = flag ?? 'miss';
        for (const order of STOP_ORDERS) {
          for (let p0 = 0; p0 < N; p0++) {
            for (let p1 = 0; p1 < N; p1++) {
              for (let p2 = 0; p2 < N; p2++) {
                const press = [p0, p1, p2];
                const stopped: (VisibleColumn | null)[] = [null, null, null];
                const finalPos = [0, 0, 0];
                for (const idx of order) {
                  const base = press[idx];
                  const slip = resolver.resolveKick({
                    reelIndex: idx,
                    basePosition: base,
                    strip: { id: `r${idx}`, cells: reels[idx] },
                    stoppedVisibles: stopped,
                    exceptYakuId: flag ?? undefined,
                  });
                  const fp = (base + slip) % N;
                  finalPos[idx] = fp;
                  stopped[idx] = visCol(reels[idx], fp);
                }
                const grid = buildGrid(stopped as VisibleColumn[]);
                const hits = judge.judgeAll(grid).hits;
                const bad = hits.filter((h) => h.yaku.id !== flag);
                games++;
                if (bad.length > 0) {
                  leakGames++;
                  leakByFlag.set(flagKey, (leakByFlag.get(flagKey) ?? 0) + 1);
                  if (leaks.length < 40) {
                    leaks.push({
                      chapter,
                      flag: flagKey,
                      order,
                      press,
                      yakuId: bad[0].yaku.id,
                      line: bad[0].paylineName,
                    });
                  }
                }
              }
            }
          }
        }
      }

      const rate = ((leakGames / games) * 100).toFixed(4);
      const byFlag = [...leakByFlag.entries()]
        .map(([f, n]) => `${f}:${n}`)
        .join(' ');
      summary.push(
        `${chapter}: ${leakGames}/${games} 漏れ (${rate}%)${byFlag ? ` [${byFlag}]` : ''}`,
      );
    }

    console.log('\n===== リール配列監査 結果 =====\n' + summary.join('\n'));
    if (leaks.length > 0) {
      console.log('\n----- ②の例（最大40件）-----');
      for (const l of leaks) {
        console.log(
          `${l.chapter} flag=${l.flag} order=${l.order.join('>')} press=${l.press.join(',')} → ${l.yakuId}(${l.line})`,
        );
      }
    }

    const totalLeaks = leaks.length;
    // リール配列を構築的に再設計し、②（出目に非当選役が残る）を完全にゼロにした。
    // 蹴り（テーブル制御）＋この配列で「出目＝フラグ」が全押下位置で保証される。
    expect(totalLeaks).toBe(0);
  }, 180000);
});

function buildGrid(cols: VisibleColumn[]): Grid3x3 {
  return [
    [cols[0].top, cols[1].top, cols[2].top],
    [cols[0].middle, cols[1].middle, cols[2].middle],
    [cols[0].bottom, cols[1].bottom, cols[2].bottom],
  ];
}
