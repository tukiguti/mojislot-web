import type { ReelStrip, Yaku, YakuList } from '../data/schemas';
import {
  PAYLINES,
  extractPartialLineSymbols,
  visibleAt,
  type PartialGrid3x3,
  type Vertical,
} from '../core/Paylines';

/**
 * 滑り（蹴り）と引き込みの解決。
 *
 * - **resolveKick**: 通常時（演出なし）のアンチ無限稼ぎ。**premium/bonus（7・バー・RB）**
 *   が偶然揃いそうな時だけ、順方向に最大 KICK_MAX_CELLS コマで「揃わない位置」へ蹴る。
 *   core/cherry は蹴らない（素直に止まる＝日常役は止まりやすく）。
 * - **resolveAssist**: 演出時の最終リール引き込み。狙い役の図柄が中段に来るよう順方向に
 *   最大 ASSIST_MAX_CELLS コマ引き込む（テンパイまでは自力、最後の出目だけ補助）。
 *
 * 設計詳細: zikken/playground/mojislot-plan/17_assist-and-slip.md
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
  /** この役IDは蹴らない（演出で予告した役。premium/bonus を予告した時に指定） */
  exceptYakuId?: string;
  /** これらのカテゴリの役は蹴らない（赤/金示唆で bonus/premium を引き込み対象にする時に指定）。 */
  exceptCategories?: readonly Yaku['category'][];
}

const KICK_PROBABILITY = 0.5;
const KICK_MAX_CELLS = 2;
/** 最終リール引き込みの最大コマ数（実機準拠＝4コマ。「テンパイ＝ほぼ成立」） */
const ASSIST_MAX_CELLS = 4;

const VERTICALS: readonly Vertical[] = ['top', 'middle', 'bottom'];

/** 補助強度の調整値（data/tuning から渡す。省略時は上記既定）。 */
export interface SlipResolverOptions {
  kickProbability?: number;
  kickMaxCells?: number;
  assistMaxCells?: number;
}

export class SlipResolver {
  /** 蹴り対象＝premium/bonus のみ（core/cherry は蹴らない） */
  private readonly kickYakus: Yaku[];
  private readonly kickProbability: number;
  private readonly kickMaxCells: number;
  private readonly assistMaxCells: number;

  constructor(yakuList: YakuList, opts: SlipResolverOptions = {}) {
    this.kickYakus = [...yakuList.premiumYaku, ...yakuList.bonusYaku];
    this.kickProbability = opts.kickProbability ?? KICK_PROBABILITY;
    this.kickMaxCells = opts.kickMaxCells ?? KICK_MAX_CELLS;
    this.assistMaxCells = opts.assistMaxCells ?? ASSIST_MAX_CELLS;
  }

  /**
   * 蹴り（アンチ無限稼ぎ）。**予告役（exceptYakuId）以外の premium/bonus** が成立しそうなら
   * 順方向最大 KICK_MAX_CELLS コマで「外れる位置」へ蹴る。0 ならスベらず押下位置で停止。
   * 演出種別に依らず作用するが、予告した役（aim/quiz が指定した役）は蹴らない。
   */
  resolveKick(ctx: SlipContext): number {
    let yakus = ctx.exceptYakuId
      ? this.kickYakus.filter((y) => y.id !== ctx.exceptYakuId)
      : this.kickYakus;
    if (ctx.exceptCategories && ctx.exceptCategories.length > 0) {
      const exempt = new Set(ctx.exceptCategories);
      yakus = yakus.filter((y) => !exempt.has(y.category));
    }
    if (yakus.length === 0) return 0;
    if (Math.random() >= this.kickProbability) return 0;
    if (!this.wouldComplete(ctx.basePosition, ctx, yakus)) return 0;

    const total = ctx.strip.cells.length;
    for (let offset = 1; offset <= this.kickMaxCells; offset++) {
      const idx = (((ctx.basePosition + offset) % total) + total) % total;
      if (!this.wouldComplete(idx, ctx, yakus)) return offset;
    }
    return 0;
  }

  /**
   * 演出時の最終リール引き込み（5ライン対応）。指定の可視位置 vertical（上/中/下）の
   * セルが targetSymbol になる最小の順方向コマ数（0..ASSIST_MAX_CELLS）を返す。
   * 窓内に無ければ null（プレイヤーのミス＝補助なし）。
   * 斜めラインは最終リールで必要な行が中段以外になるため vertical で指定する。
   */
  resolveAssist(
    strip: ReelStrip,
    basePosition: number,
    targetSymbol: string,
    vertical: Vertical,
    maxCells?: number,
  ): number | null {
    const max = maxCells ?? this.assistMaxCells;
    for (let offset = 0; offset <= max; offset++) {
      if (visibleAt(strip.cells, basePosition + offset, vertical) === targetSymbol) {
        return offset;
      }
    }
    return null;
  }

  /**
   * このリールが position に停止したとして、5ペイラインのいずれかで
   * yakus のいずれかが成立する見込みがあるかを判定。
   * 他リール（未停止）はワイルドカード扱い。
   */
  private wouldComplete(
    position: number,
    ctx: SlipContext,
    yakus: readonly Yaku[],
  ): boolean {
    const grid = this.buildPartialGrid(position, ctx);
    return PAYLINES.some((line) => {
      const [a, b, c] = extractPartialLineSymbols(grid, line);
      return yakus.some(
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
