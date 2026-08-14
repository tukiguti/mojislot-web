import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { YakuListSchema, type InternalRoleState } from '../../src/data/schemas';
import {
  SETTINGS,
  applySetting,
  applySettingToEffects,
  dayKey,
  settingFor,
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
        // reg/big は設定差そのもの。miss と single は**その増減の吸収先**なので動く。
        // 〔2026-08-14〕ハズレを1枚役へ統合したため、吸収先が miss から single へ移った。
        // どちらも演出が出ず狙って取る役でもないので、出方から設定は読めないまま。
        if (
          role.kind === 'reg' ||
          role.kind === 'big' ||
          role.kind === 'miss' ||
          role.kind === 'single'
        ) {
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

describe('設定と演出レート', () => {
  const base = { none: 0.5, shisa: 0.15, quiz: 0.25, aim: 0.1 };

  it('設定が高いほど無演出が減る（＝何を狙うか分かるゲームが増える）', () => {
    const nones = SETTINGS.map((s) => applySettingToEffects(base, s).none);
    for (let i = 1; i < nones.length; i++) {
      expect(nones[i], `設定${i + 1}`).toBeLessThan(nones[i - 1]);
    }
  });

  it('合計は常に1（抽選が壊れない）', () => {
    for (const s of SETTINGS) {
      const r = applySettingToEffects(base, s);
      expect(r.none + r.shisa + r.quiz + r.aim, `設定${s}`).toBeCloseTo(1, 9);
    }
  });

  it('演出の種類の比は設定で変わらない', () => {
    // 「今日はクイズが多い＝高設定」のような別の読み筋を作らないため、
    // 動かすのは無演出の割合だけで、示唆・クイズ・狙えの比は保つ。
    const ratio = (r: { shisa: number; quiz: number; aim: number }): number[] => {
      const sum = r.shisa + r.quiz + r.aim;
      return [r.shisa / sum, r.quiz / sum, r.aim / sum];
    };
    const want = ratio(base);
    for (const s of SETTINGS) {
      ratio(applySettingToEffects(base, s)).forEach((v, i) => {
        expect(v, `設定${s} の${i}番目`).toBeCloseTo(want[i], 9);
      });
    }
  });

  it('ボーナス中（無演出0）は設定差が出ない', () => {
    const bonus = { none: 0, shisa: 0.4, quiz: 0.35, aim: 0.25 };
    for (const s of SETTINGS) {
      expect(applySettingToEffects(bonus, s), `設定${s}`).toEqual(bonus);
    }
  });

  it('出現ウェイト込みの加重平均がほぼ1倍（ホール全体の水位が動かない）', () => {
    // 低設定ほど出やすいので、単純に1.0を挟むと平均が低設定側へ寄る。
    const WEIGHT: Record<number, number> = { 1: 30, 2: 24, 3: 18, 4: 14, 5: 9, 6: 5 };
    const total = SETTINGS.reduce((a, s) => a + WEIGHT[s], 0);
    const avg = SETTINGS.reduce(
      (a, s) => a + (applySettingToEffects(base, s).none / base.none) * WEIGHT[s],
      0,
    ) / total;
    expect(avg).toBeCloseTo(1, 2);
  });

  it('元のレートは書き換えない', () => {
    const copy = { ...base };
    applySettingToEffects(base, 6);
    expect(base).toEqual(copy);
  });
});
