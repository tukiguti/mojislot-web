import type { EffectType } from './EffectScheduler';
import type { ShisaTierColor } from '../data/schemas';
import type { EndScreenKind } from './SettingHint';

/**
 * 演出の**見た目の対応表**。
 *
 * ここに置くのは「何がどう見えるか」だけで、いつ出すか・何を意味するかは持たない。
 * 出す条件は内部役と演出抽選（[24] / [31]）、意味は役そのものが持っている。
 *
 * `main.ts` へ直書きしていた頃は、同じ対応が分岐の中に散っていて、
 * 色を1つ足すたびに3〜4箇所を揃えて直す必要があった（示唆の5色化で実際に踏んだ）。
 * 対応表を1枚にしておくと、抜けがあれば型が落ちる。
 */

/** ヘッダーの演出ステータス表示。`none` は「通常」。 */
export interface EffectStatusView {
  label: string;
  /** ステータス要素に付けるクラス（`none` は素のまま）。 */
  statusClass: string | null;
}

export const EFFECT_STATUS: Record<EffectType, EffectStatusView> = {
  none: { label: '通常', statusClass: null },
  shisa: { label: '示唆', statusClass: 'shisa' },
  quiz: { label: 'クイズ', statusClass: 'quiz' },
  aim: { label: '狙え！', statusClass: 'aim' },
};

/** ステータス要素から毎回外すクラス（演出クラス＋tier色）。付け忘れると前の色が残る。 */
export const EFFECT_STATUS_CLASSES: readonly string[] = [
  ...Object.values(EFFECT_STATUS)
    .map((v) => v.statusClass)
    .filter((c): c is string => c !== null),
  'tier-blue',
  'tier-green',
  'tier-red',
  'tier-gold',
  'tier-rainbow',
];

/** 示唆のtier色 → 画面tint（Pixi 側で使うので数値）。 */
export const SHISA_TINT: Record<ShisaTierColor, number> = {
  blue: 0x66ccff,
  green: 0x4ade80,
  red: 0xff3b30,
  gold: 0xffcc33,
  rainbow: 0xff66cc,
};

/**
 * 連チャンのオーラ4段。**配当の `streakTiers` とは独立の見た目専用**で、
 * 段が上がった瞬間にランクアップ演出（フラッシュ＋紙吹雪＋SE）を出す。
 * 12連以上は最上段で表現する。
 */
export interface StreakTier {
  /** この連チャン数以上でこの段。 */
  threshold: number;
  /** 筐体に付けるオーラのクラス。 */
  className: string;
  /** フラッシュとランクアップバッジの色。 */
  color: string;
}

export const STREAK_TIERS: readonly StreakTier[] = [
  { threshold: 2, className: 'streak-aura', color: '#ffd700' },
  { threshold: 5, className: 'streak-aura-hot', color: '#ff8a00' },
  { threshold: 8, className: 'streak-aura-fever', color: '#ff3366' },
  { threshold: 12, className: 'streak-aura-max', color: '#c060ff' },
];

export const STREAK_TIER_CLASSES: readonly string[] = STREAK_TIERS.map(
  (t) => t.className,
);

/** その連チャン数の段（0＝オーラなし、1〜4）。 */
export const streakTierOf = (streak: number): number =>
  STREAK_TIERS.filter((t) => streak >= t.threshold).length;

/**
 * ボーナス終了画面のフラッシュ色。
 *
 * **示唆が出た時だけ色を変える**のが要で、変わらなければ「何も出なかった」と分かる。
 * 奇数示唆を偶数と別色にしてあるのは、同色だと「月が出た」までしか伝わらず
 * 6が消えたのか残ったのかが読めないため（[30] §6）。
 */
export const END_SCREEN_FLASH: Record<Exclude<EndScreenKind, 'normal' | 'gold'>, string> =
  {
    max: '#b06bff',
    high: '#ffd700',
    even: '#6ee0d0',
    odd: '#f0a860',
  };

/** 示唆なしの時の色。BIGは金、REGは銀（＝ボーナスの格そのまま）。 */
export const END_SCREEN_FLASH_PLAIN: Record<'big' | 'reg', string> = {
  big: '#ffd700',
  reg: '#cdd6e0',
};

export const endScreenFlashColor = (
  kind: EndScreenKind,
  bonus: 'big' | 'reg',
): string =>
  // 'gold'（金縁＝高設定ほど出やすいだけの弱い示唆）は色を変えない。
  // 弱い示唆に強い色を当てると、色の強さと情報の強さが食い違う。
  kind === 'normal' || kind === 'gold'
    ? END_SCREEN_FLASH_PLAIN[bonus]
    : END_SCREEN_FLASH[kind];
