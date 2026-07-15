import { describe, it, expect, vi, afterEach } from 'vitest';
import { EffectScheduler, DEFAULT_RATES } from '../../src/productions/EffectScheduler';

afterEach(() => vi.restoreAllMocks());

const mockRandom = (v: number) => vi.spyOn(Math, 'random').mockReturnValue(v);

describe('EffectScheduler.roll', () => {
  // 既定: none 0.6 / shisa 0.2 / quiz 0.1 / aim 0.1（累積 0.6 / 0.8 / 0.9 / 1.0）
  const s = new EffectScheduler(DEFAULT_RATES);

  it('r<0.6 は none', () => {
    mockRandom(0.0);
    expect(s.roll()).toBe('none');
    mockRandom(0.59);
    expect(s.roll()).toBe('none');
  });

  it('0.6<=r<0.8 は shisa', () => {
    mockRandom(0.6);
    expect(s.roll()).toBe('shisa');
    mockRandom(0.79);
    expect(s.roll()).toBe('shisa');
  });

  it('0.8<=r<0.9 は quiz', () => {
    mockRandom(0.8);
    expect(s.roll()).toBe('quiz');
  });

  it('0.9<=r は aim', () => {
    mockRandom(0.9);
    expect(s.roll()).toBe('aim');
    mockRandom(0.999);
    expect(s.roll()).toBe('aim');
  });
});

describe('EffectScheduler.setRates', () => {
  it('setRates で抽選分布を切り替えられる（none=1 なら必ず none）', () => {
    const s = new EffectScheduler(DEFAULT_RATES);
    s.setRates({ none: 1, shisa: 0, quiz: 0, aim: 0 });
    mockRandom(0.99);
    expect(s.roll()).toBe('none');
  });

  it('ボーナス中レート（none=0）なら必ず演出が出る（none にならない）', () => {
    const s = new EffectScheduler({ none: 0, shisa: 0.5, quiz: 0.2, aim: 0.3 });
    mockRandom(0.0);
    expect(s.roll()).toBe('shisa'); // r=0<0(none) は偽 → shisa 以降
    mockRandom(0.99);
    expect(s.roll()).toBe('aim');
  });
});

describe('EffectScheduler.rollAvailable', () => {
  it('内部役を表現できる候補だけでレートを正規化する', () => {
    const s = new EffectScheduler({ none: 0.5, shisa: 0.15, quiz: 0.25, aim: 0.1 });
    mockRandom(0.8);
    expect(s.rollAvailable(['shisa', 'aim'])).toBe('aim');
  });

  it('候補に有効な重みがなければnoneへフォールバックする', () => {
    const s = new EffectScheduler({ none: 1, shisa: 0, quiz: 0, aim: 0 });
    expect(s.rollAvailable(['quiz', 'aim'])).toBe('none');
  });
});
