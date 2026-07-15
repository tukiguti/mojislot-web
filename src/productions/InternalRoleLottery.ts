import type {
  InternalRoleKind,
  InternalRoleState,
  Yaku,
  YakuList,
} from '../data/schemas';

export interface InternalRoleResult {
  kind: InternalRoleKind;
  yakuId: string | null;
  yakuName: string | null;
}

export interface InternalRoleDrawOptions {
  /** falseならmissを候補から外す（デバッグ強制演出用）。 */
  allowMiss?: boolean;
  /** 演出で表現可能な役だけに絞る。 */
  yakuFilter?: (yaku: Yaku) => boolean;
}

type RandomSource = () => number;

/**
 * レバーON時の内部役抽選。
 * 役種別を中間抽選せず、章JSONに設定した具体役ごとの確率で直接選ぶ。
 */
export class InternalRoleLottery {
  private readonly allYakus: readonly Yaku[];
  private readonly missRates: YakuList['internalRoleMissRate'];

  constructor(
    yakuList: YakuList,
    private readonly random: RandomSource = Math.random,
  ) {
    this.missRates = yakuList.internalRoleMissRate;
    this.allYakus = [
      ...yakuList.coreYaku,
      ...yakuList.cherryYaku,
      ...yakuList.bonusYaku,
      ...yakuList.premiumYaku,
    ];
  }

  draw(
    state: InternalRoleState,
    options: InternalRoleDrawOptions = {},
  ): InternalRoleResult {
    const allowMiss = options.allowMiss !== false;
    const candidates: Array<{
      yaku: Yaku | null;
      weight: number;
    }> = [];

    if (allowMiss && this.missRates[state] > 0) {
      candidates.push({ yaku: null, weight: this.missRates[state] });
    }

    for (const yaku of this.allYakus) {
      const weight = yaku.internalRoleRate[state];
      if (weight > 0 && (options.yakuFilter?.(yaku) ?? true)) {
        candidates.push({ yaku, weight });
      }
    }

    if (candidates.length === 0) return this.miss();
    const chosen = this.weightedPick(candidates, (candidate) => candidate.weight);
    return chosen.yaku ? this.forYaku(chosen.yaku) : this.miss();
  }

  forYaku(yaku: Yaku): InternalRoleResult {
    return {
      kind: yaku.internalRoleKind,
      yakuId: yaku.id,
      yakuName: yaku.name,
    };
  }

  yakuFor(role: InternalRoleResult): Yaku | null {
    if (!role.yakuId) return null;
    return this.allYakus.find((yaku) => yaku.id === role.yakuId) ?? null;
  }

  private miss(): InternalRoleResult {
    return { kind: 'miss', yakuId: null, yakuName: null };
  }

  private weightedPick<T>(items: readonly T[], weightOf: (item: T) => number): T {
    const weights = items.map((item) => Math.max(0, weightOf(item)));
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    if (total <= 0) return items[0];
    let cursor = this.random() * total;
    for (let index = 0; index < items.length; index++) {
      cursor -= weights[index];
      if (cursor < 0) return items[index];
    }
    return items[items.length - 1];
  }
}
