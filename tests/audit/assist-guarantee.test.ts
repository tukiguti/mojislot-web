import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { SlipResolver, type VisibleColumn } from '../../src/productions/SlipResolver';
import { TenpaiDetector } from '../../src/productions/TenpaiDetector';
import { YakuJudge } from '../../src/core/YakuJudge';
import type { Grid3x3 } from '../../src/core/Paylines';
import type { ReelConfig, YakuList } from '../../src/data/schemas';

/**
 * 引き込み（assist）経路の監査。
 * reel-guarantee.test.ts は蹴り（kick）だけの経路で「出目＝フラグ」を保証するが、
 * 実ゲームでは引き込みが slip>0 を返すと蹴りがスキップされる（main.ts resolveStopSlip）。
 * 引き込み先の停止位置で「当選役とは別の役」が偶然ロックすると、②（揃っているのに
 * 払い出し対象外）が引き込み経由で復活する。
 *
 * ここでは最も引き込みが強いシナリオ（aim/push 相当：最終リール窓8コマ＋
 * 第1・第2停止の中段ヒント4コマ）で main.ts の停止フローを忠実に再現し、
 * 全章 × 全当選役 × 全停止順 × 全押下位置で非当選役の混入を数える。
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

/** main.ts の引き込み窓（tuning/default.json と同値）。 */
const NOTICE_ASSIST_MAX_CELLS = 8;
const AIM_HINT_MAX_CELLS = 4;

const CAT_RANK: Record<string, number> = {
  premium: 3,
  bonus: 2,
  core: 1,
  cherry: 0,
};

const readJson = <T>(p: string): T => JSON.parse(readFileSync(p, 'utf-8')) as T;

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

describe('引き込み経路の監査：assist先でも出目＝フラグが崩れないか', () => {
  it('aim/push相当の最強引き込みでも非当選役が出目に混入しない', () => {
    const summary: string[] = [];
    let totalLeaks = 0;
    const examples: string[] = [];

    for (const chapter of CHAPTERS) {
      const yakuList = readJson<YakuList>(`${DATA}/yaku/${chapter}.json`);
      const reelCfg = readJson<ReelConfig>(`${DATA}/reels/${chapter}.json`);
      const reels = reelCfg.reels.map((r) => r.cells);
      const N = reels[0].length;
      const resolver = new SlipResolver(yakuList);
      const tenpai = new TenpaiDetector(yakuList);
      const judge = new YakuJudge(yakuList);
      const allYakus = [
        ...yakuList.coreYaku,
        ...yakuList.cherryYaku,
        ...yakuList.bonusYaku,
        ...yakuList.premiumYaku,
      ];

      let games = 0;
      let leakGames = 0;

      for (const flagYaku of allYakus) {
        for (const order of STOP_ORDERS) {
          for (let p0 = 0; p0 < N; p0++) {
            for (let p1 = 0; p1 < N; p1++) {
              for (let p2 = 0; p2 < N; p2++) {
                const press = [p0, p1, p2];
                const stopped: (VisibleColumn | null)[] = [null, null, null];
                for (const idx of order) {
                  const base = press[idx];
                  const assistCtx = {
                    reelIndex: idx,
                    basePosition: base,
                    strip: { id: `r${idx}`, cells: reels[idx] },
                    stoppedVisibles: stopped,
                    exceptYakuId: flagYaku.id,
                  };
                  let slip = 0;
                  // 1) 最終リール：当選役のテンパイ引き込み（窓8・main.ts pickAssistSlip 相当）
                  const tp = tenpai.detect(stopped);
                  if (tp && tp.missingReelIndex === idx) {
                    let bestSlip = 0;
                    let bestScore = -1;
                    for (const l of tp.lines) {
                      if (l.yaku.id !== flagYaku.id) continue;
                      const s = resolver.resolveAssist(
                        assistCtx,
                        l.yaku.symbols[idx],
                        l.vertical,
                        NOTICE_ASSIST_MAX_CELLS,
                      );
                      if (s === null) continue;
                      const score =
                        CAT_RANK[l.yaku.category] * 100 +
                        (NOTICE_ASSIST_MAX_CELLS - s) * 4 +
                        (l.vertical === 'middle' ? 1 : 0);
                      if (score > bestScore) {
                        bestScore = score;
                        bestSlip = s;
                      }
                    }
                    slip = bestSlip;
                  } else {
                    // 2) 第1・第2停止：当選役図柄の中段ヒント（窓4）
                    const sym = flagYaku.symbols[idx];
                    if (sym !== undefined) {
                      const s = resolver.resolveAssist(
                        assistCtx,
                        sym,
                        'middle',
                        AIM_HINT_MAX_CELLS,
                      );
                      if (s !== null) slip = s;
                    }
                  }
                  // 3) 引き込みが動かなければ蹴り（main.ts: slipCells===0 の時だけ）
                  if (slip === 0) {
                    slip = resolver.resolveKick({
                      reelIndex: idx,
                      basePosition: base,
                      strip: assistCtx.strip,
                      stoppedVisibles: stopped,
                      exceptYakuId: flagYaku.id,
                      prefer: 'blank',
                    });
                  }
                  stopped[idx] = visCol(reels[idx], (base + slip) % N);
                }
                const grid = buildGrid(stopped as VisibleColumn[]);
                const bad = judge
                  .judgeAll(grid)
                  .hits.filter((h) => h.yaku.id !== flagYaku.id);
                games++;
                if (bad.length > 0) {
                  leakGames++;
                  totalLeaks++;
                  if (examples.length < 20) {
                    examples.push(
                      `${chapter} flag=${flagYaku.id} order=${order.join('>')} press=${press.join(',')} → ${bad[0].yaku.id}(${bad[0].paylineName})`,
                    );
                  }
                }
              }
            }
          }
        }
      }
      summary.push(
        `${chapter}: ${leakGames}/${games} 漏れ (${((leakGames / games) * 100).toFixed(4)}%)`,
      );
    }

    console.log('\n===== 引き込み経路 監査結果 =====\n' + summary.join('\n'));
    if (examples.length > 0) {
      console.log('\n----- 混入例 -----\n' + examples.join('\n'));
    }
    expect(totalLeaks).toBe(0);
  }, 300000);
});

function buildGrid(cols: VisibleColumn[]): Grid3x3 {
  return [
    [cols[0].top, cols[1].top, cols[2].top],
    [cols[0].middle, cols[1].middle, cols[2].middle],
    [cols[0].bottom, cols[1].bottom, cols[2].bottom],
  ];
}
