import { ISLANDS } from './machines';

/**
 * 島ごとの筐体デザイン。実機のホールと同じで、**シャーシ（金属部）は全島共通**で
 * パネル・リール窓・ボタン・下皿だけが台ごとに違う。島を歩くと筐体の見た目が
 * 変わることで「別の台に来た」と分かる。
 *
 * 値は CSS カスタムプロパティとして筐体のルート要素に流し込む（`themeVars`）。
 * 構造は style.css のクラスが持ち、色だけがここから来る。
 *
 * 一次情報はデザインプロジェクトの「MOJISLOT 台を選ぶ.dc.html」の `THEMES`。
 * 島IDはこちらの内部ID（`hiragana_food` 等）に読み替えてある。
 */

export interface IslandTheme {
  /** トップランプ（筐体最上部の光る帯）。 */
  top: string;
  /** タイトルパネル（島名を出す板）の地と文字。 */
  panel: string;
  panelText: string;
  /** 有効ライン・島インジケータ・島案内板の帯。島を識別する主色。 */
  line: string;
  /** 下パネル（MOJISLOT のロゴ板）の地と文字。 */
  lower: string;
  lowerText: string;
  /** 天井から吊る島看板の地・枠・文字。 */
  sign: string;
  signBorder: string;
  signText: string;
  /** 演出液晶の下辺から漏れる光。 */
  glow: string;
  /** 筐体ボディの地・枠・角丸。角丸だけは形なのでここに置く。 */
  body: string;
  bodyBorder: string;
  radius: string;
  /** 演出液晶の地。 */
  screen: string;
  /** リール窓の枠。 */
  frame: string;
  frameBorder: string;
  /** リールのセル（1コマ）の地・枠・文字。 */
  cell: string;
  cellBorder: string;
  cellText: string;
  /** 操作部（ボタンが並ぶ台座）。 */
  ctrl: string;
  ctrlBorder: string;
  /** STOPボタン。 */
  btn: string;
  btnBorder: string;
  /** 下皿。 */
  tray: string;
  trayBorder: string;
  /** 台の前に置く丸椅子の座面。 */
  stool: string;
}

/** 島1 寿司：朱と生成りの和食器。 */
const SUSHI: IslandTheme = {
  top: 'linear-gradient(#fff4d0,#e8a020)',
  panel: '#c8342a',
  panelText: '#fdf4e3',
  line: '#c8342a',
  lower: 'linear-gradient(#fdf4e3,#e0d0b4)',
  lowerText: '#c8342a',
  sign: 'linear-gradient(#c8342a,#8a1c16)',
  signBorder: '#fdf4e3',
  signText: '#fdf4e3',
  glow: 'rgba(200,52,42,.35)',
  body: 'linear-gradient(#e8d9c0,#c2ab8c)',
  bodyBorder: '#8a6a48',
  radius: '5px 5px 2px 2px',
  screen: 'linear-gradient(#3a2418,#1e120c)',
  frame: 'linear-gradient(#f0e2c8,#b8a382)',
  frameBorder: '#8a6a48',
  cell: 'linear-gradient(#fffaf0,#e0d0b4)',
  cellBorder: '#c2ab8c',
  cellText: '#2a1a14',
  ctrl: 'linear-gradient(#dccdb0,#a89070)',
  ctrlBorder: '#8a6a48',
  btn: 'radial-gradient(circle at 36% 30%,#fffaf0,#e0b060)',
  btnBorder: '#4a3428',
  tray: 'linear-gradient(#3a2418,#1a1008)',
  trayBorder: '#6a4a30',
  stool: 'linear-gradient(#6d1a22,#3d0d13)',
};

/** 島2 動物：黄土と深緑・丸い造形（角丸がいちばん大きい）。 */
const ANIMAL: IslandTheme = {
  top: 'linear-gradient(#fff6c0,#e07020)',
  panel: '#2e6b30',
  panelText: '#f0e6c0',
  line: '#e07020',
  lower: 'linear-gradient(#2e6b30,#1c4a1e)',
  lowerText: '#f0e6c0',
  sign: 'linear-gradient(#d99a20,#8a6210)',
  signBorder: '#2e6b30',
  signText: '#1c2a16',
  glow: 'rgba(217,154,32,.35)',
  body: 'linear-gradient(#e8c980,#b8963c)',
  bodyBorder: '#6a5218',
  radius: '16px 16px 6px 6px',
  screen: 'linear-gradient(#243a18,#12200c)',
  frame: 'linear-gradient(#f4e2ae,#c0a45c)',
  frameBorder: '#6a5218',
  cell: 'linear-gradient(#fffdf2,#e2d4a8)',
  cellBorder: '#c0a45c',
  cellText: '#1c2a16',
  ctrl: 'linear-gradient(#dcc18c,#a8873c)',
  ctrlBorder: '#6a5218',
  btn: 'radial-gradient(circle at 36% 30%,#fffdf2,#8ac060)',
  btnBorder: '#2e4420',
  tray: 'linear-gradient(#3a2c10,#1a1408)',
  trayBorder: '#6a5218',
  stool: 'linear-gradient(#2e6b30,#173a18)',
};

