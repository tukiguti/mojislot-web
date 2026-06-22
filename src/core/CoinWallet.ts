import { Observable } from '../lib/Observable';

/**
 * 持メダル財布。
 * - coins: 現在の持メダル（メモリのみ・非永続）
 * - investmentTotal: この戦の投資累計（サンドの貸出累計）。差枚 = coins - investmentTotal。
 *   役の払い出し(win)は投資ではないので investmentTotal を動かさない。
 *   貸出(lend)だけが投資＝持メダルと投資を同時に増やす。
 */
export class CoinWallet {
  readonly coins: Observable<number>;
  readonly investmentTotal: Observable<number>;

  constructor(initial: number) {
    this.coins = new Observable<number>(initial);
    this.investmentTotal = new Observable<number>(0);
  }

  canBet(amount: number): boolean {
    return this.coins.get() >= amount;
  }

  bet(amount: number): boolean {
    if (!this.canBet(amount)) return false;
    this.coins.set(this.coins.get() - amount);
    return true;
  }

  /** 役の払い出し（投資ではない＝差枚のプラス要因）。 */
  win(amount: number): void {
    if (amount <= 0) return;
    this.coins.set(this.coins.get() + amount);
  }

  /** メダル貸出＝投資。持メダルと投資累計を同時に増やす。 */
  lend(amount: number): void {
    if (amount <= 0) return;
    this.investmentTotal.set(this.investmentTotal.get() + amount);
    this.coins.set(this.coins.get() + amount);
  }

  /** 差枚 = 現在の持メダル − この戦の投資累計。 */
  sahmai(): number {
    return this.coins.get() - this.investmentTotal.get();
  }

  /** 持メダルを amount に、投資累計を 0 にリセット（計数・各種リセットで使用＝1戦の締め）。 */
  reset(amount: number): void {
    this.coins.set(amount);
    this.investmentTotal.set(0);
  }
}
