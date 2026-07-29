import type { InternalRole, InternalRoleState, YakuList } from '../data/schemas';
import type { EffectRates } from './EffectScheduler';

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
 * 設定ごとのボーナス当選率の倍率。**設定差の従**。
 *
 * 小役では差を付けない。小役で差を付けると数百ゲームで見抜けてしまい、
 * 推測の遊びが成立しない。
 *
 * 幅は意図的に狭くしてある（旧 0.82〜1.24 → 0.93〜1.09）。主役は演出率に移した
 * （`NONE_MULTIPLIER`）ので、ここは「長く見れば合成確率にも差が出る」程度に留める。
 * 完全に0にしないのは、データカウンターを設定推測の材料として残すため。
 */
const BONUS_RATE_MULTIPLIER: Record<Setting, number> = {
  1: 0.93,
  2: 0.96,
  3: 0.98,
  4: 1.02,
  5: 1.05,
  6: 1.09,
};

/**
 * 設定ごとの「無演出」の倍率。**設定差の主役**。
 *
 * このゲームの演出は**情報だけ**を持つ。ガセ演出は無く、引き込み窓は演出では
 * 変わらない一律4コマで、狙えでも青示唆でも難易度は同じ。違うのは「何が分かるか」
 * だけ。つまり演出が出たゲームは何を狙えばよいか分かるので取りこぼさない。
 *
 *   無演出が減る → 取りこぼしが減る → 出玉が増える
 *
 * が直接つながる。実測の裏付けもあり、通常時に無演出を入れた時点で神の機械割は
 * 196.2% から170%付近へ落ちた（[31] §3①）。あの効き方がそのまま設定差になる。
 *
 * この形にすると**腕がある人ほど設定差が大きく出る**。「分かれば取れる」人ほど
 * 演出の増減が丸ごと出玉に変わるため。技術介入ゲームとしては、引きの差より
 * この方が噛み合う。
 *
 * ボーナス中（`bonus`）は none が0なので差が出ない。これは意図通りで、
 * 引いた後の性能まで変わると推測ではなく結果論になる。
 */
/*
 * 中心は「1.0倍」ではなく **出現ウェイト込みの加重平均が1.0** になるよう置いてある。
 * 低設定ほど出やすい（30/24/18/14/9/5）ので、単純に1.0を挟むと平均が低設定側へ
 * 寄ってホール全体の水位が下がる。
 */
const NONE_MULTIPLIER: Record<Setting, number> = {
  1: 1.100,
  2: 1.045,
  3: 0.990,
  4: 0.915,
  5: 0.835,
  6: 0.760,
};

/**
 * 設定を適用した演出レートを返す（元は書き換えない）。
 * 無演出の割合を倍率で動かし、空いた／足りない分を示唆・クイズ・狙えへ
 * **比を保ったまま**配分する。演出の種類のバランスは設定で変えない
 * （変えると「今日はクイズが多い＝高設定」のような別の読み筋が生まれてしまう）。
 */
export function applySettingToEffects(
  rates: EffectRates,
  setting: Setting,
): EffectRates {
  const none = Math.min(0.95, rates.none * NONE_MULTIPLIER[setting]);
  const kinds = ['shisa', 'quiz', 'aim'] as const;
  const baseSum = kinds.reduce((a, k) => a + rates[k], 0);
  if (baseSum <= 0) return { ...rates, none };
  const scale = (1 - none) / baseSum;
  const out: EffectRates = { ...rates, none };
  for (const k of kinds) out[k] = rates[k] * scale;
  return out;
}

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