/** 島3 動詞：白×蛍光ミント。唯一の白物家電めいた筐体。 */
const VERB: IslandTheme = {
  top: 'linear-gradient(90deg,#2effd0,#0fb89a)',
  panel: '#0b1416',
  panelText: '#2effd0',
  line: '#2effd0',
  lower: 'linear-gradient(#e8eef0,#b4c0c2)',
  lowerText: '#0fb89a',
  sign: 'linear-gradient(#0b1416,#08171a)',
  signBorder: '#2effd0',
  signText: '#2effd0',
  glow: 'rgba(46,255,208,.3)',
  body: 'linear-gradient(#f2f6f6,#c4cfd0)',
  bodyBorder: '#8fa0a2',
  radius: '3px',
  screen: '#08171a',
  frame: '#e8eef0',
  frameBorder: '#8fa0a2',
  cell: '#ffffff',
  cellBorder: '#d4dcdd',
  cellText: '#0b1416',
  ctrl: 'linear-gradient(#e4eaea,#b4c0c2)',
  ctrlBorder: '#8fa0a2',
  btn: '#ffffff',
  btnBorder: '#0b1416',
  tray: 'linear-gradient(#2a3436,#101a1c)',
  trayBorder: '#4a5a5c',
  stool: 'linear-gradient(#2a3436,#101a1c)',
};

/** 島4 八百屋：若草と木箱・ステンシル。液晶ではなく木箱の絵柄パネル。 */
const GREENGROCER: IslandTheme = {
  top: 'repeating-linear-gradient(90deg,#7ac142 0 12px,#e8d44c 12px 24px)',
  panel: '#2f5d1e',
  panelText: '#e8f0c8',
  line: '#7ac142',
  lower: 'linear-gradient(#f4f7e4,#d4dcb4)',
  lowerText: '#2f5d1e',
  sign: 'linear-gradient(#2f5d1e,#1a3a10)',
  signBorder: '#e8d44c',
  signText: '#e8f0c8',
  glow: 'rgba(122,193,66,.3)',
  body: 'linear-gradient(#c9a870,#96794a)',
  bodyBorder: '#5e4a26',
  radius: '3px',
  screen: 'repeating-linear-gradient(135deg,#2a2414 0 9px,#332c19 9px 18px)',
  frame: 'linear-gradient(#e0cba0,#ac8e5c)',
  frameBorder: '#5e4a26',
  cell: 'linear-gradient(#f8fbee,#dbe2c4)',
  cellBorder: '#b8c49a',
  cellText: '#12200a',
  ctrl: 'linear-gradient(#bfa274,#8f7346)',
  ctrlBorder: '#5e4a26',
  btn: 'radial-gradient(circle at 36% 30%,#f8fbee,#b4d878)',
  btnBorder: '#2a2414',
  tray: 'linear-gradient(#2a2414,#141008)',
  trayBorder: '#5e4a26',
  stool: 'linear-gradient(#2f5d1e,#18300e)',
};

/** 島5 セキュリティ：黒鉄とCRT緑・ラックマウント。唯一セルが暗い。 */
const SECURITY: IslandTheme = {
  top: 'repeating-linear-gradient(90deg,#39ff6a 0 6px,#0e120f 6px 12px)',
  panel: '#050a04',
  panelText: '#39ff6a',
  line: '#a8ff39',
  lower: 'linear-gradient(#0e120f,#050a04)',
  lowerText: '#39ff6a',
  sign: 'linear-gradient(#0e120f,#050a04)',
  signBorder: '#39ff6a',
  signText: '#39ff6a',
  glow: 'rgba(57,255,106,.3)',
  body: 'linear-gradient(#1e2420,#0e120f)',
  bodyBorder: '#3a4a3c',
  radius: '2px',
  screen: '#050a04',
  frame: '#161c18',
  frameBorder: '#3a4a3c',
  cell: '#0a1109',
  cellBorder: '#1e3a1c',
  cellText: '#39ff6a',
  ctrl: 'linear-gradient(#2a322c,#161c18)',
  ctrlBorder: '#3a4a3c',
  btn: '#161c18',
  btnBorder: '#39ff6a',
  tray: '#0e120f',
  trayBorder: '#3a4a3c',
  stool: 'linear-gradient(#1e2420,#0a0f0a)',
};

