import { describe, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { ReelConfigSchema } from '../../src/data/schemas';

/**
 * リールを回転させて、主ラインを別の形へ移す。
 *
 *   SHIFT=1 SHIFT_BY=0,1,2 npx vitest run tests/tools/shift-reels.test.ts --disable-console-intercept
 *
 * リールは円環なので、主ラインの形を変えることは各リールを何コマか回すのと等価。
 * 「主ライン上にどの3文字が並ぶか」の組み合わせは完全に保存されるので、
 * 焼きなましのやり直しなしに主ラインを移せる。
 *
 * 例）右上がり（左下・中中・右上）→ 下段（左下・中下・右下）:
 *   左はそのまま、中は1コマ、右は2コマ進める ＝ SHIFT_BY=0,1,2
 *
 * **他のラインの組み合わせは変わる**ので、②の監査は必ず回し直すこと。
 */

const RUN = process.env.SHIFT === '1';
const DIR = dirname(fileURLToPath(import.meta.url));
const DATA = resolve(DIR, '../../data');
const readJson = (p: string) => JSON.parse(readFileSync(p, 'utf-8'));
const CHAPTERS = ['hiragana_food', 'hiragana_verb', 'katakana_animal', 'security', 'yasai'];

describe.skipIf(!RUN)('リールの回転', () => {
  it('主ラインを保ったままリールをずらして書き出す', () => {
    const by = (process.env.SHIFT_BY ?? '0,1,2').split(',').map(Number);
    console.log(`シフト量: 左${by[0]} 中${by[1]} 右${by[2]} コマ`);
    for (const chapter of CHAPTERS) {
      const cfg = ReelConfigSchema.parse(readJson(`${DATA}/reels/${chapter}.json`));
      const shifted = cfg.reels.map((r, i) => {
        const n = r.cells.length;
        const d = ((by[i] % n) + n) % n;
        // cells'[k] = cells[k + d] （前方向へ d コマ進める）
        return { id: r.id, cells: r.cells.map((_, k) => r.cells[(k + d) % n]) };
      });
      const lines = ['{', `  "mode": "${chapter}",`, '  "reels": ['];
      shifted.forEach((r, i) => {
        const arr = r.cells.map((c) => `"${c}"`).join(', ');
        lines.push('    {', `      "id": "${r.id}",`, `      "cells": [${arr}]`,
          i < shifted.length - 1 ? '    },' : '    }');
      });
      lines.push('  ]', '}');
      writeFileSync(`${DATA}/reels/${chapter}.json`, `${lines.join('\n')}\n`, 'utf-8');
      console.log(`  ${chapter}: 書き出した`);
    }
  });
});
