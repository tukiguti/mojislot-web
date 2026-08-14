import type { InternalRole, InternalRoleState, YakuList } from '../data/schemas';

/**
 * リミックス島の上乗せ。
 *
 * この島はボーナスを消化しきるたびに**島そのものが入れ替わる**（設計: 32章）。
 * 覚えた配列が毎回無効になるぶん取りこぼしが増えるので、その見返りとして
 * ボーナスを強くする。**ハイリスク・ハイリターンの上級者向け**という位置づけで、
 * 腕がある人ほど得をする形になる。
 *
 * 上げるのは「引く回数」と「1回の長さ」の2つ。小役の枚数は触らない——
 * そこを上げると通常時が楽になり、覚え直しのリスクが薄まってしまう。
 * 恩恵はボーナス区間へ寄せる（31章の設計方針と同じ）。
 */
export const REMIX = {
  /** ボーナス確率の倍率。設定差（0.93〜1.09）より大きく、はっきり分かる幅にする。 */
  bonusRateMultiplier: 1.15,
  /** ボーナスのゲーム数（他島は BIG 18 / REG 8）。 */
  spinsPerBig: 22,
  spinsPerReg: 9,
} as const;

const isBonusRole = (r: InternalRole): boolean =>
  r.kind === 'reg' || r.kind === 'big';

/**
 * ボーナス確率を引き上げた役リストを返す（元は書き換えない）。
 *
 * 増えたぶんは1枚役から引いて合計1を保つ。1枚役は演出が出ず狙って取る役でもないので、
 * ここが薄くなっても「何が変わったか」はプレイヤーに見えない（`applySetting` と同じ考え方）。
 * ボーナス中（state='bonus'）は触らない。引いた後の性能まで変わると、
 * 覚え直しのリスクと釣り合わない強さになる。
 */
export function applyRemixBoost(yakuList: YakuList): YakuList {
  const states: InternalRoleState[] = ['default', 'rescue'];
  const roles: InternalRole[] = yakuList.internalRoles.map((r) => ({
    ...r,
    rate: { ...r.rate },
  }));
  const absorber =
    roles.find((r) => r.kind === 'miss' && r.rate.default > 0) ??
    roles.find((r) => r.kind === 'single');
  if (!absorber) return { ...yakuList, internalRoles: roles };

  for (const state of states) {
    let delta = 0;
    for (const role of roles) {
      if (!isBonusRole(role)) continue;
      const next = role.rate[state] * REMIX.bonusRateMultiplier;
      delta += next - role.rate[state];
      role.rate[state] = next;
    }
    absorber.rate[state] = Math.max(0, absorber.rate[state] - delta);
  }
  return { ...yakuList, internalRoles: roles };
}
