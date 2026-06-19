import type { Yaku, YakuList } from '../data/schemas';
import { PAYLINES, type Vertical } from '../core/Paylines';
import type { VisibleColumn } from './SlipResolver';

/** row 0/1/2 → 可視位置 top/middle/bottom */
const ROW_VERTICAL: readonly Vertical[] = ['top', 'middle', 'bottom'];

/** テンパイ成立ライン1本：揃えば成立する役と、最終リールで必要な可視位置（行）。 */
export interface TenpaiLine {
  yaku: Yaku;
  /** 未停止（最終）リールでこの役を完成させるために図柄が来るべき可視位置 */
  vertical: Vertical;
}

export interface TenpaiResult {
  /** 揃えば成立する役（重複なし） */
  reachable: Yaku[];
  /** 成立ライン（役 × 最終リールの行）一覧。引き込み対象の選択に使う */
  lines: TenpaiLine[];
  /** 未停止リールのインデックス */
  missingReelIndex: number;
  /** プレミアム役を含む場合 true（演出の派手さを変えるため） */
  hasPremium: boolean;
}

/**
 * テンパイ（リーチ）検出。**5ペイライン（横3＋斜め2）対応**。
 * 第2停止後（2リール停止／残り1リール）で、未停止リールの該当位置に図柄が来れば
 * 役成立になるライン群を返す。チェリー（2文字役）は使わない列を不問にする。
 */
export class TenpaiDetector {
  private readonly allYakus: Yaku[];

  constructor(yakuList: YakuList) {
    this.allYakus = [
      ...yakuList.coreYaku,
      ...yakuList.premiumYaku,
      ...yakuList.bonusYaku,
      ...yakuList.cherryYaku,
    ];
  }

  detect(
    stoppedVisibles: readonly (VisibleColumn | null)[],
  ): TenpaiResult | null {
    const stoppedCount = stoppedVisibles.filter((v) => v !== null).length;
    if (stoppedCount !== 2) return null;
    const missingReelIndex = stoppedVisibles.findIndex((v) => v === null);
    if (missingReelIndex === -1) return null;

    const lines: TenpaiLine[] = [];
    for (const yaku of this.allYakus) {
      // 役が未停止リールを使わない（例: チェリーで最終リールが右）なら対象外
      if (yaku.symbols[missingReelIndex] === undefined) continue;
      for (const line of PAYLINES) {
        const finalCell = line.cells.find(([, col]) => col === missingReelIndex);
        if (!finalCell) continue;
        let ok = true;
        for (const [row, col] of line.cells) {
          if (col === missingReelIndex) continue;
          if (yaku.symbols[col] === undefined) continue; // チェリー: 不問の列はスキップ
          const sv = stoppedVisibles[col];
          if (!sv || sv[ROW_VERTICAL[row]] !== yaku.symbols[col]) {
            ok = false;
            break;
          }
        }
        if (ok) lines.push({ yaku, vertical: ROW_VERTICAL[finalCell[0]] });
      }
    }
    if (lines.length === 0) return null;

    const reachable = Array.from(new Set(lines.map((l) => l.yaku)));
    const hasPremium = reachable.some((y) => y.category === 'premium');
    return { reachable, lines, missingReelIndex, hasPremium };
  }
}