/** 島7 リミックス：他5島の主色を並べた帯。まだ調整中の島。 */
const REMIX: IslandTheme = {
  top: 'linear-gradient(90deg,#c8342a 0 20%,#d99a20 20% 40%,#2effd0 40% 60%,#7ac142 60% 80%,#39ff6a 80% 100%)',
  panel: '#0d0a16',
  panelText: '#e8dcff',
  line: '#b8a0ff',
  lower: 'linear-gradient(#2a2540,#141024)',
  lowerText: '#e8dcff',
  sign: 'linear-gradient(#2a2540,#141024)',
  signBorder: '#b8a0ff',
  signText: '#e8dcff',
  glow: 'rgba(184,160,255,.32)',
  body: 'linear-gradient(#2a2540,#141024)',
  bodyBorder: '#6a5ca0',
  radius: '5px 5px 2px 2px',
  screen: 'linear-gradient(#1a1430,#0b0816)',
  frame: 'linear-gradient(#d8d0f0,#8a80b8)',
  frameBorder: '#4a4270',
  cell: 'linear-gradient(#fdfbff,#ddd6ee)',
  cellBorder: '#b0a8cc',
  cellText: '#12101c',
  ctrl: 'linear-gradient(#3a3458,#1e1a34)',
  ctrlBorder: '#4a4270',
  btn: 'radial-gradient(circle at 36% 30%,#ffffff,#b8a0ff)',
  btnBorder: '#1e1a34',
  tray: 'linear-gradient(#1e1a34,#0b0816)',
  trayBorder: '#4a4270',
  stool: 'linear-gradient(#3a1050,#180a26)',
};

/** 島ID → テーマ。島が増えたら足す（未定義なら寿司の見た目で出す）。 */
export const ISLAND_THEMES: Record<string, IslandTheme> = {
  hiragana_food: SUSHI,
  katakana_animal: ANIMAL,
  hiragana_verb: VERB,
  yasai: GREENGROCER,
  security: SECURITY,
  remix: REMIX,
};

/** 未知の島でも筐体が破綻しないよう既定を返す。 */
export function themeOf(islandId: string): IslandTheme {
  return ISLAND_THEMES[islandId] ?? SUSHI;
}

/** 島の主色だけ欲しい場面（案内板の帯・インジケータ）用。 */
export const lineColorOf = (islandId: string): string => themeOf(islandId).line;

/**
 * テーマを CSS カスタムプロパティの文字列にする。筐体のルート要素の style に置く。
 * 色は全部ここ経由なので、style.css 側は `var(--isl-*)` だけを見ればよい。
 */
export function themeVars(islandId: string): string {
  const t = themeOf(islandId);
  return [
    `--isl-top:${t.top}`,
    `--isl-panel:${t.panel}`,
    `--isl-panel-text:${t.panelText}`,
    `--isl-line:${t.line}`,
    `--isl-lower:${t.lower}`,
    `--isl-lower-text:${t.lowerText}`,
    `--isl-sign:${t.sign}`,
    `--isl-sign-border:${t.signBorder}`,
    `--isl-sign-text:${t.signText}`,
    `--isl-glow:${t.glow}`,
    `--isl-body:${t.body}`,
    `--isl-body-border:${t.bodyBorder}`,
    `--isl-radius:${t.radius}`,
    `--isl-screen:${t.screen}`,
    `--isl-frame:${t.frame}`,
    `--isl-frame-border:${t.frameBorder}`,
    `--isl-cell:${t.cell}`,
    `--isl-cell-border:${t.cellBorder}`,
    `--isl-cell-text:${t.cellText}`,
    `--isl-ctrl:${t.ctrl}`,
    `--isl-ctrl-border:${t.ctrlBorder}`,
    `--isl-btn:${t.btn}`,
    `--isl-btn-border:${t.btnBorder}`,
    `--isl-tray:${t.tray}`,
    `--isl-tray-border:${t.trayBorder}`,
    `--isl-stool:${t.stool}`,
  ].join(';');
}

/** テーマ未定義の島が混ざっていないか（開発時の取りこぼし検出）。 */
export const islandsMissingTheme = (): string[] =>
  ISLANDS.filter((i) => !(i.id in ISLAND_THEMES)).map((i) => i.id);
