import type { Tuning } from '../data/schemas';

/**
 * ステップアップ（段階演出）と連続演出の手続き。画面には触らない。
 *
 * **このゲームのことは何も言わない。終了色が予告するのは次のゲーム。**
 * レバーで青く光り、停止ごとに段が上がり、第3停止で終了色が出る。
 *
 * **色を先に決めて、そこから予告するゲームを作る。** 逆（次ゲームを先読みして色を
 * 決める）だと「次がボーナスの狙えになる」確率が天井になり、赤が3000ゲームに
 * 1回しか出なかった。色から作れば、振り分けで頻度を決められる。
 *
 * **ボーナスの総確率は動かさない。** BIG/REG は通常抽選から落としてあり、ここ経由で
 * しか出ない。1回のステップアップから出るボーナスは
 * .45×.12 + .35×.53 + .18×.70 + .02×1.0 = 0.3855。色の率はこの検算ごと動かすこと。
 *
 * ## 連続演出（2026-10-14）
 *
 * 終了色が決まったあと、一部はそのまま次のゲームへ続く（最大3ゲーム）。続いた
 * ゲームでも段は前のゲームの色から上がっていき、**最後のゲームの第3停止で終了色**、
 * 予告するのはその次のゲーム。
 *
 * **続く率は色ごとに違い、強い色ほど続きやすい**（tuning の `chain`）。だから
 * 「続いた」こと自体が本当に期待度を上げる——積み上がる期待感がそのまま
 * 当選と整合する。青は続かない（上がる先が無い）。
 *
 * 途中のゲームでの段の上限は 1ゲーム目＝緑、2ゲーム目＝赤（どちらも終了色まで）。
 * 途中で終了色を出し切らないので、続いたゲームの最後まで色が決まらない。
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

/**
 * ステップアップの契機になる内部役か。チェリーと、払い出しの大きい小役。
 * 実機の「チャンス役から前兆」と同じ形で、契機をすでにある役に乗せるのは
 * 出玉を動かさないため。
 */
export function isStepTrigger(
  kind: string,
  payout: number,
  cfg: Pick<StepTuning, 'triggerMinPayout'>,
): boolean {
  if (kind === 'cherry') return true;
  if (kind !== 'core') return false;
  return payout >= cfg.triggerMinPayout;
}

/** 終了色を振り分ける。 */
export function pickStepColor(cfg: StepTuning, rng: () => number): StepColor {
  let r = rng();
  for (const color of STEP_COLORS) {
    if ((r -= cfg.colors[color].rate) < 0) return color;
  }
  return 'green';
}

/** 何ゲーム続くか（1〜3）。 */
export function pickChainLength(
  cfg: StepTuning,
  color: StepColor,
  rng: () => number,
): 1 | 2 | 3 {
  const chain = cfg.colors[color].chain;
  if (!(rng() < chain.second)) return 1;
  return rng() < chain.third ? 3 : 2;
}

/**
 * 予告したゲームの中身。`null` はボーナスでない（＝必ず演出の出る小役のゲーム）。
 * `multiplier` は設定の倍率（`stepBonusMultiplier`）。演出の出方は変えず、
 * 繋がる率だけを動かす。
 */
export function pickStepBonus(
  cfg: StepTuning,
  color: StepColor,
  multiplier: number,
  rng: () => number,
): 'big' | 'reg' | null {
  const c = cfg.colors[color];
  if (!(rng() < Math.min(1, c.bonusRate * multiplier))) return null;
  return rng() < c.bigRate ? 'big' : 'reg';
}

/**
 * 連続演出の `game` ゲーム目（1始まり）で、段が上がってよい上限。
 * 最後のゲームは終了色、途中は 1ゲーム目＝緑・2ゲーム目＝赤（終了色を越えない）。
 */
export function stepCapFor(game: number, length: number, color: StepColor): number {
  const final = STEP_LEVEL[color];
  if (game >= length) return final;
  return Math.min(final, STEP_LEVEL.blue + game);
}

/**
 * 停止で段を進める。第1・第2停止は1段、第3停止はそのゲームの上限まで飛ぶ。
 *
 * **上限を追い越さない。** 終了色が青なら3回とも青のままで、段が上がらないこと
 * 自体が「弱い」という情報になる。クランプが無いと、青どまりのはずが第2停止で
 * 緑まで上がってから青へ戻る＝色が後退して見える。
 */
export function stepLevelAfterStop(current: number, stopNo: number, cap: number): number {
  const next = stopNo >= 3 ? cap : Math.min(current + 1, cap);
  return Math.max(current, next);
}
