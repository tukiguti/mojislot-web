import { describe, expect, it } from 'vitest';
import { wrapJapanese } from '../../src/render/QuizQuestionView';
import food from '../../data/quizzes/hiragana_food.json';
import animal from '../../data/quizzes/katakana_animal.json';
import verb from '../../data/quizzes/hiragana_verb.json';
import yasai from '../../data/quizzes/yasai.json';
import security from '../../data/quizzes/security.json';

/** 行の頭に置かない文字（行頭禁則）。 */
const NO_START = /^[？！、。」』）ー…っゃゅょ]/;
/** 行の終わりに置かない文字（開きかっこ）。 */
const NO_END = /[「『（]$/;

describe('wrapJapanese', () => {
  it('「？」だけの行を作らない', () => {
    const text = '地面に穴を掘って巣を作り、危険を感じると後ろ足で地面を叩いて仲間に知らせる小動物は？';
    const lines = wrapJapanese(text, 14).split('\n');
    expect(lines.every((l) => !NO_START.test(l))).toBe(true);
    expect(lines.join('')).toBe(text);
  });

  it('全部のクイズで、文字を落とさず、行の頭に禁則の文字・行の終わりに開きかっこが来ない', () => {
    for (const data of [food, animal, verb, yasai, security]) {
      for (const q of data.quizzes) {
        const lines = wrapJapanese(q.question, 14).split('\n');
        expect(lines.join(''), q.id).toBe(q.question);
        for (const l of lines) {
          expect(NO_START.test(l), `${q.id}: ${l}`).toBe(false);
          expect(NO_END.test(l), `${q.id}: ${l}`).toBe(false);
        }
      }
    }
  });
});
