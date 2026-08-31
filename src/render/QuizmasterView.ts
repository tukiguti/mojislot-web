import { Assets, Container, Graphics, Sprite, Texture } from 'pixi.js';
import {
  availableFace,
  quizmasterFor,
  type Quizmaster,
  type QuizmasterFace,
} from '../data/quizmasters';

/**
 * クイズの出題者（ドット絵）の描画。**クイズ演出のときだけ出す**。
 *
 * 48×56 のドット絵を**整数倍**で拡大する。非整数倍にすると1ドットの幅が
 * 不均一になり、線の太さが場所によって変わって崩れる。
 */

/** 実寸倍率。48×56 → 144×168。 */
export const QUIZMASTER_SCALE = 3;
const ART_W = 48;
const ART_H = 56;

/** 絵を作り直すたびに上げる（同名 PNG のブラウザキャッシュ対策）。 */
const ART_VER = '1';

export interface QuizmasterViewOptions {
  /** 絵のURLの根（`art/`）。 */
  artBase: string;
  /** 立ち位置。絵の**中心**が来る座標。 */
  x: number;
  y: number;
}

export class QuizmasterView {
  readonly container: Container;
  private readonly glow: Graphics;
  private readonly sprite: Sprite;
  private readonly artBase: string;
  /** 章ID → 表情 → テクスチャ。章を切り替えても読み直さない。 */
  private readonly cache = new Map<string, Map<QuizmasterFace, Texture>>();
  private master: Quizmaster | null = null;
  private chapterId: string | null = null;

  constructor(opts: QuizmasterViewOptions) {
    this.artBase = opts.artBase;
    this.container = new Container();
    this.container.x = opts.x;
    this.container.y = opts.y;
    this.container.visible = false;

    // 出題者は自分の枠の中に居る（実機のサブ液晶の見立て）。
    //
    // 最初は後ろに淡い光を置いていたが、**クイズ中は液晶の地色が桃色に変わる**ので
    // （EffectVisual の tint）暗い紫を前提に描いたドット絵が沈んだ。地色が変わっても
    // 効く形にするには、明るくするのではなく**暗い面を敷く**必要がある。
    // 枠にしておくと「わざわざ置いてある」と読めるので、沈み対策が意匠に見える。
    const w = (ART_W * QUIZMASTER_SCALE) / 2;
    const h = (ART_H * QUIZMASTER_SCALE) / 2;
    const pad = 6;
    this.glow = new Graphics();
    this.glow
      .roundRect(-w - pad, -h - pad, (w + pad) * 2, (h + pad) * 2, 10)
      .fill({ color: 0x1c1226, alpha: 0.72 })
      .stroke({ width: 2, color: 0xff8ad8, alpha: 0.38 });
    this.container.addChild(this.glow);

    this.sprite = new Sprite();
    this.sprite.anchor.set(0.5);
    this.sprite.scale.set(QUIZMASTER_SCALE);
    this.container.addChild(this.sprite);
  }

  /**
   * その章の出題者の絵を読み込む。章が変わるたびに呼ぶ（リミックスの台替わりを含む）。
   * 絵が欠けても例外は投げない——出題者が出ないだけでクイズ自体は成立する。
   */
  async setChapter(chapterId: string): Promise<void> {
    this.chapterId = chapterId;
    this.master = quizmasterFor(chapterId);
    if (!this.master || this.cache.has(chapterId)) return;

    const faces = this.master.faces;
    const urlOf = (face: QuizmasterFace) =>
      `${this.artBase}quizmaster/${chapterId}_${face}.png?v=${ART_VER}`;
    await Promise.allSettled(faces.map((f) => Assets.load(urlOf(f))));

    const loaded = new Map<QuizmasterFace, Texture>();
    for (const face of faces) {
      const tex = Assets.get(urlOf(face)) as Texture | undefined;
      if (!tex) continue;
      // ドット絵は必ず最近傍。既定の linear だと拡大時ににじむ。
      tex.source.scaleMode = 'nearest';
      loaded.set(face, tex);
    }
    if (loaded.size === 0) {
      console.warn(`出題者の絵が読めませんでした（${chapterId}）。出題者なしで続行します`);
      return;
    }
    this.cache.set(chapterId, loaded);
  }

  /** 出題者を出す。未収録の表情は出題の顔で代用する。 */
  show(face: QuizmasterFace): void {
    const textures = this.chapterId ? this.cache.get(this.chapterId) : undefined;
    if (!this.master || !textures) return;
    const tex = textures.get(availableFace(this.master, face));
    if (!tex) return;
    this.sprite.texture = tex;
    this.container.visible = true;
  }

  hide(): void {
    this.container.visible = false;
  }

  /** いま出題者が出ているか（吹き出しを出すかの判断に使う）。 */
  isVisible(): boolean {
    return this.container.visible;
  }
}
