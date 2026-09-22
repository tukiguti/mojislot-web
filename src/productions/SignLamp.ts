import type { Setting } from './MachineSetting';

/**
 * 看板のランプ（筐体の上の看板に並ぶ7つの球）の設定示唆。
 *
 * **コンボが節目（5・10・15…）に届いた瞬間**に抽選する（2026-09-23）。
 * 終了画面と筐体ランプ（スピーカー）はボーナス**終了時**にしか出ないので、
 * こちらは**打っている最中**に手掛かりを返す。コンボを繋げるほど抽選の回数が
 * 増えるので、目押しの上手い人ほど設定を読む材料が多く集まる。
 *
 * 色ごとに意味が違い、光り方でも見分けられる：
 *  - 白：期待度・弱（左から右へ流れる）
 *  - 青：**偶数寄り**（両端から中央へ寄る）
 *  - 黄：**奇数寄り**（中央から両端へ広がる）
 *  - 赤：期待度・強（7つが一斉に点滅）
 *  - 虹：期待度・最強（虹色が流れて全点灯）。稀
 *
 * どの色も守る性質：
 *  - **消灯が最頻**。光らなくても低設定とは限らない
 *  - **どの色も全設定で出る**（0を作ると「設定◯以上確定」や「偶数確定」になり、
 *    終了画面が持っている確定の軸と重なる）。青が出ても奇数はありうる
 *  - 白・赤・虹は設定に対して**単調**。青・黄は偶奇でおよそ2倍の差を付け、
 *    その中でも高設定ほどわずかに出やすい
 */

export type SignLampLevel = 'off' | 'white' | 'blue' | 'yellow' | 'red' | 'rainbow';

/** 抽選する節目の間隔。コンボがこの倍数に届いた瞬間に1回引く。 */
export const SIGN_LAMP_STEP = 5;

/** コンボ数が節目か（5・10・15…）。 */
export function isSignLampMilestone(streak: number): boolean {
  return streak > 0 && streak % SIGN_LAMP_STEP === 0;
}

/** 何が読み取れるか。図鑑やヘルプの説明に使う。 */
export const SIGN_LAMP_MEANINGS: Record<SignLampLevel, string> = {
  off: '消灯。設定は読み取れない',
  white: '高設定ほど出やすい（弱）',
  blue: '偶数設定で出やすい',
  yellow: '奇数設定で出やすい',
  red: '高設定ほど出やすい（強）',
  rainbow: '高設定ほど出やすい（最強）。ただし確定ではない',
};

/**
 * 色ごとの出現ウェイト（設定ごとに合計1000）。
 *
 * 筐体ランプより**1回あたりの差を小さく**置く。こちらは1回のボーナスで何度も
 * 引くので、差を大きくすると数回のボーナスで設定が見えてしまう。
 */
const WEIGHTS: Record<SignLampLevel, Record<Setting, number>> = {
  off:     { 1: 880, 2: 873, 3: 860, 4: 841, 5: 819, 6: 795 },
  white:   { 1:  60, 2:  62, 3:  65, 4:  70, 5:  75, 6:  80 },
  blue:    { 1:  15, 2:  35, 3:  18, 4:  40, 5:  21, 6:  45 },
  yellow:  { 1:  35, 2:  15, 3:  38, 4:  18, 5:  41, 6:  21 },
  red:     { 1:   8, 2:  12, 3:  15, 4:  25, 5:  35, 6:  45 },
  rainbow: { 1:   2, 2:   3, 3:   4, 4:   6, 5:   9, 6:  14 },
};

export const SIGN_LAMP_LEVELS = Object.keys(WEIGHTS) as SignLampLevel[];

/**
 * 節目で看板のランプを抽選する。
 * @param setting その台の設定
 * @param rand    0以上1未満の乱数
 */
export function drawSignLamp(setting: Setting, rand: () => number): SignLampLevel {
  const total = SIGN_LAMP_LEVELS.reduce((a, l) => a + WEIGHTS[l][setting], 0);
  let r = rand() * total;
  for (const level of SIGN_LAMP_LEVELS) {
    r -= WEIGHTS[level][setting];
    if (r <= 0) return level;
  }
  return 'off';
}

/** その色が出る確率（設定ごと）。テストと説明で使う。 */
export function signLampRate(level: SignLampLevel, setting: Setting): number {
  const total = SIGN_LAMP_LEVELS.reduce((a, l) => a + WEIGHTS[l][setting], 0);
  return WEIGHTS[level][setting] / total;
}
