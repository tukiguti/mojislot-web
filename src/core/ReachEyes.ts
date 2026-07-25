import type { Grid3x3 } from './Paylines';
import type { ReachEyeTable } from '../data/schemas';

/**
 * リーチ目の判定。
 *
 * 実機のリーチ目は designer が絵を描くものではなく**停止制御の副産物**で、
 * 「そのフラグの時にしか制御上あり得ない出目」を指す。`data/reach/*.json` は
 * 全フラグ × 全押し順 × 全押下位置を実制御で回して抽出した結果
 * （生成: `REACH=1 npx vitest run tests/tools/find-reach-eyes.test.ts`）。
 *
 * ボーナスをこぼして持ち越している間は演出も告知も出ないので、
 * プレイヤーはこの出目を読んで「まだフラグが生きている」ことを察知する。
 */
export type ReachKind = 'reg' | 'big' | 'both';

/** 3x3グリッド → 抽出時と同じキー（左|中|右、各リールは上中下）。 */
export function reachKeyOf(grid: Grid3x3): string {
  return [0, 1, 2]
    .map((col) => `${grid[0][col]}${grid[1][col]}${grid[2][col]}`)
    .join('|');
}

export class ReachEyes {
  /** 各リールの「ボーナス役にしか使われない図柄」。中段に来たらボーナス確定。 */
  private readonly bonusOnly: Set<string>[];

  constructor(
    private readonly table: ReachEyeTable | null,
    yakuList?: {
      bonusYaku: readonly { symbols: readonly string[] }[];
      premiumYaku: readonly { symbols: readonly string[] }[];
      coreYaku: readonly { symbols: readonly string[] }[];
      cherryYaku: readonly { symbols: readonly string[] }[];
      singleYaku: readonly { symbols: readonly string[] }[];
    },
  ) {
    this.bonusOnly = [0, 1, 2].map((reel) => {
      if (!yakuList) return new Set<string>();
      const s = new Set<string>();
      for (const y of [...yakuList.bonusYaku, ...yakuList.premiumYaku]) {
        const sym = y.symbols[reel];
        if (sym !== undefined) s.add(sym);
      }
      for (const y of [
        ...yakuList.coreYaku,
        ...yakuList.cherryYaku,
        ...yakuList.singleYaku,
      ]) {
        const sym = y.symbols[reel];
        if (sym !== undefined) s.delete(sym);
      }
      return s;
    });
  }

  /**
   * 停止したリールの中段が「ボーナス専用図柄」か＝**その場でボーナス確定**。
   * 停止テーブルが非ボーナスフラグではこれを中段に残さないよう組んであるので、
   * 中段に出た時点で確定になる（実機の中段告知と同じ一発リーチ目）。
   */
  isBonusOnlyAtMiddle(reel: number, middleSymbol: string): boolean {
    return this.bonusOnly[reel]?.has(middleSymbol) ?? false;
  }

  /** この出目がリーチ目なら確定するボーナス種別、違えば null。 */
  detect(grid: Grid3x3): ReachKind | null {
    if (!this.table) return null;
    return this.table.eyes[reachKeyOf(grid)] ?? null;
  }

  get size(): number {
    return this.table ? Object.keys(this.table.eyes).length : 0;
  }
}
