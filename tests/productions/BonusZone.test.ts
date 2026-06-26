import { describe, it, expect } from 'vitest';
import { BonusZone } from '../../src/productions/BonusZone';

const CONFIG = {
  spinsPerBonus: 10,
  spinsPerReg: 5,
  bonusEffectRates: { none: 0, shisa: 0.5, quiz: 0.2, aim: 0.3 },
};

describe('BonusZone.trigger', () => {
  it('新規 big 突入で remaining=spinsPerBonus・active・kind=big', () => {
    const z = new BonusZone(CONFIG);
    z.trigger('big');
    expect(z.isActive()).toBe(true);
    expect(z.remaining.get()).toBe(10);
    expect(z.kind.get()).toBe('big');
  });

  it('新規 reg 突入で remaining=spinsPerReg・kind=reg', () => {
    const z = new BonusZone(CONFIG);
    z.trigger('reg');
    expect(z.remaining.get()).toBe(5);
    expect(z.kind.get()).toBe('reg');
  });

  it('active 中の再トリガーは残り回数に加算（おかわり）', () => {
    const z = new BonusZone(CONFIG);
    z.trigger('big'); // 10
    z.trigger('big'); // +10 = 20
    expect(z.remaining.get()).toBe(20);
  });

  it('reg 中に big を引くと big へ昇格＋加算', () => {
    const z = new BonusZone(CONFIG);
    z.trigger('reg'); // 5, reg
    z.trigger('big'); // +10 = 15, big へ昇格
    expect(z.remaining.get()).toBe(15);
    expect(z.kind.get()).toBe('big');
  });

  it('big 中に reg を引いても種別は降格しない（big 維持）＋加算', () => {
    const z = new BonusZone(CONFIG);
    z.trigger('big'); // 10, big
    z.trigger('reg'); // +5 = 15, big のまま（降格しない）
    expect(z.remaining.get()).toBe(15);
    expect(z.kind.get()).toBe('big');
  });
});

describe('BonusZone.consumeSpin', () => {
  it('BET ごとに残り-1、0 で非アクティブ・kind=null', () => {
    const z = new BonusZone({ ...CONFIG, spinsPerBonus: 2 });
    z.trigger('big'); // 2
    z.consumeSpin(); // 1
    expect(z.remaining.get()).toBe(1);
    expect(z.isActive()).toBe(true);
    z.consumeSpin(); // 0 → 非アクティブ
    expect(z.remaining.get()).toBe(0);
    expect(z.isActive()).toBe(false);
    expect(z.kind.get()).toBeNull();
  });

  it('非アクティブ時の consumeSpin は無効', () => {
    const z = new BonusZone(CONFIG);
    z.consumeSpin();
    expect(z.remaining.get()).toBe(0);
    expect(z.isActive()).toBe(false);
  });
});
