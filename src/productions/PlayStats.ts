import { Observable } from '../lib/Observable';

/**
 * プレイ統計。スピン回数や収支を localStorage に永続化する。
 * 図鑑モーダルから参照されることを想定。
 */

const STORAGE_KEY = 'mojislot.stats.v1';

export interface Stats {
  spinCount: number;
  hitCount: number;
  totalBet: number;
  totalWin: number;
  maxWin: number;
  premiumCount: number;
  bonusCount: number;
  /** 現在の連続成立数（ハズレで 0 にリセット） */
  streak: number;
  /** これまでの最大連続成立数 */
  maxStreak: number;
  /** 現在の連続ハズレ数（成立で 0、ハマり救済の発動判定に使う） */
  missStreak: number;
  /** これまでに回答したクイズ数 */
  quizTotal: number;
  /** うち正解した数 */
  quizCorrect: number;
}

const INITIAL: Stats = {
  spinCount: 0,
  hitCount: 0,
  totalBet: 0,
  totalWin: 0,
  maxWin: 0,
  premiumCount: 0,
  bonusCount: 0,
  streak: 0,
  maxStreak: 0,
  missStreak: 0,
  quizTotal: 0,
  quizCorrect: 0,
};

export class PlayStats {
  readonly stats = new Observable<Stats>(INITIAL);

  constructor() {
    this.stats.set(this.load());
  }

  recordSpin(params: {
    bet: number;
    win: number;
    hit: boolean;
    premium: boolean;
    bonusTriggered: boolean;
  }): void {
    const prev = this.stats.get();
    const newStreak = params.hit ? prev.streak + 1 : 0;
    const next: Stats = {
      ...prev,
      spinCount: prev.spinCount + 1,
      hitCount: prev.hitCount + (params.hit ? 1 : 0),
      totalBet: prev.totalBet + params.bet,
      totalWin: prev.totalWin + params.win,
      maxWin: Math.max(prev.maxWin, params.win),
      premiumCount: prev.premiumCount + (params.premium ? 1 : 0),
      bonusCount: prev.bonusCount + (params.bonusTriggered ? 1 : 0),
      streak: newStreak,
      maxStreak: Math.max(prev.maxStreak, newStreak),
      missStreak: params.hit ? 0 : prev.missStreak + 1,
    };
    this.stats.set(next);
    this.save(next);
  }

  /** クイズ演出を提示した回数を記録（「見せるだけ」方式のため正誤はない）。 */
  recordQuiz(): void {
    const prev = this.stats.get();
    const next: Stats = {
      ...prev,
      quizTotal: prev.quizTotal + 1,
    };
    this.stats.set(next);
    this.save(next);
  }

  /** クイズ正解率 (%)。旧4択方式の名残（quizCorrect はセーブ互換のため保持）。 */
  quizRate(): number {
    const s = this.stats.get();
    return s.quizTotal === 0 ? 0 : (s.quizCorrect / s.quizTotal) * 100;
  }

  reset(): void {
    this.stats.set(INITIAL);
    this.save(INITIAL);
  }

  /** 役成立率 (%) */
  hitRate(): number {
    const s = this.stats.get();
    return s.spinCount === 0 ? 0 : (s.hitCount / s.spinCount) * 100;
  }

  /** 収支（純損益） */
  netGain(): number {
    const s = this.stats.get();
    return s.totalWin - s.totalBet;
  }

  private load(): Stats {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return INITIAL;
      const parsed = JSON.parse(raw);
      return { ...INITIAL, ...parsed };
    } catch {
      return INITIAL;
    }
  }

  private save(stats: Stats): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stats));
    } catch {
      // 容量上限等は黙殺
    }
  }
}
