import { Container, Graphics } from 'pixi.js';
import { PAYLINES, type Payline, type PaylineId } from '../core/Paylines';

/**
 * ジャグラー風のペイライン示唆インジケーター。
 * リールの両脇外側に小さく配置し、各ラインの形状（横/斜め）を
 * カラフルな「3点＋線」アイコンで表示する。
 *  - 通常時：薄く表示（5本のラインが評価対象であることを明示）
 *  - ヒット時：脈動しながら明るく光る
 */

const COLORS: Record<PaylineId, number> = {
  top: 0x4cc9f0, // cyan
  middle: 0xffd700, // gold
  bottom: 0xef476f, // pink
  diag_tlbr: 0x80ed99, // mint
  diag_bltr: 0xb388ff, // lavender
};

const ICON_W = 64;
const ICON_H = 40;
const ICON_GAP = 8;
const DOT_R = 3;
const LINE_THICK = 2;
const HIT_DURATION_MS = 1600;

interface IndicatorPart {
  container: Container;
  bg: Graphics;
  shape: Graphics;
  hitUntilMs: number;
  /** 前フレームで描画した alpha 値（変化検知用） */
  lastAlpha: number;
  /** 前フレームの isHit 状態 */
  lastIsHit: boolean;
}

export class PaylineIndicators {
  readonly container: Container;
  /** インジケーター全体の高さ（5アイコン + 4ギャップ） */
  static readonly TOTAL_HEIGHT = ICON_H * PAYLINES.length + ICON_GAP * (PAYLINES.length - 1);
  static readonly WIDTH = ICON_W;

  private parts: Map<PaylineId, IndicatorPart> = new Map();

  constructor() {
    this.container = new Container();
    PAYLINES.forEach((line, i) => {
      const part = this.buildIndicator(line);
      part.container.y = i * (ICON_H + ICON_GAP);
      this.container.addChild(part.container);
      this.parts.set(line.id, part);
    });
  }

  private buildIndicator(line: Payline): IndicatorPart {
    const c = new Container();
    const bg = new Graphics();
    c.addChild(bg);
    const shape = new Graphics();
    c.addChild(shape);
    const part: IndicatorPart = {
      container: c,
      bg,
      shape,
      hitUntilMs: 0,
      lastAlpha: 0.4,
      lastIsHit: false,
    };
    this.redraw(line, part, false, 0.4);
    return part;
  }

  /** 指定ラインを一定時間ハイライト点灯 */
  highlight(paylineId: PaylineId, durMs = HIT_DURATION_MS): void {
    const part = this.parts.get(paylineId);
    if (!part) return;
    part.hitUntilMs = performance.now() + durMs;
  }

  /** 全インジケーターのハイライトをリセット */
  clearAll(): void {
    for (const part of this.parts.values()) {
      part.hitUntilMs = 0;
    }
  }

  /**
   * 毎フレーム呼ぶ：ハイライト中のものだけ再描画する。
   * 非ヒット時は alpha 0.4 で固定なので、初回描画後はスキップする。
   * これで GPU 負荷を最小化し、リールのフレームレートを安定させる。
   */
  update(nowMs: number): void {
    for (const line of PAYLINES) {
      const part = this.parts.get(line.id);
      if (!part) continue;
      const isHit = nowMs < part.hitUntilMs;
      let alpha = 0.4;
      if (isHit) {
        const remain = (part.hitUntilMs - nowMs) / HIT_DURATION_MS;
        const pulse = 0.5 + 0.5 * Math.sin(nowMs / 90);
        alpha = 0.6 + 0.4 * remain * pulse;
      }
      // 状態変化なし or 微小変化（≦0.02）はスキップして無駄な再描画を避ける
      if (
        isHit === part.lastIsHit &&
        Math.abs(alpha - part.lastAlpha) < 0.02
      ) {
        continue;
      }
      this.redraw(line, part, isHit, alpha);
      part.lastIsHit = isHit;
      part.lastAlpha = alpha;
    }
  }

  private redraw(
    line: Payline,
    part: IndicatorPart,
    isHit: boolean,
    alpha: number,
  ): void {
    const color = COLORS[line.id];

    // bg
    part.bg.clear();
    part.bg
      .roundRect(0, 0, ICON_W, ICON_H, 5)
      .fill({ color: isHit ? 0x1a1505 : 0x0a0a0a, alpha: 0.9 })
      .stroke({
        color: isHit ? color : 0x333333,
        width: isHit ? 1.5 : 1,
        alpha: isHit ? 0.95 : 1,
      });

    // shape
    part.shape.clear();
    const colX = [ICON_W * 0.22, ICON_W * 0.5, ICON_W * 0.78];
    const rowY = [ICON_H * 0.28, ICON_H * 0.5, ICON_H * 0.72];
    const points = line.cells.map(([r, c]) => ({ x: colX[c], y: rowY[r] }));

    // 線
    part.shape.moveTo(points[0].x, points[0].y);
    part.shape.lineTo(points[1].x, points[1].y);
    part.shape.lineTo(points[2].x, points[2].y);
    part.shape.stroke({ color, width: LINE_THICK, alpha });

    // ドット
    for (const p of points) {
      part.shape.circle(p.x, p.y, DOT_R).fill({ color, alpha });
    }
  }
}
