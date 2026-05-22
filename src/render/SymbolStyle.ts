/**
 * リール文字を「文字ごとに固定の色」で塗り分けるためのヘルパ。
 * 同じ文字は常に同じ色になるので、回転中でも視覚的にトラッキングしやすい。
 *
 * パレットは暗い液晶背景に映えるビビッドな色を選定。
 * 文字数より少ないので衝突は起きるが、隣接文字さえ違えば視認性は大きく改善する。
 */

const SYMBOL_PALETTE: number[] = [
  0xffd166, // amber
  0x4cc9f0, // cyan
  0xef476f, // pink
  0x06d6a0, // mint
  0xffa552, // orange
  0xb388ff, // lavender
  0x80ed99, // light green
  0xffea00, // electric yellow
  0xff6b6b, // coral
  0x90e0ef, // sky
  0xf472b6, // rose
  0xc4b5fd, // periwinkle
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
