import { Assets, Container, Sprite, Texture } from 'pixi.js';

/**
 * 演出液晶の背景（島ごとの情景・ドット絵）。
 *
 * **ゲームの状態では一切変わらない。** レバーONで何かが始まると演出＝予告として
 * 読まれ、無演出のゲームが「何もない」でなくなる（[31] §3①）。コマ送りは一定の
 * 間隔で回り続けるだけで、当たりとも操作とも関係しない。
 *
 * 元絵は 200×134 を**3倍**で置く。出題者のドット絵と同じグリッドに乗せないと、
 * 1ドットの大きさが背景とキャラで食い違って濁る。
 */

/** 元絵の倍率。出題者（`QUIZMASTER_SCALE`）と揃える。 */
const SCALE = 3;
/** コマの送り。速いと目に付き、遅いと止まって見える。 */
const FRAME_MS = 620;
/** 絵を作り直すたびに上げる（同名PNGのキャッシュ対策）。 */
const ART_VER = '1';

export interface LcdBackgroundOptions {
  artBase: string;
  /** 情景を持つ島と、そのコマ数。持たない島は背景なしで動く。 */
  frameCounts: Readonly<Record<string, number>>;
}

export class LcdBackground {
  readonly container: Container;
  private readonly sprite: Sprite;
  private readonly artBase: string;
  private readonly frameCounts: Readonly<Record<string, number>>;
  private readonly cache = new Map<string, Texture[]>();
  private frames: Texture[] = [];
  private index = 0;
  private nextAt = 0;
  private paused = false;

  constructor(opts: LcdBackgroundOptions) {
    this.artBase = opts.artBase;
    this.frameCounts = opts.frameCounts;
    this.container = new Container();
    this.sprite = new Sprite();
    this.sprite.scale.set(SCALE);
    this.container.addChild(this.sprite);
    this.container.visible = false;
  }

  /** その島の情景を読み込む。台替わり（リミックス）でも呼ぶ。 */
  async setChapter(chapterId: string): Promise<void> {
    const count = this.frameCounts[chapterId] ?? 0;
    if (count === 0) {
      this.frames = [];
      this.container.visible = false;
      return;
    }
    const cached = this.cache.get(chapterId);
    if (!cached) {
      const urls = Array.from(
        { length: count },
        (_, i) => `${this.artBase}lcdbg/${chapterId}_${i}.png?v=${ART_VER}`,
      );
      await Promise.allSettled(urls.map((u) => Assets.load(u)));
      const loaded: Texture[] = [];
      for (const u of urls) {
        const tex = Assets.get(u) as Texture | undefined;
        if (!tex) continue;
        tex.source.scaleMode = 'nearest'; // ドット絵なので最近傍。既定の linear だと滲む
        loaded.push(tex);
      }
      if (loaded.length === 0) {
        console.warn(`液晶背景を読めませんでした（${chapterId}）。背景なしで続行します`);
        this.frames = [];
        this.container.visible = false;
        return;
      }
      this.cache.set(chapterId, loaded);
    }
    this.frames = this.cache.get(chapterId) ?? [];
    this.index = 0;
    this.sprite.texture = this.frames[0];
    this.container.visible = true;
  }

  /**
   * 「動きを減らす」設定。**消さずに止める**——消すと背景が無い状態に戻り、
   * 空白を埋めるという目的そのものが失われる。
   */
  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  /** main の ticker から呼ぶ。 */
  update(nowMs: number): void {
    if (this.paused || this.frames.length < 2) return;
    if (nowMs < this.nextAt) return;
    this.nextAt = nowMs + FRAME_MS;
    this.index = (this.index + 1) % this.frames.length;
    this.sprite.texture = this.frames[this.index];
  }
}
