import type { StopTable } from '../data/schemas';

/** リール1本のコマ数（表の添字の基数）。 */
const N = 21;
/** 詰めた文字列の1文字（'0'〜'4'）をスベリに戻す。 */
const CODE_0 = 48;

/**
 * 停止テーブルの参照。スベリコマ数を「内部役 × 押し順 × 停止位置 × 押下位置」で引く。
 *
 * 実機のリール制御表に相当する。表に無い内部役／範囲外の入力では null を返し、
 * 呼び出し側は既定の制御（引き込み保証 → 当選役の引き込み → 非当選役の蹴り）へフォールバックする。
 * 第2・第3停止は全押し順ぶん持つ（形式は `StopTableSchema` の説明）。
 * 設計詳細: zikken/playground/mojislot-plan/17_assist-and-slip.md
 */
export class StopTableLookup {
  constructor(private readonly table: StopTable | null) {}

  /** 第1停止のスベリコマ数。表に無ければ null（＝既定制御に任せる）。 */
  firstStopSlip(flagKey: string, reel: number, press: number): number | null {
    const rows = this.table?.firstStop[flagKey];
    if (!rows) return null;
    const row = rows[reel];
    if (!row) return null;
    const slip = row[press];
    return typeof slip === 'number' ? slip : null;
  }

  /**
   * 第2停止のスベリコマ数。表に無ければ null。
   * @param firstReel 先に止めたリール
   * @param firstPos  そのリールの**停止位置**（押下位置ではない）
   * @param reel      いま止めるリール
   * @param press     そのリールの押下位置
   * @param bonus     ボーナス中（許可リストに1枚役が加わる局面）か
   */
  secondStopSlip(
    flagKey: string,
    firstReel: number,
    firstPos: number,
    reel: number,
    press: number,
    bonus = false,
  ): number | null {
    const table = bonus ? this.table?.bonusSecondStop : this.table?.secondStop;
    const byRole = (table as Record<string, Record<string, number>> | undefined)?.[
      `${firstReel}${reel}`
    ];
    return slipAt(this.packed(byRole?.[flagKey]), [firstPos, press]);
  }

  /**
   * 第3停止のスベリコマ数。表に無ければ null。
   * @param reel      最後に止めるリール
   * @param positions 3リールの停止位置（`reel` 以外の2本が要る。`reel` の欄は見ない）
   * @param press     最後のリールの押下位置
   */
  thirdStopSlip(
    flagKey: string,
    reel: number,
    positions: readonly (number | null)[],
    press: number,
    bonus = false,
  ): number | null {
    const table = bonus ? this.table?.bonusThirdStop : this.table?.thirdStop;
    const byRole = (table as Record<string, Record<string, number>> | undefined)?.[`${reel}`];
    const [a, b] = [0, 1, 2].filter((i) => i !== reel).map((i) => positions[i]);
    if (typeof a !== 'number' || typeof b !== 'number') return null;
    return slipAt(this.packed(byRole?.[flagKey]), [a, b, press]);
  }

  /** プールの番号を詰めた文字列に戻す。 */
  private packed(index: number | undefined): string | undefined {
    return index === undefined ? undefined : this.table?.slipPool[index];
  }

  /** 表に載っている内部役ID一覧（検証・デバッグ用）。 */
  get flagKeys(): string[] {
    return this.table ? Object.keys(this.table.firstStop) : [];
  }
}

/** 詰めた文字列から添字（21進の各桁）の位置のスベリを取り出す。 */
function slipAt(packed: string | undefined, digits: readonly number[]): number | null {
  if (packed === undefined) return null;
  let i = 0;
  for (const d of digits) {
    if (!Number.isInteger(d) || d < 0 || d >= N) return null;
    i = i * N + d;
  }
  const c = packed.charCodeAt(i) - CODE_0;
  return c >= 0 && c <= 4 ? c : null;
}
