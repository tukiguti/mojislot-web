import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { YakuListSchema, type InternalRoleState } from '../../src/data/schemas';
import {
  applySetting,
  dayKey,
  settingFor,
  SETTINGS,
} from '../../src/productions/MachineSetting';

/**
 * 設定は**推測して遊ぶもの**なので、次が崩れると遊びが成立しない：
 *  - 打っている間は変わらない（リロードしても同じ）
 *  - 台ごとに違う
 *  - 小役では差が出ない（数百ゲームで見抜けてしまう）
 *  - 抽選が壊れない（レート合計は常に1）
 */

const DIR = dirname(fileURLToPath(import.meta.url));
const DATA = resolve(DIR, '../../data');
const yakuList = YakuListSchema.parse(
  JSON.parse(readFileSync(`${DATA}/yaku/hiragana_food.json`, 'utf-8')),
);

const STATES: InternalRoleState[] = ['default', 'rescue', 'bonus'];
const sum = (list: typeof yakuList, state: InternalRoleState): number =>
  list.internalRoles.reduce((a, r) => a + r.rate[state], 0);
const bonusRate = (list: typeof yakuList, state: InternalRoleState): number =>
  list.internalRoles
    .filter((r) => r.kind === 'reg' || r.kind === 'big')
    .reduce((a, r) => a + r.rate[state], 0);

describe('MachineSetting', () => {
  it('同じ日・同じ台なら常に同じ設定（リロードで推測が壊れない）', () => {
    const d = new Date(2026, 6, 27, 13, 45);
    const a = settingFor('hiragana_food', d);
    const b = settingFor('hiragana_food', new Date(2026, 6, 27, 23, 59));
    expect(a).toBe(b);
  });

  it('同じ日でも台が違えば設定は独立して決まる', () => {
    const d = new Date(2026, 6, 27);
    const byChapter = ['hiragana_food', 'katakana_animal', 'security', 'yasai']
      .map((c) => settingFor(c, d));
    // 全台が同じ値になったら「選ぶ意味がない」ので、少なくとも2種類は出てほしい
    expect(new Set(byChapter).size).toBeGreaterThan(1);
  });

  it('日付が変われば設定も変わりうる（ずっと同じではない）', () => {
    const days = Array.from({ length: 30 }, (_, i) =>
      settingFor('hiragana_food', new Date(2026, 6, 1 + i)),
    );
    expect(new Set(days).size).toBeGreaterThan(1);
  });

  it('dayKey は時刻を含まない（日付が変わるまで同じ）', () => {
    expect(dayKey(new Date(2026, 6, 27, 0, 0))).toBe('2026-07-27');
    expect(dayKey(new Date(2026, 6, 27, 23, 59))).toBe('2026-07-27');
  });

  it.each(SETTINGS)('設定%iでもレート合計は1のまま', (setting) => {
    const applied = applySetting(yakuList, setting);
    for (const state of STATES) {
      expect(sum(applied, state)).toBeCloseTo(1, 9);
    }
  });

  it('設定が高いほどボーナス当選率が上がる', () => {
    const rates = SETTINGS.map((s) => bonusRate(applySetting(yakuList, s), 'default'));
    for (let i = 1; i < rates.length; i++) {
      expect(rates[i]).toBeGreaterThan(rates[i - 1]);
    }
  });

  it('小役の当選率は設定で変わらない（出方から設定を読めない）', () => {
    const low = applySetting(yakuList, 1);
    const high = applySetting(yakuList, 6);
    for (const state of STATES) {
      for (const role of low.internalRoles) {
        if (role.kind === 'reg' || role.kind === 'big' || role.kind === 'miss') {
          continue;
        }
        const other = high.internalRoles.find((r) => r.id === role.id)!;
        expect(other.rate[state], `${role.id}/${state}`).toBe(role.rate[state]);
      }
    }
  });

  it('ボーナス中は設定差を付けない（引いた後は結果論にしない）', () => {
    const low = applySetting(yakuList, 1);
    const high = applySetting(yakuList, 6);
    expect(bonusRate(high, 'bonus')).toBe(bonusRate(low, 'bonus'));
  });

  it('元の役リストは書き換えない', () => {
    const before = bonusRate(yakuList, 'default');
    applySetting(yakuList, 6);
    expect(bonusRate(yakuList, 'default')).toBe(before);
  });
});
