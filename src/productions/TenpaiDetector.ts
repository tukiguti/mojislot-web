import type { Yaku, YakuList } from '../data/schemas';

/**
 * テンパイ（リーチ）検出。
 * 第2停止後（2リール停止 / 残り1リール）で「未停止リールの該当文字が揃えば役成立」になる
 * 状態を検出して、プレイヤーに猶予と演出を与えるための判定器。
 */

export interface TenpaiResult {
  /** 揃えれば成立する役の一覧（複数あり得る） */
  reachable: Yaku[];
  /** 未停止リールのインデックス */
  missingReelIndex: number;
  /** 揃えるべき記号（reachable のうちプレミアムを優先、複数あれば配列） */
  targetSymbols: string[];
  /** プレミアム役を含む場合 true（演出の派手さを変えるため） */
  hasPremium: boolean;
}

export class TenpaiDetector {
  private readonly allYakus: Yaku[];

  constructor(yakuList: YakuList) {
    this.allYakus = [
      ...yakuList.coreYaku,
      ...yakuList.premiumYaku,
      ...yakuList.bonusYaku,
    ];
  }

  detect(stoppedSymbols: readonly (string | null)[]): TenpaiResult | null {
    const stoppedCount = stoppedSymbols.filter((s) => s !== null).length;
    if (stoppedCount !== 2) return null;

    const missingReelIndex = stoppedSymbols.findIndex((s) => s === null);
    if (missingReelIndex === -1) return null;

    const reachable = this.allYakus.filter((y) =>
      stoppedSymbols.every((s, r) => s === null || y.symbols[r] === s),
    );
    if (reachable.length === 0) return null;

    const targetSymbols = Array.from(
      new Set(reachable.map((y) => y.symbols[missingReelIndex])),
    );
    const hasPremium = reachable.some((y) => y.category === 'premium');

    return { reachable, missingReelIndex, targetSymbols, hasPremium };
  }
}
