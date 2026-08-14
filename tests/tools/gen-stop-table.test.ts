import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { SlipResolver, type VisibleColumn } from '../../src/productions/SlipResolver';
import {
  PAYLINES,
  ROW_VERTICAL,
  primaryRowOf,
  visibleAt,
  type Vertical,
} from '../../src/core/Paylines';
import {
  YakuListSchema,
  ReelConfigSchema,
  TuningSchema,
  type Yaku,
  type YakuList,
} from '../../src/data/schemas';

/**
 * 停止テーブル（第1停止）の生成。
 *
 *   GEN=1 npx vitest run tests/tools/gen-stop-table.test.ts
 *
 * 現行の停止制御（当選役を pullInCells 以内で中段へ引き込む）から
 * `data/stops/<章>.json` を書き出す。**生成後は手で書き換えてよい**。
 * 第1停止ではどの役もロックし得ないため蹴りは発火せず、ここは完全に自由に
 * 設計できる（リーチ目・入り目の起点）。②ゼロ保証は第2・第3停止の蹴りが守り、
 * 監査テストが全押下位置で検証する。
 */

const RUN = process.env.GEN === '1';
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

/** 内部役ID → その役が出目に出してよい役（1枚役はグループ全体）。 */
export function flagYakusFor(yakuList: YakuList, flagKey: string): Yaku[] {
  if (flagKey === 'miss') return [];
  if (flagKey === 'single') return [...yakuList.singleYaku];
  const all = [
    ...yakuList.coreYaku,
    ...yakuList.cherryYaku,
    ...yakuList.bonusYaku,
    ...yakuList.premiumYaku,
  ];
  const role = yakuList.internalRoles.find((r) => r.id === flagKey);
  const id = role?.displayYakuId ?? flagKey;
  const y = all.find((v) => v.id === id);
  return y ? [y] : [];
}

/**
 * 各リールの「ボーナス役にしか使われない図柄」＝ボーナス専用図柄。
 * 非ボーナスフラグではこれを第1停止の中段に止めないことで、
 * 「中段にこの図柄＝ボーナス確定」という一発リーチ目が成立する（実機の中段告知と同じ）。
 */
export function bonusOnlySymbols(yakuList: YakuList, reel: number): Set<string> {
  const bonusSide = new Set(
    [...yakuList.bonusYaku, ...yakuList.premiumYaku]
      .map((y) => y.symbols[reel])
      .filter((v): v is string => v !== undefined),
  );
  for (const y of [
    ...yakuList.coreYaku,
    ...yakuList.cherryYaku,
    ...yakuList.singleYaku,
  ]) {
    const sym = y.symbols[reel];
    if (sym !== undefined) bonusSide.delete(sym);
  }
  return bonusSide;
}

/**
 * 第1停止（他リール未停止）のスベリコマ数を現行制御から計算する。
 *
 * **中段が第一候補で、上下段は中段に届かない時だけの逃げ道**。第1停止ではまだ
 * どのラインも確定していないので図柄が窓のどこかに入ればよく、上下段も使えば
 * 引き込み窓が5コマから7コマに広がる。
 *
 * ただし中段の優先を外すと、中段が特別な位置でなくなって**示唆の発展**（当選図柄が
 * 中段に来たら役を明かす）と**中段告知**（持ち越し中の一発リーチ目）が両方壊れる。
 * 実測で発展68%→38%、中段告知46.5%→14.1%まで落ちた。だから中段が届く限り中段。
 */
export function computeFirstStopSlip(
  resolver: SlipResolver,
  targets: readonly Yaku[],
  cells: readonly string[],
  reel: number,
  press: number,
  pullInCells: number,
): number {
  if (targets.length === 0) return 0; // ハズレ：第1停止では蹴りが効かない＝押した位置で止まる
  const stopped: (VisibleColumn | null)[] = [null, null, null];
  const ctx = {
    reelIndex: reel,
    basePosition: press,
    strip: { id: `r${reel}`, cells: [...cells] },
    stoppedVisibles: stopped,
    exceptYakuIds: targets.map((y) => y.id),
  };
  const pick = (verticals: readonly Vertical[]): number | null => {
    let best: number | null = null;
    for (const y of targets) {
      const sym = y.symbols[reel];
      if (sym === undefined) continue;
      for (const vertical of verticals) {
        const slip = resolver.resolveAssist(ctx, sym, vertical, pullInCells);
        if (slip !== null && (best === null || slip < best)) best = slip;
      }
    }
    return best;
  };
  // **主ラインが要求する行だけ**を狙う（StopController と同じ規則）。
  // 逃げ道を持たないので、テーブルの値が「主ラインへ何コマ寄せたか」だけを意味する。
  // 基準がずれると第2・第3の引き込みと噛み合わない（初回測定が32.7%まで落ちた原因）。
  return pick([primaryRowOf(reel)]) ?? 0;
}

describe.skipIf(!RUN)('停止テーブル生成', () => {
  it('全章の第1停止テーブルを data/stops へ書き出す', () => {
    const tuning = TuningSchema.parse(readJson(`${DATA}/tuning/default.json`));
    mkdirSync(`${DATA}/stops`, { recursive: true });
    for (const chapter of CHAPTERS) {
      const yakuList = YakuListSchema.parse(readJson(`${DATA}/yaku/${chapter}.json`));
      const reelCfg = ReelConfigSchema.parse(readJson(`${DATA}/reels/${chapter}.json`));
      const reels = reelCfg.reels.map((r) => r.cells);
      const resolver = new SlipResolver(yakuList, {
        assistMaxCells: tuning.assist.pullInCells,
      });

      const firstStop: Record<string, number[][]> = {};
      for (const role of yakuList.internalRoles) {
        const targets = flagYakusFor(yakuList, role.id);
        const isBonusFlag = role.kind === 'reg' || role.kind === 'big';
        firstStop[role.id] = [0, 1, 2].map((reel) => {
          const cells = reels[reel];
          const n = cells.length;
          const forbidden = isBonusFlag
            ? new Set<string>()
            : bonusOnlySymbols(yakuList, reel);
          return Array.from({ length: n }, (_, press) => {
            const slip = computeFirstStopSlip(
              resolver, targets, cells, reel, press, tuning.assist.pullInCells,
            );
            // ボーナス専用図柄を**主ライン上**に残さない（＝出たらボーナス確定になる）。
            // 引き込みが決まっている場合は主ラインが当選役の図柄なので、ここには入らない。
            if (forbidden.size === 0) return slip;
            const row = primaryRowOf(reel);
            for (let d = 0; d <= tuning.assist.pullInCells; d++) {
              const cand = (slip + d) % (tuning.assist.pullInCells + 1);
              if (!forbidden.has(visibleAt(cells, (press + cand) % n, row))) return cand;
            }
            return slip; // 窓内すべて専用図柄（配列的にあり得ないが保険）
          });
        });
      }
      const out = { mode: chapter, firstStop };
      writeFileSync(
        `${DATA}/stops/${chapter}.json`,
        `${JSON.stringify(out, null, 2)}\n`,
        'utf-8',
      );
      expect(Object.keys(firstStop).length).toBe(yakuList.internalRoles.length);
    }
  });
});
