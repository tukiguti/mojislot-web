import {
  BlurFilter,
  Container,
  Graphics,
  Rectangle,
  Sprite,
  Text,
  Texture,
} from 'pixi.js';
import type { ReelEngine } from '../core/ReelEngine';
import type { SymbolTier } from './SymbolStyle';

/** ReelView 用の色解決関数（reel ごとに事前 bind した役色を返す） */
export type SymbolColorFn = (symbol: string) => number;
/** ReelView 用の強さ階層解決関数（reel ごとに事前 bind） */
export type SymbolTierFn = (symbol: string) => SymbolTier;
/**
 * ReelView 用の図柄テクスチャ解決関数（reel ごとに事前 bind）。
 * その章に図柄画像があれば Texture、無ければ null（→ 従来の色タイル＋文字にフォールバック）。
 */
export type SymbolTextureFn = (symbol: string) => Texture | null;

export const CELL_WIDTH = 130;
export const CELL_HEIGHT = 100;
export const VISIBLE_CELLS = 3;

/**
 * 役柄の強さ階層ごとのタイル見た目。
 * 「強い柄ほどデカい」を再現：premium が枠いっぱい、filler は小さく地味。
 * リール送り（1コマ=CELL_HEIGHT）は不変で、コマ枠内に描く柄の大きさだけ変える。
 */
interface TileStyle {
  /** タイルの左右余白（小さいほど大きいタイル） */
  padX: number;
  /** タイルの上下余白 */
  padY: number;
  /** 角丸半径 */
  radius: number;
  /** 外枠（黒）の太さ・濃さ */
  strokeWidth: number;
  strokeAlpha: number;
  /** 内側のアクセント縁（金/銀）。null なら描かない */
  innerFrame: number | null;
  /** 文字サイズ */
  fontSize: number;
}

const TILE_STYLES: Record<SymbolTier, TileStyle> = {
  // BIG：枠いっぱい＋金の内縁＋極太文字
  premium: { padX: 3, padY: 3, radius: 10, strokeWidth: 4, strokeAlpha: 0.85, innerFrame: 0xfff2a8, fontSize: 70 },
  // REG：やや大きめ＋銀の内縁
  bonus: { padX: 11, padY: 9, radius: 11, strokeWidth: 3.5, strokeAlpha: 0.8, innerFrame: 0xe8e8f0, fontSize: 60 },
  // コア：標準
  core: { padX: 19, padY: 16, radius: 12, strokeWidth: 2, strokeAlpha: 0.55, innerFrame: null, fontSize: 52 },
  // 脇役：小さく地味
  filler: { padX: 35, padY: 28, radius: 12, strokeWidth: 1.5, strokeAlpha: 0.45, innerFrame: null, fontSize: 36 },
};

/**
 * 図柄スプライト（画像タイル）の階層別スケール。1.0 = セル(130x100)ぴったり。
 * 画像自体に枠が描かれているので控えめに差をつける（強い柄ほど大きく＝デカい）。
 */
const SPRITE_SCALE: Record<SymbolTier, number> = {
  premium: 0.9, // 枠つき・ほぼセルいっぱい（横長図柄が幅130pxで左右の縁に接して切れるのを防ぐ余白）
  bonus: 0.88, // 枠つき・やや大（premiumのすぐ下）
  core: 0.7, // 枠なし・はっきり小さく（強弱を size で明確に区別）
  filler: 0.58,
};

const VIEW_HEIGHT = CELL_HEIGHT * VISIBLE_CELLS;
const PAYLINE_Y = CELL_HEIGHT * 1.5;
/**
 * 上下に見せる「隣の図柄」のチラ見せ量（px）。マスクを上下に REEL_PEEK 広げて、次に来る図柄／
 * 通り過ぎる図柄を覗かせる。中央3コマ＝判定対象（PAYLINE_Y・ペイライン）は不変。
 * リール領域の確保は main.ts 側（LIQUID_AREA_H）で行う。
 */
