import type { Setting } from './MachineSetting';

/**
 * 筐体ランプ（操作部の左右にあるスピーカーグリル）の設定示唆。
 * ボーナス終了時に、終了画面と**同時**に点く。
 *
 * 終了画面（SettingHint）とは**軸が違う**。あちらは「偶数」「4以上」「6確定」と
 * 条件で絞る示唆で、当たれば一気に確度が上がる代わりに、ほとんどの回は
 * 何も出ない。こちらは**期待度だけ**を色の強さで返す——絞り込みはしないが、
 * 打った回数だけ手掛かりが積み上がる。
 *
 * 同じ軸を2経路で出しても読める量は増えないので、ここでは
 * **偶数・奇数・確定を作らない**。どの色も全設定で出る（設定1でも赤は出る）。
 * だから「赤が出た＝高設定」ではなく「赤が出た＝高設定側に寄った」でしかない。
 *
 * 設計で外せない性質は終了画面と同じ：
 *  - **消灯が最頻**。出なくても低設定とは限らない
 *  - **強い色ほど出ない**。赤は設定6でも6.5%
 *  - 期待度は設定に対して**単調**。1 < 2 < 3 < 4 < 5 < 6 の順に強い色が出やすい
 */

export type LampColor =
  /** 消灯。どの設定でも最頻出＝出なくても何も分からない。 */
  | 'off'
  /** 青。いちばん弱い。 */
  | 'blue'
  /** 黄。中位。 */
  | 'yellow'
  /** 赤。いちばん強いが**確定ではない**（設定1でも出る）。 */
  | 'red';

export interface CabinetLamp {
  color: LampColor;
  /** 何が読み取れるか。図鑑やヘルプでの説明にも使う。 */
  meaning: string;
}

const MEANINGS: Record<LampColor, string> = {
  off: '消灯。設定は読み取れない',
  blue: '高設定ほど出やすい（弱い）',
  yellow: '高設定ほど出やすい（中）',
  red: '高設定ほど出やすい（強い）。ただし確定ではない',
};

/**
 * 色ごとの出現ウェイト（設定ごとに合計1000）。
 *
 * **どの設定でも0にしない。** 0を作った時点でその色は「設定◯以上確定」になり、
 * 終了画面が持っている確定の軸と重なる。ここは期待度専用に保つ。
 */
const WEIGHTS: Record<LampColor, Record<Setting, number>> = {
  off:    { 1: 900, 2: 885, 3: 850, 4: 810, 5: 745, 6: 690 },
  blue:   { 1:  75, 2:  80, 3:  95, 4: 105, 5: 130, 6: 145 },
  yellow: { 1:  20, 2:  27, 3:  41, 4:  58, 5:  80, 6: 100 },
  red:    { 1:   5, 2:   8, 3:  14, 4:  27, 5:  45, 6:  65 },
};

const COLORS = Object.keys(WEIGHTS) as LampColor[];

/**
 * ボーナス終了時のランプを抽選する。
 * @param setting その台の設定
 * @param rand    0以上1未満の乱数
 */
export function drawCabinetLamp(setting: Setting, rand: () => number): CabinetLamp {
  const total = COLORS.reduce((a, c) => a + WEIGHTS[c][setting], 0);
  let r = rand() * total;
  for (const color of COLORS) {
    r -= WEIGHTS[color][setting];
    if (r <= 0) return { color, meaning: MEANINGS[color] };
  }
  return { color: 'off', meaning: MEANINGS.off };
}

/** その色が出る確率（設定ごと）。図鑑の説明とテストで使う。 */
export function lampRate(color: LampColor, setting: Setting): number {
  const total = COLORS.reduce((a, c) => a + WEIGHTS[c][setting], 0);
  return WEIGHTS[color][setting] / total;
}
