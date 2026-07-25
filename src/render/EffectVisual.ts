import { Container, Graphics } from 'pixi.js';
import type { EffectType } from '../productions/EffectScheduler';

/**
 * 演出ビジュアル（背景色・フラッシュ・グロー）の集合。
 * EffectScheduler の結果を視覚化する責務に絞り、ロジック側からは独立させる。
 */

interface EffectVisualOptions {
  width: number;
  liquidHeight: number;
  totalHeight: number;
}

const TINT_BY_EFFECT: Record<EffectType, number | null> = {
  none: null,
  shisa: 0x66ccff,
  quiz: 0xff66cc,
  // 「狙え！」演出は赤系のタイトめなトーンで、視線をリールに向ける
  aim: 0xff8866,
};

const TINT_ALPHA_LIQUID = 0.16;
const TINT_ALPHA_REEL = 0.1;
const FLASH_INITIAL_ALPHA = 0.55;
const FLASH_DECAY_PER_FRAME = 0.88;

export class EffectVisual {
  readonly bgLayer: Container;
  readonly fxLayer: Container;

  private readonly liquidTint: Graphics;
  private readonly reelTint: Graphics;
  private readonly flashOverlay: Graphics;
  private flashAlpha = 0;
  private current: EffectType = 'none';
  private currentTint: number | null = null;

  constructor(opts: EffectVisualOptions) {
    this.bgLayer = new Container();
    this.fxLayer = new Container();

    this.liquidTint = new Graphics();
    this.liquidTint.rect(0, 0, opts.width, opts.liquidHeight);
    this.liquidTint.fill({ color: 0xffffff });
    this.liquidTint.alpha = 0;
    this.bgLayer.addChild(this.liquidTint);

    this.reelTint = new Graphics();
    this.reelTint.rect(
      0,
      opts.liquidHeight,
      opts.width,
      opts.totalHeight - opts.liquidHeight,
    );
    this.reelTint.fill({ color: 0xffffff });
    this.reelTint.alpha = 0;
    this.bgLayer.addChild(this.reelTint);

    this.flashOverlay = new Graphics();
    this.flashOverlay.rect(0, 0, opts.width, opts.totalHeight);
    this.flashOverlay.fill({ color: 0xffffff });
    this.flashOverlay.alpha = 0;
    this.fxLayer.addChild(this.flashOverlay);
  }

  /**
   * 演出タイプを適用。変更時のみフラッシュを焚く。
   * tintOverride を渡すと既定色の代わりにその色で着色する（示唆の期待度tier色＝青/黄/緑/赤/金）。
   */
  apply(effect: EffectType, tintOverride?: number): void {
    const color = tintOverride ?? TINT_BY_EFFECT[effect];
    // 演出種別が変わった時 or 色が変わった時（示唆の期待度が変化）にフラッシュ
    const changed = effect !== this.current || color !== this.currentTint;
    this.current = effect;
    this.currentTint = color;

    if (color === null) {
      this.liquidTint.alpha = 0;
      this.reelTint.alpha = 0;
    } else {
      this.liquidTint.tint = color;
      this.reelTint.tint = color;
      this.liquidTint.alpha = TINT_ALPHA_LIQUID;
      this.reelTint.alpha = TINT_ALPHA_REEL;
    }

    // 「none → 演出」「示唆 → クイズ」「示唆の色昇格」の時のみ閃光（none に戻る時は煽らない）
    if (changed && color !== null) {
      this.flashOverlay.tint = color;
      this.flashAlpha = FLASH_INITIAL_ALPHA;
    }
  }

  update(): void {
    if (this.flashAlpha > 0.01) {
      this.flashAlpha *= FLASH_DECAY_PER_FRAME;
      this.flashOverlay.alpha = this.flashAlpha;
    } else if (this.flashOverlay.alpha !== 0) {
      this.flashAlpha = 0;
      this.flashOverlay.alpha = 0;
    }
  }
}
