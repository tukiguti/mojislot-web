import { Observable } from '../lib/Observable';
import type { EffectRates } from './EffectScheduler';

/**
 * ボーナスゾーン（プレミアム成立で発動する短期上乗せ期間）の状態管理。
 *
 * 発動条件：呼び出し側で「プレミアム役成立」等のトリガーを判定して trigger() を呼ぶ。
 * 期間中は：
 *  - 演出抽選レートが bonusEffectRates に切り替わる（呼び出し側で適用）
 *  - PayoutCalc.calc(yaku, true) として bonusZoneMultiplier が掛かる
 *  - 既に active 中に再トリガーされたら残り回数を加算（おかわり＝上乗せ）
 */

/** ボーナス種別: big=プレミアム役(すしや等) / reg=レギュラー役(すし＋別字) */
export type BonusKind = 'big' | 'reg';

export interface BonusConfig {
  /** ビッグボーナス1回の継続スピン数 */
  spinsPerBonus: number;
  /** レギュラーボーナス1回の継続スピン数（ビッグより短い） */
  spinsPerReg: number;
  /** ボーナス中の演出レート（none/shisa/quiz の合計が 1.0 になる必要あり） */
  bonusEffectRates: EffectRates;
}

export const DEFAULT_BONUS_CONFIG: BonusConfig = {
  spinsPerBonus: 10,
  spinsPerReg: 5,
  /**
   * ボーナス中は必ず何らかの演出を出す（none = 0）。
   * 「ずっと示唆 / 狙え / クイズ」=「演出 100%」のためのバランス設定。
   * shisa を厚めにしてテンポを保ち、quiz と aim を控えめに混ぜる。
   */
  bonusEffectRates: { none: 0, shisa: 0.5, quiz: 0.2, aim: 0.3 },
};

export class BonusZone {
  readonly remaining = new Observable<number>(0);
  readonly active = new Observable<boolean>(false);
  /** 現在のボーナス種別（非アクティブ時は null） */
  readonly kind = new Observable<BonusKind | null>(null);

  constructor(readonly config: BonusConfig = DEFAULT_BONUS_CONFIG) {}

  /**
   * ボーナス発動 or 残り回数の上乗せ（おかわり）。
   * kind='big' はプレミアム役、'reg' はレギュラー役で短め。
   * 既に active 中の再トリガーは、残り回数に spins を加算（上乗せ）し種別を上書き
   * （reg 中に big を引いたら big に昇格）。
   */
  trigger(kind: BonusKind = 'big'): void {
    const spins = kind === 'reg' ? this.config.spinsPerReg : this.config.spinsPerBonus;
    // おかわり（active 中の再当選）は残り回数に加算（上乗せ）。新規突入はセット。
    this.remaining.set(this.active.get() ? this.remaining.get() + spins : spins);
    this.kind.set(kind);
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
    if (next <= 0) {
      this.active.set(false);
      this.kind.set(null);
    }
  }

  isActive(): boolean {
    return this.active.get();
  }
}
