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

/** 5 本のペイライン：横3本 + 斜め2本。 */
export const PAYLINES: readonly Payline[] = [
  { id: 'top', name: '上段', cells: [[0, 0], [0, 1], [0, 2]] },
  { id: 'middle', name: '中段', cells: [[1, 0], [1, 1], [1, 2]] },
  { id: 'bottom', name: '下段', cells: [[2, 0], [2, 1], [2, 2]] },
  { id: 'diag_tlbr', name: '右下がり', cells: [[0, 0], [1, 1], [2, 2]] },
  { id: 'diag_bltr', name: '右上がり', cells: [[2, 0], [1, 1], [0, 2]] },
];

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
