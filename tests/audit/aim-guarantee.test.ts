import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  YakuListSchema,
  ReelConfigSchema,
  StopTableSchema,
  TuningSchema,
  type Yaku,
} from '../../src/data/schemas';
import { SlipResolver, type VisibleColumn } from '../../src/productions/SlipResolver';
import { StopController } from '../../src/core/StopController';
import { StopTableLookup } from '../../src/core/StopTable';
import { TenpaiDetector } from '../../src/productions/TenpaiDetector';

/**
 * **狙えば揃う**の監査：成立した役の図柄を狙って押したら、必ず有効ラインに揃うこと。
 *
 * 実機と同じく「成立役の図柄が4コマ以内にあれば必ず引き込む」を停止テーブル
 * （`data/stops/<章>.json`）側で保証しているが、この保証は**今日だけで3回壊れた**。
 *
 *  1. 各リールで「その時点で成立する最小の滑り」を選ぶ貪欲な焼き方をしていて、
 *     先に止めたリールの位置しだいで残りが詰んでいた（40役中12役）。
 *  2. 焼きなましの目的関数に図柄の間隔が入っておらず、配列が偏って引き込みが届かなかった。
 *  3. リーチ目の蹴りが、保証のために選んだ滑りを無条件に上書きしていた（40役中4役）。
 *
 * 3回とも**手で測って初めて分かった**。出玉も②ゼロ保証も1確も全部そのまま通るので、
 * テストが無ければ「たまに揃わない台」として静かに残る。だから気づける仕組みとして置く。
 *
 * 〔2026-10-02〕**全6通りの押し順を、ゲーム本体の停止制御（StopController）で測る**。
 * 以前は停止テーブル（順押しの分しか無い）を直接読んでいたので、順押し以外で
 * 2.7〜18.7% 揃わないことに気づけなかった。また②ゼロと両立しているかも見ていなかった
 * （表は②を出してでも揃えていた）。
 *
 * 「狙って押す」は**図柄が中段に来る押下位置の手前2コマ**（ゲーム本体のAUTOと同じ打ち方）。
 * 役の図柄が配列に複数あるならその全ての出現位置を対象にし、第1×第2×第3の直積を回す。
 * 総当たり（21^3）ではなく図柄の出現位置だけなので、1役あたり数百通りで済む。
 *
 * ライン定義は `Paylines.ts` を読まずここに直書きする。あちらは環境変数
 * （`PAYLINE_SET`）で本数を絞れるので、監査の基準が実行環境で動いてしまうため。
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

/** 中段に来る押下位置から手前へ何コマ戻して押すか（ゲーム本体のAUTOがボーナス役を狙う時と同じ）。 */
const AIM_OFFSET = 2;

/** 有効ライン5本。各要素は「リールrで見る行」＝ 0=上段 / 1=中段 / 2=下段。 */
const STOP_ORDERS: readonly (readonly number[])[] = [
  [0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0],
];

const LINES: readonly (readonly [number, number, number])[] = [
  [0, 0, 0], // 上段
  [1, 1, 1], // 中段
  [2, 2, 2], // 下段
  [0, 1, 2], // 右下がり
  [2, 1, 0], // 右上がり
];

/** position から可視3セル（index 0=上段 / 1=中段 / 2=下段）。 */
function visible(cells: readonly string[], pos: number): [string, string, string] {
  const n = cells.length;
  return [cells[(pos + 1) % n], cells[pos], cells[((pos - 1) % n + n) % n]];
}

/** その図柄を狙う押下位置（＝図柄が中段に来る位置の2コマ手前）を全部。 */
function aimPresses(cells: readonly string[], symbol: string): number[] {
  const n = cells.length;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    if (cells[i] === symbol) out.push(((i - AIM_OFFSET) % n + n) % n);
  }
  return out;
}

/** 可視3列のどれか1本のラインで役が揃っているか。チェリー（2文字役）は左中だけ見る。 */
function aligned(cols: readonly [string, string, string][], yaku: Yaku): boolean {
  // symbols が2つしか無いチェリーは、この every が左中の2リールしか回らない＝右は不問。
  return LINES.some((line) =>
    yaku.symbols.every((sym, r) => cols[r][line[r]] === sym),
  );
}

