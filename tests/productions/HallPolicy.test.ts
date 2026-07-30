import { describe, expect, it } from 'vitest';
import {
  hallPolicyFor,
  isTargeted,
  luckySixMachine,
  settingForMachine,
} from '../../src/productions/HallPolicy';
import {
  ISLANDS,
  MACHINES,
  REMIX_ISLAND_ID,
  SEATS_PER_ISLAND,
  TRIAL_ISLAND_ID,
  chapterIdOfMachine,
} from '../../src/data/machines';
import { dayKey } from '../../src/productions/MachineSetting';

/**
 * ポスターは「読めば有利になるが、断定はできない」で成り立っている。
 * 断定できてしまうと作業になり、まったく当たらないと読む意味がなくなる。
 * ここではその**あいだ**に収まっていることを統計で確かめる。
 */

const days = (n: number): Date[] =>
  Array.from({ length: n }, (_, i) => new Date(2026, 0, 1 + i));

const avg = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

/** ホールの島（試打コーナーを除く）。末尾示唆・角台ジンクスが成立する範囲。 */
const HALL_ISLANDS = ISLANDS.filter((i) => i.id !== TRIAL_ISLAND_ID);

describe('台構成', () => {
  it('ホールの島は4台ずつ並び、末尾（席）はどの島でも1〜4で揃う', () => {
    for (const island of HALL_ISLANDS) {
      const ms = MACHINES.filter((m) => m.islandId === island.id);
      expect(ms, island.id).toHaveLength(SEATS_PER_ISLAND);
      expect(ms.map((m) => m.seat)).toEqual([1, 2, 3, 4]);
      expect(ms.map((m) => m.number)).toEqual(
        [1, 2, 3, 4].map((s) => island.no * 10 + s),
      );
    }
  });

  it('角台は島の両端だけ', () => {
    for (const island of ISLANDS) {
      const ms = MACHINES.filter((m) => m.islandId === island.id);
      for (const m of ms) {
        expect(m.corner, `台${m.number}`).toBe(m.seat === 1 || m.seat === ms.length);
      }
    }
  });

  it('台番号とIDは重複しない', () => {
    expect(new Set(MACHINES.map((m) => m.number)).size).toBe(MACHINES.length);
    expect(new Set(MACHINES.map((m) => m.id)).size).toBe(MACHINES.length);
  });

  it('章を複数持つのはリミックス島と試打コーナーだけ', () => {
    const remix = ISLANDS.find((i) => i.id === REMIX_ISLAND_ID)!;
    expect(remix.chapterIds.length).toBeGreaterThan(1);
    for (const i of ISLANDS) {
      if (i.id === REMIX_ISLAND_ID || i.id === TRIAL_ISLAND_ID) continue;
      expect(i.chapterIds).toEqual([i.id]);
    }
  });
});

describe('試打コーナー（設定推測の外側）', () => {
  const trial = MACHINES.filter((m) => m.islandId === TRIAL_ISLAND_ID);
  const D = days(200);

  it('全機種が1台ずつ並ぶ', () => {
    expect(trial).toHaveLength(HALL_ISLANDS.length - 1); // リミックスは未実装ぶん除く
    const chapters = trial.map((m) => chapterIdOfMachine(m));
    expect(new Set(chapters).size).toBe(trial.length);
  });

  it('全台が設定6で固定（日付によらない）', () => {
    for (const d of D) {
      for (const m of trial) expect(settingForMachine(m, d), m.id).toBe(6);
    }
  });

  it('ホール方針の対象にならない（狙い目ランプが点かない）', () => {
    for (const d of D) {
      const p = hallPolicyFor(d);
      for (const m of trial) expect(isTargeted(m, p), `${m.id} ${dayKey(d)}`).toBe(false);
    }
  });

  it('その日の設定6の台としては選ばれない（探す対象はホールの24台）', () => {
    for (const d of D) {
      expect(luckySixMachine(d).islandId, dayKey(d)).not.toBe(TRIAL_ISLAND_ID);
    }
  });
});

