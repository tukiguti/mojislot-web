import { describe, expect, it } from 'vitest';
import { EffectRatesSchema } from '../../src/data/schemas';

describe('EffectRatesSchema', () => {
  it('合計1の演出レートを受け入れる', () => {
    expect(
      EffectRatesSchema.safeParse({ none: 0.5, shisa: 0.15, quiz: 0.25, aim: 0.1 })
        .success,
    ).toBe(true);
  });

  it('合計が1でない演出レートを拒否する', () => {
    const result = EffectRatesSchema.safeParse({
      none: 0.5,
      shisa: 0.15,
      quiz: 0.25,
      aim: 0.2,
    });
    expect(result.success).toBe(false);
  });
});
