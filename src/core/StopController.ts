import type { ReelStrip, Yaku, YakuList } from '../data/schemas';
import {
  SlipResolver,
  type SlipContext,
  type VisibleColumn,
} from '../productions/SlipResolver';
import { TenpaiDetector, type TenpaiLine } from '../productions/TenpaiDetector';
import { PAYLINES, ROW_VERTICAL, visibleAt, yakuOnLine, type Vertical } from './Paylines';
import type { StopTableLookup } from './StopTable';
import { PullInGuard } from './PullInGuard';

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
 *  3. 第2・第3停止も停止テーブルを引く（全押し順）。表が無ければ
 *     **引き込み保証**（`PullInGuard`：残りを狙って押せば必ず揃う滑り）で選ぶ。
 *     表はこの探索を通して焼いてあるので、引いても探索しても同じ値になる
 *  4. 保証で選べなければ当選役を引き込む（最終リールは5ラインのテンパイ）
 *  5. 引き込めなければ、非当選役が揃わない位置へ決定的に蹴る
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
  // 目印揃い。目印揃いの内部役では当選役がこれだけなので、序列は他と競わない
  chance: 2,
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
   * 各リールの**停止位置**（未停止は null）。第2停止の表を引くのに要る。
   * 渡さなければ表を使わず既定制御へ落ちる（結果は同じで、速度と追跡可能性だけ落ちる）。
   */
  stoppedPositions?: readonly (number | null)[];
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
  /**
   * ビタチャンス中の目印の図柄（2026-10-02）。**押した瞬間に中段がこの図柄なら滑らせない**。
   * それ以外の押し方は普段どおりの制御。目印は滑りで寄ってこないので、
   * 3つ揃えるには3リールともぴったり押すしかない。
   */
  bitaMark?: string | null;
  /**
   * ビタチャンスで**ぴったり押しても目印を滑らせる**（2026-10-12・矛盾 5.3）。
   * ボーナスの再当選がある回だけ立てる。正しく押したのに滑った＝上乗せの合図。
   */
  bitaRefuse?: boolean;
}

export interface StopControllerDeps {
  yakuList: YakuList;
  slipResolver: SlipResolver;
  tenpaiDetector: TenpaiDetector;
  stopTable?: StopTableLookup | null;
  /** 引き込み窓（コマ）。実機準拠の4。 */
  pullInCells: number;
  /**
   * 3リールの配列。引き込み保証（`PullInGuard`）が残りのリールまで見て滑りを選ぶのに使う。
   * 停止要求には自分のリールしか載らないので、ここで全リールを持たせる。
   */
  reels: readonly (readonly string[])[];
}

export class StopController {
  private readonly allYakus: Yaku[];
  private readonly slip: SlipResolver;
  private readonly tenpai: TenpaiDetector;
  private readonly stopTable: StopTableLookup | null;
  private readonly pullInCells: number;
  private readonly guard: PullInGuard;
  /** 目印揃いの役ID（ビタの判定で出てよい役に数える）。 */
  private readonly chanceIds: string[];
  /** ボーナスを持つ内部役ID（BIG・REG と、ボーナスを `carry` に持つチャンス目）。リーチ目を出す。 */
  private readonly bonusRoleIds: Set<string>;
  /** ボーナスの役ID。許可リストにこれがあればボーナスのフラグがある。 */
  private readonly bonusYakuIds: Set<string>;

  constructor(deps: StopControllerDeps) {
    this.allYakus = [
      ...deps.yakuList.coreYaku,
      ...deps.yakuList.premiumYaku,
      ...deps.yakuList.bonusYaku,
      ...deps.yakuList.cherryYaku,
      ...deps.yakuList.singleYaku,
      ...deps.yakuList.chanceYaku,
    ];
    this.slip = deps.slipResolver;
    this.tenpai = deps.tenpaiDetector;
    this.stopTable = deps.stopTable ?? null;
    this.pullInCells = deps.pullInCells;
    this.guard = new PullInGuard(deps.yakuList, deps.reels, deps.pullInCells);
    this.chanceIds = deps.yakuList.chanceYaku.map((y) => y.id);
    this.bonusRoleIds = new Set(
      deps.yakuList.internalRoles
        .filter((r) => r.kind === 'big' || r.kind === 'reg' || r.carry)
        .map((r) => r.id),
    );
    this.bonusYakuIds = new Set(
      [...deps.yakuList.premiumYaku, ...deps.yakuList.bonusYaku].map((y) => y.id),
    );
  }