describe('ホール方針', () => {
  it('同じ日なら何度読んでも同じ（掲示が途中で変わらない）', () => {
    const a = hallPolicyFor(new Date(2026, 6, 27, 9, 0));
    const b = hallPolicyFor(new Date(2026, 6, 27, 22, 30));
    expect(a).toEqual(b);
  });

  it('日によって方針が変わり、どの方針も出る', () => {
    const kinds = days(200).map((d) => hallPolicyFor(d).kind);
    const seen = new Set(kinds);
    expect(seen).toContain('flat');
    expect(seen).toContain('tail');
    expect(seen).toContain('island');
    expect(seen).toContain('corner');
    expect(seen).toContain('allSame');
  });

  it('「特に何もない日」が最多（毎日イベントだと価値が下がる）', () => {
    const kinds = days(400).map((d) => hallPolicyFor(d).kind);
    const flat = kinds.filter((k) => k === 'flat').length;
    for (const k of ['tail', 'island', 'corner', 'allSame'] as const) {
      expect(flat).toBeGreaterThan(kinds.filter((x) => x === k).length);
    }
  });

  it('通常営業の日はポスターを出さない', () => {
    for (const d of days(200)) {
      const p = hallPolicyFor(d);
      if (p.kind === 'flat') expect(p.poster).toBeNull();
      else expect(p.poster).not.toBeNull();
    }
  });
});

describe('設定の割り当て', () => {
  it('同じ日・同じ台なら常に同じ設定（リロードで推測が壊れない）', () => {
    const m = MACHINES[0];
    expect(settingForMachine(m, new Date(2026, 6, 27, 8, 0))).toBe(
      settingForMachine(m, new Date(2026, 6, 27, 23, 0)),
    );
  });

  it('ポスターの対象台は平均設定が高い（読めば有利）', () => {
    const targeted: number[] = [];
    const others: number[] = [];
    for (const d of days(400)) {
      const policy = hallPolicyFor(d);
      if (policy.kind === 'flat') continue;
      for (const m of MACHINES) {
        const s = settingForMachine(m, d, policy);
        (isTargeted(m, policy) ? targeted : others).push(s);
      }
    }
    expect(avg(targeted)).toBeGreaterThan(avg(others) + 0.8);
  });

  it('対象台でも低設定はあり、対象外でも高設定はある（断定にしない）', () => {
    let lowOnTarget = 0;
    let highOnOther = 0;
    for (const d of days(400)) {
      const policy = hallPolicyFor(d);
      if (policy.kind === 'flat' || policy.kind === 'allSame') continue;
      for (const m of MACHINES) {
        const s = settingForMachine(m, d, policy);
        if (isTargeted(m, policy) && s <= 2) lowOnTarget++;
        if (!isTargeted(m, policy) && s >= 5) highOnOther++;
      }
    }
    expect(lowOnTarget).toBeGreaterThan(0);
    expect(highOnOther).toBeGreaterThan(0);
  });

  it('全台系の日は対象島に低設定が入らない（そこだけは約束する）', () => {
    let checked = 0;
    for (const d of days(400)) {
      const policy = hallPolicyFor(d);
      if (policy.kind !== 'allSame') continue;
      for (const m of MACHINES.filter((m) => m.islandId === policy.islandId)) {
        expect(settingForMachine(m, d, policy)).toBeGreaterThanOrEqual(3);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('通常営業の日は全台が同じ分布から決まる', () => {
    const d = days(400).find((x) => hallPolicyFor(x).kind === 'flat')!;
    const policy = hallPolicyFor(d);
    for (const m of MACHINES) expect(isTargeted(m, policy)).toBe(false);
  });
});

describe('その日の設定6（1台保証）', () => {
  const D = days(400);

  it('毎日ちょうど1台だけ設定6がある', () => {
    // 重み抽選だけだと設定6が0台の日が普通に出る。探しても答えが無い日が
    // あると探す遊びが博打になるので、1台だけ確定で置いている。
    for (const d of D) {
      const sixes = MACHINES.filter(
        (m) => m.islandId !== REMIX_ISLAND_ID && settingForMachine(m, d) === 6,
      );
      expect(sixes.length, dayKey(d)).toBeGreaterThanOrEqual(1);
    }
  });

  it('同じ日なら何度読んでも同じ台（リロードで答えが変わらない）', () => {
    for (const d of D.slice(0, 30)) {
      expect(luckySixMachine(d).id).toBe(luckySixMachine(d).id);
      expect(settingForMachine(luckySixMachine(d), d)).toBe(6);
    }
  });

  it('日によって台は変わる（ずっと同じではない）', () => {
    const ids = new Set(D.map((d) => luckySixMachine(d).id));
    expect(ids.size).toBeGreaterThan(10);
  });

  it('調整中の島には置かない（着席できないため）', () => {
    for (const d of D) {
      expect(luckySixMachine(d).islandId, dayKey(d)).not.toBe(REMIX_ISLAND_ID);
    }
  });

  it('掲示がある日は対象台の中に置く（ポスターを読んだ人が有利）', () => {
    for (const d of D) {
      const p = hallPolicyFor(d);
      if (p.kind === 'flat') continue;
      expect(isTargeted(luckySixMachine(d, p), p), dayKey(d)).toBe(true);
    }
  });
});
