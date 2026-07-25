import { describe, expect, it } from 'vitest';
import { BonusZone } from '../../src/productions/BonusZone';
import { BonusSession } from '../../src/productions/BonusSession';

/**
 * ボーナス区間の会計。ここが狂うと「終了リザルトの枚数が合わない」「BIGがREGに化ける」
 * といった、プレイ中に気づきにくい壊れ方をする。
 *
 * 実際のゲームループの順序に合わせて呼ぶ：
 *   beginSpin() → （成立すれば enter()）→ settle(win) → resetSpin()
 */

const CONFIG = {
  spinsPerBonus: 3,
  spinsPerReg: 2,
  bonusEffectRates: { none: 0, shisa: 0.5, quiz: 0.2, aim: 0.3 },
};

const newSession = () => new BonusSession(new BonusZone(CONFIG));

/** 1ゲーム進める。成立役があれば突入/上乗せさせる。 */
const playSpin = (
  s: BonusSession,
  win: number,
  enter?: 'big' | 'reg',
) => {
  s.beginSpin();
  if (enter) s.enter(enter);
  const end = s.settle(win);
  s.resetSpin();
  return end;
};

describe('BonusSession', () => {
  it('突入ゲームの払い出しは区間の獲得に含めない', () => {
    const s = newSession();
    // 突入G（+100枚）は通常時に引いた分なので集計外。以降の3Gぶんだけ数える。
    expect(playSpin(s, 100, 'big')).toBeNull();
    expect(playSpin(s, 10)).toBeNull();
    expect(playSpin(s, 20)).toBeNull();
    expect(playSpin(s, 30)).toEqual({ payout: 60, kind: 'big' });
  });

  it('消化しきるまで終了を返さず、しきった1回だけ返す', () => {
    const s = newSession();
    playSpin(s, 0, 'reg'); // 残り2G
    expect(playSpin(s, 5)).toBeNull();
    expect(playSpin(s, 5)).toEqual({ payout: 10, kind: 'reg' });
    // 区間が終わった後のゲームでは二重に締めない
    expect(playSpin(s, 5)).toBeNull();
  });

  it('おかわり（区間中の再当選）は残数に上乗せし、突入演出用フラグを返す', () => {
    const s = newSession();
    const first = s.enter('big');
    expect(first).toEqual({ isAddition: false, spinsAdded: 3 });
    const second = s.enter('big');
    expect(second).toEqual({ isAddition: true, spinsAdded: 3 });
  });

  it('BIG区間中のREGおかわりでも区間はBIGのまま（降格しない）', () => {
    const s = newSession();
    s.beginSpin();
    s.enter('big');
    s.enter('reg'); // 同一Gでのおかわり
    s.settle(0);
    s.resetSpin();
    // 突入G自体は通常時のゲームなので消費されない。big3G + reg2G = 5G まるごと残る。
    let end = null;
    for (let i = 0; i < 5; i++) end = playSpin(s, 1);
    expect(end).toEqual({ payout: 5, kind: 'big' });
  });

  it('REG区間中のBIGは区間をBIGへ昇格させる', () => {
    const s = newSession();
    playSpin(s, 0, 'reg'); // 残り2G
    const end = playSpin(s, 7, 'big'); // 上乗せ+3G、この1Gも消費 → 残り4G
    expect(end).toBeNull();
    // おかわりGの払い出しは（突入Gではないので）集計に入る
    let last = null;
    for (let i = 0; i < 4; i++) last = playSpin(s, 0);
    expect(last).toEqual({ payout: 7, kind: 'big' });
  });

  it('ボーナス扱いはBET時に固定され、最終ゲームも最後までボーナス扱い', () => {
    const s = newSession();
    playSpin(s, 0, 'reg'); // 残り2G
    s.beginSpin();
    expect(s.spinActive).toBe(true);
    s.settle(0); // 残り1G
    s.resetSpin();
    expect(s.spinActive).toBe(false);

    s.beginSpin();
    expect(s.spinActive).toBe(true); // 最終Gも倍率・演出の対象
    expect(s.settle(0)).not.toBeNull();
    expect(s.spinActive).toBe(true); // 締めの判定が終わるまで落とさない
    s.resetSpin();
    expect(s.spinActive).toBe(false);
  });

  it('区間外のゲームでは残数を消費しない', () => {
    const s = new BonusZone(CONFIG);
    const session = new BonusSession(s);
    session.enter('big'); // BETを挟まずに発動（デバッグ発動の経路）
    expect(s.remaining.get()).toBe(3);
    // beginSpin していない＝この1Gはボーナス扱いでないので消費されない
    session.settle(0);
    expect(s.remaining.get()).toBe(3);
  });

  it('マイナスの払い出しは集計に持ち込まない', () => {
    const s = newSession();
    playSpin(s, 0, 'reg');
    playSpin(s, -50);
    expect(playSpin(s, 8)).toEqual({ payout: 8, kind: 'reg' });
  });
});
