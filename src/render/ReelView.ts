import { Container, Graphics, Text } from 'pixi.js';
import type { ReelEngine } from '../core/ReelEngine';

export const CELL_WIDTH = 130;
export const CELL_HEIGHT = 100;
export const VISIBLE_CELLS = 3;

const VIEW_HEIGHT = CELL_HEIGHT * VISIBLE_CELLS;
const PAYLINE_Y = CELL_HEIGHT * 1.5;

export class ReelView {
  readonly container: Container;
  private readonly cellTexts: Text[] = [];

  constructor(private readonly engine: ReelEngine) {
    this.container = new Container();

    const bg = new Graphics();
    bg.rect(0, 0, CELL_WIDTH, VIEW_HEIGHT);
    bg.fill({ color: 0x000000 });
    bg.stroke({ width: 3, color: 0xffd700 });
    this.container.addChild(bg);

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

  update(): void {
    const pos = this.engine.position;
    const total = this.engine.strip.cells.length;
    const totalHeight = total * CELL_HEIGHT;

    for (let i = 0; i < total; i++) {
      let y = (i - pos) * CELL_HEIGHT + PAYLINE_Y;
      y = ((y % totalHeight) + totalHeight) % totalHeight;
      this.cellTexts[i].y = y;
    }
  }
}
