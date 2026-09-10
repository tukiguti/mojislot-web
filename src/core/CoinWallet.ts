import { Observable } from '../lib/Observable';

/**
 * 差枚の帳簿。
 *
 * **メダルは借りない**（2026-09-07）。サンドから貸し出す操作を廃止し、ベットした分だけ
 * 数字がマイナスへ進み、払い出しで戻る形にした。アプリ版のスロットでよくある
 * 「所持を気にせず打てて、結果だけが差枚として残る」型。借りる手間は遊びの本筋ではなく、
 * 見たいのは投資と回収の差だけなので、その数字を直接見せる。
 *
 * - `coins` … 差枚。0 から始まり、マイナスにもなる（表示上の主役）
 * - `investmentTotal` … ベットした総額。機械割の分母
 * - `paybackTotal` … 払い出しの総額。機械割の分子
 *
 * `coins` は `paybackTotal - investmentTotal` と常に一致する。導出できるが、
 * 表示の購読先として独立した Observable を持たせている。
 */
export class CoinWallet {
  readonly coins: Observable<number>;
  readonly investmentTotal: Observable<number>;
  readonly paybackTotal: Observable<number>;

  constructor(initial: number) {
    this.coins = new Observable<number>(initial);
    this.investmentTotal = new Observable<number>(0);
    this.paybackTotal = new Observable<number>(0);
  }

  /**
   * **常に打てる。** 残高では止めない——借りる操作が無いので、止めると先へ進めなくなる。
   * 引数を受けるのは呼び側の意図（この額を賭ける）を残すため。
   */
  canBet(_amount: number): boolean {
    return true;
  }

  /** ベット＝投資。差枚が減り、投資累計が増える。 */
  bet(amount: number): boolean {
    if (amount <= 0) return false;
    this.coins.set(this.coins.get() - amount);
    this.investmentTotal.set(this.investmentTotal.get() + amount);
    return true;
  }

  /** 役の払い出し。差枚が戻り、回収累計が増える。 */
  win(amount: number): void {
    if (amount <= 0) return;
    this.coins.set(this.coins.get() + amount);
    this.paybackTotal.set(this.paybackTotal.get() + amount);
  }

  /** 差枚。`coins` と同じ値だが、意味を明示したい箇所から呼ぶ。 */
  sahmai(): number {
    return this.coins.get();
  }

  /** 1戦の締め。差枚も投資も回収もゼロへ戻す。 */
  reset(amount: number): void {
    this.coins.set(amount);
    this.investmentTotal.set(0);
    this.paybackTotal.set(0);
  }
}