  /** このリールのスベリコマ数（0..4）。 */
  resolveSlip(req: StopRequest): number {
    // フリーズ中は制御しない（強制セット位置へそのまま止める）。
    if (req.freeze) return 0;
    // ビタチャンスで目印をぴったり押した時は、ビタの判定をそのまま返す（リーチ目の寄せをかけない）
    if (req.bitaMark && req.strip.cells[req.basePosition] === req.bitaMark) {
      return this.bitaSlip(req);
    }
    return this.reachEye(req, this.baseSlip(req));
  }

  private bitaSlip(req: StopRequest): number {
    // ビタの拒否（矛盾 5.3）：ぴったり押されても滑らせる。普段の制御が0を選ぶなら、
    // 許可外の役が揃わない一番近い滑りへずらす
    if (req.bitaMark && req.bitaRefuse && req.strip.cells[req.basePosition] === req.bitaMark) {
      const base = this.baseSlip({ ...req, bitaMark: null });
      if (base > 0) return base;
      const ctx = this.ctxOf(req);
      const n = req.strip.cells.length;
      for (let s = 1; s <= this.pullInCells; s++) {
        if (!this.slip.locksNonFlagAt(ctx, (req.basePosition + s) % n)) return s;
      }
      return base;
    }
    return this.baseSlip(req);
  }

  private ctxOf(req: StopRequest): SlipContext {
    return {
      reelIndex: req.reelIndex,
      basePosition: req.basePosition,
      strip: req.strip,
      stoppedVisibles: req.stoppedVisibles,
      exceptYakuIds: req.flagYakuIds,
    };
  }

