import type { Yaku, YakuList } from '../data/schemas';

export interface JudgeResult {
  yaku: Yaku | null;
  symbols: [string, string, string];
}

export class YakuJudge {
  private readonly index = new Map<string, Yaku>();

  constructor(list: YakuList) {
    const all = [...list.premiumYaku, ...list.coreYaku, ...list.bonusYaku];
    for (const y of all) {
      this.index.set(y.symbols.join(''), y);
    }
  }

  judge(symbols: [string, string, string]): JudgeResult {
    const key = symbols.join('');
    return {
      yaku: this.index.get(key) ?? null,
      symbols,
    };
  }
}
