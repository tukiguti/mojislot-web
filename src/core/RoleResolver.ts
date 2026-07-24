import type { PaylineHit } from './YakuJudge';

/**
 * 物理的に表示された役のうち、レバーONで決まった内部役と一致するラインだけを成立させる。
 * flagYakuId は「この停止時点でまだ狙える当選役」＝押し順を外した場合や
 * miss / 1枚役フラグでは null。null なら3文字役の払い出しは無し
 * （1枚役の払い出しは別枠＝PayoutCalc.single）。
 */
export function resolveInternalRoleHits(
  flagYakuId: string | null,
  displayedHits: readonly PaylineHit[],
): PaylineHit[] {
  if (!flagYakuId) return [];
  return displayedHits.filter((hit) => hit.yaku.id === flagYakuId);
}