export const REEL_PEEK = CELL_HEIGHT * 0.1;
/**
 * 図柄（チラ見せ含む）と金枠の線の間に挟む黒余白（px）。枠(bg)を図柄表示範囲より FRAME_PAD
 * 分だけ外側に描くことで、図柄が枠線に接触して色が混じるのを防ぐ。
 */
export const FRAME_PAD = 6;
/**
 * マスク（見える領域）の上に確保する「不可視の助走バッファ」のピクセル数。
 * 文字はここから現れて、マスク上端へスクロールしていくので、
 * 「マスクの上端で唐突に文字が湧く」感じがなくなる。
 */
const PRE_BUFFER = CELL_HEIGHT;

/**
 * モーションブラー（回転中の縦方向の残像）。
 *
 * 実機のリールは物理的な回転なので目に残像が残り、速くても図柄の流れを追える。
 * Web（Pixi）は毎フレーム図柄をくっきり描くため残像が無く、実機速度（28コマ/秒）まで上げると
 * 図柄が飛び飛びに見えて逆にカクつく。そこで縦方向のブラーで残像を人工的に作る。
 * これが入って初めてリール速度を実機に近づけられる（[05](05_bita-oshi.md) の未実装メモ）。
 *
 * 強さは「1フレームで進むピクセル数」に比例させる（速いほど強く滲む）。
 * 60fps 想定で pxPerFrame = speed(コマ/秒) × CELL_HEIGHT ÷ 60。
 */
const MOTION_BLUR_K = 0.34;
/**
 * 実効のブラー係数。data/tuning の既定値を main.ts が流し込み、設定モーダルから変更できる
 * （体感で決める値なので、ビルドし直さずに比べられるようにしている）。0 でブラー無し。
 */
let motionBlurStrength = MOTION_BLUR_K;
export function setMotionBlurStrength(k: number): void {
  motionBlurStrength = Math.max(0, k);
}
/** これ未満の速度ではブラーをかけない（停止直前のチラつき防止） */
const MOTION_BLUR_MIN_SPEED = 2;
/** ブラーの品質。1 で十分（縦1方向・小さな矩形なので負荷は軽い） */
const MOTION_BLUR_QUALITY = 1;

/**
 * クイズ中、答えの文字**以外**のセルの不透明度。1 に近いほど答えがバレにくい。
 * 「答えを教える」のではなく「言われてみれば気づく」程度の強調に留める。
 */
const NON_TARGET_ALPHA = 0.8;

export class ReelView {
  readonly container: Container;
  /** 各セルのコンテナ（タイル背景＋文字を内包、上下方向にスクロール移動する） */
  private readonly cellContainers: Container[] = [];
  /** 各セルの背景タイル Graphics（色タイル時のみ・スプライト時は null） */
  private readonly cellTiles: (Graphics | null)[] = [];
  /** 各セルの図柄スプライト（画像タイル時のみ・色タイル時は null） */
  private readonly cellSprites: (Sprite | null)[] = [];
  /** 各スプライトの基準スケール（ハイライトのスケール演出から戻す用） */
  private readonly cellSpriteBaseScale: number[] = [];
  /** 各スプライトの文字なし/文字ありテクスチャ（設定トグルで差し替え） */
  private readonly cellSpritePlainTex: (Texture | null)[] = [];
  private readonly cellSpriteGlyphTex: (Texture | null)[] = [];
  /** リールに文字を表示するか（既定 false＝図柄のみ） */
  private showGlyphs = false;
  /** ハイライト中にスプライトセルへ重ねる色枠グロー（解除時に除去） */
  private readonly cellGlows: (Graphics | null)[] = [];
  /** 各セルの本来の色（ハイライト解除時に戻す用） */
  private readonly cellOriginalColors: number[] = [];
  /** 各セルのタイル見た目（強さ階層ごと・再描画で形を保つ用） */
  private readonly cellStyles: TileStyle[] = [];
  /** 現在ハイライト中のセル indexes と解除タイマー */
  private highlightTimer: number | null = null;
  private highlightedIndexes: number[] = [];
  /** 各セルの記号文字（cellContainers と同じ index） */
  private cellSymbols: string[] = [];
  /** 回転中の縦モーションブラー（cellsContainer に適用・速度に比例して強くする） */
  private readonly motionBlur: BlurFilter;
  private readonly bg: Graphics;
  private readonly centerGlow: Graphics;
  private centerGlowAlpha = 0;
  private centerGlowStart = 0;
  private centerGlowDuration = 0;
  private tenpaiAnimMs = 0;
  private tenpaiPremium = false;
  /** 停止バウンス用：振動オフセット（px） */
  private bounceOffsetY = 0;
  private bounceStart = 0;
  private bounceActive = false;

