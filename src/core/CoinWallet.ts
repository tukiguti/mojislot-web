import { Observable } from '../lib/Observable';

export class CoinWallet {
  readonly coins: Observable<number>;

  constructor(initial: number) {
    this.coins = new Observable<number>(initial);
  }

  canBet(amount: number): boolean {
    return this.coins.get() >= amount;
  }

  bet(amount: number): boolean {
    if (!this.canBet(amount)) return false;
    this.coins.set(this.coins.get() - amount);
    return true;
  }

  win(amount: number): void {
    if (amount <= 0) return;
    this.coins.set(this.coins.get() + amount);
  }
}
