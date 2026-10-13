import { describe, it, expect } from 'vitest';
import {
  EFFECT_PROCEDURES,
  EffectDirector,
  allowedInBonus,
  type ProcedureId,
} from '../../src/productions/EffectProcedures';

const ALL = Object.keys(EFFECT_PROCEDURES) as ProcedureId[];

describe('ボーナス中に出せる演出（ユーザーの指示・2026-10-14）', () => {
  it('ボーナス中に出せるのは、狙う役・図柄が画面に出ていて見て揃えられるものだけ', () => {
    const inBonus = ALL.filter(allowedInBonus).sort();
    expect(inBonus).toEqual(['aim', 'bitaChance', 'quiz', 'shisa']);
  });

  it('予兆・ステップアップ・遅れ・フリーズ（ブラックアウト）はボーナス中に出さない', () => {
    for (const id of [
      'omenSilence',
      'omenBacklight',
      'stepUp',
      'delay',
      'freeze',
      'announceLamp',
      'chanceFollow',
    ] as const) {
      expect(allowedInBonus(id)).toBe(false);
    }
  });

  it('進行役はボーナス中に never の手続きを始めない（呼ぶ側の条件漏れをここで止める）', () => {
    for (const id of ALL) {
      const d = new EffectDirector();
      let started = 0;
      d.register(id, { onLever: () => started++ });
      const ok = d.start(id, {}, { bonusActive: true });
      expect(ok).toBe(allowedInBonus(id));
      expect(started).toBe(allowedInBonus(id) ? 1 : 0);
      expect(d.isActive(id)).toBe(allowedInBonus(id));
    }
  });
});

describe('EffectDirector の段取り', () => {
  it('レバー → 停止 → 全停止 → 片付け → 次のレバーで終わる', () => {
    const d = new EffectDirector();
    const log: string[] = [];
    d.register<{ n: number }>('omenBacklight', {
      onLever: (p) => log.push(`lever${p.n}`),
      onStop: (p, stopNo, reel) => log.push(`stop${stopNo}:${reel}`),
      onAllStop: () => log.push('all'),
      onResultClear: () => log.push('clear'),
      onEnd: () => log.push('end'),
    });
    d.beginSpin();
    expect(d.start('omenBacklight', { n: 1 }, { bonusActive: false })).toBe(true);
    d.stop(1, 0);
    d.stop(2, 2);
    d.stop(3, 1);
    d.allStop();
    d.resultClear();
    d.beginSpin();
    expect(log).toEqual(['lever1', 'stop1:0', 'stop2:2', 'stop3:1', 'all', 'clear', 'end']);
    expect(d.activeIds()).toEqual([]);
  });

  it('登録していない手続きは始まらない', () => {
    const d = new EffectDirector();
    expect(d.start('stepUp', {}, { bonusActive: false })).toBe(false);
  });

  it('続ける手続きは次のゲームでもう一度始める（前のゲームのぶんは終わる）', () => {
    const d = new EffectDirector();
    const log: string[] = [];
    d.register<{ game: number }>('stepUp', {
      onLever: (p) => log.push(`lever${p.game}`),
      onEnd: (p) => log.push(`end${p.game}`),
    });
    const run = { game: 1 };
    d.start('stepUp', run, { bonusActive: false });
    d.beginSpin();
    run.game = 2;
    d.start('stepUp', run, { bonusActive: false });
    expect(log).toEqual(['lever1', 'end1', 'lever2']);
  });
});
