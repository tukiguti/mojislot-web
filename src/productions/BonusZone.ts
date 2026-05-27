import { Observable } from '../lib/Observable';
import type { EffectRates } from './EffectScheduler';

/**
 * ボーナスゾーン（プレミアム成立で発動する短期上乗せ期間）の状態管理。
 *
 * 発動条件：呼び出し側で「プレミアム役成立」等のトリガーを判定して trigger() を呼ぶ。
 * 期間中は：
 *  - 演出抽選レートが bonusEffectRates に切り替わる（呼び出し側で適用）
 *  - PayoutCalc.calc(yaku, true) として bonusZoneMultiplier が掛かる
 *  - 既に active 中に再トリガーされたら残り回数をリセット（おかわり）
 */

export interface BonusConfig {
  /** ボーナス1回の継続スピン数 */
  spinsPerBonus: number;
  /** ボーナス中の演出レート（none/shisa/quiz の合計が 1.0 になる必要あり） */
  bonusEffectRates: EffectRates;
}

export const DEFAULT_BONUS_CONFIG: BonusConfig = {
  spinsPerBonus: 10,
  /**
   * ボーナス中は必ず何らかの演出を出す（none = 0）。
   * 「ずっと示唆 or クイズ」=「演出 100%」のためのバランス設定。
   * shisa を厚めにしてテンポを保ち、quiz は控えめに混ぜる。
   */
  bonusEffectRates: { none: 0, shisa: 0.7, quiz: 0.3 },
};

export class BonusZone {
  readonly remaining = new Observable<number>(0);
  readonly active = new Observable<boolean>(false);

  constructor(readonly config: BonusConfig = DEFAULT_BONUS_CONFIG) {}

  /** ボーナス発動 or 残り回数リセット（おかわり） */
  trigger(): void {
    this.remaining.set(this.config.spinsPerBonus);
    this.active.set(true);
  }

  /**
   * spin 1回ぶんを消費。残り 0 になったら active を false に。
   * 「BET 時に1減らす」運用を想定。
   */
  consumeSpin(): void {
    if (!this.active.get()) return;
    const next = this.remaining.get() - 1;
    this.remaining.set(Math.max(0, next));
    if (next <= 0) this.active.set(false);
  }

  isActive(): boolean {
    return this.active.get();
  }
}
