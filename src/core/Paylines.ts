import type { ReelEngine } from './ReelEngine';

/**
 * 3x3 グリッドの可視セル。
 * 各リール 3 セル × 3 リール。row 0 が画面上端（top）。
 */
export type Vertical = 'top' | 'middle' | 'bottom';

export type Grid3x3 = readonly [
  readonly [string, string, string], // top    row (row 0)
  readonly [string, string, string], // middle row (row 1)
  readonly [string, string, string], // bottom row (row 2)
];

export type PartialGrid3x3 = readonly [
  readonly [string | null, string | null, string | null],
  readonly [string | null, string | null, string | null],
  readonly [string | null, string | null, string | null],
];

/** ペイライン 1 本＝ 3 セル分の [row, reelIndex] 座標。 */
export interface Payline {
  id: PaylineId;
  name: string;
  /** [row, col] の3つ。col はリールindex（0..2）、row は 0=top/1=middle/2=bottom */
  cells: readonly [
    readonly [number, number],
    readonly [number, number],
    readonly [number, number],
  ];
}

export type PaylineId =
  | 'top'
  | 'middle'
  | 'bottom'
  | 'diag_tlbr'
  | 'diag_bltr';

/** ライン形の定義（全5本）。**有効ラインはこの中から選ぶ**。 */
const ALL_PAYLINES: readonly Payline[] = [
  { id: 'top', name: '上段', cells: [[0, 0], [0, 1], [0, 2]] },
  { id: 'middle', name: '中段', cells: [[1, 0], [1, 1], [1, 2]] },
  { id: 'bottom', name: '下段', cells: [[2, 0], [2, 1], [2, 2]] },
  { id: 'diag_tlbr', name: '右下がり', cells: [[0, 0], [1, 1], [2, 2]] },
  { id: 'diag_bltr', name: '右上がり', cells: [[2, 0], [1, 1], [0, 2]] },
];

// node の型を入れていないので globalThis 経由で読む（ブラウザでは undefined）。
const ENV = (globalThis as { process?: { env?: Record<string, string | undefined> } })
  .process?.env;

/**
 * 有効ライン＝**払い出しの判定対象**。ここに揃えば成立する。
 *
 * 5本のまま。判定を1本に絞ると引き込みの対象範囲が7コマ→5コマに縮み、
 * 下手な人ほど取りこぼす（実測で初心者 -8pt・腕の開き1.87→2.11倍）。
 * 検証用に `PAYLINE_SET` で絞れるようにしてあるが、本番は既定の5本。
 */
const PAYLINE_SET = ENV?.PAYLINE_SET?.split(',');

export const PAYLINES: readonly Payline[] = PAYLINE_SET
  ? ALL_PAYLINES.filter((l) => PAYLINE_SET.includes(l.id))
  : ALL_PAYLINES;

/** ペイラインの行番号 0/1/2 → 可視位置。 */
export const ROW_VERTICAL: readonly Vertical[] = ['top', 'middle', 'bottom'];

/**
 * **主ライン**＝制御が狙う唯一のライン。判定（`PAYLINES`）とは役割が違う。
 *
 * 引き込みも停止テーブル生成も告知も、すべてこの1本だけを見る。他のラインへ
 * 逃がす分岐を持たないので、制御は「主ラインへ寄せられるか」の一問一答になる。
 *
 * 判定は5ラインのままなので、**狙わなかったラインで偶然揃った分は払い出される**。
 * 制御を単純にしても取りこぼしにならない、という非対称がこの構成の狙い。
 *
 * 基準がバラバラだと、第1停止が主ラインを狙っていないのに第2・第3が主ラインへ
 * 揃えようとする、という噛み合わせ事故が起きる（実際それで機械割が32.7%まで
 * 落ちた）。だから制御側の基準はすべてここを参照する。
 */
/**
 * 本作の主ラインは**右上がり**（左下段・中中段・右上段）。リール配列・停止テーブル・
 * リーチ目テーブルはすべてこの前提で焼いてあるので、**既定値をここから動かすと
 * データと制御が噛み合わなくなる**（実測で機械割が2割変わる）。
 *
 * 環境変数はツールと検証用。ブラウザでは `process` が無いので既定値が使われる＝
 * 本番は常に右上がり。次に作るAT機は `'middle'` にする。
 */
const PRIMARY_ID = ENV?.PRIMARY_LINE ?? 'diag_bltr';

export const PRIMARY_PAYLINE: Payline =
  PAYLINES.find((l) => l.id === PRIMARY_ID) ?? PAYLINES[0];

/** 主ラインがそのリールで要求する行番号（0=top / 1=middle / 2=bottom）。 */
export function primaryRowIndexOf(reelIndex: number): number {
  const cell = PRIMARY_PAYLINE.cells.find(([, col]) => col === reelIndex);
  return cell ? cell[0] : 1;
}

/** 主ラインがそのリールで要求する行。 */
export function primaryRowOf(reelIndex: number): Vertical {
  return ROW_VERTICAL[primaryRowIndexOf(reelIndex)];
}

const VERTICAL_OFFSET: Record<Vertical, number> = {
  top: 1, // pos + 1
  middle: 0, // pos
  bottom: -1, // pos - 1
};

/** リール 1 本の position から可視 3 セルを取り出す（top/middle/bottom）。 */
export function getVisibleCell(engine: ReelEngine, vertical: Vertical): string {
  return engine.strip.cells[getVisibleCellIndex(engine, vertical)];
}

/**
 * リール内 cells[] 配列上での「可視位置 (top/middle/bottom)」に対応する index。
 * ReelView.highlightCells() に渡す cell index と同じ座標系。
 */
export function getVisibleCellIndex(engine: ReelEngine, vertical: Vertical): number {
  const total = engine.strip.cells.length;
  const pos = Math.round(engine.position);
  const offset = VERTICAL_OFFSET[vertical];
  return (((pos + offset) % total) + total) % total;
}

/** strip と position から可視 3 セルを取り出す（resolver 用）。 */
export function visibleAt(
  cells: readonly string[],
  position: number,
  vertical: Vertical,
): string {
  const total = cells.length;
  const offset = VERTICAL_OFFSET[vertical];
  const idx = (((position + offset) % total) + total) % total;
  return cells[idx];
}

/** 全リール停止後の 3x3 グリッドを engines から組み立てる。 */
export function extractGrid(engines: readonly ReelEngine[]): Grid3x3 {
  const verticals: Vertical[] = ['top', 'middle', 'bottom'];
  return verticals.map(
    (v) =>
      engines.map((e) => getVisibleCell(e, v)) as [string, string, string],
  ) as unknown as Grid3x3;
}

/** ペイラインから 3 文字を取り出す。 */
export function extractLineSymbols(
  grid: Grid3x3,
  line: Payline,
): [string, string, string] {
  return line.cells.map(([row, col]) => grid[row][col]) as [
    string,
    string,
    string,
  ];
}

/** PartialGrid 版（slip resolver 用）。null 要素はワイルドカード扱い。 */
export function extractPartialLineSymbols(
  grid: PartialGrid3x3,
  line: Payline,
): [string | null, string | null, string | null] {
  return line.cells.map(([row, col]) => grid[row][col]) as [
    string | null,
    string | null,
    string | null,
  ];
}
