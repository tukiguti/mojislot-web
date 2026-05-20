import type { ReelStrip, Yaku, YakuList } from '../data/schemas';

/**
 * 滑り（引き込み）解決ロジック。
 *
 * 3つのモードを持つ：
 *  - noise:  通常時。押下位置で役が成立しそうなら、その役を「蹴る」方向に滑らせる。
 *            → 通常時は当たりにくくする（無限稼ぎ防止）。
 *  - none:   示唆時。滑らない＝完全にプレイヤーのビタ押し勝負。
 *  - assist: クイズ正解時。target 役の該当文字（左/中/右の自リール分）を
 *            押下位置±N コマで探して寄せる（猶予拡大）。
 *            正解した役のみが対象なので、適当にビタを外しても他の役にはならない。
 */

export type SlipMode = 'noise' | 'none' | 'assist';

export interface SlipPolicy {
  mode: SlipMode;
  /** noise/assist の発動確率 (0..1) */
  probability: number;
  /** 押下位置からの最大探索コマ数 */
  maxCells: number;
}

/** 通常時：押下位置で揃いそうなら蹴る（当たりにくい） */
export const SLIP_NONE: SlipPolicy = {
  mode: 'noise',
  probability: 0.5,
  maxCells: 2,
};

/** 示唆時：滑らない＝ビタ押し勝負 */
export const SLIP_SHISA: SlipPolicy = {
  mode: 'none',
  probability: 0,
  maxCells: 0,
};

/** クイズ正解時：target 役の該当文字を ±N コマで寄せる */
export const SLIP_QUIZ_CORRECT: SlipPolicy = {
  mode: 'assist',
  probability: 1,
  maxCells: 3,
};

export interface SlipContext {
  /** 0=左, 1=中, 2=右 */
  reelIndex: number;
  /** 押下時点のセルインデックス（既にスナップ済みの整数） */
  basePosition: number;
  strip: ReelStrip;
  /** 各リールの現在の停止記号（未停止は null） */
  stoppedSymbols: readonly (string | null)[];
  policy: SlipPolicy;
  /**
   * assist モード時、引き込みターゲットの役ID。
   * クイズ正解時にその役のIDを渡す。
   */
  targetYakuId?: string | null;
}

export class SlipResolver {
  private readonly allYakus: Yaku[];
  private readonly yakuById: Map<string, Yaku>;

  constructor(yakuList: YakuList) {
    this.allYakus = [
      ...yakuList.coreYaku,
      ...yakuList.premiumYaku,
      ...yakuList.bonusYaku,
    ];
    this.yakuById = new Map(this.allYakus.map((y) => [y.id, y]));
  }

  /**
   * 引き込みコマ数（0..maxCells）を返す。0 ならスベらず押下位置で停止。
   */
  resolve(ctx: SlipContext): number {
    switch (ctx.policy.mode) {
      case 'none':
        return 0;
      case 'assist':
        return this.resolveAssist(ctx);
      case 'noise':
        return this.resolveNoise(ctx);
    }
  }

  /**
   * assist: クイズ正解時。target 役の該当文字（自リールが受け持つ1文字）を
   * 押下位置±N コマで探して、最も近い位置に寄せる。
   * 押下位置がすでに該当文字なら 0（そのまま止まる）。
   */
  private resolveAssist(ctx: SlipContext): number {
    if (!ctx.targetYakuId) return 0;
    const target = this.yakuById.get(ctx.targetYakuId);
    if (!target) return 0;
    const targetSymbol = target.symbols[ctx.reelIndex];

    // 押下位置がもう該当文字ならそのまま
    if (ctx.strip.cells[ctx.basePosition] === targetSymbol) return 0;

    const total = ctx.strip.cells.length;
    for (let offset = 1; offset <= ctx.policy.maxCells; offset++) {
      const idx = (((ctx.basePosition + offset) % total) + total) % total;
      if (ctx.strip.cells[idx] === targetSymbol) return offset;
    }
    return 0;
  }

  /**
   * noise: 通常時。押下位置で停めると役が成立する見込みなら、
   * 確率 P で「役が成立しない位置」に1〜maxCells コマ滑らせる。
   */
  private resolveNoise(ctx: SlipContext): number {
    if (Math.random() >= ctx.policy.probability) return 0;

    // 押下位置で停めても役成立しない場合は何もしない（普通にハズレに止まる）
    if (
      !this.wouldComplete(
        ctx.reelIndex,
        ctx.basePosition,
        ctx.strip,
        ctx.stoppedSymbols,
      )
    ) {
      return 0;
    }

    // 順方向に「役成立しない位置」を探す（蹴る）
    const total = ctx.strip.cells.length;
    for (let offset = 1; offset <= ctx.policy.maxCells; offset++) {
      const idx = (((ctx.basePosition + offset) % total) + total) % total;
      if (
        !this.wouldComplete(ctx.reelIndex, idx, ctx.strip, ctx.stoppedSymbols)
      ) {
        return offset;
      }
    }
    // 全ての候補位置で役成立してしまうなら、諦めて押下位置のまま
    return 0;
  }

  /**
   * このリールの position に停止した場合、停止済みリールと合わせて
   * 役が成立する見込みがあるか（未停止リールは「何でも入りうる」と仮定）。
   */
  private wouldComplete(
    reelIndex: number,
    position: number,
    strip: ReelStrip,
    stoppedSymbols: readonly (string | null)[],
  ): boolean {
    const symbol = strip.cells[position];
    const final = stoppedSymbols.map((s, r) =>
      r === reelIndex ? symbol : s,
    );
    return this.allYakus.some((y) =>
      y.symbols.every((sym, i) => final[i] === null || sym === final[i]),
    );
  }
}
