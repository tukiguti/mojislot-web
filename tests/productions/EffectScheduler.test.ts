import { describe, it, expect, vi, afterEach } from 'vitest';
import { EffectScheduler } from '../../src/productions/EffectScheduler';

afterEach(() => vi.restoreAllMocks());

const mockRandom = (v: number) => vi.spyOn(Math, 'random').mockReturnValue(v);

/** 通常時レート（data/tuning/default.json と同値）。合計1.0。 */
const NORMAL = { none: 0.5, shisa: 0.15, quiz: 0.25, aim: 0.1 };
/** ボーナス中レート。none=0 なので無演出が出てはいけない。 */
const BONUS = { none: 0.0, shisa: 0.4, quiz: 0.35, aim: 0.25 };

describe('EffectScheduler.rollAvailable', () => {
  it('候補に none を足して抽選する（通常時は無演出が出る）', () => {
    const s = new EffectScheduler(NORMAL);
    // 候補は none/shisa/quiz/aim、合計1.0。累積 0.5 / 0.65 / 0.90 / 1.0
    mockRandom(0.0);
    expect(s.rollAvailable(['shisa', 'quiz', 'aim'])).toBe('none');
    mockRandom(0.49);
    expect(s.rollAvailable(['shisa', 'quiz', 'aim'])).toBe('none');
    mockRandom(0.5);
    expect(s.rollAvailable(['shisa', 'quiz', 'aim'])).toBe('shisa');
    mockRandom(0.7);
    expect(s.rollAvailable(['shisa', 'quiz', 'aim'])).toBe('quiz');
    mockRandom(0.95);
    expect(s.rollAvailable(['shisa', 'quiz', 'aim'])).toBe('aim');
  });

  it('表現できない演出を除いて正規化する（チェリーは aim を使えない）', () => {
    const s = new EffectScheduler(NORMAL);
    // 候補は none/shisa/quiz の 0.9。none は 0.5/0.9≒55.6% と少し厚くなる
    mockRandom(0.5); // 0.5*0.9 = 0.45 < 0.5(none)
    expect(s.rollAvailable(['shisa', 'quiz'])).toBe('none');
    mockRandom(0.99);
    expect(s.rollAvailable(['shisa', 'quiz'])).toBe('quiz');
  });

  it('ボーナス中レート（none=0）では無演出が出ない', () => {
    const s = new EffectScheduler(BONUS);
    mockRandom(0.0);
    expect(s.rollAvailable(['shisa', 'quiz', 'aim'])).toBe('shisa');
    mockRandom(0.99);
    expect(s.rollAvailable(['shisa', 'quiz', 'aim'])).toBe('aim');
  });

  it('setRates で抽選分布を切り替えられる（none=1 なら必ず none）', () => {
    const s = new EffectScheduler(NORMAL);
    s.setRates({ none: 1, shisa: 0, quiz: 0, aim: 0 });
    mockRandom(0.99);
    expect(s.rollAvailable(['shisa', 'quiz', 'aim'])).toBe('none');
  });

  it('候補に有効な重みがなければnoneへフォールバックする', () => {
    const s = new EffectScheduler({ none: 0, shisa: 0, quiz: 0, aim: 0 });
    expect(s.rollAvailable(['quiz', 'aim'])).toBe('none');
  });
});
