import type { StopTable } from '../data/schemas';

/**
 * 停止テーブルの参照。第1停止のスベリコマ数を「内部役 × リール × 押下位置」で引く。
 *
 * 実機のリール制御表に相当する。表に無い内部役／範囲外の入力では null を返し、
 * 呼び出し側は既定の制御（当選役の引き込み → 非当選役の蹴り）へフォールバックする。
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
   * 第2停止のスベリコマ数（**順押しのみ**）。表に無ければ null。
   * @param firstPos 第1停止したリールの**停止位置**（押下位置ではない）
   * @param press    第2リールの押下位置
   */
  secondStopSlip(
    flagKey: string,
    firstPos: number,
    press: number,
  ): number | null {
    const rows = this.table?.secondStop?.[flagKey];
    if (!rows) return null;
    const row = rows[firstPos];
    if (!row) return null;
    const slip = row[press];
    return typeof slip === 'number' ? slip : null;
  }

  /**
   * 第3停止のスベリコマ数（**順押しのみ**）。表に無ければ null。
   * @param firstPos  第1停止したリールの停止位置
   * @param secondPos 第2停止したリールの停止位置
   * @param press     第3リールの押下位置
   */
  thirdStopSlip(
    flagKey: string,
    firstPos: number,
    secondPos: number,
    press: number,
  ): number | null {
    const row = this.table?.thirdStop?.[flagKey]?.[firstPos]?.[secondPos];
    if (!row) return null;
    const slip = row[press];
    return typeof slip === 'number' ? slip : null;
  }

  /** 表に載っている内部役ID一覧（検証・デバッグ用）。 */
  get flagKeys(): string[] {
    return this.table ? Object.keys(this.table.firstStop) : [];
  }
}
