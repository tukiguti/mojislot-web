/**
 * リール文字を「文字ごとに固定の色」で塗り分けるためのヘルパ。
 * 同じ文字は常に同じ色になるので、回転中でも視覚的にトラッキングしやすい。
 *
 * パレットは暗い液晶背景に映えるビビッドな色を選定。
 * 文字数より少ないので衝突は起きるが、隣接文字さえ違えば視認性は大きく改善する。
 */

/**
 * 8 色のはっきりした色相のみ採用。
 * 似た色（amber/peach/yellow が共存していた）で起きていた判別ミスを抑え、
 * 文字を白固定にした上で「タイル背景の色」として使う。
 */
const SYMBOL_PALETTE: number[] = [
  0xe74c3c, // red
  0xff8c1a, // orange
  0xffd700, // gold
  0x4ade80, // green
  0x14b8a6, // teal
  0x3b82f6, // blue
  0xa78bfa, // purple
  0xec4899, // pink
];

/** djb2 ベースの簡易ハッシュ（同じ文字 → 同じ index） */
function hashString(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return h >>> 0;
}

/** 文字に対して固定のカラー（0xRRGGBB）を返す */
export function symbolColor(symbol: string): number {
  return SYMBOL_PALETTE[hashString(symbol) % SYMBOL_PALETTE.length];
}

/** CSS 用の '#rrggbb' 表記 */
export function symbolColorCss(symbol: string): string {
  const n = symbolColor(symbol);
  return '#' + n.toString(16).padStart(6, '0');
}