  constructor(
    private readonly engine: ReelEngine,
    private readonly colorForSymbol: SymbolColorFn,
    private readonly tierForSymbol: SymbolTierFn = () => 'core',
    // 既定表示（文字なし＝図柄のみ）
    private readonly textureForSymbol: SymbolTextureFn = () => null,
    // 設定ON時の表示（文字あり）
    private readonly textureGlyphForSymbol: SymbolTextureFn = () => null,
  ) {
    this.container = new Container();

    this.bg = new Graphics();
    this.redrawBg(0xffd700, 3);
    this.container.addChild(this.bg);

    // 中央セル（ペイライン上）のハイライトグロー
    this.centerGlow = new Graphics();
    this.centerGlow
      .rect(0, PAYLINE_Y - CELL_HEIGHT / 2, CELL_WIDTH, CELL_HEIGHT)
      .fill({ color: 0xffd700, alpha: 0.45 });
    this.centerGlow.alpha = 0;
    this.container.addChild(this.centerGlow);

    const cellsContainer = new Container();
    // 縦だけ滲ませる（横は 0）。強さは update() で速度に応じて毎フレーム更新。
    this.motionBlur = new BlurFilter({
      strengthX: 0,
      strengthY: 0,
      quality: MOTION_BLUR_QUALITY,
    });
    // フィルタとマスクを同じコンテナに付けると Pixi では効かないので、マスク用のラッパーを挟む。
    // ラッパー = 見える窓（マスク）／内側の cellsContainer = ブラー対象。
    // ブラーは窓の外へ滲むが、ラッパーのマスクで切り取られるのでリール枠を越えない。
    const maskWrapper = new Container();
    cellsContainer.filters = [this.motionBlur];
    // フィルタ適用範囲を「見える窓」に限定する（21コマ全長 2100px を毎フレーム描画しないため）。
    cellsContainer.filterArea = new Rectangle(
      0,
      -REEL_PEEK,
      CELL_WIDTH,
      VIEW_HEIGHT + REEL_PEEK * 2,
    );
    const mask = new Graphics();
    // 図柄は中央3コマ＋上下 REEL_PEEK（隣の図柄チラ見せ）まで表示。枠線とは FRAME_PAD 分離れる。
    mask.rect(0, -REEL_PEEK, CELL_WIDTH, VIEW_HEIGHT + REEL_PEEK * 2);
    mask.fill({ color: 0xffffff });
    this.container.addChild(mask);
    maskWrapper.mask = mask;
    maskWrapper.addChild(cellsContainer);

    this.cellSymbols = [...engine.strip.cells];
    for (const symbol of engine.strip.cells) {
      // セル単位のコンテナ：背景タイル + 文字
      const cell = new Container();

      const tier = this.tierForSymbol(symbol);
      const style = TILE_STYLES[tier];
      const originalColor = this.colorForSymbol(symbol);
      const texture = this.textureForSymbol(symbol); // 既定＝文字なし
      const glyphTexture = this.textureGlyphForSymbol(symbol); // 設定ON＝文字あり

      if (texture) {
        // 図柄画像モード：既定は文字なし版を表示（設定でテクスチャを差し替え）
        const sprite = new Sprite(this.showGlyphs && glyphTexture ? glyphTexture : texture);
        sprite.anchor.set(0.5);
        // セル(CELL_WIDTH×CELL_HEIGHT)に収め、強さ階層で控えめに大小をつける
        const fit = Math.min(
          CELL_WIDTH / texture.width,
          CELL_HEIGHT / texture.height,
        );
        const scale = fit * SPRITE_SCALE[tier];
        sprite.scale.set(scale);
        sprite.x = CELL_WIDTH / 2;
        sprite.y = 0;
        cell.addChild(sprite);
        this.cellSprites.push(sprite);
        this.cellSpriteBaseScale.push(scale);
        this.cellSpritePlainTex.push(texture);
        this.cellSpriteGlyphTex.push(glyphTexture);
        this.cellTiles.push(null);
      } else {
        // 従来モード：色タイル＋文字（強さ階層でサイズ・縁飾り・文字サイズ可変）
        const tile = new Graphics();
        this.drawTile(tile, originalColor, style);
        cell.addChild(tile);
        this.cellTiles.push(tile);
        this.cellSprites.push(null);
        this.cellSpriteBaseScale.push(0);
        this.cellSpritePlainTex.push(null);
        this.cellSpriteGlyphTex.push(null);

        const text = new Text({
          text: symbol,
          style: {
            fill: 0xffffff,
            fontSize: style.fontSize,
            fontFamily:
              '"Hiragino Mincho ProN", "Yu Mincho", "MS PMincho", serif',
            fontWeight: '900',
            stroke: { color: 0x000000, width: 5, alpha: 0.85 },
            dropShadow: {
              color: 0x000000,
              alpha: 0.5,
              angle: Math.PI / 4,
              distance: 1,
              blur: 2,
            },
          },
        });
        text.anchor.set(0.5);
        text.x = CELL_WIDTH / 2;
        text.y = 0;
        cell.addChild(text);
      }

      this.cellOriginalColors.push(originalColor);
      this.cellStyles.push(style);
      this.cellGlows.push(null);

      cellsContainer.addChild(cell);
      this.cellContainers.push(cell);
    }
    this.container.addChild(maskWrapper);

    // ペイラインやセル区切り線はリール上に描画しない（外側インジケーターで示す）

    this.update();
  }

