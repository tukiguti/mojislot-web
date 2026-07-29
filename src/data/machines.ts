import { CHAPTERS } from './chapters';

/**
 * ホールの台構成。島（＝リール配列を共有する一群）に4台ずつ並ぶ。
 *
 * 実機のホールと同じく、プレイヤーが選ぶのは「章」ではなく**台**。
 * 同じ島の台はリール配列が同じで、違うのは**設定だけ**。
 * だから配列を覚える技術は島の中で持ち越せて、台移動しても無駄にならない。
 *
 * 台番号は「島番号×10＋席番号」。末尾（下1桁＝席）はどの島でも 1〜4 で揃うので、
 * 「本日は末尾3」のような島をまたぐ示唆が成立する（設計: HallPolicy）。
 */

/** 1島あたりの台数。末尾示唆と角台ジンクスの両方が成立する最小構成。 */
export const SEATS_PER_ISLAND = 4;

/** リミックス島（章がステージとして切り替わる台）の島ID。 */
export const REMIX_ISLAND_ID = 'remix';
/** リミックス島の島番号。7は縁起物なので端に置く。 */
const REMIX_ISLAND_NO = 7;

export interface Island {
  id: string;
  name: string;
  /** 台番号の十の位。 */
  no: number;
  /** この島で使う章。リミックス島だけ複数持ち、ステージとして切り替わる。 */
  chapterIds: string[];
  /** サムネイルに使う章（リミックスは先頭章の絵を使う）。 */
  artChapterId: string;
  description: string;
}

export interface Machine {
  /** 'm11' のような安定ID。データの保存キーにも使う。 */
  id: string;
  /** 台番号（11〜14、21〜24 …）。 */
  number: number;
  islandId: string;
  /** 席番号（1〜4）＝台番号の末尾。 */
  seat: number;
  /** 島の端（角台）か。実機のジンクスに使う。 */
  corner: boolean;
}

export const ISLANDS: Island[] = [
  ...CHAPTERS.filter((c) => !c.hidden).map((c, i) => ({
    id: c.id,
    name: c.name,
    no: i + 1,
    chapterIds: [c.id],
    artChapterId: c.id,
    description: c.description,
  })),
  {
    id: REMIX_ISLAND_ID,
    name: 'リミックス',
    no: REMIX_ISLAND_NO,
    // 全章を1台に統合し、ボーナスごとにステージ（＝リール配列）が切り替わる。
    chapterIds: CHAPTERS.filter((c) => !c.hidden).map((c) => c.id),
    artChapterId: CHAPTERS[0].id,
    description:
      '全章がステージとして切り替わる台。配列を覚え直す忙しさと引き換えに、どの文字も出る。',
  },
];

/** 全台（島の並び順 × 席順）。 */
export const MACHINES: Machine[] = ISLANDS.flatMap((island) =>
  Array.from({ length: SEATS_PER_ISLAND }, (_, i) => {
    const seat = i + 1;
    return {
      id: `m${island.no}${seat}`,
      number: island.no * 10 + seat,
      islandId: island.id,
      seat,
      corner: seat === 1 || seat === SEATS_PER_ISLAND,
    };
  }),
);

export const machineById = (id: string): Machine | undefined =>
  MACHINES.find((m) => m.id === id);

export const islandById = (id: string): Island | undefined =>
  ISLANDS.find((i) => i.id === id);

export const machinesOfIsland = (islandId: string): Machine[] =>
  MACHINES.filter((m) => m.islandId === islandId);

export const islandOfMachine = (m: Machine): Island =>
  islandById(m.islandId) ?? ISLANDS[0];

/**
 * その台で回る章。通常の島は1つだけ持つ。リミックス島は複数持つが
 * ステージ切替が未実装なので、いまは先頭を返す（島ごと着席を塞いである）。
 */
export const chapterIdOfMachine = (m: Machine): string =>
  islandOfMachine(m).chapterIds[0];

/**
 * 選んだ台。設定（1〜6）とデータカウンターは**章ではなく台ごと**に決まるので、
 * ゲーム側はこのIDを見る。章IDだけでは同じ島の4台が区別できない。
 */
const CURRENT_MACHINE_KEY = 'mojislot.machine.v1';

/** いま選ばれている台。未選択・不正値なら先頭の島の1番台。 */
export function getCurrentMachine(): Machine {
  try {
    const stored = localStorage.getItem(CURRENT_MACHINE_KEY);
    const found = stored ? machineById(stored) : undefined;
    if (found) return found;
  } catch {
    /* ignore */
  }
  return MACHINES[0];
}

export function setCurrentMachineId(id: string): void {
  try {
    localStorage.setItem(CURRENT_MACHINE_KEY, id);
  } catch {
    /* ignore */
  }
}
