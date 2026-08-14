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

/**
 * 島番号は台番の十の位で、**入口から見て左から右へ 1・2・3… と連番**になる。
 * 欠番は作らない（歩いた順と台番の順が食い違うと、末尾示唆も台番も読みにくくなる）。
 *
 *   寿司1 → 動物2 → 動詞3 → 八百屋4 → セキュリティ5 → リミックス6 → 試打コーナー7
 *
 * いちばん奥（右端）が試打コーナーで、そこに縁起物の7が来る。
 * 全台が設定6で開放してある一角なので、番号としても収まりがよい。
 */

/** リミックス島（章がステージとして切り替わる台）の島ID。 */
export const REMIX_ISLAND_ID = 'remix';
const REMIX_ISLAND_NO = 6;

/** 試打コーナーの島ID。全機種が1台ずつ並び、**全台が設定6**で開放されている。 */
export const TRIAL_ISLAND_ID = 'trial';
const TRIAL_ISLAND_NO = 7;

export interface Island {
  id: string;
  name: string;
  /** 台番号の十の位。 */
  no: number;
  /**
   * この島で使う章。通常の島は1つ。
   * リミックス島は複数持ち（ステージとして切り替わる予定）、
   * 試打コーナーも複数持つが、そちらは**席ごとに1章**を割り当てる。
   */
  chapterIds: string[];
  /** サムネイルに使う章（リミックスは先頭章の絵を使う）。 */
  artChapterId: string;
  description: string;
  /** 台数。既定は SEATS_PER_ISLAND。試打コーナーだけ章の数だけ並ぶ。 */
  seats?: number;
  /**
   * 試打コーナーか。**設定推測の外側**にある島で、
   *  - 全台が設定6で固定（推測の対象にしない）
   *  - 席ごとに違う章＝「同じ島は同じ配列」の例外
   *  - ホール方針の対象にしない（ポスターが指さない）
   *  - ここでの記録はランキングの比較条件で既定除外
   * 探すのが面倒な日に好きな文字セットをすぐ打てる逃げ道として置いてある。
   */
  trial?: boolean;
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
  {
    id: TRIAL_ISLAND_ID,
    name: '試打コーナー',
    no: TRIAL_ISLAND_NO,
    // 席ごとに1章。並び順は ISLANDS の島順と揃える。
    chapterIds: CHAPTERS.filter((c) => !c.hidden).map((c) => c.id),
    artChapterId: CHAPTERS[0].id,
    seats: CHAPTERS.filter((c) => !c.hidden).length,
    trial: true,
    description:
      '全機種が1台ずつ、すべて設定6で開放。設定を探さずに好きな文字セットを打てる。ここでの記録はランキングの比較条件で既定除外。',
  },
];

/** 全台（島の並び順 × 席順）。 */
export const MACHINES: Machine[] = ISLANDS.flatMap((island) => {
  const seats = island.seats ?? SEATS_PER_ISLAND;
  return Array.from({ length: seats }, (_, i) => {
    const seat = i + 1;
    return {
      id: `m${island.no}${seat}`,
      number: island.no * 10 + seat,
      islandId: island.id,
      seat,
      corner: seat === 1 || seat === seats,
    };
  });
});

export const machineById = (id: string): Machine | undefined =>
  MACHINES.find((m) => m.id === id);

export const islandById = (id: string): Island | undefined =>
  ISLANDS.find((i) => i.id === id);

export const machinesOfIsland = (islandId: string): Machine[] =>
  MACHINES.filter((m) => m.islandId === islandId);

export const islandOfMachine = (m: Machine): Island =>
  islandById(m.islandId) ?? ISLANDS[0];

/**
 * その台で回る章。
 * 通常の島は1つだけ持つ。**試打コーナーは席ごとに違う章**。
 * リミックス島は複数持つがステージ切替が未実装なので先頭を返す（着席は塞いである）。
 */
export const chapterIdOfMachine = (m: Machine): string => {
  const island = islandOfMachine(m);
  if (island.trial) return island.chapterIds[m.seat - 1] ?? island.chapterIds[0];
  // リミックス島は座るたびにランダムな島から始まる（以降はボーナスごとに入れ替わる）。
  if (m.islandId === REMIX_ISLAND_ID) return nextRemixStage(null);
  return island.chapterIds[0];
};

/** 試打コーナーの台か（設定6固定・ランキングの比較条件で既定除外）。 */
export const isTrialMachine = (m: Machine): boolean =>
  islandOfMachine(m).trial === true;

/** リミックス島の台か（ボーナスごとにステージ＝島が入れ替わる）。 */
export const isRemixMachine = (m: Machine): boolean =>
  m.islandId === REMIX_ISLAND_ID;

/**
 * リミックス島の次ステージ。**直前と違う島**から選ぶ。
 *
 * 同じ島が続くとリミックスの趣旨（毎ボーナスごとに配列を覚え直す）が成立しない。
 * 出玉の見返りは「覚え直しのコストを払っている」ことが前提なので、
 * ここで同じ島を引くと払っていないのに貰えることになる。
 */
export function nextRemixStage(
  current: string | null,
  rand: () => number = Math.random,
): string {
  const stages = ISLANDS.find((i) => i.id === REMIX_ISLAND_ID)?.chapterIds ?? [];
  if (stages.length === 0) return current ?? CHAPTERS[0].id;
  const pool = stages.filter((id) => id !== current);
  const from = pool.length > 0 ? pool : stages;
  return from[Math.min(from.length - 1, Math.floor(rand() * from.length))];
}

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
