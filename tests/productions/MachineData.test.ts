import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GRAPH_POINTS,
  archiveStaleDays,
  bonusRate,
  readAllMachineDays,
  readMachineDay,
  readMachineHistory,
  recordSpin,
} from '../../src/productions/MachineData';

/**
 * データカウンターは**設定を推測するための唯一の客観的な材料**なので、
 * 数え方が狂うと台選びの遊びそのものが壊れる。
 *
 * とくにスランプグラフは「点が上限を超えたら間引いて間隔を倍にする」という
 * 非自明な畳み込みをしている。ここが壊れると、グラフが今日の一部しか映さなく
 * なる（見た目は正常なまま嘘をつく）ので、テストで押さえておく。
 */

const DAY = new Date(2026, 6, 30, 12, 0, 0);
const OTHER_DAY = new Date(2026, 6, 31, 12, 0, 0);

/** 通常ゲーム（3枚掛けで払い出しなし＝差枚 −3）。 */
const miss = { bet: 3, win: 0, bonus: null } as const;

/** node 環境なので localStorage を差し替える（RunHistory のテストと同じ手）。 */
function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}

beforeEach(() => vi.stubGlobal('localStorage', memoryStorage()));
afterEach(() => vi.unstubAllGlobals());

describe('日ごとの集計', () => {
  it('回転数・BB・RB・差枚を積み上げる', () => {
    recordSpin('m11', DAY, { bet: 3, win: 0, bonus: null });
    recordSpin('m11', DAY, { bet: 3, win: 15, bonus: 'big' });
    recordSpin('m11', DAY, { bet: 3, win: 10, bonus: 'reg' });
    const d = readMachineDay('m11', DAY);
    expect(d.spins).toBe(3);
    expect(d.big).toBe(1);
    expect(d.reg).toBe(1);
    expect(d.sahmai).toBe(-3 + 12 + 7);
  });

  it('ハマりはボーナスで0に戻る', () => {
    for (let i = 0; i < 40; i++) recordSpin('m11', DAY, miss);
    expect(readMachineDay('m11', DAY).sinceBonus).toBe(40);
    recordSpin('m11', DAY, { bet: 3, win: 15, bonus: 'big' });
    expect(readMachineDay('m11', DAY).sinceBonus).toBe(0);
  });

  it('日付が変わると0から数え直す', () => {
    for (let i = 0; i < 10; i++) recordSpin('m11', DAY, miss);
    expect(readMachineDay('m11', DAY).spins).toBe(10);
    expect(readMachineDay('m11', OTHER_DAY).spins).toBe(0);
  });

  it('台ごとに独立して数える（同じ島の別の台と混ざらない）', () => {
    for (let i = 0; i < 5; i++) recordSpin('m11', DAY, miss);
    for (let i = 0; i < 9; i++) recordSpin('m12', DAY, miss);
    const all = readAllMachineDays(['m11', 'm12', 'm13'], DAY);
    expect(all.get('m11')?.spins).toBe(5);
    expect(all.get('m12')?.spins).toBe(9);
    expect(all.get('m13')?.spins).toBe(0);
  });

  it('ボーナスを引くまで合成確率は出さない', () => {
    for (let i = 0; i < 20; i++) recordSpin('m11', DAY, miss);
    expect(bonusRate(readMachineDay('m11', DAY))).toBeNull();
    recordSpin('m11', DAY, { bet: 3, win: 15, bonus: 'big' });
    expect(bonusRate(readMachineDay('m11', DAY))).toBeCloseTo(21);
  });
});

