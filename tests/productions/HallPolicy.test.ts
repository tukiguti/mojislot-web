import { describe, expect, it } from 'vitest';
import {
  hallPolicyFor,
  isTargeted,
  settingForMachine,
} from '../../src/productions/HallPolicy';
import { ISLANDS, MACHINES, SEATS_PER_ISLAND } from '../../src/data/machines';

/**
 * ポスターは「読めば有利になるが、断定はできない」で成り立っている。
 * 断定できてしまうと作業になり、まったく当たらないと読む意味がなくなる。
 * ここではその**あいだ**に収まっていることを統計で確かめる。
 */

const days = (n: number): Date[] =>
  Array.from({ length: n }, (_, i) => new Date(2026, 0, 1 + i));

const avg = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

describe('台構成', () => {
  it('各島に4台ずつ並び、末尾（席）はどの島でも1〜4で揃う', () => {
    for (const island of ISLANDS) {
      const ms = MACHINES.filter((m) => m.islandId === island.id);
      expect(ms, island.id).toHaveLength(SEATS_PER_ISLAND);
      expect(ms.map((m) => m.seat)).toEqual([1, 2, 3, 4]);
      expect(ms.map((m) => m.number)).toEqual(
        [1, 2, 3, 4].map((s) => island.no * 10 + s),
      );
    }
  });

  it('角台は島の両端だけ', () => {
    for (const m of MACHINES) {
      expect(m.corner, `台${m.number}`).toBe(m.seat === 1 || m.seat === SEATS_PER_ISLAND);
    }
  });

  it('台番号とIDは重複しない', () => {
    expect(new Set(MACHINES.map((m) => m.number)).size).toBe(MACHINES.length);
    expect(new Set(MACHINES.map((m) => m.id)).size).toBe(MACHINES.length);
  });

  it('リミックス島は全章を持ち、他の島は1章だけ', () => {
    const remix = ISLANDS.find((i) => i.id === 'remix')!;
    expect(remix.chapterIds.length).toBeGreaterThan(1);
    for (const i of ISLANDS.filter((i) => i.id !== 'remix')) {
      expect(i.chapterIds).toEqual([i.id]);
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
