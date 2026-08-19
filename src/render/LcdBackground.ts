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
/** コマの送り。12コマで約1.7秒の輪になる。速いと目に付き、遅いと止まって見える。 */
const FRAME_MS = 140;
/** 絵を作り直すたびに上げる（同名PNGのキャッシュ対策）。 */
const ART_VER = '2';

export interface LcdBackgroundOptions {
  artBase: string;
  /** 島ID → [情景の数, 1情景あたりのコマ数]。無い島は背景なしで動く。 */
  scenes: Readonly<Record<string, readonly [number, number]>>;
}

export class LcdBackground {
  readonly container: Container;
  private readonly sprite: Sprite;
  private readonly artBase: string;
  private readonly scenes: Readonly<Record<string, readonly [number, number]>>;
  /** 島ID → 情景ごとのコマ列。 */
  private readonly cache = new Map<string, Texture[][]>();
  private variants: Texture[][] = [];
  private frames: Texture[] = [];
  private variant = 0;
  private index = 0;
  private nextAt = 0;
  private paused = false;
  /** 情景を切り替えた直後の明け具合（0→1）。 */
  private fade = 1;

  constructor(opts: LcdBackgroundOptions) {
    this.artBase = opts.artBase;
    this.scenes = opts.scenes;
    this.container = new Container();
    this.sprite = new Sprite();
    this.sprite.scale.set(SCALE);
    this.container.addChild(this.sprite);
    this.container.visible = false;
  }

  /** その島の情景をまとめて読み込む。台替わり（リミックス）でも呼ぶ。 */
  async setChapter(chapterId: string): Promise<void> {
    const spec = this.scenes[chapterId];
    if (!spec) {
      this.variants = [];
      this.frames = [];
      this.container.visible = false;
      return;
    }
    const [variantCount, frameCount] = spec;
    if (!this.cache.has(chapterId)) {
      const urls: string[] = [];
      for (let v = 0; v < variantCount; v++) {
        for (let f = 0; f < frameCount; f++) {
          urls.push(`${this.artBase}lcdbg/${chapterId}_${v}_${f}.png?v=${ART_VER}`);
        }
      }
      await Promise.allSettled(urls.map((u) => Assets.load(u)));
      const loaded: Texture[][] = [];
      for (let v = 0; v < variantCount; v++) {
        const frames: Texture[] = [];
        for (let f = 0; f < frameCount; f++) {
          const tex = Assets.get(urls[v * frameCount + f]) as Texture | undefined;
          if (!tex) continue;
          tex.source.scaleMode = 'nearest'; // ドット絵なので最近傍。linear だと滲む
          frames.push(tex);
        }
        if (frames.length > 0) loaded.push(frames);
      }
      if (loaded.length === 0) {
        console.warn(`液晶背景を読めませんでした（${chapterId}）。背景なしで続行します`);
        this.variants = [];
        this.frames = [];
        this.container.visible = false;
        return;
      }
      this.cache.set(chapterId, loaded);
    }
    this.variants = this.cache.get(chapterId) ?? [];
    this.show(Math.floor(Math.random() * this.variants.length));
    this.container.visible = true;
  }

  /**
   * 別の情景へ移る。**いま出ているものは選ばない**ので、呼べば必ず変わる。
   * 実機のステージチェンジと同じ扱いで、レバーONの抽選から呼ぶ。
   */
  changeScene(): void {
    if (this.variants.length < 2) return;
    const n = this.variants.length;
    this.show((this.variant + 1 + Math.floor(Math.random() * (n - 1))) % n);
    this.fade = 0; // 切り替わりを一瞬の暗転で繋ぐ（真横に差し替わると乱暴に見える）
  }

  private show(variant: number): void {
    this.variant = variant;
    this.frames = this.variants[variant] ?? [];
    this.index = 0;
    if (this.frames[0]) this.sprite.texture = this.frames[0];
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
    if (this.fade < 1) {
      this.fade = Math.min(1, this.fade + 0.06);
      this.container.alpha = this.fade;
    }
    if (this.paused || this.frames.length < 2) return;
    if (nowMs < this.nextAt) return;
    this.nextAt = nowMs + FRAME_MS;
    this.index = (this.index + 1) % this.frames.length;
    this.sprite.texture = this.frames[this.index];
  }
}
