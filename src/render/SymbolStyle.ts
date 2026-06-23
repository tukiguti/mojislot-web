import type { YakuList } from '../data/schemas';

/**
 * 役柄の「強さ」階層。リール上のタイルの大きさ・文字サイズ・縁飾りを決める。
 *  premium(BIG) > bonus(REG) > core(コア7役) > filler(脇役)
 * 実機の「強い柄ほど大きくデカい」見た目を再現するための軸。
 */
export type SymbolTier = 'premium' | 'bonus' | 'core' | 'filler';

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

// コア役は7役（[12b]）。役被り文字を解消したので 1 リール内で色が 1:1 に対応する。
// 各リールで隣り合っても識別しやすいよう、色相を大きく離した高コントラスト7色。
// 黄〜金はプレミアム(ゴールド)専用なので避ける。
const CORE_PALETTE: number[] = [
  0xff3b30, // red
  0xff9500, // orange
  0x34c759, // green
  0x00c7be, // teal/cyan
  0x0a84ff, // blue
  0xbf5af2, // purple
  0xff2d92, // magenta
];

// プレミアム(BIG)役は章に複数ある（例：寿司屋=7揃い / ナマズ=バー揃い）。
// 単一色だと役同士が区別できないので、登場順にパレットを循環させる（1つ目=金）。
const PREMIUM_PALETTE: number[] = [
  0xffd700, // gold（7揃い・1つ目）
  0x3da5ff, // electric blue（バー揃い等・2つ目）
  0xff6ad5, // pink（3つ目以降の予備）
];
const BONUS_COLOR = 0xc0c0c0; // silver（レギュラーボーナス役 = すし＋別字）
const CHERRY_COLOR = 0xff4d6d; // cherry red（2文字役チェリー）
const FILLER_COLOR = 0x4a4a4a; // dark gray（地味な脇役感）

export class SymbolColorResolver {
  /** key = `${reelIdx}:${symbol}` → 役色 */
  private cellColor = new Map<string, number>();
  /** key = `${reelIdx}:${symbol}` → 役柄の強さ階層（タイルサイズ用） */
  private cellTier = new Map<string, SymbolTier>();
  /** 役 id → 役色（成立時の動的ハイライト用） */
  private yakuColor = new Map<string, number>();

  constructor(yakuList: YakuList) {
    // premium → core → cherry → bonus の順で割り当て（先勝ち）
    const ordered = [
      ...yakuList.premiumYaku,
      ...yakuList.coreYaku,
      ...yakuList.cherryYaku,
      ...yakuList.bonusYaku,
    ];

    let coreIdx = 0;
    let premiumIdx = 0;
    for (const yaku of ordered) {
      const color =
        yaku.category === 'premium'
          ? PREMIUM_PALETTE[premiumIdx++ % PREMIUM_PALETTE.length]
          : yaku.category === 'bonus'
            ? BONUS_COLOR
            : yaku.category === 'cherry'
              ? CHERRY_COLOR
              : CORE_PALETTE[coreIdx++ % CORE_PALETTE.length];
      // cherry は小役なので size は core 扱い（小さく枠なし）
      const tier: SymbolTier =
        yaku.category === 'premium'
          ? 'premium'
          : yaku.category === 'bonus'
            ? 'bonus'
            : 'core';
      // 役色を id でひけるよう登録
      this.yakuColor.set(yaku.id, color);
      // チェリーは2文字（symbols.length=2）なので存在する文字だけ登録
      for (let r = 0; r < yaku.symbols.length; r++) {
        const key = `${r}:${yaku.symbols[r]}`;
        // 先勝ち（premium→core→cherry→bonus の順）で色・階層を確定
        if (!this.cellColor.has(key)) {
          this.cellColor.set(key, color);
          this.cellTier.set(key, tier);
        }
      }
    }
  }

  /** 0xRRGGBB の数値で返す（Pixi 用） */
  colorFor(reelIndex: number, symbol: string): number {
    return this.cellColor.get(`${reelIndex}:${symbol}`) ?? FILLER_COLOR;
  }

  /** 役柄の強さ階層を返す（どの役にも属さない文字は filler=脇役） */
  tierFor(reelIndex: number, symbol: string): SymbolTier {
    return this.cellTier.get(`${reelIndex}:${symbol}`) ?? 'filler';
  }

  /** '#rrggbb' で返す（CSS 用） */
  cssFor(reelIndex: number, symbol: string): string {
    const n = this.colorFor(reelIndex, symbol);
    return '#' + n.toString(16).padStart(6, '0');
  }

  /**
   * 役 id からその役の色を返す。役成立時に「3文字を同色にする」ための取得用。
   * 共有文字（複数役で同じ文字を使う）の色衝突は構造上避けられないが、
   * 成立した瞬間だけはこの値で全 3 セルを動的に塗り替えて統一する。
   */
  colorForYakuId(yakuId: string): number | null {
    return this.yakuColor.get(yakuId) ?? null;
  }
}
