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

    // 枚数が上がるほど当選率が下がる、が**どの状態でも**成り立つこと。
    // 以前はボーナス中だけ 8枚が 4枚と同率で最頻になっており、階段と逆行していた
    // （通常時しか見ていなかったので検出できなかった）。
    for (const state of ['default', 'rescue', 'bonus'] as const) {
      it(`${chapter}: ${state} で枚数が高い小役ほど当選率が低い`, () => {
        const rate = new Map(
          list.internalRoles
            .filter((r) => r.kind === 'core' && r.displayYakuId)
            .map((r) => [r.displayYakuId as string, r.rate[state]]),
        );
        const rates = list.coreYaku.map((y) => rate.get(y.id) ?? 0);
        if (rates.every((r) => r === 0)) return; // その状態で小役を引かない章
        for (let i = 1; i < rates.length; i++) {
          expect(
            rates[i],
            `${list.coreYaku[i].name}(${CORE_TIERS[i]}枚) が ` +
              `${list.coreYaku[i - 1].name}(${CORE_TIERS[i - 1]}枚) より出やすい`,
          ).toBeLessThan(rates[i - 1]);
        }
      });
    }
  }
});
