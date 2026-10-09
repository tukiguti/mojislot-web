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
import { YakuJudge } from '../../src/core/YakuJudge';

/**
 * **狙い所の監査**（2026-10-10）。目印のある配列は「BIG1・BIG2・目印のどれかを
 * 狙って押せば、その役が揃う」を約束している（tests/tools/optimize-reels の aimGroups）。
 *
 *  - 押し方：狙う図柄が中段に来る**2コマ手前**で押す（少し早めに押しても引き込みで取れる）
 *  - 押し順：順押し・逆押し・中押し2通りの**4通り**
 *  - 判定：役ごとに、3つの狙い所の**どれか1つ**で取りこぼしが0であること
 *    （受け持つ役は島ごとに割り振ってよい、という決定）
 *  - 第3リールの BIG1・BIG2 は図柄ではなく**組**で狙う（2026-10-10 決定）。目印の
 *    すぐ次の組がペア1（BIG1 の担当）、もう一方の組がペア2（BIG2 の担当）
 *
 * ゲーム本体と同じ停止制御（停止テーブルを引く）で測る。
 */

const DIR = dirname(fileURLToPath(import.meta.url));
const DATA = resolve(DIR, '../../data');
const readJson = (p: string) => JSON.parse(readFileSync(p, 'utf-8'));
const CHAPTERS = ['hiragana_food', 'hiragana_verb', 'katakana_animal', 'security', 'yasai'] as const;
const ORDERS = [[0, 1, 2], [2, 1, 0], [1, 0, 2], [1, 2, 0]] as const;
const LINES = [[0, 0, 0], [1, 1, 1], [2, 2, 2], [0, 1, 2], [2, 1, 0]] as const;

describe('狙い所（BIG1・BIG2・目印）', () => {
  const tuning = TuningSchema.parse(readJson(`${DATA}/tuning/default.json`));
  for (const chapter of CHAPTERS) {
    const yakuList = YakuListSchema.parse(readJson(`${DATA}/yaku/${chapter}.json`));
    const reelCfg = ReelConfigSchema.parse(readJson(`${DATA}/reels/${chapter}.json`));
    const mark = reelCfg.landmark;
    if (!mark) continue;
    const reels = reelCfg.reels.map((r) => r.cells);
    const N = reels[0].length;
    const ctrl = new StopController({
      yakuList,
      slipResolver: new SlipResolver(yakuList, { assistMaxCells: tuning.assist.pullInCells }),
      tenpaiDetector: new TenpaiDetector(yakuList),
      stopTable: new StopTableLookup(StopTableSchema.parse(readJson(`${DATA}/stops/${chapter}.json`))),
      pullInCells: tuning.assist.pullInCells,
      reels,
    });
    const judge = new YakuJudge(yakuList);
    const big1 = yakuList.premiumYaku[0];
    const big2 = yakuList.premiumYaku[1] ?? big1;
    // 第3リールの組：BIG1 の図柄と REG の図柄が隣り合う2コマ。目印のすぐ次がペア1。
    const r3 = reels[2];
    const regSym = yakuList.bonusYaku[0]?.symbols[2];
    const bigSym = big1?.symbols[2];
    const pair1Big = r3.findIndex((c, i) => c === bigSym && r3[(i - 1 + N) % N] === mark);
    const pair2Pos = r3.findIndex(
      (c, i) =>
        c === big2?.symbols[2] &&
        Math.abs(i - pair1Big) > 1 &&
        (r3[(i + 1) % N] === (c === bigSym ? regSym : bigSym) ||
          r3[(i - 1 + N) % N] === (c === bigSym ? regSym : bigSym)),
    );
    const symAt = (r: number, sym: string | undefined) =>
      sym === undefined ? [] : reels[r].flatMap((c, i) => (c === sym ? [i] : []));
    const anchors: { label: string; at: number[][] }[] = [
      { label: 'BIG1', at: [symAt(0, big1?.symbols[0]), symAt(1, big1?.symbols[1]), [pair1Big]] },
      { label: 'BIG2', at: [symAt(0, big2?.symbols[0]), symAt(1, big2?.symbols[1]), [pair2Pos]] },
      { label: '目印', at: [symAt(0, mark), symAt(1, mark), symAt(2, mark)] },
    ];
    it(`${chapter}: 第3リールにペア1（目印のすぐ次）とペア2がある`, () => {
      expect(pair1Big, `${chapter}: 目印のすぐ次に BIG の図柄が無い`).toBeGreaterThanOrEqual(0);
      expect(pair2Pos, `${chapter}: ペア2が見つからない`).toBeGreaterThanOrEqual(0);
    });
    const vis = (r: number, p: number): VisibleColumn => ({
      top: reels[r][(p + 1) % N],
      middle: reels[r][p],
      bottom: reels[r][(p - 1 + N) % N],
    });
    const misses = (y: Yaku, at: number[][]): number => {
      const role = yakuList.internalRoles.find((rr) => rr.displayYakuId === y.id && !rr.freeze);
      const aims = at.map((list) => (list.length === 0 ? [0] : list.map((i) => (i - 2 + N) % N)));
      let n = 0;
      for (const order of ORDERS) {
        for (const p0 of aims[0]) for (const p1 of aims[1]) {
          for (const p2 of y.symbols[2] === undefined ? [aims[2][0] ?? 0] : aims[2]) {
            const press = [p0, p1, p2];
            const st: (VisibleColumn | null)[] = [null, null, null];
            const pos: (number | null)[] = [null, null, null];
            for (const r of order) {
              const slip = ctrl.resolveSlip({
                reelIndex: r,
                basePosition: press[r],
                strip: reelCfg.reels[r],
                stoppedVisibles: st,
                stoppedPositions: pos,
                flagYakuIds: [y.id],
                flagKey: role?.id ?? y.id,
              });
              pos[r] = (press[r] + slip) % N;
              st[r] = vis(r, pos[r] as number);
            }
            const cols = st.map((v) => [v!.top, v!.middle, v!.bottom]);
            const ok = LINES.some((l) => y.symbols.every((s, r) => cols[r][l[r]] === s));
            if (!ok) n++;
          }
        }
      }
      return n;
    };
    for (const y of [...yakuList.coreYaku, ...yakuList.cherryYaku]) {
      it(`${chapter}: ${y.name} はどれかの狙い所で必ず揃う`, () => {
        const byAnchor = anchors.map((a) => `${a.label}=${misses(y, a.at)}`);
        const ok = anchors.some((a) => misses(y, a.at) === 0);
        expect(ok, `${chapter} ${y.name}: 狙い所ごとの取りこぼし ${byAnchor.join(' ')}`).toBe(true);
      });
    }
  }
});