  update(nowMs?: number): void {
    const pos = this.engine.position;
    const total = this.engine.strip.cells.length;
    const totalHeight = total * CELL_HEIGHT;

    // 文字の循環範囲を [-PRE_BUFFER, -PRE_BUFFER + totalHeight) にずらす。
    // マスク（0..VIEW_HEIGHT）の手前 PRE_BUFFER 分は不可視バッファになり、
    // 文字はそこから降りてきてマスクに入る → 「上から流れてきた」感が出る。
    // ペイライン位置・中央セル判定は従来通り（PAYLINE_Y は変えない）。
    // 停止バウンスの計算
    if (this.bounceActive) {
      const t = nowMs ?? performance.now();
      const elapsed = t - this.bounceStart;
      const durMs = 220;
      if (elapsed >= durMs) {
        this.bounceActive = false;
        this.bounceOffsetY = 0;
      } else {
        const k = elapsed / durMs;
        // 減衰しながら振動：sin(2π * 2) で 2サイクル
        this.bounceOffsetY = Math.sin(k * Math.PI * 4) * 9 * (1 - k);
      }
    }

    for (let i = 0; i < total; i++) {
      let y = (pos - i) * CELL_HEIGHT + PAYLINE_Y + PRE_BUFFER;
      y = ((y % totalHeight) + totalHeight) % totalHeight;
      this.cellContainers[i].y = y - PRE_BUFFER + this.bounceOffsetY;
    }

    // モーションブラー：回転中だけ、速度（1フレームの移動px）に比例して縦に滲ませる。
    // 停止した瞬間に 0 へ戻るので、出目はくっきり読める（目押しの答え合わせを妨げない）。
    const spinning = this.engine.state.get() === 'spinning';
    const speed = spinning ? this.engine.currentSpeed : 0;
    const strengthY =
      speed >= MOTION_BLUR_MIN_SPEED
        ? ((speed * CELL_HEIGHT) / 60) * motionBlurStrength
        : 0;
    if (this.motionBlur.strengthY !== strengthY) {
      this.motionBlur.strengthY = strengthY;
      // strength=0 のままフィルタを通すと無駄なテクスチャ確保が走るので、止まったら外す
      this.motionBlur.enabled = strengthY > 0;
    }

    // テンパイ枠の脈動
    if (this.tenpaiAnimMs > 0) {
      const t = nowMs ?? performance.now();
      const pulse = (Math.sin(t / 120) + 1) / 2; // 0..1
      const baseColor = this.tenpaiPremium ? 0xff3366 : 0xffff00;
      const width = 3 + pulse * 3;
      this.redrawBg(baseColor, width);
    }

    // 中央ハイライトのフェードアウト
    if (this.centerGlowAlpha > 0) {
      const t = nowMs ?? performance.now();
      const elapsed = t - this.centerGlowStart;
      if (elapsed >= this.centerGlowDuration) {
        this.centerGlowAlpha = 0;
      } else {
        const k = 1 - elapsed / this.centerGlowDuration;
        // 脈動 + フェード
        const pulse = 0.5 + 0.5 * Math.sin(t / 80);
        this.centerGlowAlpha = 0.55 * k * pulse;
      }
      this.centerGlow.alpha = this.centerGlowAlpha;
    }
  }

