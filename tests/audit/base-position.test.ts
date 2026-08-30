import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { YakuListSchema, ReelConfigSchema, TuningSchema } from '../../src/data/schemas';

/**
 * **基準となる押下位置**の監査。
 *
 * 実機の「左枠上に赤7を狙え」と同じで、そこを押せばボーナスもチェリーも取りこぼさない
 * 位置を作ってある。遅れが出た時に「ボーナスかチェリーか分からないから、どちらを
 * 狙えばいいか決まらない」という状態を無くすため。
 *
 * BIG1用とBIG2用の2箇所（どちらを狙ってもよい）。REGはBIG1と頭2文字を共有するので
 * BIG1の基準位置で拾える。3つとも届く位置が多すぎると「どこを押しても拾える」に
 * なって打ち方を覚える価値が無くなるので、そちらには上限を置く。
 *
 * 焼きなましの目的関数にも同じ制約が入っているが、配列は手で書き換えてもよいので
 * ここでも見る（気づける仕組みが無いと静かに壊れる）。
 */

const DIR = dirname(fileURLToPath(import.meta.url));
const DATA = resolve(DIR, '../../data');
const readJson = (p: string) => JSON.parse(readFileSync(p, 'utf-8'));
const CHAPTERS = ['hiragana_food', 'hiragana_verb', 'katakana_animal', 'security', 'yasai'] as const;
/** 3つとも届く押下位置の上限。 */
const MAX_ALL = 3;

describe('基準となる押下位置', () => {
  const pull = TuningSchema.parse(readJson(`${DATA}/tuning/default.json`)).assist.pullInCells;

  for (const chapter of CHAPTERS) {
    const yakuList = YakuListSchema.parse(readJson(`${DATA}/yaku/${chapter}.json`));
    const reels = ReelConfigSchema.parse(readJson(`${DATA}/reels/${chapter}.json`)).reels.map(
      (r) => r.cells,
    );
    const bigs = yakuList.premiumYaku.slice(0, 2);
    const cherry = yakuList.cherryYaku[0];

    for (const reel of [0, 1]) {
      const n = reels[reel].length;
      const reachAt = (press: number): Set<string> =>
        new Set(Array.from({ length: pull + 1 }, (_, s) => reels[reel][(press + s) % n]));
      const cs = cherry?.symbols[reel];
      const posFor = (sym: string | undefined): number[] =>
        sym === undefined
          ? []
          : Array.from({ length: n }, (_, p) => p).filter((p) => {
              const w = reachAt(p);
              return w.has(sym) && (cs === undefined || w.has(cs));
            });

      it(`${chapter}: 第${reel + 1}リールに BIG ごとの基準位置がある`, () => {
        for (const b of bigs) {
          expect(
            posFor(b.symbols[reel]).length,
            `${b.name}(${b.symbols[reel]})とチェリー(${cs})が同時に届く押下位置`,
          ).toBeGreaterThan(0);
        }
      });

      it(`${chapter}: 第${reel + 1}リールで全部届く位置が${MAX_ALL}箇所以下`, () => {
        const all = Array.from({ length: n }, (_, p) => p).filter((p) => {
          const w = reachAt(p);
          return (
            bigs.every((b) => b.symbols[reel] !== undefined && w.has(b.symbols[reel]!)) &&
            (cs === undefined || w.has(cs))
          );
        });
        expect(all.length, `どこを押しても拾えると打ち方を覚える価値が無くなる`).toBeLessThanOrEqual(MAX_ALL);
      });
    }
  }
});
