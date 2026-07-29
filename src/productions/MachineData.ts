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
 * **キーは台ID（`m13`）で、章IDではない**。同じ島の4台は章を共有するので、
 * 章で数えると4台のデータが混ざって台を選び分ける意味が消える。
 *
 * ランキングの正本である RunHistory とは別物。あちらは「1戦＝計数まで」の記録で、
 * こちらは「その台の今日」を台側が数えているもの。計数してもリセットされない。
 */

// v1 は章IDで数えていた。台IDへ移した時点で意味が変わるので上げてある
// （日替わりで捨てるデータなので移行はしない）。
const STORAGE_KEY = 'mojislot.machineData.v2';

/** スランプグラフの点数。表示器の幅がこれ以上の棒を置けない。 */
export const GRAPH_POINTS = 26;
/** 最初の記録間隔（ゲーム数）。点が溢れたら間引いて倍にしていく。 */
const INITIAL_SAMPLE_EVERY = 25;

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
  /**
   * スランプグラフの点（差枚の推移）。`sampleEvery` ゲームごとに1点。
   * 溢れたら1つ置きに間引いて間隔を倍にするので、**常に今日の全体が入る**。
   */
  samples: number[];
  /** 現在の記録間隔。間引くたびに倍になる。 */
  sampleEvery: number;
}

const emptyDay = (day: string): MachineDay => ({
  day,
  spins: 0,
  big: 0,
  reg: 0,
  sinceBonus: 0,
  sahmai: 0,
  samples: [],
  sampleEvery: INITIAL_SAMPLE_EVERY,
});

/** 保存済みレコードに欠けている項目を補う（項目追加前のデータを壊さない）。 */
const normalize = (d: MachineDay): MachineDay => ({
  ...d,
  samples: Array.isArray(d.samples) ? d.samples : [],
  sampleEvery: d.sampleEvery > 0 ? d.sampleEvery : INITIAL_SAMPLE_EVERY,
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
export function readMachineDay(machineId: string, now: Date): MachineDay {
  const day = dayKey(now);
  const found = load()[machineId];
  return found && found.day === day ? normalize(found) : emptyDay(day);
}

/** 全台ぶんまとめて読む（島の表示用）。 */
export function readAllMachineDays(
  machineIds: readonly string[],
  now: Date,
): Map<string, MachineDay> {
  const day = dayKey(now);
  const store = load();
  return new Map(
    machineIds.map((id) => {
      const found = store[id];
      return [id, found && found.day === day ? normalize(found) : emptyDay(day)];
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
  machineId: string,
  now: Date,
  spin: SpinRecord,
): MachineDay {
  const store = load();
  const day = dayKey(now);
  const cur =
    store[machineId] && store[machineId].day === day
      ? normalize(store[machineId])
      : emptyDay(day);

  const spins = cur.spins + 1;
  const sahmai = cur.sahmai + spin.win - spin.bet;

  // グラフの点は間隔ごとに1つ足す。詰まったら**足す前に**1つ置きに間引いて間隔を倍にする。
  // こうすると点の数は上限内に収まったまま、常に「今日の最初から今まで」が入る。
  //
  // 間引きは奇数番目を残す（＝新しい間隔ちょうどの位置に揃う）。間引いた直後の回転数は
  // 新しい間隔の切れ目とは限らないので、そこでは足さずに次の切れ目まで待つ。
  // 先に足してから間引くと、いま記録したばかりの点が真っ先に捨てられる。
  let samples = cur.samples;
  let sampleEvery = cur.sampleEvery;
  if (spins % sampleEvery === 0) {
    if (samples.length >= GRAPH_POINTS) {
      samples = samples.filter((_, i) => i % 2 === 1);
      sampleEvery *= 2;
    }
    if (spins % sampleEvery === 0) samples = [...samples, sahmai];
  }

  const next: MachineDay = {
    day,
    spins,
    big: cur.big + (spin.bonus === 'big' ? 1 : 0),
    reg: cur.reg + (spin.bonus === 'reg' ? 1 : 0),
    sinceBonus: spin.bonus ? 0 : cur.sinceBonus + 1,
    sahmai,
    samples,
    sampleEvery,
  };
  store[machineId] = next;
  save(store);
  return next;
}

/** ボーナス確率の表示（1/N）。まだ引いていなければ null。 */
export function bonusRate(d: MachineDay): number | null {
  const count = d.big + d.reg;
  return count > 0 ? d.spins / count : null;
}
