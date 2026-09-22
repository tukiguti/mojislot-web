import type { Setting } from './MachineSetting';

/**
 * 看板のランプ（筐体の上の看板に並ぶ7つの球）の設定示唆。
 *
 * **コンボが節目（5・10・15…）に届いた瞬間**に抽選する（2026-09-23）。
 * 終了画面と筐体ランプ（スピーカー）はボーナス**終了時**にしか出ないので、
 * こちらは**打っている最中**に手掛かりを返す。コンボを繋げるほど抽選の回数が
 * 増えるので、目押しの上手い人ほど設定を読む材料が多く集まる。
 *
 * 返すのは**期待度**（示唆弱・示唆強）。筐体ランプと同じ性質を守る：
 *  - **消灯が最頻**。光らなくても低設定とは限らない
 *  - **強い方ほど出ない**
 *  - どちらも**全設定で出る**（0を作ると「設定◯以上確定」になり、終了画面の
 *    確定の軸と重なる）
 *  - 期待度は設定に対して**単調**
 */

export type SignLampLevel =
  /** 消灯。どの設定でも最頻出。 */
  | 'off'
  /** 示唆弱。金色が左から右へ流れる。 */
  | 'weak'
  /** 示唆強。赤で全点滅する。 */
  | 'strong';

/** 抽選する節目の間隔。コンボがこの倍数に届いた瞬間に1回引く。 */
export const SIGN_LAMP_STEP = 5;

/** コンボ数が節目か（5・10・15…）。 */
export function isSignLampMilestone(streak: number): boolean {
  return streak > 0 && streak % SIGN_LAMP_STEP === 0;
}

/**
 * 段ごとの出現ウェイト（設定ごとに合計1000）。
 *
 * 筐体ランプより**弱めに**置く。こちらは1回のボーナスで何度も引くので、
 * 1回あたりの差を大きくすると、数回のボーナスで設定が見えてしまう。
 */
const WEIGHTS: Record<SignLampLevel, Record<Setting, number>> = {
  off:    { 1: 900, 2: 885, 3: 860, 4: 830, 5: 790, 6: 750 },
  weak:   { 1:  85, 2:  95, 3: 110, 4: 125, 5: 150, 6: 170 },
  strong: { 1:  15, 2:  20, 3:  30, 4:  45, 5:  60, 6:  80 },
};

const LEVELS = Object.keys(WEIGHTS) as SignLampLevel[];

/**
 * 節目で看板のランプを抽選する。
 * @param setting その台の設定
 * @param rand    0以上1未満の乱数
 */
export function drawSignLamp(setting: Setting, rand: () => number): SignLampLevel {
  const total = LEVELS.reduce((a, l) => a + WEIGHTS[l][setting], 0);
  let r = rand() * total;
  for (const level of LEVELS) {
    r -= WEIGHTS[level][setting];
    if (r <= 0) return level;
  }
  return 'off';
}

/** その段が出る確率（設定ごと）。テストと説明で使う。 */
export function signLampRate(level: SignLampLevel, setting: Setting): number {
  const total = LEVELS.reduce((a, l) => a + WEIGHTS[l][setting], 0);
  return WEIGHTS[level][setting] / total;
}
