import { describe, expect, it } from 'vitest';
import {
  EffectRatesSchema,
  InternalRoleRatesSchema,
} from '../../src/data/schemas';

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

describe('InternalRoleRatesSchema', () => {
  it('合計1の内部役レートを受け入れる', () => {
    expect(
      InternalRoleRatesSchema.safeParse({
        miss: 0.5,
        replay: 0.1,
        core: 0.31,
        cherry: 0.05,
        reg: 0.03,
        big: 0.01,
      }).success,
    ).toBe(true);
  });

  it('合計が1でない内部役レートを拒否する', () => {
    expect(
      InternalRoleRatesSchema.safeParse({
        miss: 0.5,
        replay: 0.1,
        core: 0.4,
        cherry: 0.05,
        reg: 0.03,
        big: 0.01,
      }).success,
    ).toBe(false);
  });
});
