import { Assets, Texture } from 'pixi.js';

// ART_VER: ドット文字を作り直すたびに上げる（同名 PNG のブラウザキャッシュ対策）。
const ART_VER = '23';

/**
 * リールの**ドット文字**を読み込む。
 *
 * 〔2026-08-29〕役ごとの図柄画像（生成画像・全島で9.4MB）は**廃止した**。
 * 理由は2つ。
 *
 *  - **腐る**。役を作り直した時に絵だけ前の役のまま残った（寿司島は7枚とも不一致）。
 *    外部の画像生成へ投げ直さないと直せないので、誰も直さなかった
 *  - **コンセプトを壊す**。絵でセルを見分けられると、文字を読まずに押せてしまう
 *
 * 代わりに文字そのものをドット絵にする。生成は `tools/gen_glyphs.py`。65x50 ドットを
 * 130x100 のセルへ2倍で置く（2026-10-02 の v2 で 44x34・3倍から細かくした）。
 * 文字は配列データから作るので**配列を変えれば自動で追随する**。
 *
 * 1文字は**地と艶の2枚**。地は tint で役色に染め、艶（白の艶・ボーナスの金の輪）は
 * tint せずに重ねる。乗算では白も金も役色に化けるため。
 *
 * 字は**リールごとに別ファイル**。同じ文字でもリールによって属する役の強さが変わり
 * （寿司島の「し」は左でしゃけ＝ボーナス、右でいわし＝小役）、大きさが違うため。
 */
export interface GlyphArt {
  /** `${リール}:${文字}` → Texture。無ければ undefined（呼び出し側はフォント描画へ落ちる） */
  textures: Map<string, Texture>;
  /** `${リール}:${文字}` → 艶の Texture（tint しない層）。無ければ艶なしで描く */
  glosses: Map<string, Texture>;
  /** 右パネル用の URL（?v= 付き）。無ければ null */
  urlFor(reel: number, symbol: string): string | null;
}

/** ファイル名はコードポイント。日本語のままだとURLエンコードの差で事故る（生成側と対）。 */
function nameOf(reel: number, symbol: string): string {
  return (
    `r${reel}_u` +
    [...symbol]
      .map((c) => (c.codePointAt(0) ?? 0).toString(16).padStart(4, '0'))
      .join('-')
  );
}

export async function loadGlyphArt(
  chapterId: string,
  /** リールごとの文字（`reels[i].cells`）。同じ文字でもリールで絵が違う */
  reelSymbols: readonly (readonly string[])[],
  artBase: string,
): Promise<GlyphArt> {
  const urls = new Map<string, string>();
  reelSymbols.forEach((cells, reel) => {
    for (const s of new Set(cells)) {
      urls.set(`${reel}:${s}`, `${artBase}glyphs/${chapterId}/${nameOf(reel, s)}.png`);
    }
  });
  const textures = new Map<string, Texture>();
  const glosses = new Map<string, Texture>();
  /** 艶は地と同じ名前に `_g` を付けたもの（tools/gen_glyphs.py）。 */
  const glossUrl = (u: string) => u.replace(/\.png$/, '_g.png');
  try {
    // 1文字欠けても全体を壊さない。欠けた文字だけフォント描画へ落ちる
    await Promise.allSettled(
      [...urls.values()].flatMap((u) => [
        Assets.load(`${u}?v=${ART_VER}`),
        Assets.load(`${glossUrl(u)}?v=${ART_VER}`),
      ]),
    );
    for (const [key, url] of [...urls]) {
      const tex = Assets.get(`${url}?v=${ART_VER}`) as Texture | undefined;
      if (!tex) {
        urls.delete(key);
        continue;
      }
      // **補間させない。** 3倍に伸ばすので、滑らかに補間するとドットが溶ける
      tex.source.scaleMode = 'nearest';
      textures.set(key, tex);
      const gloss = Assets.get(`${glossUrl(url)}?v=${ART_VER}`) as Texture | undefined;
      if (gloss) {
        gloss.source.scaleMode = 'nearest';
        glosses.set(key, gloss);
      }
    }
  } catch (err) {
    console.warn('ドット文字の読み込みに失敗。フォント描画へ落とします', err);
    textures.clear();
    glosses.clear();
    urls.clear();
  }

  const urlFor = (reel: number, symbol: string): string | null => {
    const u = urls.get(`${reel}:${symbol}`);
    return u ? `${u}?v=${ART_VER}` : null;
  };
  return { textures, glosses, urlFor };
}
