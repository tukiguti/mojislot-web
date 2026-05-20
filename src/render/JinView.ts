import { Container, Graphics } from 'pixi.js';
import type { JinState, JinExpression } from '../productions/JinState';

/**
 * シーサー風マスコット「ジン」の描画。
 * Pixi Graphics で組み上げ、表情ごとに目・口・オーラを切り替える。
 * Phase 5 で Unity に置き換えやすいよう、状態は JinState 側に閉じてある。
 */

const BODY_RADIUS = 70;
const MANE_OUTER = 90;
const EYE_OFFSET_X = 22;
const EYE_OFFSET_Y = -10;
const MOUTH_Y = 22;

const AURA_BY_EXPRESSION: Record<JinExpression, number | null> = {
  idle: null,
  shisa: 0x66ccff,
  quiz: 0xff66cc,
  cheer: 0xffd700,
  miss: null,
};

export class JinView {
  readonly container: Container;
  private readonly aura: Graphics;
  private readonly body: Graphics;
  private readonly face: Graphics;
  private unsubscribe: () => void;
  private bobPhase = 0;

  constructor(state: JinState) {
    this.container = new Container();

    this.aura = new Graphics();
    this.body = new Graphics();
    this.face = new Graphics();

    this.container.addChild(this.aura);
    this.container.addChild(this.body);
    this.container.addChild(this.face);

    this.drawBody();
    this.drawFace(state.get());
    this.drawAura(state.get());

    this.unsubscribe = state.expression.subscribe((expr) => {
      this.drawFace(expr);
      this.drawAura(expr);
    });
  }

  /** main の ticker から呼ぶ。微妙に上下動して生きてる感を出す */
  update(nowMs: number): void {
    this.bobPhase = (nowMs / 600) % (Math.PI * 2);
    this.body.y = Math.sin(this.bobPhase) * 3;
    this.face.y = this.body.y;
  }

  destroy(): void {
    this.unsubscribe();
    this.container.destroy({ children: true });
  }

  private drawBody(): void {
    const g = this.body;
    g.clear();

    // たてがみ（金色の輪）
    g.circle(0, 0, MANE_OUTER);
    g.fill({ color: 0xd9a441 });

    // たてがみのギザギザ感（小さい三角を周囲に）
    const spikes = 12;
    for (let i = 0; i < spikes; i++) {
      const angle = (i / spikes) * Math.PI * 2;
      const x = Math.cos(angle) * MANE_OUTER;
      const y = Math.sin(angle) * MANE_OUTER;
      g.circle(x, y, 10);
      g.fill({ color: 0xb8862b });
    }

    // 顔の輪郭
    g.circle(0, 0, BODY_RADIUS);
    g.fill({ color: 0xf5e6c8 });

    // 鼻
    g.circle(0, 6, 6);
    g.fill({ color: 0x2a1a0a });
  }

  private drawFace(expr: JinExpression): void {
    const g = this.face;
    g.clear();

    // 目
    if (expr === 'cheer') {
      // ハート風（簡略）：目を閉じてニコ
      this.drawClosedEye(g, -EYE_OFFSET_X, EYE_OFFSET_Y);
      this.drawClosedEye(g, EYE_OFFSET_X, EYE_OFFSET_Y);
    } else if (expr === 'miss') {
      // 半目（>_<）
      this.drawClosedEye(g, -EYE_OFFSET_X, EYE_OFFSET_Y);
      this.drawClosedEye(g, EYE_OFFSET_X, EYE_OFFSET_Y);
    } else if (expr === 'shisa') {
      // やや見開く
      this.drawEye(g, -EYE_OFFSET_X, EYE_OFFSET_Y, 8);
      this.drawEye(g, EYE_OFFSET_X, EYE_OFFSET_Y, 8);
    } else if (expr === 'quiz') {
      // キラリ（白いハイライト大きめ）
      this.drawEye(g, -EYE_OFFSET_X, EYE_OFFSET_Y, 9, true);
      this.drawEye(g, EYE_OFFSET_X, EYE_OFFSET_Y, 9, true);
    } else {
      this.drawEye(g, -EYE_OFFSET_X, EYE_OFFSET_Y, 6);
      this.drawEye(g, EYE_OFFSET_X, EYE_OFFSET_Y, 6);
    }

    // 口
    if (expr === 'cheer') {
      // 大きく開いた口
      g.ellipse(0, MOUTH_Y + 4, 18, 14);
      g.fill({ color: 0x2a1a0a });
      g.ellipse(0, MOUTH_Y + 8, 10, 6);
      g.fill({ color: 0xff5577 });
    } else if (expr === 'miss') {
      // 一文字口
      g.rect(-12, MOUTH_Y, 24, 3);
      g.fill({ color: 0x2a1a0a });
    } else if (expr === 'quiz') {
      // O型の集中口
      g.circle(0, MOUTH_Y + 4, 7);
      g.fill({ color: 0x2a1a0a });
    } else if (expr === 'shisa') {
      // 「ニッ」と笑う口
      g.moveTo(-14, MOUTH_Y);
      g.quadraticCurveTo(0, MOUTH_Y + 12, 14, MOUTH_Y);
      g.stroke({ width: 3, color: 0x2a1a0a });
    } else {
      // idle: 微笑
      g.moveTo(-12, MOUTH_Y);
      g.quadraticCurveTo(0, MOUTH_Y + 8, 12, MOUTH_Y);
      g.stroke({ width: 3, color: 0x2a1a0a });
    }
  }

  private drawEye(
    g: Graphics,
    x: number,
    y: number,
    size: number,
    sparkle = false,
  ): void {
    g.circle(x, y, size);
    g.fill({ color: 0xffffff });
    g.circle(x, y, size - 2);
    g.fill({ color: 0x000000 });
    // ハイライト
    g.circle(x - size / 3, y - size / 3, sparkle ? 3 : 2);
    g.fill({ color: 0xffffff });
  }

  private drawClosedEye(g: Graphics, x: number, y: number): void {
    g.moveTo(x - 8, y);
    g.quadraticCurveTo(x, y - 6, x + 8, y);
    g.stroke({ width: 3, color: 0x2a1a0a });
  }

  private drawAura(expr: JinExpression): void {
    const g = this.aura;
    g.clear();
    const color = AURA_BY_EXPRESSION[expr];
    if (color === null) return;

    // 3層のグロー（外→内で濃く）
    g.circle(0, 0, MANE_OUTER + 30);
    g.fill({ color, alpha: 0.12 });
    g.circle(0, 0, MANE_OUTER + 18);
    g.fill({ color, alpha: 0.18 });
    g.circle(0, 0, MANE_OUTER + 6);
    g.fill({ color, alpha: 0.25 });
  }
}
