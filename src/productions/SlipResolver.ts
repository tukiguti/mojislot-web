import type { ReelStrip, Yaku, YakuList } from '../data/schemas';
import {
  PAYLINES,
  extractPartialLineSymbols,
  visibleAt,
  type PartialGrid3x3,
  type Vertical,
} from '../core/Paylines';

/**
 * 滑り（蹴り）と引き込みの解決。実機のリール制御（テーブル制御）に相当する。
 *
 * - **resolveKick**: 実機の「フラグの無い役は絶対に揃わない位置へ蹴る」制御。
 *   当選役グループ（内部役＝`exceptYakuIds`）**以外の全役**が偶然揃いそうな時、順方向に
 *   最大 KICK_MAX_CELLS コマ（実機準拠＝4）で「揃わない位置」へ**決定的に**蹴る。
 *   確率抽選は無い。これにより出目は常に内部役と一致する（＝「揃っているのに0枚」を
 *   構造的に消す）。
 * - **resolveAssist**: 演出時の引き込み。狙い役の図柄が指定行に来るよう順方向に引き込む
 *   （テンパイまでは自力、最後の出目だけ補助）。当選役だけが対象＝技術介入を残す。
 *   引き込み先でも非当選役をロックさせない（蹴りと同じテーブル制御に従う）。
 *
 * フラグが複数IDなのは1枚役グループ（singleYaku のどれが揃ってもよい）のため。
 * 設計詳細: zikken/playground/mojislot-plan/17_assist-and-slip.md ／ 24_internal-role-lottery.md
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
  /** 出目に出てよい役ID群（レバーONで確定した内部役。1枚役はグループ全体）。 */
  exceptYakuIds?: readonly string[];
  /** これらのカテゴリの役は蹴らない（引き込み対象にしている時などに指定）。 */
  exceptCategories?: readonly Yaku['category'][];
}

/** 最終リール引き込みの最大コマ数（実機準拠＝4コマ。「テンパイ＝ほぼ成立」） */
const ASSIST_MAX_CELLS = 4;
/** 蹴りの探索窓（実機準拠＝最大スベリ4コマ）。フラグ無しの役を4コマ以内で回避する。 */
const KICK_MAX_CELLS = 4;

const VERTICALS: readonly Vertical[] = ['top', 'middle', 'bottom'];

/** 補助強度の調整値（data/tuning から渡す。省略時は上記既定）。 */
export interface SlipResolverOptions {
  assistMaxCells?: number;
}

export class SlipResolver {
  /** 全役（premium/bonus/core/cherry/single）。蹴りは内部役以外のこの全役を対象にする。 */
  private readonly allYakus: Yaku[];
  private readonly assistMaxCells: number;

  constructor(yakuList: YakuList, opts: SlipResolverOptions = {}) {
    this.allYakus = [
      ...yakuList.premiumYaku,
      ...yakuList.bonusYaku,
      ...yakuList.coreYaku,
      ...yakuList.cherryYaku,
      ...yakuList.singleYaku,
    ];
    this.assistMaxCells = opts.assistMaxCells ?? ASSIST_MAX_CELLS;
  }

