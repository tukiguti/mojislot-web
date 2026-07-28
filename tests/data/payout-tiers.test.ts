import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { YakuListSchema } from '../../src/data/schemas';

/**
 * 小役の枚数配分の監査。
 *
 * 小役4種の払い出しを 2/4/6/8 に散らしてあるのは、**枚数を役の名札にする**ため
 * （設計: 31章）。「6枚が出た＝あの役＝あの位置」と結びつくので、枚数が島ごとに
 * 違うとその手がかりが壊れる。リミックス島は文字がステージごとに変わり、位置と
 * 枚数の対応だけが共通言語として残るので、ここがずれると設計の前提が崩れる。
 *
 * あわせて「出やすい役ほど安い」も見る。小役4だけ当選率が低い（0.099 対 0.132）ので、
 * そこが最高配当でないと枚数の並びが確率と逆行する。
 */

const DIR = dirname(fileURLToPath(import.meta.url));
const DATA = resolve(DIR, '../../data');
const readJson = (p: string) => JSON.parse(readFileSync(p, 'utf-8'));
const CHAPTERS = [
  'hiragana_food',
  'hiragana_verb',
  'katakana_animal',
  'security',
  'yasai',
] as const;

/** 小役の払い出し。位置（coreYaku の並び）と対応する。 */
const CORE_TIERS = [4, 6, 8, 10];

describe('小役の枚数配分', () => {
  for (const chapter of CHAPTERS) {
    const list = YakuListSchema.parse(readJson(`${DATA}/yaku/${chapter}.json`));

    it(`${chapter}: 小役の payout が ${CORE_TIERS.join('/')} 枚`, () => {
      expect(list.coreYaku.map((y) => y.payout)).toEqual(CORE_TIERS);
    });

    it(`${chapter}: 当選率がいちばん低い小役がいちばん高配当`, () => {
      const rate = new Map(
        list.internalRoles
          .filter((r) => r.kind === 'core' && r.displayYakuId)
          .map((r) => [r.displayYakuId as string, r.rate.default]),
      );
      const rarest = [...list.coreYaku].sort(
        (a, b) => (rate.get(a.id) ?? 0) - (rate.get(b.id) ?? 0),
      )[0];
      expect(rarest.payout).toBe(Math.max(...CORE_TIERS));
    });
  }
});