describe('スランプグラフの点', () => {
  const spin = (n: number): void => {
    for (let i = 0; i < n; i++) recordSpin('m11', DAY, miss);
  };

  it('記録間隔ごとに1点ずつ増える', () => {
    spin(24);
    expect(readMachineDay('m11', DAY).samples).toHaveLength(0);
    spin(1); // 25ゲーム目
    expect(readMachineDay('m11', DAY).samples).toHaveLength(1);
    spin(25);
    expect(readMachineDay('m11', DAY).samples).toHaveLength(2);
  });

  it('詰まったら1つ置きに間引いて間隔を倍にする', () => {
    spin(GRAPH_POINTS * 25); // ちょうど26点
    expect(readMachineDay('m11', DAY).samples).toHaveLength(GRAPH_POINTS);
    expect(readMachineDay('m11', DAY).sampleEvery).toBe(25);

    spin(25); // 次の切れ目で溢れる → 足す前に間引く
    const d = readMachineDay('m11', DAY);
    expect(d.samples).toHaveLength(GRAPH_POINTS / 2);
    expect(d.sampleEvery).toBe(50);

    // 間引いた直後の切れ目（新しい間隔の倍数）で、また積み上がり始める
    spin(25);
    expect(readMachineDay('m11', DAY).samples).toHaveLength(GRAPH_POINTS / 2 + 1);
  });

  it('何度間引いても点は上限を超えない', () => {
    spin(25 * 26 * 8);
    const d = readMachineDay('m11', DAY);
    expect(d.samples.length).toBeLessThanOrEqual(GRAPH_POINTS);
    expect(d.sampleEvery).toBeGreaterThan(25);
  });

  it('切れ目ちょうどでは最後の点が現在の差枚と一致する（グラフの右端が今）', () => {
    spin(50);
    const d = readMachineDay('m11', DAY);
    expect(d.samples[d.samples.length - 1]).toBe(d.sahmai);
  });

  it('間引いた直後でも、最後の点は捨てた値ではなく残した値になる', () => {
    spin(GRAPH_POINTS * 25 + 25);
    const d = readMachineDay('m11', DAY);
    // 26点目（= 26 × 25ゲーム時点）が右端。27点目は足さずに次の切れ目を待つ
    expect(d.samples[d.samples.length - 1]).toBe(-3 * GRAPH_POINTS * 25);
  });

  it('間引いても最初の点は残る（今日の全体が入る）', () => {
    spin(25); // 1点目 = 25ゲーム時点の差枚 = -75
    const first = readMachineDay('m11', DAY).samples[0];
    expect(first).toBe(-75);
    spin(25 * 30); // 何度か間引かれる
    // 間引きは奇数番目を残すので、先頭は「間隔の1倍目」の点へ置き換わる。
    // 大事なのは、残った先頭が現在の間隔ちょうどの位置にあること。
    const d = readMachineDay('m11', DAY);
    expect(d.samples[0]).toBe(-3 * d.sampleEvery);
  });
});

describe('保存データの互換', () => {
  it('項目追加前のレコード（samples が無い）を読んでも壊れない', () => {
    localStorage.setItem(
      'mojislot.machineData.v2',
      JSON.stringify({
        m11: { day: '2026-07-30', spins: 100, big: 1, reg: 2, sinceBonus: 30, sahmai: -120 },
      }),
    );
    const d = readMachineDay('m11', DAY);
    expect(d.spins).toBe(100);
    expect(d.samples).toEqual([]);
    expect(d.sampleEvery).toBeGreaterThan(0);
    // そのまま追記できる
    recordSpin('m11', DAY, miss);
    expect(readMachineDay('m11', DAY).spins).toBe(101);
  });
});

/**
 * 過ぎた日のデータは**今日の推測には使わない**（前日の数字で空欄を埋める案は
 * 却下済み）。保管するのは記録の閲覧のためで、逃がし損ねると翌日その台に
 * 座った瞬間に消える。消えたことは画面に出ないので、テストで押さえる。
 */
describe('過去データの保管', () => {
  it('日をまたいで同じ台に座ると、前日ぶんが保管庫へ移る', () => {
    recordSpin('m11', DAY, miss);
    recordSpin('m11', DAY, miss);
    // 翌日そのまま打つ＝0で上書きされる局面
    recordSpin('m11', OTHER_DAY, miss);
    expect(readMachineDay('m11', OTHER_DAY).spins).toBe(1);
    const hist = readMachineHistory('m11');
    expect(hist).toHaveLength(1);
    expect(hist[0].day).toBe('2026-07-30');
    expect(hist[0].data.spins).toBe(2);
  });

  it('打たなくても、ホールに入った時点で前日ぶんが保管される', () => {
    recordSpin('m11', DAY, miss);
    recordSpin('m12', DAY, miss);
    archiveStaleDays(OTHER_DAY);
    // 現役のカウンターからは消える（今日の数字は空欄で正しい）
    expect(readMachineDay('m11', OTHER_DAY).spins).toBe(0);
    expect(readMachineHistory('m11')[0].data.spins).toBe(1);
    expect(readMachineHistory('m12')[0].data.spins).toBe(1);
  });

  it('今日ぶんは保管しない（現役のカウンターが正）', () => {
    recordSpin('m11', DAY, miss);
    archiveStaleDays(DAY);
    expect(readMachineDay('m11', DAY).spins).toBe(1);
    expect(readMachineHistory('m11')).toHaveLength(0);
  });

  it('保管は30日ぶんで、古い日から落ちる', () => {
    // 6/1 から32日ぶん、1日1ゲームずつ
    for (let i = 0; i < 32; i++) {
      recordSpin('m11', new Date(2026, 5, 1 + i, 12, 0, 0), miss);
    }
    const hist = readMachineHistory('m11');
    expect(hist).toHaveLength(30);
    // 最後に打った日（7/2）は現役なので、保管の先頭はその前日
    expect(hist[0].day).toBe('2026-07-01');
    expect(hist.some((h) => h.day === '2026-06-01')).toBe(false);
  });

  it('新しい日から順に返す', () => {
    recordSpin('m11', new Date(2026, 6, 28, 12, 0, 0), miss);
    recordSpin('m11', new Date(2026, 6, 29, 12, 0, 0), miss);
    recordSpin('m11', OTHER_DAY, miss);
    expect(readMachineHistory('m11').map((h) => h.day)).toEqual([
      '2026-07-29',
      '2026-07-28',
    ]);
  });
});
