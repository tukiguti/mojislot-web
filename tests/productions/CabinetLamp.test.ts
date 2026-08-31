import { describe, it, expect } from 'vitest';
import { drawCabinetLamp, lampRate, type LampColor } from '../../src/productions/CabinetLamp';
import type { Setting } from '../../src/productions/MachineSetting';

const SETTINGS: Setting[] = [1, 2, 3, 4, 5, 6];
const LIT: LampColor[] = ['blue', 'yellow', 'red'];

describe('筐体ランプ（設定示唆・期待度の軸）', () => {
  it('どの色もどの設定でも出る＝確定にならない', () => {
    // 0を作った時点でその色は「設定◯以上確定」になり、終了画面が持っている
    // 確定の軸と重なる。ここは期待度専用に保つ。
    for (const s of SETTINGS) {
      for (const c of LIT) {
        expect(lampRate(c, s), `設定${s}の${c}`).toBeGreaterThan(0);
      }
    }
  });

  it('消灯がどの設定でも最頻＝出なくても低設定とは限らない', () => {
    for (const s of SETTINGS) {
      const off = lampRate('off', s);
      expect(off, `設定${s}の消灯`).toBeGreaterThan(0.5);
      for (const c of LIT) expect(off).toBeGreaterThan(lampRate(c, s));
    }
  });

  it('強い色ほど出ない', () => {
    for (const s of SETTINGS) {
      expect(lampRate('blue', s)).toBeGreaterThan(lampRate('yellow', s));
      expect(lampRate('yellow', s)).toBeGreaterThan(lampRate('red', s));
    }
  });

  it('設定が上がるほど点灯しやすく、色も強くなる（単調）', () => {
    for (let i = 1; i < SETTINGS.length; i++) {
      const lo = SETTINGS[i - 1];
      const hi = SETTINGS[i];
      expect(lampRate('off', hi), `設定${lo}→${hi}の消灯`).toBeLessThan(lampRate('off', lo));
      for (const c of LIT) {
        expect(lampRate(c, hi), `設定${lo}→${hi}の${c}`).toBeGreaterThan(lampRate(c, lo));
      }
    }
  });

  it('赤は設定6でも滅多に出ないが、設定1との差は大きい', () => {
    expect(lampRate('red', 6)).toBeLessThan(0.1);
    expect(lampRate('red', 6) / lampRate('red', 1)).toBeGreaterThan(5);
  });

  it('抽選が重みどおりに散る', () => {
    // 決定的な擬似乱数で回して、経験頻度が重みへ寄ることを見る
    let seed = 12345;
    const rand = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const n = 200_000;
    const count: Record<string, number> = { off: 0, blue: 0, yellow: 0, red: 0 };
    for (let i = 0; i < n; i++) count[drawCabinetLamp(6, rand).color] += 1;
    for (const c of ['off', ...LIT] as LampColor[]) {
      expect(Math.abs(count[c] / n - lampRate(c, 6)), c).toBeLessThan(0.01);
    }
  });
});
