import type { Tuning } from '../data/schemas';

/**
 * 予兆（無音・バックライト消灯）の抽選。画面と音には触らない。
 *
 * **ボーナスのフラグがある時にしか出ない。** 2026-07-29 の方針どおり、予兆は
 * 強レア役とボーナス専用に取っておき、無演出の穴埋めには使わない。出たら
 * ボーナスは本当にある（嘘をつかない）。BIG か REG かは言わない——種類の重みは
 * フラグによらず同じ。
 *
 * 出すのは**無演出のゲームだけ**。演出が出ていればボーナスかどうかは色や役名で
 * 分かっていて、重ねても情報が増えない。矛盾（小役を指す演出）に重ねると、
 * 種明かしを先にしてしまう。遅れと同じ判断。
 *
 * ブラックアウトはここに入れない。フリーズ専用（production.md §ブラックアウト）で、
 * 普通のボーナスで使うと「全部落ちた」が驚きでなくなる。
 */

export type OmenKind = 'silence' | 'backlight';

/** バックライトが消える場面。レバー、第1停止、第2停止。 */
export type BacklightAt = 0 | 1 | 2;

export interface OmenPlan {
  kind: OmenKind;
  /** バックライトが消える場面（無音では使わない）。 */
  at: BacklightAt;
}

/** 予兆を出せるかの判断に要る、そのゲームの状態。 */
export interface OmenContext {
  /** 内部役の種別（big / reg / chance / core …）。 */
  roleKind: string;
  /** フリーズ役か。フリーズは自前のブラックアウトを持つので予兆は重ねない。 */
  freeze: boolean;
  /** チャンス目の内部役が持ち越すボーナス。 */
  carryYakuId: string | null;
  /** 通常抽選のゲームか（持ち越し・確定ランプ・デバッグ予約は false）。 */
  fromLottery: boolean;
  /** 示唆・クイズ・狙え・ステップアップのどれかが出ているか。 */
  effectShown: boolean;
  /** ボーナス中か。**ボーナス中は出さない**——情報の無い煽りになる。 */
  bonusActive: boolean;
}

/** このゲームのフラグで予兆を出すなら、その発生率。出せないなら 0。 */
export function omenRate(cfg: Tuning['omen'], ctx: OmenContext): number {
  if (ctx.bonusActive || !ctx.fromLottery || ctx.effectShown || ctx.freeze) return 0;
  if (ctx.roleKind === 'big') return cfg.rate.big;
  if (ctx.roleKind === 'reg') return cfg.rate.reg;
  if (ctx.roleKind === 'chance' && ctx.carryYakuId !== null) return cfg.rate.chance;
  return 0;
}

const pick = <K extends string>(weights: Record<K, number>, rng: () => number): K => {
  const keys = Object.keys(weights) as K[];
  const total = keys.reduce((s, k) => s + Math.max(0, weights[k]), 0);
  let r = rng() * total;
  for (const k of keys) {
    if ((r -= Math.max(0, weights[k])) < 0) return k;
  }
  return keys[keys.length - 1];
};

/** 予兆を引く。出ないなら null。 */
export function rollOmen(
  cfg: Tuning['omen'],
  ctx: OmenContext,
  rng: () => number,
): OmenPlan | null {
  const p = omenRate(cfg, ctx);
  if (!(p > 0) || !(rng() < p)) return null;
  const kind = pick(cfg.kinds, rng);
  const atKey = pick(cfg.backlightAt, rng);
  const at: BacklightAt = atKey === 'lever' ? 0 : atKey === 'stop1' ? 1 : 2;
  return { kind, at };
}
