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

describe('YakuListSchema internalRoleRate', () => {
  const yakuList = {
    mode: 'test',
    internalRoleMissRate: { default: 0.5, rescue: 0.5, bonus: 0.5 },
    coreYaku: [
      {
        id: 'apple',
        name: 'りんご',
        symbols: ['り', 'ん', 'ご'],
        category: 'core',
        internalRoleKind: 'core',
        internalRoleRate: { default: 0.5, rescue: 0.5, bonus: 0.5 },
      },
    ],
    cherryYaku: [],
    bonusYaku: [],
    premiumYaku: [],
  };

  it('各状態でmissと全具体役の合計が1なら受け入れる', () => {
    expect(YakuListSchema.safeParse(yakuList).success).toBe(true);
  });

  it('どれかの状態で役別確率の合計が1でなければ拒否する', () => {
    const invalid = structuredClone(yakuList);
    invalid.coreYaku[0].internalRoleRate.default = 0.6;
    expect(YakuListSchema.safeParse(invalid).success).toBe(false);
  });

  it.each([
    ['hiragana_food', hiraganaFood],
    ['hiragana_verb', hiraganaVerb],
    ['katakana_animal', katakanaAnimal],
    ['security', security],
    ['yasai', yasai],
  ])('%s章の全役が明示設定され、状態別合計が1になる', (_mode, raw) => {
    expect(YakuListSchema.safeParse(raw).success).toBe(true);
  });
});
