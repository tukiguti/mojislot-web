import { Observable } from '../lib/Observable';
import type { Stats } from './PlayStats';
import type { ZukanCounts } from './ZukanState';
import type { YakuList } from '../data/schemas';

/**
 * チャレンジ（ミッション）システム。
 * 各種統計と図鑑カウントを参照して、達成条件をチェックする。
 * 一度達成したものは永続化し、報酬コインを付与する。
 */

export interface ChallengeContext {
  stats: Stats;
  bitaCount: number;
  zukanCounts: ZukanCounts;
  yakuList: YakuList;
}

export interface Challenge {
  id: string;
  title: string;
  description: string;
  reward: number;
  /** 達成条件。true なら達成 */
  check: (ctx: ChallengeContext) => boolean;
  /** 現在の進捗（達成までの値）。表示用 */
  progress?: (ctx: ChallengeContext) => { current: number; target: number };
}

export const CHALLENGES: readonly Challenge[] = [
  {
    id: 'first_hit',
    title: 'はじめての一歩',
    description: '役を1回揃える',
    reward: 50,
    check: (ctx) => ctx.stats.hitCount >= 1,
    progress: (ctx) => ({ current: Math.min(ctx.stats.hitCount, 1), target: 1 }),
  },
  {
    id: 'streak3',
    title: 'プチ連チャン',
    description: '3連チャンを達成',
    reward: 100,
    check: (ctx) => ctx.stats.maxStreak >= 3,
    progress: (ctx) => ({ current: Math.min(ctx.stats.maxStreak, 3), target: 3 }),
  },
  {
    id: 'streak5',
    title: '気持ちいい連チャン',
    description: '5連チャンを達成',
    reward: 200,
    check: (ctx) => ctx.stats.maxStreak >= 5,
    progress: (ctx) => ({ current: Math.min(ctx.stats.maxStreak, 5), target: 5 }),
  },
  {
    id: 'streak10',
    title: '神連チャン',
    description: '10連チャンを達成',
    reward: 500,
    check: (ctx) => ctx.stats.maxStreak >= 10,
    progress: (ctx) => ({ current: Math.min(ctx.stats.maxStreak, 10), target: 10 }),
  },
  {
    id: 'bita10',
    title: 'ビタ押し職人',
    description: 'ビタ押し10回達成',
    reward: 150,
    check: (ctx) => ctx.bitaCount >= 10,
    progress: (ctx) => ({ current: Math.min(ctx.bitaCount, 10), target: 10 }),
  },
  {
    id: 'bita50',
    title: 'ビタ押しの達人',
    description: 'ビタ押し50回達成',
    reward: 500,
    check: (ctx) => ctx.bitaCount >= 50,
    progress: (ctx) => ({ current: Math.min(ctx.bitaCount, 50), target: 50 }),
  },
  {
    id: 'premium1',
    title: 'プレミアム成立',
    description: 'プレミアム役を1回揃える',
    reward: 300,
    check: (ctx) => ctx.stats.premiumCount >= 1,
    progress: (ctx) => ({ current: Math.min(ctx.stats.premiumCount, 1), target: 1 }),
  },
  {
    id: 'premium5',
    title: 'プレミアムハンター',
    description: 'プレミアム役を5回揃える',
    reward: 1000,
    check: (ctx) => ctx.stats.premiumCount >= 5,
    progress: (ctx) => ({ current: Math.min(ctx.stats.premiumCount, 5), target: 5 }),
  },
  {
    id: 'quiz_correct10',
    title: 'クイズマスター',
    description: 'クイズ正解 10回',
    reward: 150,
    check: (ctx) => ctx.stats.quizCorrect >= 10,
    progress: (ctx) => ({ current: Math.min(ctx.stats.quizCorrect, 10), target: 10 }),
  },
  {
    id: 'spin100',
    title: '100スピン到達',
    description: 'スピン累計 100回',
    reward: 200,
    check: (ctx) => ctx.stats.spinCount >= 100,
    progress: (ctx) => ({ current: Math.min(ctx.stats.spinCount, 100), target: 100 }),
  },
  {
    id: 'spin500',
    title: '500スピン到達',
    description: 'スピン累計 500回',
    reward: 700,
    check: (ctx) => ctx.stats.spinCount >= 500,
    progress: (ctx) => ({ current: Math.min(ctx.stats.spinCount, 500), target: 500 }),
  },
  {
    id: 'positive_net',
    title: '勝ち越し',
    description: '通算収支をプラスに',
    reward: 300,
    check: (ctx) => ctx.stats.totalWin - ctx.stats.totalBet >= 1,
    progress: (ctx) => ({
      current: Math.max(0, ctx.stats.totalWin - ctx.stats.totalBet),
      target: 1,
    }),
  },
];

const STORAGE_KEY = 'mojislot.challenges.v1';
const ENABLED_KEY = 'mojislot.challengesEnabled.v1';

export class ChallengeTracker {
  readonly achieved = new Observable<ReadonlySet<string>>(new Set());
  /**
   * ミッション全体の有効/無効。OFFのとき：
   *  - evaluate() は何もせず []を返す（報酬付与もトーストも出ない）
   *  - 既に達成済みのものは表示されたまま（履歴は保持）
   */
  readonly enabled = new Observable<boolean>(true);

  constructor() {
    this.achieved.set(this.load());
    this.enabled.set(this.loadEnabled());
  }

  /**
   * 達成チェックを行い、新たに達成したものを返す。
   * 呼び出し側で報酬付与とトースト表示を行う。
   * enabled=false のときは何もせず []を返す。
   */
  evaluate(ctx: ChallengeContext): Challenge[] {
    if (!this.enabled.get()) return [];
    const prev = this.achieved.get();
    const newlyAchieved: Challenge[] = [];
    const next = new Set(prev);
    for (const c of CHALLENGES) {
      if (prev.has(c.id)) continue;
      if (c.check(ctx)) {
        next.add(c.id);
        newlyAchieved.push(c);
      }
    }
    if (newlyAchieved.length > 0) {
      this.achieved.set(next);
      this.save(next);
    }
    return newlyAchieved;
  }

  isAchieved(id: string): boolean {
    return this.achieved.get().has(id);
  }

  setEnabled(v: boolean): void {
    this.enabled.set(v);
    try {
      localStorage.setItem(ENABLED_KEY, v ? '1' : '0');
    } catch {
      /* ignore */
    }
  }

  reset(): void {
    this.achieved.set(new Set());
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }

  private load(): Set<string> {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return new Set();
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return new Set();
      return new Set(parsed.filter((v) => typeof v === 'string'));
    } catch {
      return new Set();
    }
  }

  private loadEnabled(): boolean {
    try {
      const raw = localStorage.getItem(ENABLED_KEY);
      if (raw === null) return true; // デフォルトON
      return raw === '1';
    } catch {
      return true;
    }
  }

  private save(ids: ReadonlySet<string>): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(ids)));
    } catch {
      /* ignore */
    }
  }
}
