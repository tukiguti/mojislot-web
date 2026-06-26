import { Assets, Texture } from 'pixi.js';
import type { Yaku } from '../data/schemas';

// ART_VER: 図柄を作り直すたびに上げる（同名 webp のブラウザキャッシュ対策）。
const ART_VER = '6';
// 図柄画像を持つ章。ここに無い章は色タイル＋文字で描く。
const CHAPTERS_WITH_SYMBOL_ART = new Set<string>([
  'hiragana_food',
  'katakana_animal',
  'yasai',
  'hiragana_verb',
  'security',
  'h_adult',
]);

export interface SymbolArt {
  /** 文字あり版テクスチャ（設定ON）。key=`${reelIdx}:${symbol}` */
  textures: Map<string, Texture>;
  /** 文字なし版テクスチャ＝図柄のみ（既定）。key=`${reelIdx}:${symbol}` */
  texturesPlain: Map<string, Texture>;
  /** 右パネル用：文字あり版の URL（?v= 付き）。無ければ null */
  tileUrlWithVer(reelIdx: number, symbol: string): string | null;
  /** 右パネル用：文字なし版（_plain）の URL（?v= 付き）。無ければ null */
  tilePlainUrlWithVer(reelIdx: number, symbol: string): string | null;
}

interface YakuListLike {
  premiumYaku: Yaku[];
  coreYaku: Yaku[];
  cherryYaku: Yaku[];
  bonusYaku: Yaku[];
}

/**
 * 章ごとの図柄画像を読み込み、(reelIdx, symbol) -> Texture / URL を「色と同じ先勝ち順」で構築する。
 * 画像が無い章・遊ぶ設定が plain・読込失敗時は空のマップを返し、
 * 呼び出し側（ReelView / 右パネル）は従来の色タイル＋文字へフォールバックする。
 */
export async function loadSymbolArt(
  chapterId: string,
  yakuList: YakuListLike,
  artBase: string,
): Promise<SymbolArt> {
  const tileUrls = new Map<string, string>(); // 文字あり版の素URL
  const textures = new Map<string, Texture>();
  const texturesPlain = new Map<string, Texture>();

  // リール絵柄スタイル（遊ぶ設定）：image=図柄画像 / plain=色タイル＋文字（旧スタイル）。
  // plain のときは画像を一切読み込まない。
  const useArtImages = localStorage.getItem('mojislot.reelArt.v1') !== 'plain';
  if (useArtImages && CHAPTERS_WITH_SYMBOL_ART.has(chapterId)) {
    const orderedForArt = [
      ...yakuList.premiumYaku,
      ...yakuList.coreYaku,
      ...yakuList.cherryYaku,
      ...yakuList.bonusYaku,
    ];
    for (const y of orderedForArt) {
      if (y.noArt) continue; // 画像を持たない役（例：もも）は色＋文字で描く
      // チェリーは2文字（symbols.length=2）。存在する文字だけ対象にする
      for (let r = 0; r < y.symbols.length; r++) {
        const key = `${r}:${y.symbols[r]}`;
        if (!tileUrls.has(key)) {
          tileUrls.set(key, `${artBase}symbols/${chapterId}/${y.id}_${r}.webp`);
        }
      }
    }
    try {
      const glyphUrls = [...new Set(tileUrls.values())];
      const plainUrls = glyphUrls.map((u) => u.replace(/\.webp$/, '_plain.webp'));
      // 一部記号のアートが欠けても全体を壊さない（allSettled）。
      // 欠けた記号はテクスチャ未設定＋URL削除で、その記号だけ色＋文字に落とす。
      await Promise.allSettled(
        [...glyphUrls, ...plainUrls].map((u) => Assets.load(`${u}?v=${ART_VER}`)),
      );
      for (const [key, url] of [...tileUrls]) {
        const glyphTex = Assets.get(`${url}?v=${ART_VER}`) as Texture | undefined;
        const plainTex = Assets.get(
          `${url.replace(/\.webp$/, '_plain.webp')}?v=${ART_VER}`,
        ) as Texture | undefined;
        if (glyphTex && plainTex) {
          textures.set(key, glyphTex);
          texturesPlain.set(key, plainTex);
        } else {
          tileUrls.delete(key); // アート欠落 → 右の配列表も色＋文字へ
        }
      }
    } catch (err) {
      console.warn('図柄画像の読み込みに失敗。色タイルにフォールバックします', err);
      textures.clear();
      texturesPlain.clear();
      tileUrls.clear();
    }
  }

  // 文字あり版 / 文字なし版(_plain) の URL（右パネル用）
  const tileUrlWithVer = (reelIdx: number, symbol: string): string | null => {
    const u = tileUrls.get(`${reelIdx}:${symbol}`);
    return u ? `${u}?v=${ART_VER}` : null;
  };
  const tilePlainUrlWithVer = (reelIdx: number, symbol: string): string | null => {
    const u = tileUrls.get(`${reelIdx}:${symbol}`);
    return u ? `${u.replace(/\.webp$/, '_plain.webp')}?v=${ART_VER}` : null;
  };

  return { textures, texturesPlain, tileUrlWithVer, tilePlainUrlWithVer };
}
