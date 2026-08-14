import type { ReelStrip, Yaku, YakuList } from '../data/schemas';
import {
  SlipResolver,
  type SlipContext,
  type VisibleColumn,
} from '../productions/SlipResolver';
import { TenpaiDetector, type TenpaiLine } from '../productions/TenpaiDetector';
import { PAYLINES, PRIMARY_PAYLINE, ROW_VERTICAL, primaryRowOf } from './Paylines';
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

/**
 * 引き込み先の優先カテゴリ序列（premium > bonus > core > cherry > single）。
 *
 * 1枚役を単独の最下位に置いているのは、ボーナス中に1枚役が**こぼし先として当選役と
 * 同時に候補へ並ぶ**ため。1枚役の図柄がたまたま近いという理由で本来取れる小役を
 * 取り逃がしたら本末転倒なので、当選役が届く限り必ずそちらを引き込む。
 */
const CAT_RANK: Record<Yaku['category'], number> = {
  premium: 4,
  bonus: 3,
  core: 2,
  cherry: 1,
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

    // ボーナス中は1枚役が「こぼし先」として当選役と一緒に許可リストへ入る（設計: 31章）。
    // その場合、1枚役は**引き込みの対象ではない**。当選役より先に1枚役を引いてしまうと
    // 本来取れる小役を捨てて1枚に落とすことになり、出玉が静かに削れる。
    // 1枚役だけの許可リスト（通常時の1枚役フラグ）は、そのまま引き込み対象にする。
    const hasWinTarget = targets.some((y) => y.category !== 'single');
    const winTargets = hasWinTarget
      ? targets.filter((y) => y.category !== 'single')
      : targets;
    const spillTargets = hasWinTarget
      ? targets.filter((y) => y.category === 'single')
      : [];

    let slip = this.pullIn(winTargets, req, ctx);
    // 当選役が届かない**最終停止**でだけ、1枚役を拾いに行く＝外した結果としての1枚。
    // 途中のリールで拾いに行くと、まだ間に合う当選役の目を自分で潰すことになる。
    if (slip === null && spillTargets.length > 0 && this.isFinalStop(req)) {
      slip = this.pullIn(spillTargets, req, ctx);
    }

    // 引き込めなかった局面だけ、非当選役が揃わない位置へ決定的に蹴る。
    return slip ?? this.slip.resolveKick(ctx);
  }

  /** 他の2リールが停止済み＝このリールで出目が決まる。 */
  private isFinalStop(req: StopRequest): boolean {
    return req.stoppedVisibles.filter((v) => v !== null).length === 2;
  }

  /**
   * 対象役のどれかを引き込むスベリコマ数。**どれも届かなければ null**。
   * 0（＝そのまま止めれば揃う）と「届かない」を区別する必要があるので、0 を返り値に
   * 使わない。以前は両方0で表していたため、届かない時と揃う時が区別できなかった。
   */
  private pullIn(
    targets: readonly Yaku[],
    req: StopRequest,
    ctx: SlipContext,
  ): number | null {
    if (targets.length === 0) return null;
    const ids = targets.map((y) => y.id);

    // 最終リール：テンパイしているライン（斜め含む5ライン）へ引き込む。
    const tp = this.tenpai.detect(req.stoppedVisibles);
    if (tp && tp.missingReelIndex === req.reelIndex) {
      const tabled = this.pickTenpaiSlip(tp.lines, req.reelIndex, ctx, ids);
      if (tabled !== null) return tabled;
    }

    // 第1・第2停止（および最終でテンパイが無い時）：当選役を**主ラインへ**寄せる。
    //
    // 狙い先を1本に固定するのがこの設計の要。制御が「主ラインへ届くか」の
    // 一問一答になり、停止テーブルも役×押下位置の一次元で書ける。
    // 他のラインへ逃がす分岐を持つと、テーブルの中身が「どのラインを選んだか」に
    // 依存して読めなくなる。
    //
    // 引き込みの対象範囲は7コマ→5コマに縮むが、その分は**リール配列側で取り返す**
    // （主ラインへの到達率を目的関数にして焼き直す。実測で0.5→0.95）。
    //
    // 判定は5ラインのままなので、狙わなかったラインで偶然揃った分は払い出される。
    return this.pickLine(targets, req, ctx, (l) => l.id === PRIMARY_PAYLINE.id);
  }

  /** 条件に合うペイラインだけを対象に引き込む。カテゴリ優先→近い順。 */
  private pickLine(
    targets: readonly Yaku[],
    req: StopRequest,
    ctx: SlipContext,
    accept: (line: (typeof PAYLINES)[number]) => boolean,
  ): number | null {
    let best: number | null = null;
    let bestRank = -1;
    for (const y of targets) {
      if (y.symbols[req.reelIndex] === undefined) continue;
      for (const line of PAYLINES) {
        if (!accept(line)) continue;
        const rowOf = new Map(line.cells.map(([row, col]) => [col, row]));
        const row = rowOf.get(req.reelIndex);
        if (row === undefined) continue;
        // 停止済みリールがこのラインでこの役と一致しているか
        const consistent = req.stoppedVisibles.every((v, i) => {
          if (v === null || i === req.reelIndex) return true;
          const sym = y.symbols[i];
          if (sym === undefined) return true; // チェリーの不問リール
          const r = rowOf.get(i);
          return r === undefined || v[ROW_VERTICAL[r]] === sym;
        });
        if (!consistent) continue;
        const hint = this.slip.resolveAssist(
          ctx,
          y.symbols[req.reelIndex],
          ROW_VERTICAL[row],
          this.pullInCells,
        );
        if (hint === null) continue;
        const rank = CAT_RANK[y.category];
        if (rank > bestRank || (rank === bestRank && (best === null || hint < best))) {
          bestRank = rank;
          best = hint;
        }
      }
    }
    return best;
  }

  /**
   * テンパイ成立ライン群から、当選役に合う最良の引き込みコマ数を返す。
   * 優先順位: カテゴリ（premium>bonus>core>cherry>single）→ 引き込みが近い → 中段ライン。
   * どのラインも届かなければ null（0＝そのまま揃う、と区別する）。
   */
  private pickTenpaiSlip(
    lines: readonly TenpaiLine[],
    finalIdx: number,
    ctx: SlipContext,
    flagYakuIds: readonly string[],
  ): number | null {
    let bestSlip: number | null = null;
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
        (l.vertical === primaryRowOf(finalIdx) ? 1 : 0);
      if (score > bestScore) {
        bestScore = score;
        bestSlip = slip;
      }
    }
    return bestSlip;
  }
}
