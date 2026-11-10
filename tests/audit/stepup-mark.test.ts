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
import { AIM_TIMINGS } from '../../src/core/PullInGuard';

/**
 * **ステップアップのボーナスのゲーム**（2026-11-10）の監査。
 *
 * ボーナスのゲームは内部役がそのボーナスを伴う目印揃い（`carry` あり）になり、
 * 目印とそのボーナスの役のどちらも揃えてよい。
 *  - BIG（REG）を狙えば、そのゲームで揃う（生入り）
 *  - チェリーを狙う（左・中）と目印がテンパイし、右リールは目印に届けば目印が揃い、
 *    届かなければテンパイしたラインにボーナスの図柄が止まる
 *
 * ゲーム本体と同じ停止制御（停止テーブルを引く）・順押しで測る。
 */

const DIR = dirname(fileURLToPath(import.meta.url));
const DATA = resolve(DIR, '../../data');
const readJson = (p: string) => JSON.parse(readFileSync(p, 'utf-8'));
const CHAPTERS = ['hiragana_food', 'hiragana_verb', 'katakana_animal', 'security', 'yasai'] as const;
const LINES = [[0, 0, 0], [1, 1, 1], [2, 2, 2], [0, 1, 2], [2, 1, 0]] as const;

describe('ステップアップのボーナスのゲーム（目印揃い＋ボーナス）', () => {
  const tuning = TuningSchema.parse(readJson(`${DATA}/tuning/default.json`));
  for (const chapter of CHAPTERS) {
    const yakuList = YakuListSchema.parse(readJson(`${DATA}/yaku/${chapter}.json`));
    const reelCfg = ReelConfigSchema.parse(readJson(`${DATA}/reels/${chapter}.json`));
    const mark = reelCfg.landmark;
    if (!mark) continue;
    const reels = reelCfg.reels.map((r) => r.cells);
    const N = reels[0].length;
    const tenpai = new TenpaiDetector(yakuList);
    const ctrl = new StopController({
      yakuList,
      slipResolver: new SlipResolver(yakuList, { assistMaxCells: tuning.assist.pullInCells }),
      tenpaiDetector: tenpai,
      stopTable: new StopTableLookup(StopTableSchema.parse(readJson(`${DATA}/stops/${chapter}.json`))),
      pullInCells: tuning.assist.pullInCells,
      reels,
    });
    const vis = (r: number, p: number): VisibleColumn => ({
      top: reels[r][(p + 1) % N],
      middle: reels[r][p],
      bottom: reels[r][(p - 1 + N) % N],
    });
    const markYaku = yakuList.chanceYaku[0];
    const cherry = yakuList.cherryYaku[0];
    const symAt = (r: number, sym: string | undefined) =>
      sym === undefined ? [] : reels[r].flatMap((c, i) => (c === sym ? [i] : []));
    const aimsFor = (r: number, sym: string | undefined) =>
      symAt(r, sym).flatMap((i) => AIM_TIMINGS.map((e) => (i - e + N) % N));

    /** 順押しで3リールを止めた出目（列ごとに top/middle/bottom）。 */
    const play = (press: number[], flagYakuIds: string[], flagKey: string) => {
      const st: (VisibleColumn | null)[] = [null, null, null];
      const pos: (number | null)[] = [null, null, null];
      let beforeLast: (VisibleColumn | null)[] = [];
      for (const r of [0, 1, 2]) {
        if (r === 2) beforeLast = [...st];
        const slip = ctrl.resolveSlip({
          reelIndex: r,
          basePosition: press[r],
          strip: reelCfg.reels[r],
          stoppedVisibles: st,
          stoppedPositions: pos,
          flagYakuIds,
          flagKey,
        });
        pos[r] = (press[r] + slip) % N;
        st[r] = vis(r, pos[r] as number);
      }
      return { cols: st.map((v) => [v!.top, v!.middle, v!.bottom]), beforeLast };
    };
    const lined = (cols: string[][], y: Yaku) =>
      LINES.some((l) => y.symbols.every((s, r) => cols[r][l[r]] === s));

    // 第3リールの BIG は組で狙う（aim-groups と同じ）。ペア1＝BIG1、ペア2＝BIG2
    const r3 = reels[2];
    const regSym = yakuList.bonusYaku[0]?.symbols[2];
    const big1 = yakuList.premiumYaku[0];
    const big2 = yakuList.premiumYaku[1] ?? big1;
    const pair1Big = r3.findIndex((c, i) => c === big1?.symbols[2] && r3[(i + 1) % N] === regSym);
    const pair2Reg = r3.findIndex((c, i) => c === regSym && r3[(i + 1) % N] === big1?.symbols[2]);
    const pair2Pos = big2?.symbols[2] === regSym ? pair2Reg : (pair2Reg + 1) % N;
    const thirdAims = (y: Yaku) =>
      (y.id === big1?.id ? [pair1Big] : [pair2Pos]).flatMap((i) =>
        AIM_TIMINGS.map((e) => (i - e + N) % N),
      );
    const symbolsOnRight = new Set(
      [...yakuList.premiumYaku, ...yakuList.bonusYaku].map((y) => y.symbols[2]),
    );

    for (const bonus of [...yakuList.premiumYaku, ...yakuList.bonusYaku]) {
      const role = yakuList.internalRoles.find((r) => r.kind === 'chance' && r.carry === bonus.id);
      if (!role || !markYaku) continue;
      const flags = [markYaku.id, bonus.id];

      // 生入りは BIG だけ見る（REG には狙い所が無い）。BIG の図柄を狙った時の揃い方が、
      // 目印揃いの付かない普通の BIG の当選と同じ程度であること（普通の BIG でも
      // 4コマ手前〜下段の全タイミングでは揃わない押し方がある）。
      const pureRole = yakuList.internalRoles.find(
        (r) => r.displayYakuId === bonus.id && !r.freeze && r.kind === 'big',
      );
      if (bonus.category === 'premium' && pureRole) it(`${chapter}: ${role.id} で ${bonus.name} を狙えば、普通の BIG と同じ程度に揃う（生入り）`, () => {
        let total = 0;
        let missChance = 0;
        let missPure = 0;
        for (const p0 of aimsFor(0, bonus.symbols[0])) {
          for (const p1 of aimsFor(1, bonus.symbols[1])) {
            for (const p2 of thirdAims(bonus)) {
              total++;
              if (!lined(play([p0, p1, p2], flags, role.id).cols, bonus)) missChance++;
              if (!lined(play([p0, p1, p2], [bonus.id], pureRole.id).cols, bonus)) missPure++;
            }
          }
        }
        console.log(`${chapter} ${role.id}: ${bonus.name} を狙って揃わない ${missChance}/${total}（普通の BIG は ${missPure}）`);
        expect(total).toBeGreaterThan(0);
        expect(missChance, `${chapter} ${role.id}: 普通の BIG より揃いにくい`).toBeLessThanOrEqual(
          missPure + Math.ceil(total * 0.05),
        );
      });

      it(`${chapter}: ${role.id} でチェリーを狙うと、右は目印かボーナスの図柄で止まる`, () => {
        let tenpaiCount = 0;
        let other = 0;
        let markHit = 0;
        for (const p0 of aimsFor(0, cherry?.symbols[0])) {
          for (const p1 of aimsFor(1, cherry?.symbols[1])) {
            for (let p2 = 0; p2 < N; p2++) {
              const { cols, beforeLast } = play([p0, p1, p2], flags, role.id);
              const tp = tenpai.detect(beforeLast);
              const markLines = (tp?.lines ?? []).filter((l) => l.yaku.id === markYaku.id);
              if (markLines.length === 0) continue;
              tenpaiCount++;
              if (lined(cols, markYaku)) {
                markHit++;
                continue;
              }
              if (lined(cols, bonus)) continue;
              const row = { top: 0, middle: 1, bottom: 2 } as const;
              const shown = markLines.some((l) => symbolsOnRight.has(cols[2][row[l.vertical]]));
              if (!shown) other++;
            }
          }
        }
        expect(tenpaiCount, `${chapter} ${role.id}: チェリーを狙って目印がテンパイしない`).toBeGreaterThan(0);
        // 右リールは目印が1枚で、目印にもボーナスの図柄にも届かない押し方が配列上ある
        // （21コマ中おおよそ4コマ）。届く押し方では必ず止まることを、下限で確かめる。
        const covered = (tenpaiCount - other) / tenpaiCount;
        console.log(
          `${chapter} ${role.id}: 目印テンパイ ${tenpaiCount}・目印${markHit}・どちらでもない ${other}（${(covered * 100).toFixed(1)}%）`,
        );
        expect(covered, `${chapter} ${role.id}: 目印かボーナスの図柄で止まる割合`).toBeGreaterThanOrEqual(0.75);
      });
    }
  }
});
