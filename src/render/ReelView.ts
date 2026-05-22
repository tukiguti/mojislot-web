import { Container, Graphics, Text } from 'pixi.js';
import type { ReelEngine } from '../core/ReelEngine';
import { symbolColor } from './SymbolStyle';

export const CELL_WIDTH = 130;
export const CELL_HEIGHT = 100;
export const VISIBLE_CELLS = 3;

const VIEW_HEIGHT = CELL_HEIGHT * VISIBLE_CELLS;
const PAYLINE_Y = CELL_HEIGHT * 1.5;
/**
 * マスク（見える領域）の上に確保する「不可視の助走バッファ」のピクセル数。
 * 文字はここから現れて、マスク上端へスクロールしていくので、
 * 「マスクの上端で唐突に文字が湧く」感じがなくなる。
 */
const PRE_BUFFER = CELL_HEIGHT;

/** タイル余白（cell の周囲に空けるピクセル） */
const TILE_PAD = 4;
const TILE_RADIUS = 12;

export class ReelView {
  readonly container: Container;
  /** 各セルのコンテナ（タイル背景＋文字を内包、上下方向にスクロール移動する） */
  private readonly cellContainers: Container[] = [];
  /** 各セルの記号文字（cellContainers と同じ index） */
  private cellSymbols: string[] = [];
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

  constructor(private readonly engine: ReelEngine) {
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
    const mask = new Graphics();
    mask.rect(0, 0, CELL_WIDTH, VIEW_HEIGHT);
    mask.fill({ color: 0xffffff });
    this.container.addChild(mask);
    cellsContainer.mask = mask;

    this.cellSymbols = [...engine.strip.cells];
    for (const symbol of engine.strip.cells) {
      // セル単位のコンテナ：背景タイル + 文字
      const cell = new Container();

      // 背景タイル（角丸・symbol色・薄縁取り）
      const tile = new Graphics();
      tile
        .roundRect(
          TILE_PAD,
          -CELL_HEIGHT / 2 + TILE_PAD,
          CELL_WIDTH - TILE_PAD * 2,
          CELL_HEIGHT - TILE_PAD * 2,
          TILE_RADIUS,
        )
        .fill({ color: symbolColor(symbol) })
        .stroke({ width: 2, color: 0x000000, alpha: 0.55 });
      cell.addChild(tile);

      // 文字（白固定・明朝体・黒ストロークでタイル上のコントラスト確保）
      const text = new Text({
        text: symbol,
        style: {
          fill: 0xffffff,
          fontSize: 60,
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

      cellsContainer.addChild(cell);
      this.cellContainers.push(cell);
    }
    this.container.addChild(cellsContainer);

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
   * クイズ正解時の目標文字を設定。non-null の間、target と一致しない
   * セル（タイル＋文字まとめて）を薄く描画してフォーカスを強調する。
   * null を渡すと通常表示に戻る。
   */
  setTargetSymbol(symbol: string | null): void {
    for (let i = 0; i < this.cellContainers.length; i++) {
      const isTarget = symbol === null || this.cellSymbols[i] === symbol;
      this.cellContainers[i].alpha = isTarget ? 1 : 0.25;
    }
  }

  /** 中央セル（ペイライン上）を一定時間グローさせる（役成立時） */
  highlightCenter(durMs = 1200): void {
    this.centerGlowStart = performance.now();
    this.centerGlowDuration = durMs;
    this.centerGlowAlpha = 0.55;
    this.centerGlow.alpha = this.centerGlowAlpha;
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
    this.bg.rect(0, 0, CELL_WIDTH, VIEW_HEIGHT);
    this.bg.fill({ color: 0x000000 });
    this.bg.stroke({ width: strokeWidth, color: strokeColor });
  }
}
