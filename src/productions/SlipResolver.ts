import type { ReelStrip, Yaku, YakuList } from '../data/schemas';
import {
  PAYLINES,
  extractPartialLineSymbols,
  visibleAt,
  type PartialGrid3x3,
  type Vertical,
} from '../core/Paylines';

/**
 * 滑り（引き込み）解決ロジック（簡素化版）。
 *
 * モードは1つだけ：**noise**（通常時の蹴り滑り）。
 *  - 50% の確率で起動
 *  - 押下位置で 5ペイライン（横3+斜め2）のいずれかが成立しそうなら、
 *    順方向に最大2コマで「どのラインも成立しない位置」を探して滑らせる
 *  - 無限稼ぎを防ぎつつ、たまに揃う爽快感を残す調整
 *
 * 示唆/クイズ時の特別補助は廃止。演出（マスコット表情・SE）のみ残す。
 */

export interface VisibleColumn {
  top: string;
  middle: string;
  bottom: string;
}

export interface SlipContext {
  /** 0=左, 1=中, 2=右 */
  reelIndex: number;
  /** 押下時点のセルインデックス（既にスナップ済みの整数） */
  basePosition: number;
  strip: ReelStrip;
  /** 各リールの現在の停止 3 セル（未停止は null） */
  stoppedVisibles: readonly (VisibleColumn | null)[];
}

const SLIP_PROBABILITY = 0.5;
const SLIP_MAX_CELLS = 2;

const VERTICALS: readonly Vertical[] = ['top', 'middle', 'bottom'];

export class SlipResolver {
  private readonly allYakus: Yaku[];

  constructor(yakuList: YakuList) {
    this.allYakus = [
      ...yakuList.coreYaku,
      ...yakuList.premiumYaku,
      ...yakuList.bonusYaku,
    ];
  }

  /**
   * 引き込みコマ数（0..SLIP_MAX_CELLS）を返す。
   * 0 ならスベらず押下位置で停止。
   */
  resolve(ctx: SlipContext): number {
    if (Math.random() >= SLIP_PROBABILITY) return 0;

    if (!this.wouldCompleteAnyLine(ctx.basePosition, ctx)) {
      return 0;
    }

    // 順方向に「どのラインも成立しない位置」を探す
    const total = ctx.strip.cells.length;
    for (let offset = 1; offset <= SLIP_MAX_CELLS; offset++) {
      const idx = (((ctx.basePosition + offset) % total) + total) % total;
      if (!this.wouldCompleteAnyLine(idx, ctx)) {
        return offset;
      }
    }
    return 0;
  }

  /**
   * このリールが position に停止したとして、5ペイラインのいずれかで
   * 役成立する見込みがあるかを判定。
   * 他リール（未停止）はワイルドカード扱い。
   */
  private wouldCompleteAnyLine(position: number, ctx: SlipContext): boolean {
    const grid = this.buildPartialGrid(position, ctx);
    return PAYLINES.some((line) => {
      const [a, b, c] = extractPartialLineSymbols(grid, line);
      return this.allYakus.some(
        (y) =>
          (a === null || y.symbols[0] === a) &&
          (b === null || y.symbols[1] === b) &&
          (c === null || y.symbols[2] === c),
      );
    });
  }

  private buildPartialGrid(
    position: number,
    ctx: SlipContext,
  ): PartialGrid3x3 {
    const rows: (string | null)[][] = [[null, null, null], [null, null, null], [null, null, null]];
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        if (c === ctx.reelIndex) {
          // 自分のリールはこの position で 3 セルが確定
          rows[r][c] = visibleAt(ctx.strip.cells, position, VERTICALS[r]);
        } else {
          const v = ctx.stoppedVisibles[c];
          rows[r][c] = v ? v[VERTICALS[r]] : null;
        }
      }
    }
    return [
      [rows[0][0], rows[0][1], rows[0][2]],
      [rows[1][0], rows[1][1], rows[1][2]],
      [rows[2][0], rows[2][1], rows[2][2]],
    ];
  }
}