  /** 普段の制御（ビタの拒否をかける前）。 */
  private baseSlip(req: StopRequest): number {

    const ctx: SlipContext = {
      reelIndex: req.reelIndex,
      basePosition: req.basePosition,
      strip: req.strip,
      stoppedVisibles: req.stoppedVisibles,
      exceptYakuIds: req.flagYakuIds,
    };

    // ビタチャンス：目印をぴったり押したら、当選役の引き込みより優先してそのまま止める。
    // 小役を取りに行くか目印を狙うかは打ち手が選ぶ（両方は取れないことがある）。
    // ただし**出目＝フラグは崩さない**——止めると許可外の役が揃う位置なら普段の制御に戻す。
    if (
      req.bitaMark &&
      req.strip.cells[req.basePosition] === req.bitaMark &&
      // 目印揃い（リーチ目・チャンス目）は出てよい役に数える。ビタは目印を揃える場面そのもの
      // なので、これを許さないと3つ目を止めた時に必ず拒まれる（2026-10-13 に実測で成功0%）。
      // 払い出しはフラグで決まる（RoundResolver）ので、ここで許しても配当は増えない
      !this.slip.locksNonFlagAt(
        { ...ctx, exceptYakuIds: [...(ctx.exceptYakuIds ?? []), ...this.chanceIds] },
        req.basePosition,
      )
    ) {
      return 0;
    }

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

    // 第2・第3停止も表を引く（**全押し順**）。表は下の探索をそのまま通して焼いてあるので、
    // 引いても探索しても同じ値になる（tests/data/stop-table-equivalence が突き合わせる）。
    // 停止位置を渡されていない／表が無い、のどちらかなら探索へ落ちる。
    //
    // **ボーナス中のこぼし局面（当選役＋1枚役）は別の表を引く**。ボーナス中だけ
    // 許可リストに1枚役が加わり、当選役を引き込めなかった最終停止で拾いに行くため、
    // 通常時の表をそのまま使うと受け皿が消える（実測で「→1枚」8.6%→0.0%・機械割-2pt）。
    const isBonusSpill = hasWinTarget && spillTargets.length > 0;
    if (req.flagKey && req.stoppedPositions && req.stoppedVisibles[req.reelIndex] === null) {
      const done = [0, 1, 2].filter(
        (i) => i !== req.reelIndex && req.stoppedVisibles[i] !== null,
      );
      const firstPos = done.length === 1 ? req.stoppedPositions[done[0]] : null;
      const tabled =
        done.length === 1 && typeof firstPos === 'number'
          ? this.stopTable?.secondStopSlip(
              req.flagKey,
              done[0],
              firstPos,
              req.reelIndex,
              req.basePosition,
              isBonusSpill,
            )
          : done.length === 2
            ? this.stopTable?.thirdStopSlip(
                req.flagKey,
                req.reelIndex,
                req.stoppedPositions,
                req.basePosition,
                isBonusSpill,
              )
            : null;
      if (tabled !== null && tabled !== undefined) return tabled;
    }

    // 表が無い第2・第3停止：引き込み保証で選ぶ。表もこの判定で焼くので、
    // **押し順で「狙えば揃う」が変わらない**。
    // 以前はここで素の引き込み（その時点で揃う最小の滑り）に落ちていて、
    // 先に止めた位置しだいで残りが詰み、正しく狙っても揃わない押し方が残った。
    if (!noneStopped && req.stoppedPositions && winTargets.length > 0) {
      const stops = req.stoppedPositions.map((p, i) => (i === req.reelIndex ? null : p));
      // 保証の判定では、ボーナス中のこぼし先（1枚役）を**出てよい役に数えない**。
      // 数えると通常時と別の止め方を選び、同じ押し方でも当選役を取り逃がすことがあった
      // （監査 bonus-spill で6通り）。1枚役は当選役を取れなかった時の受け皿で、
      // 下の最終停止の拾いに任せる。
      const guarded = this.guard.chooseSlip(
        winTargets,
        stops,
        req.reelIndex,
        req.basePosition,
        () => 0,
        winTargets.map((y) => y.id),
      );
      if (guarded !== null) return guarded;
    }

    let slip = this.pullIn(winTargets, req, ctx);
    // 当選役が届かない**最終停止**でだけ、1枚役を拾いに行く＝外した結果としての1枚。
    // 途中のリールで拾いに行くと、まだ間に合う当選役の目を自分で潰すことになる。
    if (slip === null && spillTargets.length > 0 && this.isFinalStop(req)) {
      slip = this.pullIn(spillTargets, req, ctx);
    }

    // 引き込めなかった局面だけ、非当選役が揃わない位置へ決定的に蹴る。
    return slip ?? this.slip.resolveKick(ctx);
  }

  /**
   * **リーチ目**（2026-10-13）：小役がテンパイしたのに、最後のリールでその図柄が
   * 1段ずれて止まり揃わない形。**ボーナスのフラグがある時だけ**出す。
   *
   * ずれる段は、テンパイしたラインで最後のリールが要る段が中段なら下段、
   * それ以外（斜め・上段・下段のライン）なら中段。どちらも枠の中に見える。
   * 斜めで揃うと思ったら中段に止まった、という見え方になる。
   *
   * ボーナスのフラグが無い時は、同じ形を出さない（ずれる段にその図柄を止めない）。
   * 出れば必ずボーナス、を崩さないため。
   *
   * 何かが揃う止め方（当選役の引き込み・こぼしの1枚役）は変えない。
   * 停止テーブルもこの関数を通して焼くので、表を引いた結果に重ねても同じ値が返る。
   */
  private reachEye(req: StopRequest, slip: number): number {
    if (!this.isFinalStop(req)) return slip;
    const tp = this.tenpai.detect(req.stoppedVisibles);
    if (!tp || tp.missingReelIndex !== req.reelIndex) return slip;
    const lines = tp.lines.filter(
      (l) => l.yaku.category === 'core' && !req.flagYakuIds.includes(l.yaku.id),
    );
    if (lines.length === 0) return slip;

    const ctx = this.ctxOf(req);
    const n = req.strip.cells.length;
    const posOf = (s: number) => (req.basePosition + s) % n;
    const anyWin = (pos: number) =>
      this.slip.locksNonFlagAt({ ...ctx, exceptYakuIds: [] }, pos);
    if (anyWin(posOf(slip))) return slip;

    const shifted = (pos: number) =>
      shownShifted(lines, req.reelIndex, (v) => visibleAt(req.strip.cells, pos, v));
    const bonus = this.hasBonusFlag(req);
    const ok = (pos: number) => (bonus ? shifted(pos) : !shifted(pos));
    if (ok(posOf(slip))) return slip;
    for (let s = 0; s <= this.pullInCells; s++) {
      const pos = posOf(s);
      if (this.slip.locksNonFlagAt(ctx, pos)) continue;
      if (ok(pos)) return s;
    }
    return slip;
  }