  /**
   * クイズの答えの文字を「うっすら」強調する。target 以外のセルを NON_TARGET_ALPHA まで落とすだけ。
   * 以前は 0.25 まで暗く落としていたが、それでは答えが一目で分かってしまい、
   * 「どれかな」と自分で考えて狙うというクイズの主旨が消える（答えの提示ではなく、気づきの補助）。
   * null を渡すと通常表示に戻る。
   */
  setTargetSymbol(symbol: string | null): void {
    for (let i = 0; i < this.cellContainers.length; i++) {
      const isTarget = symbol === null || this.cellSymbols[i] === symbol;
      this.cellContainers[i].alpha = isTarget ? 1 : NON_TARGET_ALPHA;
    }
  }

  /** 中央セル（ペイライン上）を一定時間グローさせる（役成立時） */
  highlightCenter(durMs = 1200): void {
    this.centerGlowStart = performance.now();
    this.centerGlowDuration = durMs;
    this.centerGlowAlpha = 0.55;
    this.centerGlow.alpha = this.centerGlowAlpha;
  }

  /**
   * リールに文字を表示するか切り替える。
   * true=文字あり版テクスチャ / false=図柄のみ（既定）。スプライトのテクスチャを差し替える。
   */
  setShowGlyphs(show: boolean): void {
    this.showGlyphs = show;
    for (let i = 0; i < this.cellSprites.length; i++) {
      const sp = this.cellSprites[i];
      if (!sp) continue;
      const glyph = this.cellSpriteGlyphTex[i];
      const plain = this.cellSpritePlainTex[i];
      const next = show && glyph ? glyph : plain;
      if (next) sp.texture = next;
    }
  }

  /** STOP 押下後の停止バウンス（軽い縦振動） */
  triggerStopBounce(): void {
    this.bounceStart = performance.now();
    this.bounceActive = true;
  }

  /** テンパイ枠フラッシュを開始（残ったリール用） */
  startTenpaiFlash(premium: boolean): void {
    this.tenpaiAnimMs = 1; // フラグ立て
    this.tenpaiPremium = premium;
  }

  /** テンパイ枠フラッシュを終了して通常枠に戻す */
  stopTenpaiFlash(): void {
    this.tenpaiAnimMs = 0;
    this.redrawBg(0xffd700, 3);
  }

