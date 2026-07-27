import { describe, expect, it } from 'vitest';
import {
  drawEndScreen,
  possibleSettings,
  type EndScreenKind,
} from '../../src/productions/SettingHint';
import { SETTINGS, type Setting } from '../../src/productions/MachineSetting';

/**
 * 示唆は「出たら意味がある／出なくても否定にならない」という非対称で成り立つ。
 * ここが崩れると示唆が**嘘をつく**——出ない設定で出てしまえば読みが破綻し、
 * 通常画面が高設定で出なくなれば「出なかった＝低設定」と読めてしまう。
 */

/** 設定 s で1万回引いて、種別ごとの出現数を数える。 */
function tally(setting: Setting): Record<EndScreenKind, number> {
  const counts = { normal: 0, gold: 0, even: 0, high: 0, max: 0 };
  // 決定的な擬似乱数（テストが揺れないように）
  let seed = 12345;
  const rand = (): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let i = 0; i < 10000; i++) counts[drawEndScreen(setting, rand).kind]++;
  return counts;
}

const TALLIES = new Map(SETTINGS.map((s) => [s, tally(s)]));

describe('SettingHint（ボーナス終了画面）', () => {
  it('偶数示唆は偶数設定でしか出ない', () => {
    expect(possibleSettings('even')).toEqual([2, 4, 6]);
    for (const s of [1, 3, 5] as Setting[]) {
      expect(TALLIES.get(s)!.even, `設定${s}`).toBe(0);
    }
  });

  it('設定4以上示唆は4・5・6でしか出ない', () => {
    expect(possibleSettings('high')).toEqual([4, 5, 6]);
    for (const s of [1, 2, 3] as Setting[]) {
      expect(TALLIES.get(s)!.high, `設定${s}`).toBe(0);
    }
  });

  it('最高設定確定は設定6でしか出ない', () => {
    expect(possibleSettings('max')).toEqual([6]);
    for (const s of [1, 2, 3, 4, 5] as Setting[]) {
      expect(TALLIES.get(s)!.max, `設定${s}`).toBe(0);
    }
  });

  it('通常画面はどの設定でも最頻出（出なかった＝低設定にはしない）', () => {
    for (const s of SETTINGS) {
      const t = TALLIES.get(s)!;
      const others = t.gold + t.even + t.high + t.max;
      expect(t.normal, `設定${s}`).toBeGreaterThan(others);
      // 設定6でも通常画面が半分以上＝1回の終了で決めつけられない
      expect(t.normal / 10000, `設定${s}`).toBeGreaterThan(0.5);
    }
  });

  it('強い示唆ほど出ない（設定6でも最高設定確定は数％）', () => {
    const t = TALLIES.get(6)!;
    expect(t.max).toBeLessThan(t.high);
    expect(t.high).toBeLessThan(t.gold);
    expect(t.max / 10000).toBeLessThan(0.06);
  });

  it('弱い示唆は高設定ほど出やすい', () => {
    // 隣り合う設定では逆転しうるので、下位2つと上位2つの平均で比べる
    const low = (TALLIES.get(1)!.gold + TALLIES.get(2)!.gold) / 2;
    const high = (TALLIES.get(5)!.gold + TALLIES.get(6)!.gold) / 2;
    expect(high).toBeGreaterThan(low);
  });

  it('何らかの示唆が出る確率は高設定ほど高い', () => {
    const anyHint = (s: Setting): number => {
      const t = TALLIES.get(s)!;
      return t.gold + t.even + t.high + t.max;
    };
    expect(anyHint(6)).toBeGreaterThan(anyHint(3));
    expect(anyHint(3)).toBeGreaterThan(anyHint(1));
  });

  it('通常画面には文言を出さない（毎回何か出ると示唆が薄まる）', () => {
    let seed = 1;
    const rand = (): number => {
      seed = (seed * 48271) % 2147483647;
      return seed / 2147483647;
    };
    for (let i = 0; i < 2000; i++) {
      const s = drawEndScreen(6, rand);
      if (s.kind === 'normal') expect(s.label).toBe('');
      else expect(s.label.length).toBeGreaterThan(0);
    }
  });
});
