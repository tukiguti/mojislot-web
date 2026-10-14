/**
 * 演出の手続きの登録表と、それを1ゲームの流れ（レバー・停止・全停止・片付け）に
 * 乗せる進行役。画面と音には触らない——実際に光らせる・鳴らすのは登録する側。
 *
 * 見た目の対応表は `EffectPresentation.ts`、ここは**いつ何をするか**の側。
 * main.ts に分岐で書いていた頃は、停止ごとの処理が停止ハンドラの中に散っていて、
 * 演出を1つ足すたびにレバー・停止・全停止・片付けの4か所を揃えて直す必要があった。
 *
 * ## ボーナス中に出せる演出（2026-10-14・ユーザーの指示）
 *
 * **ボーナス中は、プレイヤーが見て揃えられる演出だけにする。** 狙う図柄・役が
 * 画面から分かり、見て目押しすれば揃えられるものだけ。情報の無い煽り・予兆・
 * ブラックアウトは出さない。登録表の `inBonus` がその区別で、`'never'` の手続きは
 * 進行役がボーナス中に始めさせない（テスト `EffectProcedures.test.ts` で固定）。
 */

export type ProcedureId =
  | 'shisa'
  | 'quiz'
  | 'aim'
  | 'bitaChance'
  | 'stepUp'
  | 'omenSilence'
  | 'omenBacklight'
  | 'delay'
  | 'freeze'
  | 'announceLamp'
  | 'chanceFollow';

export interface ProcedureDef {
  label: string;
  /**
   * ボーナス中の扱い。
   *  - aimable: 狙う役・図柄が画面に出ていて、見て押せば揃えられる
   *  - never: ボーナス中は出さない
   */
  inBonus: 'aimable' | 'never';
  /** なぜその扱いか（判断を後から追えるように残す）。 */
  why: string;
}

export const EFFECT_PROCEDURES: Record<ProcedureId, ProcedureDef> = {
  shisa: {
    label: '示唆',
    inBonus: 'aimable',
    why: '候補の役を吹き出しに並べ、図柄が窓に来ればその役の狙えへ発展する',
  },
  quiz: {
    label: 'クイズ',
    inBonus: 'aimable',
    why: '答えの役の3文字を考えて狙う。答えは当選役そのもの',
  },
  aim: {
    label: '狙え！',
    inBonus: 'aimable',
    why: '当選役の3文字をリールの真上に出す',
  },
  bitaChance: {
    label: 'ビタチャンス',
    inBonus: 'aimable',
    why: '目印を中段にぴったり押せば揃う。目印は全島共通で画面に見えている',
  },
  stepUp: {
    label: 'ステップアップ',
    inBonus: 'never',
    why: '次のゲームの予告。ボーナス中は毎ゲーム当選で予告するものが無い',
  },
  omenSilence: {
    label: '無音',
    inBonus: 'never',
    why: '狙う役を言わない予兆。ボーナス中は情報の無い煽りになる',
  },
  omenBacklight: {
    label: 'バックライト消灯',
    inBonus: 'never',
    why: '狙う役を言わない予兆。ボーナス中は情報の無い煽りになる',
  },
  delay: {
    label: '遅れ',
    inBonus: 'never',
    why: '何かが当たっていることしか言わない。ボーナス中は毎ゲーム当たる',
  },
  freeze: {
    label: 'フリーズ',
    inBonus: 'never',
    why: 'ブラックアウトを伴う。フリーズ役はボーナス中の確率が0',
  },
  announceLamp: {
    label: '確定ランプ',
    inBonus: 'never',
    why: 'ボーナスの告知。ボーナス中は告知するものが無い',
  },
  chanceFollow: {
    label: 'チャンス目のあとの狙え・クイズ',
    inBonus: 'never',
    why: '持ち越したボーナスを指す。ボーナス中は持ち越しが無い',
  },
};

/** ボーナス中に始めてよい手続きか。 */
export const allowedInBonus = (id: ProcedureId): boolean =>
  EFFECT_PROCEDURES[id].inBonus === 'aimable';

/**
 * 1つの手続きの段取り。どれも省略できる。
 *
 * 寿命は「始めたゲームの次のレバーまで」。続けたい手続き（連続演出）は、
 * 次のゲームでもう一度 `start` する。
 */
export interface ProcedureHandler<P> {
  /** レバーON（`start` の時点）。 */
  onLever?(plan: P): void;
  /** 停止。`stopNo` は何本目の停止か（1〜3）、`reelIndex` は止めたリール。 */
  onStop?(plan: P, stopNo: number, reelIndex: number): void;
  /** 全停止（役の判定より前）。 */
  onAllStop?(plan: P): void;
  /** 結果の表示を片付ける時。 */
  onResultClear?(plan: P): void;
  /** 寿命が尽きた時（次のレバー）。片付け漏れの最後の受け皿。 */
  onEnd?(plan: P): void;
}

interface Active {
  id: ProcedureId;
  plan: unknown;
  handler: ProcedureHandler<unknown>;
}

export class EffectDirector {
  private readonly handlers = new Map<ProcedureId, ProcedureHandler<unknown>>();
  private active: Active[] = [];

  register<P>(id: ProcedureId, handler: ProcedureHandler<P>): void {
    this.handlers.set(id, handler as ProcedureHandler<unknown>);
  }

  /** 前のゲームの手続きを畳む。レバーONの最初に呼ぶ。 */
  beginSpin(): void {
    const prev = this.active;
    this.active = [];
    for (const a of prev) a.handler.onEnd?.(a.plan);
  }

  /**
   * 手続きを始める。**ボーナス中に `never` の手続きは始めない**（false を返す）。
   * 呼ぶ側の条件漏れをここで止める——ボーナス中に出してよいかは手続きの性質で
   * 決まっていて、呼ぶ場所ごとに判断させると抜けが出る。
   */
  start<P>(id: ProcedureId, plan: P, opts: { bonusActive: boolean }): boolean {
    if (opts.bonusActive && !allowedInBonus(id)) return false;
    const handler = this.handlers.get(id);
    if (!handler) return false;
    this.active.push({ id, plan, handler });
    handler.onLever?.(plan);
    return true;
  }

  stop(stopNo: number, reelIndex: number): void {
    for (const a of this.active) a.handler.onStop?.(a.plan, stopNo, reelIndex);
  }

  allStop(): void {
    for (const a of this.active) a.handler.onAllStop?.(a.plan);
  }

  resultClear(): void {
    for (const a of this.active) a.handler.onResultClear?.(a.plan);
  }

  isActive(id: ProcedureId): boolean {
    return this.active.some((a) => a.id === id);
  }

  activeIds(): ProcedureId[] {
    return this.active.map((a) => a.id);
  }
}
