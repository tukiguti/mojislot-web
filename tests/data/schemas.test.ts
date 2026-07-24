import { describe, expect, it } from 'vitest';
import {
  EffectRatesSchema,
  YakuListSchema,
} from '../../src/data/schemas';
import hiraganaFood from '../../data/yaku/hiragana_food.json';
import hiraganaVerb from '../../data/yaku/hiragana_verb.json';
import katakanaAnimal from '../../data/yaku/katakana_animal.json';
import security from '../../data/yaku/security.json';
import yasai from '../../data/yaku/yasai.json';

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

describe('YakuListSchema internalRoles', () => {
  const rate = (v: number) => ({ default: v, rescue: v, bonus: v });
  const yakuList = {
    mode: 'test',
    coreYaku: [
      { id: 'apple', name: 'りんご', symbols: ['り', 'ん', 'ご'], category: 'core' },
    ],
    cherryYaku: [],
    bonusYaku: [],
    premiumYaku: [],
    internalRoles: [
      { id: 'miss', kind: 'miss', displayYakuId: null, pressOrder: null, rate: rate(0.4) },
      { id: 'single', kind: 'single', displayYakuId: null, pressOrder: null, rate: rate(0.2) },
      { id: 'apple', kind: 'core', displayYakuId: 'apple', pressOrder: null, rate: rate(0.2) },
      {
        id: 'apple_l',
        kind: 'core',
        displayYakuId: 'apple',
        pressOrder: { type: 'first', reel: 0 },
        rate: rate(0.1),
      },
      {
        id: 'apple_exact',
        kind: 'core',
        displayYakuId: 'apple',
        pressOrder: { type: 'exact', order: [2, 1, 0] },
        rate: rate(0.1),
      },
    ],
  };

  it('各状態で内部役の合計が1なら受け入れる', () => {
    expect(YakuListSchema.safeParse(yakuList).success).toBe(true);
  });

  it('どれかの状態で内部役の合計が1でなければ拒否する', () => {
    const invalid = structuredClone(yakuList);
    invalid.internalRoles[0].rate.default = 0.6;
    expect(YakuListSchema.safeParse(invalid).success).toBe(false);
  });

  it('存在しない表示役を参照する内部役は拒否する', () => {
    const invalid = structuredClone(yakuList);
    invalid.internalRoles[2].displayYakuId = 'nope';
    expect(YakuListSchema.safeParse(invalid).success).toBe(false);
  });

  it('miss / single は表示役を持てない', () => {
    const invalid = structuredClone(yakuList);
    invalid.internalRoles[1].displayYakuId = 'apple';
    expect(YakuListSchema.safeParse(invalid).success).toBe(false);
  });

  it('core などの内部役には表示役が必須', () => {
    const invalid = structuredClone(yakuList);
    invalid.internalRoles[2].displayYakuId = null;
    expect(YakuListSchema.safeParse(invalid).success).toBe(false);
  });

  it.each([
    ['hiragana_food', hiraganaFood],
    ['hiragana_verb', hiraganaVerb],
    ['katakana_animal', katakanaAnimal],
    ['security', security],
    ['yasai', yasai],
  ])('%s章の内部役テーブルが妥当で、状態別合計が1になる', (_mode, raw) => {
    expect(YakuListSchema.safeParse(raw).success).toBe(true);
  });
});
