import type { YakuList } from '../data/schemas';

/**
 * 役（やく）単位で色を割り当て、その役の構成文字（各リール 1 文字ずつ）に色を伝播させる。
 *
 *  - プレミアム役 → ゴールド固定
 *  - コア役 → 8色パレットを順番に割当（多すぎる場合は再循環）
 *  - 同じ文字が複数役で共有される場合は、最初に登場した役の色を優先
 *  - どの役にも属さないフィラー文字 → ニュートラルグレー
 *
 *  狙い: みかん成立時、左「み」/ 中「か」/ 右「ん」がすべて同じ色になり、
 *  3リールにまたがる「色の縦並び」で何の役が揃っているかが視覚的にわかる。
 */

const CORE_PALETTE: number[] = [
  0xe74c3c, // red
  0xff8c1a, // orange
  0x4ade80, // green
  0x14b8a6, // teal
  0x3b82f6, // blue
  0xa78bfa, // purple
  0xec4899, // pink
  0x06b6d4, // cyan
  0xf472b6, // rose
  0xfacc15, // amber
];

const PREMIUM_COLOR = 0xffd700; // gold
const FILLER_COLOR = 0x4a4a4a; // dark gray（地味な脇役感）

export class SymbolColorResolver {
  /** key = `${reelIdx}:${symbol}` → 役色 */
  private cellColor = new Map<string, number>();

  constructor(yakuList: YakuList) {
    // premium → core → bonus の順で割り当て（先勝ち）
    const ordered = [
      ...yakuList.premiumYaku,
      ...yakuList.coreYaku,
      ...yakuList.bonusYaku,
    ];

    let coreIdx = 0;
    for (const yaku of ordered) {
      const color =
        yaku.category === 'premium'
          ? PREMIUM_COLOR
          : CORE_PALETTE[coreIdx++ % CORE_PALETTE.length];
      for (let r = 0; r < 3; r++) {
        const key = `${r}:${yaku.symbols[r]}`;
        if (!this.cellColor.has(key)) {
          this.cellColor.set(key, color);
        }
      }
    }
  }

  /** 0xRRGGBB の数値で返す（Pixi 用） */
  colorFor(reelIndex: number, symbol: string): number {
    return this.cellColor.get(`${reelIndex}:${symbol}`) ?? FILLER_COLOR;
  }

  /** '#rrggbb' で返す（CSS 用） */
  cssFor(reelIndex: number, symbol: string): string {
    const n = this.colorFor(reelIndex, symbol);
    return '#' + n.toString(16).padStart(6, '0');
  }
}
