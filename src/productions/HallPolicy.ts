import { ISLANDS, SEATS_PER_ISLAND, type Machine } from '../data/machines';
import { dayKey, SETTINGS, type Setting } from './MachineSetting';

/**
 * その日のホールの方針と、掲示されるポスター。
 *
 * 設定を台ごとに無作為で決めると、プレイヤーには**推測の取っ掛かりが無い**。
 * データが埋まるまで完全な当てずっぽうになり、初日は特にそうなる。
 *
 * そこで実機のホールと同じ順序にした：
 *
 *   日付 → ホールの方針 → 各台の設定 → ポスター（方針をぼかして掲示）
 *
 * ポスターは**確定ではなく示唆**。「末尾3に力を入れた」日でも末尾3が必ず高設定
 * ではなく、入りやすいだけ。断定にすると読む楽しみが消えて作業になる。
 */

export type HallPolicyKind =
  | 'tail'      // 特定の末尾（席番号）に高設定を寄せる
  | 'island'    // 特定の島に高設定を寄せる
  | 'corner'    // 各島の角台（席1・席4）に寄せる
  | 'allSame'   // どこか1島だけ全台を中間以上に（全台系）
  | 'flat';     // 特に寄せない（通常営業）

export interface HallPolicy {
  kind: HallPolicyKind;
  /** kind='tail' の対象末尾（1〜4）。 */
  tail?: number;
  /** kind='island' / 'allSame' の対象島ID。 */
  islandId?: string;
  /** 掲示文。方針をぼかして伝える。'flat' の日は掲示しない（null）。 */
  poster: string | null;
}

/** 文字列から決定的な32bit値を作る。 */
function hash32(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** 方針の出現ウェイト。「特に何もない日」がいちばん多いのが実際のホール。 */
const POLICY_WEIGHT: Record<HallPolicyKind, number> = {
  flat: 34,
  tail: 22,
  island: 20,
  corner: 14,
  allSame: 10,
};

/** その日のホール方針。日付から決定的に決まる（同じ日なら何度読んでも同じ）。 */
export function hallPolicyFor(now: Date): HallPolicy {
  const day = dayKey(now);
  const kinds = Object.keys(POLICY_WEIGHT) as HallPolicyKind[];
  const total = kinds.reduce((a, k) => a + POLICY_WEIGHT[k], 0);
  let r = (hash32(`policy/${day}`) % total) + 1;
  let kind: HallPolicyKind = 'flat';
  for (const k of kinds) {
    r -= POLICY_WEIGHT[k];
    if (r <= 0) {
      kind = k;
      break;
    }
  }

  if (kind === 'tail') {
    const tail = (hash32(`tail/${day}`) % SEATS_PER_ISLAND) + 1;
    return { kind, tail, poster: `本日は 末尾${tail} に力を入れました` };
  }
  if (kind === 'island' || kind === 'allSame') {
    const island = ISLANDS[hash32(`island/${day}`) % ISLANDS.length];
    return {
      kind,
      islandId: island.id,
      poster:
        kind === 'island'
          ? `本日は 「${island.name}」島 強化中`
          : 'いずれかの島に まとめて入れました ／ 全台系あり',
    };
  }
  if (kind === 'corner') {
    return { kind, poster: '角に置きました' };
  }
  return { kind, poster: null };
}

/** その台が今日の方針の対象か（＝高設定が入りやすい台か）。 */
export function isTargeted(machine: Machine, policy: HallPolicy): boolean {
  switch (policy.kind) {
    case 'tail':
      return machine.seat === policy.tail;
    case 'island':
    case 'allSame':
      return machine.islandId === policy.islandId;
    case 'corner':
      return machine.corner;
    case 'flat':
      return false;
  }
}

/**
 * 設定の出現ウェイト。方針の対象台は高設定側へ寄せる。
 * 対象台でも設定1が出る／対象外でも設定6が出る余地を残す＝ポスターは断定しない。
 */
const WEIGHT_BASE: Record<Setting, number> = { 1: 34, 2: 26, 3: 18, 4: 12, 5: 7, 6: 3 };
const WEIGHT_TARGET: Record<Setting, number> = { 1: 8, 2: 12, 3: 18, 4: 24, 5: 22, 6: 16 };
/** 全台系の対象島は「全台が中間以上」。ここだけ下2つを落とす。 */
const WEIGHT_ALL_SAME: Record<Setting, number> = { 1: 0, 2: 0, 3: 28, 4: 32, 5: 24, 6: 16 };

/**
 * その日その台の設定。日付・台番号・方針から決定的に決まる。
 * 保存しないので、リロードしても同じ台なら同じ設定になる（推測が壊れない）。
 */
export function settingForMachine(
  machine: Machine,
  now: Date,
  policy: HallPolicy = hallPolicyFor(now),
): Setting {
  const targeted = isTargeted(machine, policy);
  const weights =
    targeted && policy.kind === 'allSame'
      ? WEIGHT_ALL_SAME
      : targeted
        ? WEIGHT_TARGET
        : WEIGHT_BASE;

  const total = SETTINGS.reduce((a, s) => a + weights[s], 0);
  let r = (hash32(`${dayKey(now)}/machine/${machine.number}`) % total) + 1;
  for (const s of SETTINGS) {
    r -= weights[s];
    if (r <= 0) return s;
  }
  return 1;
}