describe('狙えば揃う（引き込み保証）', () => {
  for (const chapter of CHAPTERS) {
    const yakuList = YakuListSchema.parse(readJson(`${DATA}/yaku/${chapter}.json`));
    const reels = ReelConfigSchema.parse(readJson(`${DATA}/reels/${chapter}.json`)).reels.map(
      (r) => r.cells,
    );
    const stops = StopTableSchema.parse(readJson(`${DATA}/stops/${chapter}.json`));
    const tuning = TuningSchema.parse(readJson(`${DATA}/tuning/default.json`));
    const ctrl = new StopController({
      yakuList,
      slipResolver: new SlipResolver(yakuList, { assistMaxCells: tuning.assist.pullInCells }),
      tenpaiDetector: new TenpaiDetector(yakuList),
      stopTable: new StopTableLookup(stops),
      pullInCells: tuning.assist.pullInCells,
      reels,
    });
    const N = reels[0].length;
    const strips = reels.map((cells, i) => ({ id: `r${i}`, cells: [...cells] }));

    // 目印のある島は、小役とチェリーを**狙い所**で保証する（aim-groups・2026-10-16 決定）。
    // 役の図柄そのものを狙う打ち方の保証は外し、ここではボーナス役だけを見る。AUTO も
    // 小役・チェリーは狙い所を狙う（main.ts の scheduleAimedStop）。
    const hasLandmark = ReelConfigSchema.parse(readJson(`${DATA}/reels/${chapter}.json`)).landmark !== undefined;
    const yakuById = new Map<string, Yaku>(
      [
        ...(hasLandmark ? [] : yakuList.coreYaku),
        ...yakuList.premiumYaku,
        ...yakuList.bonusYaku,
        ...(hasLandmark ? [] : yakuList.cherryYaku),
      ].map((y) => [y.id, y]),
    );

    // 揃えさせたい表示役を持つ内部役だけが対象（miss・1枚役は「狙う」対象が無い）。
    for (const role of yakuList.internalRoles) {
      const yaku = role.displayYakuId ? yakuById.get(role.displayYakuId) : undefined;
      if (!yaku) continue;

      it(`${chapter}: ${role.id}（${yaku.name}）を狙えば必ず揃う（全押し順）`, () => {
        // 2文字役は第3リールが不問なので、狙い所も無い＝全21箇所を対象にする。
        const aims = [0, 1, 2].map((r) =>
          yaku.symbols[r] === undefined
            ? Array.from({ length: N }, (_, p) => p)
            : aimPresses(reels[r], yaku.symbols[r]),
        );
        for (const r of [0, 1, 2]) {
          expect(
            aims[r].length,
            `${chapter}: ${yaku.name} の第${r + 1}リール図柄「${yaku.symbols[r]}」が配列に無い`,
          ).toBeGreaterThan(0);
        }

        const misses: string[] = [];
        for (const order of STOP_ORDERS) {
          for (const p0 of aims[0]) {
            for (const p1 of aims[1]) {
              for (const p2 of aims[2]) {
                const press = [p0, p1, p2];
                const vis: (VisibleColumn | null)[] = [null, null, null];
                const pos: (number | null)[] = [null, null, null];
                for (const r of order) {
                  const slip = ctrl.resolveSlip({
                    reelIndex: r,
                    basePosition: press[r],
                    strip: strips[r],
                    stoppedVisibles: vis,
                    stoppedPositions: pos,
                    flagYakuIds: [yaku.id],
                    flagKey: role.id,
                  });
                  const q = (press[r] + slip) % N;
                  pos[r] = q;
                  const [top, middle, bottom] = visible(reels[r], q);
                  vis[r] = { top, middle, bottom };
                }
                const cols = pos.map((q, r) => visible(reels[r], q as number));
                if (!aligned(cols, yaku)) {
                  misses.push(
                    `押し順${order.join('')} 押下(${press.join(',')}) → 停止(${pos.join(',')}) ` +
                      `出目 ${cols.map((c) => c.join('/')).join(' | ')}`,
                  );
                }
              }
            }
          }
        }

        const total = STOP_ORDERS.length * aims[0].length * aims[1].length * aims[2].length;
        expect(
          misses,
          `${chapter} / ${role.id}（${yaku.name}＝${yaku.symbols.join('')}）: ` +
            `狙って押した ${total} 通りのうち ${misses.length} 通りで揃わない\n` +
            misses.slice(0, 20).join('\n') +
            (misses.length > 20 ? `\n…他 ${misses.length - 20} 件` : ''),
        ).toEqual([]);
      });
    }
  }
});
