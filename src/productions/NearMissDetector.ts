import type { ReelStrip, Yaku, YakuList } from '../data/schemas';

/**
 * ニアミス（おしい！）検出。
 * ハズレ結果について、いずれか1リールが ±1 コマずれただけで成立していた役を返す。
 * プレイヤーに「あと少しで揃った」フィードバックを与えるために使う。
 */

export interface NearMissResult {
  yaku: Yaku;
  reelIndex: number; // ズレていたリール
  offset: -1 | 1; // -1=上に1コマ、+1=下に1コマだったら揃っていた
}

export class NearMissDetector {
  private readonly allYakus: Yaku[];

  constructor(yakuList: YakuList) {
    this.allYakus = [
      ...yakuList.coreYaku,
      ...yakuList.premiumYaku,
      ...yakuList.bonusYaku,
    ];
  }

  /**
   * @param finalSymbols 確定した3リール記号
   * @param strips        各リールの strip
   * @param positions     各リールの確定 position（整数）
   */
  detect(
    finalSymbols: readonly [string, string, string],
    strips: readonly ReelStrip[],
    positions: readonly number[],
  ): NearMissResult[] {
    const results: NearMissResult[] = [];
    for (const y of this.allYakus) {
      // 各リールについて、「そのリールだけが該当文字になっていない & 他は一致」を探す
      for (let r = 0; r < 3; r++) {
        const otherMatches = y.symbols.every(
          (sym, i) => i === r || sym === finalSymbols[i],
        );
        if (!otherMatches) continue;
        // r 番目のリールが該当文字ならそもそも役成立してるはず（重複候補）
        if (y.symbols[r] === finalSymbols[r]) continue;

        const strip = strips[r];
        const total = strip.cells.length;
        const pos = positions[r];
        const upIdx = ((pos - 1) % total + total) % total;
        const downIdx = (pos + 1) % total;
        if (strip.cells[upIdx] === y.symbols[r]) {
          results.push({ yaku: y, reelIndex: r, offset: -1 });
        }
        if (strip.cells[downIdx] === y.symbols[r]) {
          results.push({ yaku: y, reelIndex: r, offset: 1 });
        }
      }
    }
    // 重複役を除去（同じ役で上下両方ニアの場合は1件にまとめる）
    const seen = new Set<string>();
    return results.filter((r) => {
      const key = `${r.yaku.id}-${r.reelIndex}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
}
