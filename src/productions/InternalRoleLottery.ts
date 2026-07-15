import type {
  InternalRoleKind,
  InternalRoleRates,
  Yaku,
  YakuInternalRoleKind,
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
type YakuWeight = (yaku: Yaku) => number;

const NON_MISS_KINDS: readonly YakuInternalRoleKind[] = [
  'replay',
  'core',
  'cherry',
  'reg',
  'big',
];

export function internalRoleKindForYaku(yaku: Yaku): YakuInternalRoleKind {
  if (yaku.internalRoleKind) return yaku.internalRoleKind;
  if (yaku.category === 'premium') return 'big';
  if (yaku.category === 'bonus') return 'reg';
  if (yaku.category === 'cherry') return 'cherry';
  return 'core';
}

/**
 * レバーON時の内部役抽選。
 * 種別をレートで選び、同じ種別の具体役はリール枚数等の重みで選ぶ。
 */
export class InternalRoleLottery {
  private readonly allYakus: readonly Yaku[];

  constructor(
    yakuList: YakuList,
    private readonly random: RandomSource = Math.random,
    private readonly yakuWeight: YakuWeight = () => 1,
  ) {
    this.allYakus = [
      ...yakuList.coreYaku,
      ...yakuList.cherryYaku,
      ...yakuList.bonusYaku,
      ...yakuList.premiumYaku,
    ];
  }

  draw(
    rates: InternalRoleRates,
    options: InternalRoleDrawOptions = {},
  ): InternalRoleResult {
    const allowMiss = options.allowMiss !== false;
    const candidates: Array<{
      kind: InternalRoleKind;
      weight: number;
      yakus: readonly Yaku[];
    }> = [];

    if (allowMiss && rates.miss > 0) {
      candidates.push({ kind: 'miss', weight: rates.miss, yakus: [] });
    }

    for (const kind of NON_MISS_KINDS) {
      const yakus = this.allYakus.filter(
        (yaku) =>
          internalRoleKindForYaku(yaku) === kind &&
          (options.yakuFilter?.(yaku) ?? true),
      );
      const weight = rates[kind];
      if (weight > 0 && yakus.length > 0) {
        candidates.push({ kind, weight, yakus });
      }
    }

    if (candidates.length === 0) return this.miss();
    const chosenKind = this.weightedPick(candidates, (candidate) => candidate.weight);
    if (chosenKind.kind === 'miss') return this.miss();

    const yaku = this.weightedPick(chosenKind.yakus, (candidate) =>
      Math.max(0, this.yakuWeight(candidate)),
    );
    return this.forYaku(yaku);
  }

  forYaku(yaku: Yaku): InternalRoleResult {
    return {
      kind: internalRoleKindForYaku(yaku),
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
