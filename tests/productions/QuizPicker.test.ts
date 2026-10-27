import { describe, expect, it } from 'vitest';
import { QuizPicker } from '../../src/productions/QuizPicker';
import type { Quiz } from '../../src/data/schemas';

const q = (id: string, answerYakuId: string): Quiz => ({
  id,
  question: `${id}？`,
  answerYakuId,
  decoyYakuIds: ['x', 'y', 'z'],
});

const QUIZZES = [q('a1', 'a'), q('a2', 'a'), q('a3', 'a'), q('a4', 'a'), q('b1', 'b')];

/** 決まった並びの乱数（mulberry32。テストを毎回同じにし、種が近くても最初の値が散る）。 */
const seeded = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

describe('QuizPicker', () => {
  it('役ごとに、全部出し切るまで同じ問題を繰り返さない', () => {
    const p = new QuizPicker(QUIZZES, seeded(1));
    const ids = Array.from({ length: 4 }, () => p.pick('a')?.id);
    expect(new Set(ids).size).toBe(4);
  });

  it('引き直しの境目でも、同じ問題が2回続かない', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const p = new QuizPicker(QUIZZES, seeded(seed));
      let prev: string | undefined;
      for (let i = 0; i < 40; i++) {
        const id = p.pick('a')?.id;
        expect(id).not.toBe(prev);
        prev = id;
      }
    }
  });

  it('答えの役の問題だけを出し、無い役は null', () => {
    const p = new QuizPicker(QUIZZES, seeded(2));
    expect(p.pick('b')?.id).toBe('b1');
    expect(p.pick('b')?.id).toBe('b1'); // 1問しか無ければ繰り返す
    expect(p.pick('none')).toBeNull();
  });

  it('いろいろな問題が出る（最初の1問に固定されない）', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 20; seed++) {
      seen.add(new QuizPicker(QUIZZES, seeded(seed)).pick('a')?.id ?? '');
    }
    expect(seen.size).toBeGreaterThan(1);
  });
});
