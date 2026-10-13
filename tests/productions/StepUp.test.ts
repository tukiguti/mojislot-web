import { describe, it, expect } from 'vitest';
import tuningRaw from '../../data/tuning/default.json';
import { TuningSchema } from '../../src/data/schemas';
import {
  STEP_COLORS,
  STEP_LEVEL,
  isStepTrigger,
  pickChainLength,
  pickStepBonus,
  pickStepColor,
  stepCapFor,
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
const runGame = (start: number, game: number, length: number, color: StepColor) => {
  const cap = stepCapFor(game, length, color);
  const levels = [start];
  let cur = start;
  for (let stop = 1; stop <= 3; stop++) {
    cur = stepLevelAfterStop(cur, stop, cap);
    levels.push(cur);
  }
  return levels;
};

describe('ステップアップの率（tuning.stepUp）', () => {
  it('終了色の振り分けは合計1', () => {
    const sum = STEP_COLORS.reduce((s, c) => s + cfg.colors[c].rate, 0);
    expect(sum).toBeCloseTo(1, 9);
  });

  it('1回のステップアップから出るボーナスは 0.3855 のまま（BIG/REG はここ経由でしか出ない）', () => {
    const bonus = STEP_COLORS.reduce(
      (s, c) => s + cfg.colors[c].rate * cfg.colors[c].bonusRate,
      0,
    );
    expect(bonus).toBeCloseTo(0.3855, 4);
  });

  it('青は続かない（上がる先が無い）', () => {
    expect(cfg.colors.blue.chain.second).toBe(0);
  });

  it('続いたこと自体が期待度を上げる（続くほど予告したゲームのボーナス率が高い）', () => {
    // 2ゲーム目・3ゲーム目へ届いた走りの、予告したゲームがボーナスになる率
    const reach = (game: 1 | 2 | 3) => {
      let w = 0;
      let b = 0;
      for (const c of STEP_COLORS) {
        const { rate, bonusRate, chain } = cfg.colors[c];
        const p = game === 1 ? 1 : game === 2 ? chain.second : chain.second * chain.third;
        w += rate * p;
        b += rate * p * bonusRate;
      }
      return b / w;
    };
    expect(reach(2)).toBeGreaterThan(reach(1));
    expect(reach(3)).toBeGreaterThan(reach(2));
  });
});

describe('契機と抽選', () => {
  it('チェリーと払い出し5枚以上の小役だけが契機', () => {
    expect(isStepTrigger('cherry', 2, cfg)).toBe(true);
    expect(isStepTrigger('core', 5, cfg)).toBe(true);
    expect(isStepTrigger('core', 4, cfg)).toBe(false);
    expect(isStepTrigger('big', 0, cfg)).toBe(false);
    expect(isStepTrigger('miss', 0, cfg)).toBe(false);
  });

  it('色は振り分けの累積で決まる', () => {
    expect(pickStepColor(cfg, () => 0)).toBe('blue');
    expect(pickStepColor(cfg, () => 0.46)).toBe('green');
    expect(pickStepColor(cfg, () => 0.81)).toBe('red');
    expect(pickStepColor(cfg, () => 0.99)).toBe('gold');
  });

  it('連続演出の長さ：続かない・2ゲーム・3ゲーム', () => {
    expect(pickChainLength(cfg, 'red', seq(0.9))).toBe(1);
    expect(pickChainLength(cfg, 'red', seq(0.1, 0.9))).toBe(2);
    expect(pickChainLength(cfg, 'red', seq(0.1, 0.1))).toBe(3);
    expect(pickChainLength(cfg, 'blue', seq(0))).toBe(1);
  });

  it('金はボーナス確定・BIG がほとんど', () => {
    expect(pickStepBonus(cfg, 'gold', 1, seq(0.999, 0.5))).toBe('big');
    expect(pickStepBonus(cfg, 'blue', 1, seq(0.5))).toBeNull();
  });
});

describe('段の動き', () => {
  it('1ゲームで終わる時は、第3停止で終了色が出る（従来と同じ）', () => {
    expect(runGame(STEP_LEVEL.blue, 1, 1, 'blue')).toEqual([2, 2, 2, 2]);
    expect(runGame(STEP_LEVEL.blue, 1, 1, 'green')).toEqual([2, 3, 3, 3]);
    expect(runGame(STEP_LEVEL.blue, 1, 1, 'red')).toEqual([2, 3, 4, 4]);
    expect(runGame(STEP_LEVEL.blue, 1, 1, 'gold')).toEqual([2, 3, 4, 5]);
  });

  it('連続演出：途中のゲームは上限で止まり、最後のゲームの第3停止で終了色', () => {
    // 金・3ゲーム：緑どまり → 赤どまり → 金
    const g1 = runGame(STEP_LEVEL.blue, 1, 3, 'gold');
    const g2 = runGame(g1[3], 2, 3, 'gold');
    const g3 = runGame(g2[3], 3, 3, 'gold');
    expect(g1).toEqual([2, 3, 3, 3]);
    expect(g2).toEqual([3, 4, 4, 4]);
    expect(g3).toEqual([4, 5, 5, 5]);
  });

  it('どの色・長さでも、段は下がらず終了色を越えず、終了色は最後のゲームでしか出ない', () => {
    for (const color of STEP_COLORS) {
      for (const length of [1, 2, 3]) {
        let level: number = STEP_LEVEL.blue;
        const all: number[] = [];
        for (let game = 1; game <= length; game++) {
          const levels = runGame(level, game, length, color);
          all.push(...levels);
          level = levels[3];
          if (game < length && STEP_LEVEL[color] > STEP_LEVEL.blue + game - 1) {
            // 途中のゲームの終わりの段は、そのゲームの上限
            expect(level).toBe(Math.min(STEP_LEVEL[color], STEP_LEVEL.blue + game));
          }
        }
        for (let i = 1; i < all.length; i++) expect(all[i]).toBeGreaterThanOrEqual(all[i - 1]);
        expect(Math.max(...all)).toBe(STEP_LEVEL[color]);
        expect(level).toBe(STEP_LEVEL[color]);
      }
    }
  });
});
