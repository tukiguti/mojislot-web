import { Container, Graphics, Text } from 'pixi.js';
import type { ReelEngine } from '../core/ReelEngine';

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

export class ReelView {
  readonly container: Container;
  private readonly cellTexts: Text[] = [];
  private readonly bg: Graphics;
  private tenpaiAnimMs = 0;
  private tenpaiPremium = false;

  constructor(private readonly engine: ReelEngine) {
    this.container = new Container();

    this.bg = new Graphics();
    this.redrawBg(0xffd700, 3);
    this.container.addChild(this.bg);

    const cellsContainer = new Container();
    const mask = new Graphics();
    mask.rect(0, 0, CELL_WIDTH, VIEW_HEIGHT);
    mask.fill({ color: 0xffffff });
    this.container.addChild(mask);
    cellsContainer.mask = mask;

    for (const symbol of engine.strip.cells) {
      const text = new Text({
        text: symbol,
        style: {
          fill: 0xffffff,
          fontSize: 72,
          fontFamily: 'system-ui, "Hiragino Sans", "Yu Gothic", sans-serif',
          fontWeight: 'bold',
        },
      });
      text.anchor.set(0.5);
      text.x = CELL_WIDTH / 2;
      cellsContainer.addChild(text);
      this.cellTexts.push(text);
    }
    this.container.addChild(cellsContainer);

    const payline = new Graphics();
    payline.moveTo(0, PAYLINE_Y);
    payline.lineTo(CELL_WIDTH, PAYLINE_Y);
    payline.stroke({ width: 2, color: 0xff3333 });
    this.container.addChild(payline);

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
    for (let i = 0; i < total; i++) {
      let y = (pos - i) * CELL_HEIGHT + PAYLINE_Y + PRE_BUFFER;
      y = ((y % totalHeight) + totalHeight) % totalHeight;
      this.cellTexts[i].y = y - PRE_BUFFER;
    }

    // テンパイ枠の脈動
    if (this.tenpaiAnimMs > 0) {
      const t = nowMs ?? performance.now();
      const pulse = (Math.sin(t / 120) + 1) / 2; // 0..1
      const baseColor = this.tenpaiPremium ? 0xff3366 : 0xffff00;
      const width = 3 + pulse * 3;
      this.redrawBg(baseColor, width);
    }
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
