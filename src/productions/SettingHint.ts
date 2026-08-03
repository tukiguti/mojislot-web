import type { Setting } from './MachineSetting';

/**
 * 設定示唆。ボーナスの**終了画面**で伝える（実機でいちばん定番の示唆手法）。
 *
 * データカウンターは「引けたかどうか」という結果しか映さないので、
 * 短時間だと運に埋もれる。示唆はそこを補う**別経路の情報**で、
 * 1回のボーナスで一気に確度が上がることがある。
 *
 * 設計で外せない性質：
 *  - **出なくても低設定とは限らない**。通常画面はどの設定でも最頻出
 *  - **出たら意味がある**。偶数・奇数・高設定・最高設定は、その条件を満たす台でしか出ない
 *  - **強い示唆ほど出ない**。最高設定確定は設定6でも数％
 *
 * 「出た＝確定」ではなく「出た＝その条件に絞れる」。否定はできないが肯定はできる、
 * という非対称が読み合いを作る。全部を確率だけにすると印象論になり、
 * 全部を確定にすると1回見て終わる。
 */

export type EndScreenKind =
  /** 通常。どの設定でも最頻出＝出ても何も分からない。 */
  | 'normal'
  /** 金縁。高設定ほど出やすいだけの弱い示唆（低設定でも出る）。 */
  | 'gold'
  /** 偶数設定示唆。設定2・4・6でのみ出る。 */
  | 'even'
  /**
   * 奇数設定示唆。設定1・3・5でのみ出る。
   *
   * 他の示唆と違い、**この台を降りる判断に使える**。設定6は偶数側なので、
   * 出た時点で6が消える。設定6を探すのがホールの遊びである以上、
   * 「粘る」だけでなく「見切る」材料があると探索が前に進む。
   *
   * 否定の示唆ではあるが、非対称そのものは壊していない。奇数示唆が出れば
   * 1・3・5に絞れる（肯定の絞り込み）のであって、出ないことは何も意味しない。
   */
  | 'odd'
  /** 設定4以上示唆。設定4・5・6でのみ出る。 */
  | 'high'
  /** 最高設定確定。設定6でのみ出る。 */
  | 'max';

export interface EndScreen {
  kind: EndScreenKind;
  /** 終了画面に添える一言。断定はしない（'max' を除く）。 */
  label: string;
  /** 何が読み取れるか。図鑑やヘルプでの説明にも使う。 */
  meaning: string;
}

const SCREENS: Record<EndScreenKind, Omit<EndScreen, 'kind'>> = {
  normal: { label: '', meaning: '通常の終了画面。設定は読み取れない' },
  gold: { label: 'また来てね', meaning: '高設定ほど出やすい（弱い示唆）' },
  even: { label: 'また来てね ＋ 偶数の月', meaning: '偶数設定（2・4・6）' },
  odd: { label: 'また来てね ＋ 奇数の月', meaning: '奇数設定（1・3・5）' },
  high: { label: 'また来てね ＋ 金の月', meaning: '設定4以上' },
  max: { label: 'ありがとう ＋ 虹の月', meaning: '最高設定（設定6）確定' },
};

/**
 * 設定ごとの出現ウェイト。合計は設定ごとに揃っていなくてよい（内部で正規化する）。
 *
 * `even` は設定2・4・6、`odd` は1・3・5、`high` は4以上、`max` は6のみで0以外にする。
 * ここを崩すと「出たら意味がある」が壊れる（示唆が嘘になる）。
 *
 * `odd` も偶数示唆と同じく**高い方ほど出やすい**（1 < 3 < 5）。奇数側の最上位は
 * 設定5なので、6が消えると同時に5への期待が残る。ここを一律にすると
 * 「奇数＝低設定」と読まれ、示唆が撤退の合図だけになってしまう。
 */
const WEIGHTS: Record<EndScreenKind, Record<Setting, number>> = {
  normal: { 1: 910, 2: 900, 3: 855, 4: 830, 5: 720, 6: 700 },
  gold:   { 1:  60, 2:  70, 3: 100, 4: 100, 5: 160, 6: 130 },
  even:   { 1:   0, 2:  30, 3:   0, 4:  45, 5:   0, 6:  90 },
  odd:    { 1:  30, 2:   0, 3:  45, 4:   0, 5:  90, 6:   0 },
  high:   { 1:   0, 2:   0, 3:   0, 4:  25, 5:  30, 6:  50 },
  max:    { 1:   0, 2:   0, 3:   0, 4:   0, 5:   0, 6:  30 },
};

const KINDS = Object.keys(WEIGHTS) as EndScreenKind[];

/**
 * ボーナス終了時の画面を抽選する。
 * @param setting その台の設定
 * @param rand    0以上1未満の乱数
 */
export function drawEndScreen(setting: Setting, rand: () => number): EndScreen {
  const total = KINDS.reduce((a, k) => a + WEIGHTS[k][setting], 0);
  let r = rand() * total;
  for (const kind of KINDS) {
    r -= WEIGHTS[kind][setting];
    if (r <= 0) return { kind, ...SCREENS[kind] };
  }
  return { kind: 'normal', ...SCREENS.normal };
}

/** その終了画面が出うる設定の一覧（示唆の意味そのもの）。 */
export function possibleSettings(kind: EndScreenKind): Setting[] {
  return (Object.keys(WEIGHTS[kind]) as unknown as string[])
    .map((s) => Number(s) as Setting)
    .filter((s) => WEIGHTS[kind][s] > 0);
}
