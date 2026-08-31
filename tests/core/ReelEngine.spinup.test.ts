import { describe, expect, it } from 'vitest';
import { ReelEngine } from '../../src/core/ReelEngine';
import type { ReelStrip } from '../../src/data/schemas';

/**
 * リールの加速。**レバーONから定速になるまで**の間だけ速度を上げていく。
 *
 * 見た目のためだけの仕組みで、この間は停止操作を受け付けないので出目には効かない。
 * ただし「加速が効いていない」「リールごとの差が消えた」は目で気づきにくいので、
 * ここで押さえておく。
 */
const strip: ReelStrip = { cells: Array.from({ length: 21 }, (_, i) => String(i % 10)) };

/** `ms` 経過ぶん回してから位置を返す。tick は 16ms 刻みで送る。 */
function advance(engine: ReelEngine, ms: number): number {
  const step = 16;
  for (let t = 0; t <= ms; t += step) engine.tick(t);
  return engine.position;
}

describe('ReelEngine の加速', () => {
  it('加速中は定速より遅く、加速し切ると同じ速さになる', () => {
    const ramped = new ReelEngine(strip);
    const instant = new ReelEngine(strip);
    ramped.spin(200, 0);
    instant.spin(0, 0);

    // 加速の途中（100ms）では、進んだ距離が定速より短い
    expect(advance(ramped, 100)).toBeLessThan(advance(instant, 100));

    // 加速し切ったあとの1コマぶんの進み方は同じ
    const before = { r: ramped.position, i: instant.position };
    for (let t = 300; t <= 500; t += 16) {
      ramped.tick(t);
      instant.tick(t);
    }
    expect(ramped.position - before.r).toBeCloseTo(instant.position - before.i, 5);
  });

  it('リールごとに加速時間を変えると、回り出しがずれる', () => {
    const fast = new ReelEngine(strip);
    const slow = new ReelEngine(strip);
    fast.spin(110, 0);
    slow.spin(150, 0);
    // 同じ時間だけ回しても、加速が長い方は遅れる（揃って回り出さない）
    expect(advance(fast, 120)).toBeGreaterThan(advance(slow, 120));
  });

  it('加速時間0なら最初から定速（シミュレータはこちらを使う）', () => {
    const engine = new ReelEngine(strip);
    engine.spin();
    // 20コマ/秒 × 0.096秒 ≒ 1.92コマ
    expect(advance(engine, 96)).toBeCloseTo(1.92, 2);
  });
});
