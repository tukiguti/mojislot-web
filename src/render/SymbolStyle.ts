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
 *  - 色は **役データの `color`（`data/yaku/<章>.json`）が第一**。書いてあればそれを使う
 *  - 書いていない役はカテゴリごとのパレットから登場順に配る（フォールバック）
 *  - 同じ文字が複数役で共有される場合は、最初に登場した役の色を優先
 *  - どの役にも属さないフィラー文字 → ニュートラルグレー
 *
 *  狙い: みかん成立時、左「み」/ 中「か」/ 右「ん」がすべて同じ色になり、
 *  3リールにまたがる「色の縦並び」で何の役が揃っているかが視覚的にわかる。
 *
 *  図柄は生成画像を廃してドット文字だけになったので、色はタイルの地ではなく
 *  **文字そのもの**に乗る（白い字面を tint する）。黒地に色文字なので、暗い色は
 *  そのまま読みにくさになる。以下の色はどれも L*≧57 に揃えてある。
 */

/**
 * ボーナス（premium）の色。実機の「7・7・BAR」に相当する赤／青の2色。
 *
 * 全5島で役の構造が同じ——BIG1 = A・B・C / BIG2 = D・E・F / **REG = A・B・F**——
 * なので、BIG1を赤・BIG2を青にすると REG は自動的に **赤・赤・青** になる。
 * REG に専用色を持たせないのはそのため（下のコンストラクタの先勝ち参照）。
 * 3つ目以降は予備で、いまはどの島も BIG は2つ。
 */
const PREMIUM_PALETTE: number[] = [
  0xff3b30, // red   … BIG1（＝実機の7）
  0x3da5ff, // blue  … BIG2（＝実機のBAR）
  0xff6ad5, // pink  … 3つ目以降の予備
];

/**
 * 小役（core）のフォールバックパレット。**赤と青はボーナス予約なので入れない。**
 *
 * 現行5島の小役は全て `data/yaku` 側で色を指定してあるので、ここが使われるのは
 * 色を書かずに役を足した時だけ。順番はパレット内で色相が最も散る並びにしてある。
 */
const CORE_PALETTE: number[] = [
  0xff9500, // orange
  0x34c759, // green
  0x00c7be, // teal
  0xbf5af2, // purple
];

/**
 * チェリー（2文字役）の色。
 *
 * 旧値 0xff4d6d は BIG1 の赤（0xff3b30）から CIELAB で ΔE≈31 しか離れておらず、
 * 「赤い文字が2つ止まった」がボーナスと紛らわしかった。マゼンタ寄りに振って
 * ΔE≈56（赤）／95（青）まで離してある。小役どうし（orange 等）との最短距離より
 * ボーナスとの距離を優先する——チェリーを小役と見間違えても損はないが、
 * ボーナスと見間違えるとガセ告知になるため。
 */
const CHERRY_COLOR = 0xff2d92; // magenta
const FILLER_COLOR = 0x4a4a4a; // dark gray（地味な脇役感）

/** `#rrggbb` → 0xRRGGBB。未指定・不正なら null（schema が形式を保証している）。 */
function parseHexColor(css: string | undefined): number | null {
  if (!css) return null;
  const n = Number.parseInt(css.slice(1), 16);
  return Number.isNaN(n) ? null : n;
}

export class SymbolColorResolver {
  /** key = `${reelIdx}:${symbol}` → 役色 */
  private cellColor = new Map<string, number>();
  /** key = `${reelIdx}:${symbol}` → 役柄の強さ階層（タイルサイズ用） */
  private cellTier = new Map<string, SymbolTier>();
  /** 役 id → 役色（成立時の動的ハイライト用） */
  private yakuColor = new Map<string, number>();

  constructor(yakuList: YakuList) {
    /** BIG の色。データ指定があればそれ、無ければ赤→青の順。 */
    const bigColor = (i: number): number =>
      parseHexColor(yakuList.premiumYaku[i]?.color) ??
      PREMIUM_PALETTE[i % PREMIUM_PALETTE.length];

    // premium → core → cherry → bonus の順で割り当て（先勝ち）。
    // **REG(bonus) を最後に置いているのが赤赤青の仕掛け**：REG の3文字は
    // A・B が BIG1、F が BIG2 と同じ（リール位置ごと）なので、先に BIG が
    // 塗った色がそのまま残り、REG 用の色は1文字も塗られない。
    const ordered = [
      ...yakuList.premiumYaku,
      ...yakuList.coreYaku,
      ...yakuList.cherryYaku,
      ...yakuList.bonusYaku,
    ];

    let coreIdx = 0;
    let premiumIdx = 0;
    for (const yaku of ordered) {
      // 役データの color が最優先。無ければカテゴリごとのフォールバック。
      const fallback: number =
        yaku.category === 'premium'
          ? bigColor(premiumIdx++)
          : yaku.category === 'bonus'
            ? // REG は専用色を持たない。カットインと成立ハイライトは
              // 役 id 経由で1色しか受け取れないので、3文字のうち2文字を
              // 占める BIG1 の赤を代表色にする。
              bigColor(0)
            : yaku.category === 'cherry'
              ? CHERRY_COLOR
              : CORE_PALETTE[coreIdx++ % CORE_PALETTE.length];
      const color = parseHexColor(yaku.color) ?? fallback;
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

  /**
   * 役 id の色を '#rrggbb' で返す（CSS 用）。役に色が無ければ fallback。
   * カットインの手続き生成は、この色から放射グローと光線を組み立てる。
   */
  cssForYakuId(yakuId: string, fallback = '#ffd700'): string {
    const n = this.colorForYakuId(yakuId);
    return n === null ? fallback : '#' + n.toString(16).padStart(6, '0');
  }
}
