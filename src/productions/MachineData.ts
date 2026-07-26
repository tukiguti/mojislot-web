import { dayKey } from './MachineSetting';

/**
 * 台のデータカウンター（実機のホールに付いている、あの表示器）。
 *
 * 設定を推測するための**唯一の客観的な材料**。プレイヤーはこれと示唆演出だけで
 * 「今日この台は良さそうか」を判断する。
 *
 * 実機と同じく**日替わりでリセット**する。設定も日替わりなので、
 * 「今日のデータ」と「今日の設定」が対応する（昨日の実績を見ても意味がない）。
 *
 * ランキングの正本である RunHistory とは別物。あちらは「1戦＝計数まで」の記録で、
 * こちらは「その台の今日」を台側が数えているもの。計数してもリセットされない。
 */

const STORAGE_KEY = 'mojislot.machineData.v1';

export interface MachineDay {
  /** この数字が今日でなければ、表示前にリセットする。 */
  day: string;
  /** 今日の総回転数 */
  spins: number;
  big: number;
  reg: number;
  /** 最終ボーナスからの回転数（＝ハマり）。実機の一番大事な数字。 */
  sinceBonus: number;
  /** 今日の差枚（払い出し − 投入） */
  sahmai: number;
}

const emptyDay = (day: string): MachineDay => ({
  day,
  spins: 0,
  big: 0,
  reg: 0,
  sinceBonus: 0,
  sahmai: 0,
});

type Store = Record<string, MachineDay>;

function load(): Store {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Store) : {};
  } catch {
    return {};
  }
}

function save(store: Store): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // 保存できなくても遊べる方を優先する（プライベートモード等）
  }
}

/** その台の今日のデータ。日付が変わっていれば0から。 */
export function readMachineDay(chapterId: string, now: Date): MachineDay {
  const day = dayKey(now);
  const found = load()[chapterId];
  return found && found.day === day ? found : emptyDay(day);
}

/** 全台ぶんまとめて読む（島の表示用）。 */
export function readAllMachineDays(
  chapterIds: readonly string[],
  now: Date,
): Map<string, MachineDay> {
  const day = dayKey(now);
  const store = load();
  return new Map(
    chapterIds.map((id) => {
      const found = store[id];
      return [id, found && found.day === day ? found : emptyDay(day)];
    }),
  );
}

export interface SpinRecord {
  bet: number;
  win: number;
  /** このゲームでボーナスへ新規突入したか（おかわりは数えない）。 */
  bonus: 'big' | 'reg' | null;
}

/**
 * 1ゲームぶん記録する。全停止して払い出しが確定してから呼ぶ。
 * ボーナスを引いたゲームで sinceBonus が0に戻る＝ハマりが途切れる。
 */
export function recordSpin(
  chapterId: string,
  now: Date,
  spin: SpinRecord,
): MachineDay {
  const store = load();
  const day = dayKey(now);
  const cur =
    store[chapterId] && store[chapterId].day === day
      ? store[chapterId]
      : emptyDay(day);

  const next: MachineDay = {
    day,
    spins: cur.spins + 1,
    big: cur.big + (spin.bonus === 'big' ? 1 : 0),
    reg: cur.reg + (spin.bonus === 'reg' ? 1 : 0),
    sinceBonus: spin.bonus ? 0 : cur.sinceBonus + 1,
    sahmai: cur.sahmai + spin.win - spin.bet,
  };
  store[chapterId] = next;
  save(store);
  return next;
}

/** ボーナス確率の表示（1/N）。まだ引いていなければ null。 */
export function bonusRate(d: MachineDay): number | null {
  const count = d.big + d.reg;
  return count > 0 ? d.spins / count : null;
}
