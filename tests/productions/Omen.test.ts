import { describe, it, expect } from 'vitest';
import tuningRaw from '../../data/tuning/default.json';
import { TuningSchema } from '../../src/data/schemas';
import { omenRate, rollOmen, type OmenContext } from '../../src/productions/Omen';

const cfg = TuningSchema.parse(tuningRaw).omen;

const base: OmenContext = {
  roleKind: 'big',
  freeze: false,
  carryYakuId: null,
  fromLottery: true,
  effectShown: false,
  bonusActive: false,
};

describe('予兆はボーナスのフラグでしか出ない（嘘をつかない）', () => {
  it('BIG・REG・ボーナスを持ち越すチャンス目でだけ率がある', () => {
    expect(omenRate(cfg, base)).toBe(cfg.rate.big);
    expect(omenRate(cfg, { ...base, roleKind: 'reg' })).toBe(cfg.rate.reg);
    expect(omenRate(cfg, { ...base, roleKind: 'chance', carryYakuId: 'big1' })).toBe(
      cfg.rate.chance,
    );
  });

  it('ハズレ・1枚役・小役・チェリー・ボーナスの無いチャンス目では出ない', () => {
    for (const roleKind of ['miss', 'single', 'core', 'cherry', 'chance']) {
      expect(omenRate(cfg, { ...base, roleKind })).toBe(0);
      expect(rollOmen(cfg, { ...base, roleKind }, () => 0)).toBeNull();
    }
  });

  it('ボーナス中は出さない（情報の無い煽りになる）', () => {
    for (const roleKind of ['big', 'reg', 'core', 'cherry']) {
      const ctx = { ...base, roleKind, bonusActive: true };
      expect(omenRate(cfg, ctx)).toBe(0);
      expect(rollOmen(cfg, ctx, () => 0)).toBeNull();
    }
  });

  it('演出の出ているゲーム・持ち越しや確定ランプのゲーム・フリーズでは出さない', () => {
    expect(omenRate(cfg, { ...base, effectShown: true })).toBe(0);
    expect(omenRate(cfg, { ...base, fromLottery: false })).toBe(0);
    expect(omenRate(cfg, { ...base, freeze: true })).toBe(0);
  });
});

describe('出た時の中身', () => {
  it('種類と場面はフラグによらない（BIG か REG かは言わない）', () => {
    const rng = () => {
      const values = [0, 0.7, 0.4];
      let i = 0;
      return () => values[i++];
    };
    const big = rollOmen(cfg, base, rng());
    const reg = rollOmen(cfg, { ...base, roleKind: 'reg' }, rng());
    expect(big).not.toBeNull();
    expect(big).toEqual(reg);
  });

  it('種類の重みと場面の重みで引く', () => {
    // 0 → 当選、0.1 → 無音（重み1:1の前半）、0.9 → 第2停止
    expect(rollOmen(cfg, base, (() => { const v = [0, 0.1, 0.9]; let i = 0; return () => v[i++]; })()))
      .toEqual({ kind: 'silence', at: 2 });
    // 0.6 → バックライト、0.1 → レバー
    expect(rollOmen(cfg, base, (() => { const v = [0, 0.6, 0.1]; let i = 0; return () => v[i++]; })()))
      .toEqual({ kind: 'backlight', at: 0 });
  });

  it('率を超えた乱数では出ない', () => {
    expect(rollOmen(cfg, base, () => 0.99)).toBeNull();
  });
});