  /**
   * 蹴り（実機のテーブル制御）。当選役グループ以外の役が押下位置で揃うなら、
   * 順方向に最大 KICK_MAX_CELLS コマで「非当選役が1つも揃わない位置」へ決定的に蹴る。
   * - 押下位置で非当選役が揃わない → 0（そのまま止める＝ビタ押しを壊さない）
   * - 当選役が押下位置で自力成立している → それを壊さない位置を優先して蹴る
   * - 窓内にクリーン位置が無い（リール配列の不足）→ 0（蹴らず止める。監査で検出する）
   */
  resolveKick(ctx: SlipContext): number {
    const exceptIds = new Set(ctx.exceptYakuIds ?? []);
    const exemptCats = ctx.exceptCategories
      ? new Set(ctx.exceptCategories)
      : null;
    const flagged = this.allYakus.filter((y) => exceptIds.has(y.id));
    const nonFlagged = this.allYakus.filter(
      (y) => !exceptIds.has(y.id) && !exemptCats?.has(y.category),
    );
    if (nonFlagged.length === 0) return 0;

    // 押下位置で非当選役が1つも揃わないなら蹴る必要はない。
    if (!this.anyCompletes(ctx.basePosition, ctx, nonFlagged)) return 0;

    // 当選役が押下位置で自力成立しているか（自力ビタ成功）。壊さないよう優先する。
    const flagAtBase =
      flagged.length > 0 && this.anyCompletes(ctx.basePosition, ctx, flagged);
    const total = ctx.strip.cells.length;

    // pass0: 当選役の成立を保ったままクリーンにできる位置を探す。
    // pass1: 見つからなければ当選役保護を諦めてクリーン位置を探す（稀なフォールバック）。
    for (let pass = 0; pass < (flagAtBase ? 2 : 1); pass++) {
      const keepFlag = flagAtBase && pass === 0;
      for (let offset = 1; offset <= KICK_MAX_CELLS; offset++) {
        const pos = (((ctx.basePosition + offset) % total) + total) % total;
        if (this.anyCompletes(pos, ctx, nonFlagged)) continue;
        if (keepFlag && !this.anyCompletes(pos, ctx, flagged)) continue;
        return offset;
      }
    }
    // 窓内に「非当選役が揃わない位置」が無い＝リール配列がこの局面をカバーできていない。
    // 蹴らず押下位置で止める（払い出しレイヤで内部役フィルタが効くので過払いにはならない）。
    return 0;
  }

  /**
   * 演出時の引き込み（5ライン対応）。指定の可視位置 vertical（上/中/下）のセルが
   * targetSymbol になる最小の順方向コマ数（0..maxCells）を返す。窓内に無ければ null
   * （プレイヤーのミス＝補助なし）。斜めラインは vertical で行を指定する。
   *
   * 引き込みも蹴りと同じテーブル制御に従う：**当選役グループ以外の役がロックしてしまう
   * 位置へは引き込まない**（tests/audit/assist-guarantee.test.ts で全数監査）。
   * クリーンな引き込み位置が窓内に無ければ null＝引き込まず、呼び出し側の蹴りに任せる。
   */
  resolveAssist(
    ctx: SlipContext,
    targetSymbol: string,
    vertical: Vertical,
    maxCells?: number,
  ): number | null {
    const max = maxCells ?? this.assistMaxCells;
    const exceptIds = new Set(ctx.exceptYakuIds ?? []);
    const nonFlagged = this.allYakus.filter((y) => !exceptIds.has(y.id));
    const total = ctx.strip.cells.length;
    for (let offset = 0; offset <= max; offset++) {
      const pos = (((ctx.basePosition + offset) % total) + total) % total;
      if (visibleAt(ctx.strip.cells, pos, vertical) !== targetSymbol) continue;
      if (this.anyCompletes(pos, ctx, nonFlagged)) continue;
      return offset;
    }
    return null;
  }

  /**
   * このリールが position に停止したとして、5ペイラインのいずれかで
   * yakus のいずれかが**確定（ロック）**するかを判定＝蹴りが避けるべき成立。
   * 未停止リール（null）は**不成立扱い**（ワイルドカードにしない）。これにより、
   * まだ揃っていない役（リーチ目・第1/2停止の途中経過）を過剰に蹴らず、
   * その停止で実際に役が揃ってしまう局面だけを避ける。判定は YakuJudge.judgeAll と一致
   * （3文字役＝左中右の一致／チェリー＝左+中の一致で右は不問）。
   */
  private anyCompletes(
    position: number,
    ctx: SlipContext,
    yakus: readonly Yaku[],
  ): boolean {
    const grid = this.buildPartialGrid(position, ctx);
    return PAYLINES.some((line) => {
      const [a, b, c] = extractPartialLineSymbols(grid, line);
      return yakus.some((y) => this.matchesLine(y, a, b, c));
    });
  }

  /** 1ラインの3セル（null=未停止＝不成立）が yaku に完全一致（＝ロック）するか。 */
  private matchesLine(
    yaku: Yaku,
    a: string | null,
    b: string | null,
    c: string | null,
  ): boolean {
    const s = yaku.symbols;
    // チェリー（2文字役）＝左+中の一致で成立（右は不問）。両リールが停止済みの時だけ確定。
    if (s.length === 2) return a === s[0] && b === s[1];
    return a === s[0] && b === s[1] && c === s[2];
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
