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
  /**
   * 通常時（ボーナス中でない）の回転数と、そのうち**演出が出た**回転数。
   *
   * 設定差は演出の出方に乗せてあるので（`MachineSetting`）、**設定を読める数字は
   * これだけ**。BIG/REG回数や合成確率は設定差が小さすぎて事実上読めない
   * （2台を3σで見分けるのに28万ゲーム。演出率なら約400ゲーム）。
   *
   * ボーナス中を数えないのは、ボーナス中は無演出が0で必ず演出が出るため。
   * 混ぜると消化ゲーム数の差で率が動いてしまう。
   */
  normalSpins: number;
  effectSpins: number;
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
  normalSpins: 0,
  effectSpins: 0,
});

/** 保存済みレコードに欠けている項目を補う（項目追加前のデータを壊さない）。 */
const normalize = (d: MachineDay): MachineDay => ({
  ...d,
  samples: Array.isArray(d.samples) ? d.samples : [],
  sampleEvery: d.sampleEvery > 0 ? d.sampleEvery : INITIAL_SAMPLE_EVERY,
  normalSpins: d.normalSpins ?? 0,
  effectSpins: d.effectSpins ?? 0,
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
  /** ボーナス消化中のゲームか。演出率の母数から外す。 */
  inBonus: boolean;
  /** 演出（示唆・クイズ・狙え）が出たか。設定を読める唯一の数字。 */
  effect: boolean;
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
    normalSpins: cur.normalSpins + (spin.inBonus ? 0 : 1),
    effectSpins: cur.effectSpins + (!spin.inBonus && spin.effect ? 1 : 0),
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

/**
 * 演出が出た割合（通常時のみ）。まだ回していなければ null。
 * 高いほど高設定寄り。設定1で約25%、設定6で約35%（ハズレと1枚役を含む母数）。
 */
export function effectRate(d: MachineDay): number | null {
  return d.normalSpins > 0 ? d.effectSpins / d.normalSpins : null;
}

/** ボーナス確率の表示（1/N）。まだ引いていなければ null。 */
export function bonusRate(d: MachineDay): number | null {
  const count = d.big + d.reg;
  return count > 0 ? d.spins / count : null;
}