  /**
   * 止まった出目がリーチ目の形か（ボーナスの有無は見ない）。最後のリールを止める前の
   * 2リールでテンパイしていた小役（フラグの無いもの）の図柄が、ずれた段に見えているか。
   * 何かが揃ったゲームでは呼び出し側で除く。画面の白いフラッシュと「失敗」の判定に使う。
   */
  isReachShape(
    stoppedBefore: readonly (VisibleColumn | null)[],
    reelIndex: number,
    finalColumn: VisibleColumn,
    flagYakuIds: readonly string[],
  ): boolean {
    const tp = this.tenpai.detect(stoppedBefore);
    if (!tp || tp.missingReelIndex !== reelIndex) return false;
    const lines = tp.lines.filter(
      (l) => l.yaku.category === 'core' && !flagYakuIds.includes(l.yaku.id),
    );
    return shownShifted(lines, reelIndex, (v) => finalColumn[v]);
  }

  private hasBonusFlag(req: StopRequest): boolean {
    if (req.flagKey && this.bonusRoleIds.has(req.flagKey)) return true;
    return req.flagYakuIds.some((id) => this.bonusYakuIds.has(id));
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

    // 第1・第2停止（および最終でテンパイが無い時）：当選役が**5ラインのどれかで
    // 成立する**最小のスベリを選ぶ。狙う「行」は持たない。
    //
    // 実機の制御は「押し位置＋0〜4のどれで止めるか」を選ぶだけで、どのラインに
    // 揃うかは関心事ではない（成立役は最大限引き込む義務があるだけ）。行を指定して
    // 引き込むと、**滑りが前方向にしか効かないため主ラインの行によって取りこぼしが
    // 変わる**という、実機に存在しない非対称が生まれる。
    //
    // 実際、主ラインを 上段/右上がり から 下段/中段 へ移すだけで機械割が28pt動いた。
    // 下段は「その先の行」が無く押し遅れを一切救済できないためで、配列を焼き直しても
    // 直らなかった（主ライン上の到達性を同一にしても戻らない）。
    //
    // 主ラインは**告知の基準**としては残る（リーチ目・誤告知の判定）。制御は使わない。
    return this.pickLine(targets, req, ctx, () => true);
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
        if (!accept(line) || !yakuOnLine(y, line.id)) continue;
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
      // カテゴリ → スベリが近い順。**主ラインの優先は持たない**（行で優劣を付けると
      // 実機に無い非対称が戻る）。
      const score = CAT_RANK[l.yaku.category] * 100 + (this.pullInCells - slip) * 4;
      if (score > bestScore) {
        bestScore = score;
        bestSlip = slip;
      }
    }
    return bestSlip;
  }
}

/**
 * リーチ目で図柄をずらす段。テンパイのラインが要る段が中段なら下段（1コマ滑りすぎた形）、
 * それ以外は中段。中段のテンパイで上段も数えると、右リールのように小役の図柄が3コマおきに
 * 並ぶ配列ではボーナスが無い時に隠しきれない（どの滑りでも上か下に見える）。
 */
function reachRows(lineRow: Vertical): readonly Vertical[] {
  return lineRow === 'middle' ? ['bottom'] : ['middle'];
}

/** テンパイしていた小役の図柄が、どれか1本でもずれた段に見えているか。 */
function shownShifted(
  lines: readonly TenpaiLine[],
  reelIndex: number,
  cellAt: (v: Vertical) => string,
): boolean {
  return lines.some((l) =>
    reachRows(l.vertical).some((v) => cellAt(v) === l.yaku.symbols[reelIndex]),
  );
}
