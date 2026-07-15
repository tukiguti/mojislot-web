import { describe, expect, it } from 'vitest';
import { QuizState } from '../../src/productions/QuizState';
import type { Quiz, YakuList } from '../../src/data/schemas';

const YAKU_LIST: YakuList = {
  mode: 'test',
  internalRoleMissRate: { default: 0, rescue: 0, bonus: 0 },
  coreYaku: [
    {
      id: 'apple',
      name: 'りんご',
      symbols: ['り', 'ん', 'ご'],
      category: 'core',
      internalRoleKind: 'core',
      internalRoleRate: { default: 1, rescue: 1, bonus: 1 },
    },
  ],
  premiumYaku: [],
  bonusYaku: [],
  cherryYaku: [],
};

const QUIZ: Quiz = {
  id: 'q1',
  question: '赤い果物は？',
  answerYakuId: 'apple',
  decoyYakuIds: ['x', 'y', 'z'],
};

describe('QuizState', () => {
  it('出題中は答えを引き込み対象として保持し、全停止後に的中結果を確定する', () => {
    const state = new QuizState();

    state.reveal(QUIZ, YAKU_LIST);
    expect(state.phase.get()).toBe('shown');
    expect(state.current.get()?.answer).toBe('りんご');
    expect(state.targetYakuId()).toBe('apple');

    state.resolve(true);
    expect(state.phase.get()).toBe('resolved');
    expect(state.matched.get()).toBe(true);
    expect(state.targetYakuId()).toBe('apple');

    state.reset();
    expect(state.phase.get()).toBe('inactive');
    expect(state.current.get()).toBeNull();
    expect(state.matched.get()).toBeNull();
    expect(state.targetYakuId()).toBeNull();
  });

  it('出題中でない resolve は状態を変えない', () => {
    const state = new QuizState();
    state.resolve(false);
    expect(state.phase.get()).toBe('inactive');
    expect(state.matched.get()).toBeNull();
  });
});
