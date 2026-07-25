import type { ReelStrip, Yaku, YakuList } from '../data/schemas';
import {
  SlipResolver,
  type SlipContext,
  type VisibleColumn,
} from '../productions/SlipResolver';
import { TenpaiDetector, type TenpaiLine } from '../productions/TenpaiDetector';
import type { StopTableLookup } from './StopTable';

/**
 * 停止制御（実機のリール制御）。1リール停止時のスベリコマ数を決める**唯一の実装**。
 *
 * ゲーム本体・監査テスト・出玉シミュレーターがすべてこのクラスを使う。
 * 以前は3〜4箇所に同じロジックを書き写しており、シミュレーターだけ引き込みが
 * 欠けている・告知ランプが未実装といった取りこぼしが実際に起きたため統合した。
 *
 * 決定の順序（設計: zikken/playground/mojislot-plan/17_assist-and-slip.md）:
 *  1. フリーズ中 → 制御を一切かけない（強制セット位置へスナップ）
 *  2. 第1停止（他リール未停止）→ **停止テーブル**を引く。この時点ではどの役も
 *     ロックし得ないので蹴りが効かず、出目（リーチ目・入り目）の設計点になる
 *  3. 当選役があれば引き込む（最終リールは5ラインのテンパイ／それ以外は中段）
 *  4. 引き込めなければ、非当選役が揃わない位置へ決定的に蹴る
 *
 * 引き込み窓は**内部役だけで決まり演出では変わらない**（実機準拠）。
 * 難易度はリール配列（図柄の間隔）が担う。
 */

/** 引き込み先の優先カテゴリ序列（premium > bonus > core > cherry/single）。 */
const CAT_RANK: Record<Yaku['category'], number> = {
  premium: 3,
  bonus: 2,
  core: 1,
  cherry: 0,
  single: 0,
};

export interface StopRequest {
  /** 0=左 / 1=中 / 2=右 */
  reelIndex: number;
  /** 押下時点のセルインデックス（スナップ済みの整数） */
  basePosition: number;
  strip: ReelStrip;
  /** 各リールの停止3セル（未停止は null） */
  stoppedVisibles: readonly (VisibleColumn | null)[];
  /**
   * 出目に出してよい役ID群。
   * miss は空配列、1枚役はグループ全体、通常は当選役1件。
   */
  flagYakuIds: readonly string[];
  /**
   * 停止テーブルを引くキー（内部役ID）。null ならテーブルを使わず既定制御へ。
   * 確定告知ランプ点灯中は、その確定役に対応する内部役IDを渡す。
   */
  flagKey?: string | null;
  /** フリーズ演出中（制御を無効化して押下位置へスナップ）。 */
  freeze?: boolean;
}

export interface StopControllerDeps {
  yakuList: YakuList;
  slipResolver: SlipResolver;
  tenpaiDetector: TenpaiDetector;
  stopTable?: StopTableLookup | null;
  /** 引き込み窓（コマ）。実機準拠の4。 */
  pullInCells: number;
}

export class StopController {
  private readonly allYakus: Yaku[];
  private readonly slip: SlipResolver;
  private readonly tenpai: TenpaiDetector;
  private readonly stopTable: StopTableLookup | null;
  private readonly pullInCells: number;

  constructor(deps: StopControllerDeps) {
    this.allYakus = [
      ...deps.yakuList.coreYaku,
      ...deps.yakuList.premiumYaku,
      ...deps.yakuList.bonusYaku,
      ...deps.yakuList.cherryYaku,
      ...deps.yakuList.singleYaku,
    ];
    this.slip = deps.slipResolver;
    this.tenpai = deps.tenpaiDetector;
    this.stopTable = deps.stopTable ?? null;
    this.pullInCells = deps.pullInCells;
  }

  /** このリールのスベリコマ数（0..4）。 */
  resolveSlip(req: StopRequest): number {
    // フリーズ中は制御しない（強制セット位置へそのまま止める）。
    if (req.freeze) return 0;

    const ctx: SlipContext = {
      reelIndex: req.reelIndex,
      basePosition: req.basePosition,
      strip: req.strip,
      stoppedVisibles: req.stoppedVisibles,
      exceptYakuIds: req.flagYakuIds,
    };

    // 第1停止は停止テーブルを引く（まだどの役もロックし得ない＝出目の設計点）。
    const noneStopped = req.stoppedVisibles.every((v) => v === null);
    if (noneStopped && req.flagKey) {
      const tabled = this.stopTable?.firstStopSlip(
        req.flagKey,
        req.reelIndex,
        req.basePosition,
      );
      if (tabled !== null && tabled !== undefined) return tabled;
    }

    const targets = req.flagYakuIds
      .map((id) => this.allYakus.find((y) => y.id === id))
      .filter((y): y is Yaku => y !== undefined);

    let slipCells = 0;
    if (targets.length > 0) {
      // 最終リール：テンパイしているライン（斜め含む5ライン）へ引き込む。
      const tp = this.tenpai.detect(req.stoppedVisibles);
      if (tp && tp.missingReelIndex === req.reelIndex) {
        slipCells = this.pickTenpaiSlip(tp.lines, req.reelIndex, ctx, req.flagYakuIds);
      }
      if (slipCells === 0) {
        // 第1・第2停止（および最終でテンパイが無い時）：当選役の図柄を中段へ。
        // 1枚役はグループなので、停止済みの中段と矛盾しないものだけを候補にする。
        let best: number | null = null;
        for (const y of targets) {
          const sym = y.symbols[req.reelIndex];
          if (sym === undefined) continue;
          const consistent = req.stoppedVisibles.every(
            (v, i) =>
              v === null ||
              i === req.reelIndex ||
              y.symbols[i] === undefined ||
              v.middle === y.symbols[i],
          );
          if (!consistent) continue;
          const hint = this.slip.resolveAssist(ctx, sym, 'middle', this.pullInCells);
          if (hint !== null && (best === null || hint < best)) best = hint;
        }
        if (best !== null) slipCells = best;
      }
    }

    // 引き込めなかった局面だけ、非当選役が揃わない位置へ決定的に蹴る。
    if (slipCells === 0) slipCells = this.slip.resolveKick(ctx);
    return slipCells;
  }

  /**
   * テンパイ成立ライン群から、当選役に合う最良の引き込みコマ数を返す。
   * 優先順位: カテゴリ（premium>bonus>core>cherry）→ 引き込みが近い → 中段ライン。
   */
  private pickTenpaiSlip(
    lines: readonly TenpaiLine[],
    finalIdx: number,
    ctx: SlipContext,
    flagYakuIds: readonly string[],
  ): number {
    let bestSlip = 0;
    let bestScore = -1;
    for (const l of lines) {
      if (!flagYakuIds.includes(l.yaku.id)) continue;
      const slip = this.slip.resolveAssist(
        ctx,
        l.yaku.symbols[finalIdx],
        l.vertical,
        this.pullInCells,
      );
      if (slip === null) continue;
      const score =
        CAT_RANK[l.yaku.category] * 100 +
        (this.pullInCells - slip) * 4 +
        (l.vertical === 'middle' ? 1 : 0);
      if (score > bestScore) {
        bestScore = score;
        bestSlip = slip;
      }
    }
    return bestSlip;
  }
}
