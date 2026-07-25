import type { PaylineHit } from './YakuJudge';

/**
 * 物理的に表示された役のうち、レバーONで決まった内部役と一致するラインだけを成立させる。
 * flagYakuIds は「この停止時点でまだ狙える当選役のID群」。
 * - 通常役: そのIDだけの単数配列
 * - 1枚役フラグ／押し順ミスのこぼし: singleYaku グループ全ID（どれが揃ってもよい）
 * - miss: 空配列＝払い出しなし
 */
export function resolveInternalRoleHits(
  flagYakuIds: readonly string[],
  displayedHits: readonly PaylineHit[],
): PaylineHit[] {
  if (flagYakuIds.length === 0) return [];
  const ids = new Set(flagYakuIds);
  return displayedHits.filter((hit) => ids.has(hit.yaku.id));
}
