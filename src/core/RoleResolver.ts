import type { PaylineHit } from './YakuJudge';
import type { RoundContext } from './RoundContext';

/**
 * 物理的に表示された役のうち、レバーONで決まった内部役と一致するラインだけを成立させる。
 * 内部役がmiss、または目押しで対象役を表示できなければ払い出しは0になる。
 */
export function resolveInternalRoleHits(
  round: RoundContext | null,
  displayedHits: readonly PaylineHit[],
): PaylineHit[] {
  const yakuId = round?.internalRole.yakuId;
  if (!yakuId) return [];
  return displayedHits.filter((hit) => hit.yaku.id === yakuId);
}
