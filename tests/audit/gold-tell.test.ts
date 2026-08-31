import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { YakuListSchema, ReelConfigSchema, TuningSchema } from '../../src/data/schemas';

/**
 * **金示唆が成立する配置か**の監査。
 *
 * 金示唆は「BIG1かREGか」の2択を伝える。頭2文字はBIG1とREGで共通なので
 * （しゃけ／しゃこ）、**第3リールだけがどちらかを決める**。ここで2つの図柄が
 * 離れていると、押した位置で片方しか狙えない——2択を待つ体験そのものが消える。
 *
 * 実機のジャグラーで7とBARが隣接していて、滑りがフラグ側へ振り分けるのと同じ形。
 * **1箇所押せば制御が決めてくれる**位置を残しておく。
 *
 * 焼きなましの目的関数にも同じ制約が入っているが、配列は手で書き換えてもよいので
 * ここでも見る（気づける仕組みが無いと静かに壊れる）。
 */

const DIR = dirname(fileURLToPath(import.meta.url));
const DATA = resolve(DIR, '../../data');
const readJson = (p: string) => JSON.parse(readFileSync(p, 'utf-8'));
const CHAPTERS = ['hiragana_food', 'hiragana_verb', 'katakana_animal', 'security', 'yasai'] as const;
/** 両方引き込める押下位置の下限（optimize-reels の GOLD_TELL_MIN と対）。 */
const MIN_BOTH = 2;

describe('金示唆（BIG1とREGの2択）が成立する配置', () => {
  const pull = TuningSchema.parse(readJson(`${DATA}/tuning/default.json`)).assist.pullInCells;

  for (const chapter of CHAPTERS) {
    const yakuList = YakuListSchema.parse(readJson(`${DATA}/yaku/${chapter}.json`));
    const cells = ReelConfigSchema.parse(readJson(`${DATA}/reels/${chapter}.json`)).reels[2].cells;
    const n = cells.length;
    const big1 = yakuList.premiumYaku[0]?.symbols[2];
    const reg = yakuList.bonusYaku[0]?.symbols[2];

    it(`${chapter}: 第3リールでBIG1とREGが別の文字`, () => {
      // 同じ文字だと第3リールが2択を決められない＝金示唆が意味を持たない
      expect(big1).toBeDefined();
      expect(reg).toBeDefined();
      expect(big1).not.toBe(reg);
    });

    it(`${chapter}: 両方引き込める押下位置が${MIN_BOTH}箇所以上ある`, () => {
      const both = Array.from({ length: n }, (_, p) => p).filter((p) => {
        const w = new Set(Array.from({ length: pull + 1 }, (_, s) => cells[(p + s) % n]));
        return w.has(big1!) && w.has(reg!);
      });
      expect(
        both.length,
        `BIG1(${big1})とREG(${reg})が同時に届く押下位置: [${both.join(', ')}]`,
      ).toBeGreaterThanOrEqual(MIN_BOTH);
    });
  }
});
