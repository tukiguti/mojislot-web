import { describe, it, expect } from 'vitest';
import {
  drawSignLamp,
  isSignLampMilestone,
  signLampRate,
  type SignLampLevel,
} from '../../src/productions/SignLamp';
import type { Setting } from '../../src/productions/MachineSetting';

const SETTINGS: Setting[] = [1, 2, 3, 4, 5, 6];
const LIT: SignLampLevel[] = ['weak', 'strong'];

describe('看板のランプ（コンボの節目・期待度の軸）', () => {
  it('節目は 5 の倍数だけ', () => {
    expect([1, 4, 5, 6, 9, 10, 15, 20].filter(isSignLampMilestone)).toEqual([5, 10, 15, 20]);
    expect(isSignLampMilestone(0)).toBe(false);
  });

  it('示唆弱・示唆強はどの設定でも出る＝確定にならない', () => {
    for (const s of SETTINGS) {
      for (const l of LIT) {
        expect(signLampRate(l, s), `設定${s}の${l}`).toBeGreaterThan(0);
      }
    }
  });

  it('消灯がどの設定でも最頻', () => {
    for (const s of SETTINGS) {
      const off = signLampRate('off', s);
      expect(off, `設定${s}の消灯`).toBeGreaterThan(0.5);
      for (const l of LIT) expect(off).toBeGreaterThan(signLampRate(l, s));
    }
  });

  it('強い方ほど出ない', () => {
    for (const s of SETTINGS) {
      expect(signLampRate('weak', s)).toBeGreaterThan(signLampRate('strong', s));
    }
  });

  it('光る確率は設定に対して単調に増える', () => {
    for (const l of LIT) {
      for (let i = 1; i < SETTINGS.length; i++) {
        expect(signLampRate(l, SETTINGS[i])).toBeGreaterThan(signLampRate(l, SETTINGS[i - 1]));
      }
    }
  });

  it('抽選は重みどおりに振り分ける', () => {
    // 乱数の端で、先頭（消灯）と末尾（示唆強）に落ちること
    expect(drawSignLamp(6, () => 0)).toBe('off');
    expect(drawSignLamp(6, () => 0.9999)).toBe('strong');
  });
});
