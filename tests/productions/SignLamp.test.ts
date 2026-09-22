import { describe, it, expect } from 'vitest';
import {
  drawSignLamp,
  isSignLampMilestone,
  signLampRate,
  SIGN_LAMP_LEVELS,
  type SignLampLevel,
} from '../../src/productions/SignLamp';
import type { Setting } from '../../src/productions/MachineSetting';

const SETTINGS: Setting[] = [1, 2, 3, 4, 5, 6];
const LIT = SIGN_LAMP_LEVELS.filter((l) => l !== 'off');
/** 期待度の色。設定に対して単調に増える。 */
const RISING: SignLampLevel[] = ['white', 'red', 'rainbow'];

describe('看板のランプ（コンボの節目の設定示唆）', () => {
  it('節目は 5 の倍数だけ', () => {
    expect([1, 4, 5, 6, 9, 10, 15, 20].filter(isSignLampMilestone)).toEqual([5, 10, 15, 20]);
    expect(isSignLampMilestone(0)).toBe(false);
  });

  it('設定ごとの確率は合計1', () => {
    for (const s of SETTINGS) {
      const sum = SIGN_LAMP_LEVELS.reduce((a, l) => a + signLampRate(l, s), 0);
      expect(sum).toBeCloseTo(1, 10);
    }
  });

  it('どの色もどの設定でも出る＝確定にならない', () => {
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

  it('期待度の色（白・赤・虹）は設定に対して単調に増え、強いほど出ない', () => {
    for (const l of RISING) {
      for (let i = 1; i < SETTINGS.length; i++) {
        expect(signLampRate(l, SETTINGS[i]), `${l} 設定${SETTINGS[i]}`).toBeGreaterThan(
          signLampRate(l, SETTINGS[i - 1]),
        );
      }
    }
    for (const s of SETTINGS) {
      expect(signLampRate('white', s)).toBeGreaterThan(signLampRate('red', s));
      expect(signLampRate('red', s)).toBeGreaterThan(signLampRate('rainbow', s));
    }
  });

  it('青は偶数設定、黄は奇数設定で出やすい（隣の設定と比べて）', () => {
    for (const s of SETTINGS) {
      for (const n of SETTINGS.filter((x) => Math.abs(x - s) === 1)) {
        const even = s % 2 === 0;
        if (even) {
          expect(signLampRate('blue', s), `青 設定${s} > 設定${n}`).toBeGreaterThan(signLampRate('blue', n));
          expect(signLampRate('yellow', s), `黄 設定${s} < 設定${n}`).toBeLessThan(signLampRate('yellow', n));
        }
      }
    }
  });

  it('抽選は重みどおりに振り分ける', () => {
    expect(drawSignLamp(6, () => 0)).toBe('off');
    expect(drawSignLamp(6, () => 0.9999)).toBe('rainbow');
  });
});
