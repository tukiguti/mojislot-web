import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  DATA_VERSION,
  EffectRatesSchema,
  PayoutSchema,
  QuizListSchema,
  QuizmasterLinesSchema,
  ReelConfigSchema,
  StopTableSchema,
  TuningSchema,
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
    dataVersion: 1,
    mode: 'test',
    coreYaku: [
      { id: 'apple', name: 'りんご', symbols: ['り', 'ん', 'ご'], category: 'core', payout: 5 },
    ],
    cherryYaku: [],
    bonusYaku: [],
    premiumYaku: [],
    internalRoles: [
      { id: 'miss', kind: 'miss', displayYakuId: null, rate: rate(0.4) },
      { id: 'single', kind: 'single', displayYakuId: null, rate: rate(0.2) },
      { id: 'apple', kind: 'core', displayYakuId: 'apple', rate: rate(0.2) },
      {
        id: 'apple_l',
        kind: 'core',
        displayYakuId: 'apple',
        rate: rate(0.1),
      },
      {
        id: 'apple_exact',
        kind: 'core',
        displayYakuId: 'apple',
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

  // 小役は4種を枚数で区別する（4/6/8/10）ので、カテゴリ既定では表せない。
  // ここが緩むと baseMultiplier に小役の共通枠が戻り、「枚数が役の名札」が崩れる。
  it('payout を持たない小役は拒否する', () => {
    const invalid = structuredClone(yakuList);
    delete (invalid.coreYaku[0] as { payout?: number }).payout;
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

/**
 * データ版（dataVersion）。data/ の JSON はすべて版を持ち、読み込み時に検証する。
 * 形式を変えたのに古いファイルが残っていると、黙って別の意味に読まずにここで止まる。
 */
describe('データ版', () => {
  const DATA = resolve(dirname(fileURLToPath(import.meta.url)), '../../data');
  const read = (p: string) => JSON.parse(readFileSync(`${DATA}/${p}`, 'utf-8'));
  const cases = [
    ['reels/hiragana_food.json', ReelConfigSchema, DATA_VERSION.reels],
    ['yaku/hiragana_food.json', YakuListSchema, DATA_VERSION.yaku],
    ['quizzes/hiragana_food.json', QuizListSchema, DATA_VERSION.quizzes],
    ['stops/hiragana_food.json', StopTableSchema, DATA_VERSION.stops],
    ['payouts/default.json', PayoutSchema, DATA_VERSION.payouts],
    ['tuning/default.json', TuningSchema, DATA_VERSION.tuning],
    ['quizmaster-lines.json', QuizmasterLinesSchema, DATA_VERSION.quizmasterLines],
  ] as const;

  it.each(cases)('%s は今の版で読める', (path, schema, version) => {
    const raw = read(path);
    expect(raw.dataVersion).toBe(version);
    expect(schema.safeParse(raw).success).toBe(true);
  });

  it.each(cases)('%s は版が無い・違うと拒否し、理由に dataVersion を出す', (path, schema, version) => {
    const raw = read(path);
    for (const bad of [undefined, version + 1]) {
      const r = schema.safeParse({ ...raw, dataVersion: bad });
      expect(r.success).toBe(false);
      const issue = r.error!.issues.find((i) => i.path[0] === 'dataVersion');
      expect(issue?.message).toContain('dataVersion');
    }
  });
});
