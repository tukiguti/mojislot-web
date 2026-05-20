import type { ReelStrip, Yaku, YakuList } from '../data/schemas';

/**
 * 滑り（引き込み）解決ロジック。
 * 押下位置から最大 N コマ先までを探索し、
 *  - 既に停止しているリールと整合する役があれば
 *  - 自分のリールの該当文字が範囲内に出現したら
 * 確率に応じて引き込む。
 *
 * 注意: 「常時 100% 引き込む」とプレイヤーが無限稼ぎできてしまうため、
 * 演出（示唆 / クイズ正解）に応じて probability を絞る前提で運用する。
 */

export interface SlipPolicy {
  /** 引き込み発動確率 0..1 */
  probability: number;
  /** 押下位置からの最大引き込みコマ数 */
  maxCells: number;
}

/** 演出なし: ほぼ運勝負（保険程度に1コマ寄せる） */
export const SLIP_NONE: SlipPolicy = { probability: 0.15, maxCells: 1 };
/** 示唆あり: 軽めに引き込む */
export const SLIP_SHISA: SlipPolicy = { probability: 0.4, maxCells: 2 };
/** クイズ正解: 強めに引き込む（補助レベル+2相当） */
export const SLIP_QUIZ_CORRECT: SlipPolicy = { probability: 0.85, maxCells: 4 };

export interface SlipContext {
  /** 0=左, 1=中, 2=右 */
  reelIndex: number;
  /** 押下時点のセルインデックス（既にスナップ済みの整数） */
  basePosition: number;
  strip: ReelStrip;
  /** 各リールの現在の停止記号（未停止は null） */
  stoppedSymbols: readonly (string | null)[];
  policy: SlipPolicy;
}

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
   * 引き込みコマ数（0..maxCells）を返す。
   * 0 ならスベらない＝押下位置で停止。
   */
  resolve(ctx: SlipContext): number {
    if (ctx.policy.probability <= 0 || ctx.policy.maxCells <= 0) return 0;
    if (Math.random() >= ctx.policy.probability) return 0;

    // 既に停止したリールと矛盾しない役を候補に絞る
    const candidates = this.allYakus.filter((y) =>
      ctx.stoppedSymbols.every(
        (s, r) => s === null || y.symbols[r] === s,
      ),
    );
    if (candidates.length === 0) return 0;

    const total = ctx.strip.cells.length;
    for (let offset = 1; offset <= ctx.policy.maxCells; offset++) {
      const idx = (((ctx.basePosition + offset) % total) + total) % total;
      const symbol = ctx.strip.cells[idx];
      if (candidates.some((y) => y.symbols[ctx.reelIndex] === symbol)) {
        return offset;
      }
    }
    return 0;
  }
}
