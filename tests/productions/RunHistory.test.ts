import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  appendRunRecord,
  loadRunHistory,
  RUN_RULESET_VERSION,
  type RunRecord,
} from '../../src/productions/RunHistory';

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}

const BASE_RECORD: RunRecord = {
  runId: 'run-1',
  memberId: 'member-1',
  memberName: 'テスト',
  chapterId: 'hiragana_food',
  startedAt: 1,
  settledAt: 2,
  investment: 100,
  payback: 120,
  sahmai: 20,
  spinCount: 10,
  totalBet: 30,
  totalWin: 50,
  premiumCount: 1,
  bonusCount: 0,
};

describe('RunHistory', () => {
  beforeEach(() => vi.stubGlobal('localStorage', memoryStorage()));
  afterEach(() => vi.unstubAllGlobals());

  it('比較条件を含む新しい履歴を保存する', () => {
    appendRunRecord({
      ...BASE_RECORD,
      appVersion: '0.0.0',
      rulesetVersion: RUN_RULESET_VERSION,
      reelSpeedMin: 20,
      reelSpeedMax: 24,
      autoUsed: true,
      missionsEnabled: false,
      debugEnabled: false,
    });

    expect(loadRunHistory()).toEqual([
      expect.objectContaining({
        runId: 'run-1',
        rulesetVersion: RUN_RULESET_VERSION,
        reelSpeedMin: 20,
        reelSpeedMax: 24,
        autoUsed: true,
      }),
    ]);
  });

  it('比較条件がない旧履歴も引き続き読み込む', () => {
    localStorage.setItem('mojislot.runHistory.v1', JSON.stringify([BASE_RECORD]));
    expect(loadRunHistory()).toEqual([BASE_RECORD]);
  });
});
