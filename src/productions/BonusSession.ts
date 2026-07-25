import type { BonusKind, BonusZone } from './BonusZone';

/**
 * ボーナス**区間**（突入〜消化しきり）のライフサイクル管理。
 *
 * {@link BonusZone} が持つのは「残り何ゲームか」という**ゲーム単位**の状態だけで、
 * 「この区間で何枚取れたか」「今のは新規突入か上乗せ（おかわり）か」といった
 * **区間単位**の情報は持たない。そこを担うのがこのクラス。
 *
 * 実機の BIG/REG と同じく、次の3点が扱いの要になる：
 *  - **突入役そのものの払い出しは区間の獲得に含めない**（通常時に引いた分なので）
 *  - **種別は昇格のみ**（BIG中にREGを引いても区間はBIGのまま）
 *  - **残数の消費はそのゲームの演出・配当・上乗せ判定がすべて終わってから**
 *    （BET時に減らすと最終ゲームだけボーナス扱いから外れる）
 *
 * 3番目は呼び出し順を間違えると静かに壊れるため、{@link settle} が消費・集計・
 * 終了判定をまとめて引き受けて順序を固定する。
 */

/** {@link BonusSession.enter} の結果。突入演出と上乗せ演出の出し分けに使う。 */
export interface BonusEntry {
  /** true = ボーナス中の再当選（おかわり＝残数上乗せ）／ false = 新規突入。 */
  isAddition: boolean;
  /** 今回加算されたスピン数（上乗せ表示に使う）。 */
  spinsAdded: number;
}

/** 区間が消化しきった時の締め情報。 */
export interface BonusRunEnd {
  /** 突入〜消化しきりまでの獲得枚数（突入役の払い出しは含まない）。 */
  payout: number;
  /** 区間の種別（BIG中のREGおかわりでは big のまま）。 */
  kind: BonusKind;
}

export class BonusSession {
  /** 区間が継続中か（残数が尽きて終了リザルトを返すまで true）。 */
  private runActive = false;
  /** 区間の獲得枚数の累計。 */
  private runPayout = 0;
  /** 区間の種別。zone.kind は消化しきりで null になるので、締めの表示用に別途持つ。 */
  private runKind: BonusKind = 'big';
  /** この1Gをボーナス扱いにするか（BET時に固定）。 */
  private spinActiveFlag = false;
  /** この1Gが区間の突入ゲームか（＝獲得集計から除く）。 */
  private enteredThisSpin = false;

  constructor(private readonly zone: BonusZone) {}

  /**
   * その1Gがボーナス中か。**BET時点で固定**するので、消化しきりの最終ゲームも
   * 最後まで true のまま（配当倍率・演出レート・残数消費の判定が一貫する）。
   */
  get spinActive(): boolean {
    return this.spinActiveFlag;
  }

  /** BET 成立時。その1Gのボーナス扱いを固定する。 */
  beginSpin(): void {
    this.spinActiveFlag = this.zone.isActive();
    this.enteredThisSpin = false;
  }

  /** 次ゲームの BET までボーナス扱いを持ち越さない。 */
  resetSpin(): void {
    this.spinActiveFlag = false;
  }

  /**
   * ボーナス役成立。新規突入なら区間を開始し、区間中なら残数を上乗せする。
   * 種別は昇格のみ（BIG中にREGを引いても区間はBIGのまま）。
   */
  enter(kind: BonusKind): BonusEntry {
    const isAddition = this.runActive;
    if (!isAddition) {
      this.runActive = true;
      this.runPayout = 0;
      this.enteredThisSpin = true;
    }
    // big は常に採用（＝昇格）、reg は新規突入の時だけ。これで降格が起きない。
    if (kind === 'big' || !isAddition) this.runKind = kind;
    this.zone.trigger(kind);
    return {
      isAddition,
      spinsAdded:
        kind === 'reg'
          ? this.zone.config.spinsPerReg
          : this.zone.config.spinsPerBonus,
    };
  }

  /**
   * 全停止後の締め。残数を1消費し、獲得を集計し、消化しきったら結果を返す。
   * このゲームの演出・配当・上乗せ判定がすべて終わってから**1回だけ**呼ぶ。
   *
   * @param win このゲームの払い出し枚数
   * @returns 区間が終わったならその締め情報、継続中なら null
   */
  settle(win: number): BonusRunEnd | null {
    if (this.spinActiveFlag) this.zone.consumeSpin();
    if (!this.runActive) return null;
    // 突入ゲームの払い出しは通常時に引いた分なので区間の獲得に含めない。
    if (!this.enteredThisSpin) this.runPayout += Math.max(0, win);
    if (this.zone.isActive()) return null;
    this.runActive = false;
    return { payout: this.runPayout, kind: this.runKind };
  }
}
