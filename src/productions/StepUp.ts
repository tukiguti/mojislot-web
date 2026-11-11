import type { Tuning } from '../data/schemas';

/**
 * ステップアップ（段階演出）の手続き。画面には触らない。
 *
 * 〔2026-11-10〕**当たったゲームの中で完結する**形に作り直した（ユーザー指示）。
 * レバーで青く光り、第1・第2停止で緑まで上がり、第3停止で終了色が出る。
 * 以前の「終了色が次のゲームを予告する」形と、複数ゲームに続く連続演出はやめた。
 *
 * **チェリーを狙う演出。**
 * - チェリーのゲームで `cherryRate` の割合で出る。終了色は青か緑
 * - 通常抽選で BIG / REG を引いたゲームで `bonusRate` の割合で出る。内部役をそのボーナスを
 *   伴う目印揃い（チャンス目）に置き換え、終了色は赤か金。**赤以上ならボーナス確定**
 *
 * ボーナスのゲームでチェリーを狙うと、左と中は目印に届く（配列で目印がチェリーの隣にある）。
 * 右は目印に届けば目印が揃い、届かなければボーナスの図柄が止まる（停止制御）。
 * BIG を狙えば、そのゲームで BIG を揃えて突入することもできる。
 */

export type StepColor = 'blue' | 'green' | 'red' | 'gold';

export const STEP_COLORS: readonly StepColor[] = ['blue', 'green', 'red', 'gold'];

/**
 * 段の番号（`ui/Effects.ts` の `setStepFx` が受け取る値）。白（1）は使わない——
 * 実機のステップアップは光った時点で既に色が付いている。
 */
export const STEP_LEVEL: Record<StepColor, number> = {
  blue: 2,
  green: 3,
  red: 4,
  gold: 5,
};

export type StepTuning = Tuning['stepUp'];

/** 重みから色を1つ選ぶ。重みが空なら青。 */
export function pickColor(
  weights: Partial<Record<StepColor, number>>,
  rng: () => number,
): StepColor {
  const entries = STEP_COLORS.filter((c) => (weights[c] ?? 0) > 0);
  const total = entries.reduce((s, c) => s + (weights[c] ?? 0), 0);
  if (total <= 0) return 'blue';
  let r = rng() * total;
  for (const c of entries) {
    if ((r -= weights[c] ?? 0) < 0) return c;
  }
  return entries[entries.length - 1];
}

/**
 * このゲームでステップアップを出すか、出すなら何色で終わるか。
 * `kind` はレバーONで引いた内部役の種別（フリーズ役やボーナス中は呼び出し側で除く）。
 * ボーナスのゲームで色を返したら、呼び出し側が内部役を目印揃い（ボーナス付き）に置き換える。
 */
export function planStepUp(
  cfg: StepTuning,
  kind: string,
  rng: () => number,
): StepColor | null {
  if (kind === 'cherry') {
    return rng() < cfg.cherryRate ? pickColor(cfg.cherryColors, rng) : null;
  }
  if (kind === 'big' || kind === 'reg') {
    if (!(rng() < cfg.bonusRate)) return null;
    return pickColor(kind === 'big' ? cfg.bonusColors.big : cfg.bonusColors.reg, rng);
  }
  return null;
}

/**
 * 停止で段を進める。第1・第2停止は1段ずつ（緑まで）、第3停止で終了色へ飛ぶ。
 * **第3停止まで赤と金を見せない**——最後のリールで揃うかどうか、の形にするため。
 * 終了色が青なら3回とも青のまま。
 */
export function stepLevelAfterStop(current: number, stopNo: number, final: StepColor): number {
  const cap =
    stopNo >= 3 ? STEP_LEVEL[final] : Math.min(STEP_LEVEL[final], STEP_LEVEL.green);
  const next = stopNo >= 3 ? cap : Math.min(current + 1, cap);
  return Math.max(current, next);
}
