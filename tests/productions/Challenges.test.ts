import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CHALLENGES,
  ChallengeTracker,
  type ChallengeContext,
} from '../../src/productions/Challenges';

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => Array.from(data.keys())[index] ?? null,
    removeItem: (key) => data.delete(key),
    setItem: (key, value) => data.set(key, String(value)),
  };
}

const context = (hitCount: number): ChallengeContext => ({
  stats: {
    spinCount: hitCount,
    hitCount,
    totalBet: hitCount * 3,
    totalWin: hitCount * 3,
    streak: hitCount,
    maxStreak: hitCount,
    maxWin: hitCount * 3,
    quizTotal: 0,
    quizCorrect: 0,
    premiumCount: 0,
    bonusCount: 0,
    missStreak: 0,
  },
  bitaCount: 0,
  zukanCounts: {},
  yakuList: {
    mode: 'test',
    coreYaku: [],
    premiumYaku: [],
    bonusYaku: [],
    cherryYaku: [],
  },
});

describe('ChallengeTracker', () => {
  beforeEach(() => vi.stubGlobal('localStorage', memoryStorage()));

  it('ミッション定義にコイン報酬を持たない', () => {
    expect(CHALLENGES.every((challenge) => !('reward' in challenge))).toBe(true);
  });

  it('新規達成を一度だけ記録して永続化する', () => {
    const tracker = new ChallengeTracker();

    expect(tracker.evaluate(context(1)).map((challenge) => challenge.id)).toContain(
      'first_hit',
    );
    expect(tracker.evaluate(context(1))).toEqual([]);
    expect(JSON.parse(localStorage.getItem('mojislot.challenges.v1') ?? '[]')).toContain(
      'first_hit',
    );
  });

  it('OFF中は達成を記録しない', () => {
    const tracker = new ChallengeTracker();
    tracker.setEnabled(false);

    expect(tracker.evaluate(context(1))).toEqual([]);
    expect(tracker.isAchieved('first_hit')).toBe(false);
  });
});
