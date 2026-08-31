import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { ReelConfigSchema } from '../../src/data/schemas';

/**
 * リールのドット文字が全部揃っているかの監査。
 *
 * 図柄の一枚絵はこれが無かったせいで腐った。役を作り直した時に絵だけ前の役のまま
 * 残り、**全テストが通ったまま**寿司島は7枚とも不一致になっていた（2026-08-29に発見）。
 * 26章§7の到達性監査を足した時と同じ構造で、気づく仕組みが無いと静かに壊れる。
 *
 * 編集できること（ドット絵はテキストのマップと生成器で直せる）と、
 * **気づけること**は別の問題で、両方いる。
 *
 * 生成: python3 tools/gen_glyphs.py
 */

const DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(DIR, '../..');
const DATA = resolve(ROOT, 'data');
const GLYPHS = resolve(ROOT, 'public/art/glyphs');
const readJson = (p: string) => JSON.parse(readFileSync(p, 'utf-8'));

const CHAPTERS = [
  'hiragana_food',
  'hiragana_verb',
  'katakana_animal',
  'security',
  'yasai',
] as const;

/**
 * ファイル名は「リール番号＋コードポイント」（src/render/ReelArt.ts の nameOf と対）。
 * 同じ文字でもリールによって属する役の強さが変わり、大きさが違うのでリール別に持つ。
 */
const nameOf = (reel: number, symbol: string): string =>
  `r${reel}_u` +
  [...symbol]
    .map((c) => (c.codePointAt(0) ?? 0).toString(16).padStart(4, '0'))
    .join('-');

describe('リールのドット文字', () => {
  for (const chapter of CHAPTERS) {
    const cfg = ReelConfigSchema.parse(readJson(`${DATA}/reels/${chapter}.json`));
    const used = cfg.reels.flatMap((r, reel) =>
      [...new Set(r.cells)].map((s) => ({ reel, s })),
    );

    it(`${chapter}: 配列の全${used.length}枚（リール別）にドット文字がある`, () => {
      const missing = used
        .filter(({ reel, s }) => !existsSync(resolve(GLYPHS, chapter, `${nameOf(reel, s)}.png`)))
        .map(({ reel, s }) => `${reel}:${s}`);
      expect(missing, `不足: ${missing.join(' ')}`).toEqual([]);
    });

    // 逆向きも見る。配列から消えた文字の絵が残っていると、次に配列を触った人が
    // 「もう作ってある」と誤解する。図柄画像が腐った時もこれが残っていた
    it(`${chapter}: 配列に無い文字のドット文字が残っていない`, () => {
      const want = new Set(used.map(({ reel, s }) => nameOf(reel, s)));
      const have = readdirSync(resolve(GLYPHS, chapter))
        .filter((f) => f.endsWith('.png'))
        .map((f) => f.replace(/\.png$/, ''));
      const stale = have.filter((h) => !want.has(h));
      expect(stale, `余分: ${stale.join(' ')}`).toEqual([]);
    });
  }
});
