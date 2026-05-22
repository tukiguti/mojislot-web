import type { Yaku, YakuList } from '../data/schemas';
import {
  PAYLINES,
  extractLineSymbols,
  type Grid3x3,
  type PaylineId,
} from './Paylines';

export interface JudgeResult {
  yaku: Yaku | null;
  symbols: [string, string, string];
}

/** ペイラインヒット 1 件 */
export interface PaylineHit {
  paylineId: PaylineId;
  paylineName: string;
  yaku: Yaku;
  symbols: [string, string, string];
}

/** 複数ペイライン同時判定の結果 */
export interface MultiJudgeResult {
  hits: PaylineHit[];
  grid: Grid3x3;
}

export class YakuJudge {
  private readonly index = new Map<string, Yaku>();

  constructor(list: YakuList) {
    const all = [...list.premiumYaku, ...list.coreYaku, ...list.bonusYaku];
    for (const y of all) {
      this.index.set(y.symbols.join(''), y);
    }
  }

  /** 1 ラインだけの判定（中段固定。互換用） */
  judge(symbols: [string, string, string]): JudgeResult {
    const key = symbols.join('');
    return {
      yaku: this.index.get(key) ?? null,
      symbols,
    };
  }

  /**
   * 全 5 ペイライン（横3+斜め2）を判定。
   * 同じ役が複数ラインで揃った場合はそれぞれカウントされる（ライン毎の払い出し）。
   */
  judgeAll(grid: Grid3x3): MultiJudgeResult {
    const hits: PaylineHit[] = [];
    for (const line of PAYLINES) {
      const symbols = extractLineSymbols(grid, line);
      const yaku = this.index.get(symbols.join(''));
      if (yaku) {
        hits.push({
          paylineId: line.id,
          paylineName: line.name,
          yaku,
          symbols,
        });
      }
    }
    return { hits, grid };
  }
}
