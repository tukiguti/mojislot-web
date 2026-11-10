import { describe, it, expect } from 'vitest';
import tuningRaw from '../../data/tuning/default.json';
import { TuningSchema } from '../../src/data/schemas';
import {
  STEP_LEVEL,
  pickColor,
  planStepUp,
  stepLevelAfterStop,
  type StepColor,
} from '../../src/productions/StepUp';

const cfg = TuningSchema.parse(tuningRaw).stepUp;

/** 固定の列を返す乱数。 */
const seq = (...values: number[]) => {
  let i = 0;
  return () => values[i++ % values.length];
};

/** 1ゲームぶんの段の動き（レバー・第1・第2・第3停止）。 */
const runGame = (color: StepColor) => {
  const levels = [STEP_LEVEL.blue];
  let cur = STEP_LEVEL.blue;
  for (let stop = 1; stop <= 3; stop++) {
    cur = stepLevelAfterStop(cur, stop, color);
    levels.push(cur);
  }
  return levels;
};

describe('ステップアップ（当たったゲームの中で完結）', () => {
  it('チェリーは青か緑、ボーナスは赤か金で終わる', () => {
    for (let i = 0; i < 200; i++) {
      const r = Math.random;
      const c = planStepUp({ ...cfg, cherryRate: 1, bonusRate: 1 }, 'cherry', r);
      expect(['blue', 'green']).toContain(c);
      const b = planStepUp({ ...cfg, cherryRate: 1, bonusRate: 1 }, 'big', r);
      expect(['red', 'gold']).toContain(b);
      const g = planStepUp({ ...cfg, cherryRate: 1, bonusRate: 1 }, 'reg', r);
      expect(['red', 'gold']).toContain(g);
    }
  });

  it('チェリー・ボーナス以外では出ない', () => {
    for (const kind of ['miss', 'core', 'chance', 'single']) {
      expect(planStepUp({ ...cfg, cherryRate: 1, bonusRate: 1 }, kind, () => 0)).toBeNull();
    }
  });

  it('率を外れたら出ない', () => {
    expect(planStepUp(cfg, 'cherry', seq(0.999))).toBeNull();
    expect(planStepUp(cfg, 'big', seq(0.999))).toBeNull();
  });

  it('第1・第2停止は緑まで、第3停止で終了色（赤と金は最後まで見せない）', () => {
    expect(runGame('blue')).toEqual([2, 2, 2, 2]);
    expect(runGame('green')).toEqual([2, 3, 3, 3]);
    expect(runGame('red')).toEqual([2, 3, 3, 4]);
    expect(runGame('gold')).toEqual([2, 3, 3, 5]);
  });

  it('pickColor は重みのある色だけを返す', () => {
    for (let i = 0; i < 100; i++) {
      expect(['red', 'gold']).toContain(pickColor({ red: 0.8, gold: 0.2 }, Math.random));
    }
    expect(pickColor({}, Math.random)).toBe('blue');
  });
});
