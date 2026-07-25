import type { Grid3x3 } from './Paylines';
import type { PayoutCalc } from './PayoutCalc';
import type { ReachEyes, ReachKind } from './ReachEyes';
import { resolveInternalRoleHits } from './RoleResolver';
import type { PaylineHit, YakuJudge } from './YakuJudge';

/**
 * 全リール停止時の「このゲームで何が起きたか」の確定。
 *
 * 出目（Grid3x3）と内部役から、成立ラインと払い出し枚数を求めるところまでを担う。
 * **表示も音も状態変更も一切しない純粋な計算**で、演出の出し分けは呼び出し側の仕事。
 *
 * 払い出しの合成には、単純な足し算に見えて意図のある規則が3つある：
 *  - **1枚役は倍率に乗せない**（固定1枚）。ボーナス倍率・コンボ倍率を掛けると
 *    「こぼしたのに美味しい」ことになり、連を狙う動機が薄れる
 *  - **1枚役は何ライン揃っても1枚**（1Gあたり最大1枚）
 *  - **予告役の達成ボーナスは通常配当に上乗せ**（置き換えではない）
 *
 * 設計: zikken/playground/mojislot-plan/24_internal-role-lottery.md
 */

export interface RoundInput {
  /** 全停止した3x3の出目。 */
  grid: Grid3x3;
  /** レバーONで確定した内部役のID群（miss は空配列、1枚役はグループ全体）。 */
  flagYakuIds: readonly string[];
  /** この1Gがボーナス中か（BET時に固定した値）。 */
  bonusActive: boolean;
  /** このゲームを含める前の連チャン数。 */
  streakBefore: number;
  /** 予告役（狙え＝予告役／クイズ＝答えの役）。無ければ null。 */
  noticeYakuId: string | null;
}

export interface RoundOutcome {
  /** 成立ライン（1枚役を除く）。連チャン・図鑑・成立演出はこれを見る。 */
  hits: PaylineHit[];
  /** 1枚役の成立ライン。払い出しだけ別枠で扱う「こぼし」。 */
  singleHits: PaylineHit[];
  /** 1枚役を除いて何か揃ったか（＝連チャンが伸びるか）。 */
  willHit: boolean;
  premiumHit: PaylineHit | null;
  bonusHit: PaylineHit | null;
  /** BIGボーナス成立。 */
  isPremium: boolean;
  /** REGボーナス成立（プレミアムが無いときだけ）。 */
  isRegular: boolean;
  /** チェリー成立（重複当選の抽選契機）。 */
  cherryHit: boolean;
  /** リーチ目の種別。何か揃った時は判定しない（null）。 */
  reachKind: ReachKind | null;
  /** このゲームを含めた連チャン数（ハズレなら0）。 */
  streakAfter: number;
  streakMult: number;
  /** 払い出し合計（= base + singleWin + noticeBonus）。 */
  win: number;
  /** 内訳：成立ラインの通常配当。 */
  base: number;
  /** 内訳：1枚役ぶん（倍率非適用の固定枚数）。 */
  singleWin: number;
  /** 内訳：予告役の達成ボーナス（上乗せ分のみ）。 */
  noticeBonus: number;
}

export interface RoundResolverDeps {
  judge: YakuJudge;
  calc: PayoutCalc;
  reachEyes: ReachEyes;
  /** 1枚役の払い出し枚数（payout.baseMultiplier.single）。 */
  singlePayout: number;
}

export class RoundResolver {
  constructor(private readonly deps: RoundResolverDeps) {}

  resolve(input: RoundInput): RoundOutcome {
    const { judge, calc, reachEyes, singlePayout } = this.deps;

    // 物理表示を5ラインで検出し、内部役と一致するラインだけを成立扱いにする。
    const allowedHits = resolveInternalRoleHits(
      input.flagYakuIds,
      judge.judgeAll(input.grid).hits,
    );
    const singleHits = allowedHits.filter((h) => h.yaku.category === 'single');
    const hits = allowedHits.filter((h) => h.yaku.category !== 'single');
    const willHit = hits.length > 0;

    const premiumHit = hits.find((h) => h.yaku.category === 'premium') ?? null;
    const isPremium = premiumHit !== null;
    // レギュラー役（すし＋別字）。プレミアムが無いときだけ REG 扱い。
    const bonusHit = hits.find((h) => h.yaku.category === 'bonus') ?? null;
    const isRegular = !isPremium && bonusHit !== null;

    // リーチ目はハズレ出目の読み。何か揃っているなら見る必要がない。
    const reachKind = willHit ? null : reachEyes.detect(input.grid);

    // 連チャン倍率は「成立後の数」で評価する＝達成スピンから恩恵が乗る。
    const streakAfter = willHit ? input.streakBefore + 1 : 0;
    const streakMult = calc.streakMult(streakAfter);

    const base = calc.calcMulti(hits, input.bonusActive, streakMult);
    // 1枚役は倍率を掛けず、何ライン揃っても1Gあたり1枚まで。
    const singleWin = singleHits.length > 0 ? singlePayout : 0;
    const noticeBonus = input.noticeYakuId
      ? calc.aimBonus(
          hits.filter((h) => h.yaku.id === input.noticeYakuId),
          input.bonusActive,
          streakMult,
        )
      : 0;

    return {
      hits,
      singleHits,
      willHit,
      premiumHit,
      bonusHit,
      isPremium,
      isRegular,
      cherryHit: hits.some((h) => h.yaku.category === 'cherry'),
      reachKind,
      streakAfter,
      streakMult,
      win: base + singleWin + noticeBonus,
      base,
      singleWin,
      noticeBonus,
    };
  }
}
