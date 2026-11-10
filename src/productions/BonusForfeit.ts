import type { EffectType } from './EffectScheduler';

/**
 * 通常時にボーナスのフラグを取りこぼした時、権利を持ち越すか消すかの判定。
 *
 * 〔2026-11-10〕**何を狙えばよいかを演出が1役に絞って教えたのに取りこぼしたら、持ち越さない。**
 * 教わったうえで外したのは腕の問題なので、権利ごと消える。
 *
 * 持ち越すのは、狙う役が1つに決まらなかったゲームだけ。
 * - 無演出（何も教えていない）
 * - 示唆で候補が複数並び、発展しなかった（BIG1・BIG2・REG のどれか分からず、狙っても揃わないことがある）
 * - 演出が別の役を指していた（矛盾・チャンス目のあとの外れの狙え）。言われたとおりに押しても揃わない
 *
 * ボーナス中・確定ランプ中は呼ばない（それぞれ別の扱い）。
 */
export interface BonusMissContext {
  /** そのゲームの演出。 */
  effect: EffectType;
  /** 演出が指していた役（矛盾なら小役）。無演出なら null。 */
  shownYakuId: string | null;
  /** 取りこぼしたボーナスの役。 */
  flaggedYakuId: string;
  /** 示唆が「狙え！」へ発展したか。 */
  shisaEscalated: boolean;
  /** 示唆の吹き出しに並んだ候補の数。 */
  shisaCandidateCount: number;
}

/** true なら権利を消す（持ち越さない）。 */
export function forfeitsMissedBonus(ctx: BonusMissContext): boolean {
  if (ctx.effect === 'none') return false;
  // 演出が別の役を指していた＝言われたとおりに押しても揃わない
  if (ctx.shownYakuId !== ctx.flaggedYakuId) return false;
  if (ctx.effect === 'aim' || ctx.effect === 'quiz') return true;
  if (ctx.effect === 'shisa') return ctx.shisaEscalated || ctx.shisaCandidateCount === 1;
  return false;
}