  private redrawBg(strokeColor: number, strokeWidth: number): void {
    this.bg.clear();
    // 枠（黒背景＋金枠）は図柄表示範囲(上下チラ見せ ±REEL_PEEK)より FRAME_PAD 分さらに外側へ描く。
    // これで図柄（チラ見せ含む）と金枠の線の間に黒余白ができ、色が混じらない。
    this.bg.rect(
      0,
      -REEL_PEEK - FRAME_PAD,
      CELL_WIDTH,
      VIEW_HEIGHT + REEL_PEEK * 2 + FRAME_PAD * 2,
    );
    this.bg.fill({ color: 0x000000 });
    this.bg.stroke({ width: strokeWidth, color: strokeColor });
  }

  /** タイル背景を指定色・指定スタイル（強さ階層）で描く（共通ロジック） */
  private drawTile(tile: Graphics, color: number, style: TileStyle): void {
    tile.clear();
    const x = style.padX;
    const y = -CELL_HEIGHT / 2 + style.padY;
    const w = CELL_WIDTH - style.padX * 2;
    const h = CELL_HEIGHT - style.padY * 2;
    tile
      .roundRect(x, y, w, h, style.radius)
      .fill({ color })
      .stroke({ width: style.strokeWidth, color: 0x000000, alpha: style.strokeAlpha });
    // 強い柄（premium/bonus）は内側に金/銀のアクセント縁を重ねて格を出す
    if (style.innerFrame !== null) {
      const inset = 4;
      tile
        .roundRect(
          x + inset,
          y + inset,
          w - inset * 2,
          h - inset * 2,
          Math.max(2, style.radius - 3),
        )
        .stroke({ width: 2, color: style.innerFrame, alpha: 0.9 });
    }
  }

  /**
   * 指定セル（リール内の周回 index）のタイルを役色で塗り替え、durMs 後に元に戻す。
   * 役成立時に、3 リールにまたがる構成文字をまとめて同色化するための公開 API。
   *
   * 共有文字（複数役で使われる文字）はタイル静的色が衝突するが、
   * これを使えば成立した瞬間だけは「揃った役の 3 文字」が同色で見える。
   */
  highlightCells(cellIndexes: readonly number[], color: number, durMs = 1400): void {
    this.clearHighlight();
    this.highlightedIndexes = [...cellIndexes];
    for (const i of cellIndexes) {
      if (i < 0 || i >= this.cellContainers.length) continue;
      const sprite = this.cellSprites[i];
      if (sprite) {
        // 図柄スプライト：役色の枠グローを重ね、軽く拡大して「揃った」を強調
        const glow = new Graphics();
        glow
          .roundRect(6, -CELL_HEIGHT / 2 + 6, CELL_WIDTH - 12, CELL_HEIGHT - 12, 12)
          .stroke({ width: 5, color, alpha: 0.95 });
        this.cellContainers[i].addChild(glow);
        this.cellGlows[i] = glow;
        sprite.scale.set(this.cellSpriteBaseScale[i] * 1.07);
      } else if (this.cellTiles[i]) {
        this.drawTile(this.cellTiles[i]!, color, this.cellStyles[i]);
      }
    }
    this.highlightTimer = window.setTimeout(() => {
      this.clearHighlight();
    }, durMs);
  }

  /** ハイライト中のタイルを元の色に戻す（タイマー強制終了込み） */
  clearHighlight(): void {
    if (this.highlightTimer !== null) {
      window.clearTimeout(this.highlightTimer);
      this.highlightTimer = null;
    }
    for (const i of this.highlightedIndexes) {
      if (i < 0 || i >= this.cellContainers.length) continue;
      const glow = this.cellGlows[i];
      if (glow) {
        glow.destroy();
        this.cellGlows[i] = null;
      }
      const sprite = this.cellSprites[i];
      if (sprite) {
        sprite.scale.set(this.cellSpriteBaseScale[i]);
      } else if (this.cellTiles[i]) {
        this.drawTile(this.cellTiles[i]!, this.cellOriginalColors[i], this.cellStyles[i]);
      }
    }
    this.highlightedIndexes = [];
  }
}
