import type { InternalRole, InternalRoleState, YakuList } from '../data/schemas';

/**
 * 設定（1〜6）。実機の「ホールが台ごとに決める当たりやすさ」に相当する。
 *
 * このゲームの遊びの中心は**設定を推測すること**にある。プレイヤーは設定を
 * 直接見られない。データカウンター（BIG回数・ハマり）と示唆演出から読むしかない。
 * だから設定は次の性質を満たす必要がある：
 *
 *  - **打っている間は変わらない**。途中で変わったら推測が成立しない
 *  - **台ごとに違う**。全台同じなら選ぶ意味がない
 *  - **いつか変わる**。ずっと同じなら一度当てて終わり
 *
 * 実機のホールに合わせて**日替わり**にした。日付と台IDから決定的に決まるので
 * 保存は要らず、リロードしても同じ台なら同じ設定になる（推測が壊れない）。
 * 「今日はこの台が良さそう」という日単位の遊びになる。
 */

export const SETTINGS = [1, 2, 3, 4, 5, 6] as const;
export type Setting = (typeof SETTINGS)[number];

/**
 * 設定ごとのボーナス当選率の倍率。
 * 実機の設定差と同じく**小役では差を付けず、ボーナス確率だけ**を動かす。
 * 小役で差を付けると数百ゲームで見抜けてしまい、推測の遊びが成立しない。
 */
const BONUS_RATE_MULTIPLIER: Record<Setting, number> = {
  1: 0.82,
  2: 0.89,
  3: 0.96,
  4: 1.04,
  5: 1.13,
  6: 1.24,
};

/** 設定ごとの出現ウェイト。実機のホールと同じで高設定ほど少ない。 */
const SETTING_WEIGHT: Record<Setting, number> = {
  1: 30,
  2: 24,
  3: 18,
  4: 14,
  5: 9,
  6: 5,
};

/** 文字列から決定的な32bit値を作る（同じ入力なら常に同じ結果）。 */
function hash32(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** その日の日付キー（ローカル時刻の YYYY-MM-DD）。 */
export function dayKey(now: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/**
 * その日その台の設定。日付と台IDから決定的に決まる。
 * 高設定ほど出にくいよう重み付き抽選する（実機のホールと同じ肌感）。
 */
export function settingFor(chapterId: string, now: Date): Setting {
  const total = SETTINGS.reduce((a, s) => a + SETTING_WEIGHT[s], 0);
  let r = (hash32(`${dayKey(now)}/${chapterId}`) % total) + 1;
  for (const s of SETTINGS) {
    r -= SETTING_WEIGHT[s];
    if (r <= 0) return s;
  }
  return 1;
}

/** ボーナス（REG/BIG）の内部役か。設定差はここにだけ乗せる。 */
const isBonusRole = (role: InternalRole): boolean =>
  role.kind === 'reg' || role.kind === 'big';

/**
 * 設定を適用した役リストを返す（元は書き換えない）。
 *
 * ボーナス役のレートに倍率を掛け、増減したぶんを **miss** で吸収して
 * 合計を1に保つ。小役のレートは動かさない＝小役の出方から設定は読めない。
 * ボーナス中（state='bonus'）は設定差を付けない。ボーナス性能まで変わると
 * 「引いた後」に差が出てしまい、推測ではなく結果論になるため。
 */
export function applySetting(yakuList: YakuList, setting: Setting): YakuList {
  const mult = BONUS_RATE_MULTIPLIER[setting];
  const states: InternalRoleState[] = ['default', 'rescue'];
  const roles: InternalRole[] = yakuList.internalRoles.map((r) => ({
    ...r,
    rate: { ...r.rate },
  }));
  const miss = roles.find((r) => r.kind === 'miss');
  if (!miss) return { ...yakuList, internalRoles: roles };

  for (const state of states) {
    let delta = 0;
    for (const role of roles) {
      if (!isBonusRole(role)) continue;
      const next = role.rate[state] * mult;
      delta += next - role.rate[state];
      role.rate[state] = next;
    }
    // ハズレで吸収する。吸収しきれない（miss が足りない）ことは実データでは起きないが、
    // 万一のときは0で止めて合計1を優先する（抽選が壊れるより穏当）。
    miss.rate[state] = Math.max(0, miss.rate[state] - delta);
  }
  return { ...yakuList, internalRoles: roles };
}
