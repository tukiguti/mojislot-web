import type {
  InternalRole,
  InternalRoleKind,
  InternalRoleState,
  Yaku,
  YakuList,
} from '../data/schemas';

/** レバーONで確定した内部役（1ゲーム不変）。 */
export interface InternalRoleResult {
  /** 内部役テーブル上のID（押し順違いを区別する）。 */
  roleId: string;
  kind: InternalRoleKind;
  /** 揃えさせたい表示役ID。miss / single は null。 */
  yakuId: string | null;
  yakuName: string | null;
  /** 当選と同時にフリーズ演出を発動する強レア役か。 */
  freeze: boolean;
}

export interface InternalRoleDrawOptions {
  /** falseなら miss を候補から外す（デバッグ強制演出用）。 */
  allowMiss?: boolean;
  /** 演出で表現可能な内部役だけに絞る（yaku は displayYakuId の実体・無い場合 null）。 */
  roleFilter?: (role: InternalRole, yaku: Yaku | null) => boolean;
}

type RandomSource = () => number;

/**
 * レバーON時の内部役抽選。
 * 表示役ではなく**内部役テーブル**（1枚役を含む）から直接抽選する。
 * 押し順は役の種類ではなく停止制御の入力なので、ここには現れない。
 */
export class InternalRoleLottery {
  private readonly roles: readonly InternalRole[];
  private readonly yakuById: Map<string, Yaku>;

  constructor(
    yakuList: YakuList,
    private readonly random: RandomSource = Math.random,
  ) {
    this.roles = yakuList.internalRoles;
    this.yakuById = new Map(
      [
        ...yakuList.coreYaku,
        ...yakuList.cherryYaku,
        ...yakuList.bonusYaku,
        ...yakuList.premiumYaku,
      ].map((y) => [y.id, y]),
    );
  }

  draw(
    state: InternalRoleState,
    options: InternalRoleDrawOptions = {},
  ): InternalRoleResult {
    const allowMiss = options.allowMiss !== false;
    const candidates = this.roles.filter((role) => {
      if (role.rate[state] <= 0) return false;
      if (!allowMiss && role.kind === 'miss') return false;
      const yaku = role.displayYakuId
        ? (this.yakuById.get(role.displayYakuId) ?? null)
        : null;
      return options.roleFilter?.(role, yaku) ?? true;
    });
    if (candidates.length === 0) return this.miss();
    const chosen = this.weightedPick(candidates, (r) => r.rate[state]);
    return this.toResult(chosen);
  }

  /**
   * 特定の表示役を強制する（確定告知ランプ・持ち越し用）。
   * フリーズ役は**選ばない**。告知や持ち越しの消化でフリーズが暴発しないようにする。
   */
  forYaku(yaku: Yaku): InternalRoleResult {
    const role = this.roles.find(
      (r) => r.displayYakuId === yaku.id && !r.freeze,
    );
    if (!role) {
      // テーブルに無い表示役を強制した場合は押し順不問の擬似内部役として扱う。
      return {
        roleId: `forced:${yaku.id}`,
        kind: 'core',
        yakuId: yaku.id,
        yakuName: yaku.name,
        freeze: false,
      };
    }
    return this.toResult(role);
  }

  /** 内部役IDを直接指定して引く（デバッグのフリーズ強制用）。無ければ null。 */
  forRoleId(roleId: string): InternalRoleResult | null {
    const role = this.roles.find((r) => r.id === roleId);
    return role ? this.toResult(role) : null;
  }

  /** フリーズを発動する内部役（章に1つ想定）。 */
  freezeRole(): InternalRoleResult | null {
    const role = this.roles.find((r) => r.freeze);
    return role ? this.toResult(role) : null;
  }

  yakuFor(role: InternalRoleResult): Yaku | null {
    if (!role.yakuId) return null;
    return this.yakuById.get(role.yakuId) ?? null;
  }

  private toResult(role: InternalRole): InternalRoleResult {
    const yaku = role.displayYakuId
      ? (this.yakuById.get(role.displayYakuId) ?? null)
      : null;
    return {
      roleId: role.id,
      kind: role.kind,
      yakuId: role.displayYakuId,
      yakuName: yaku?.name ?? null,
      freeze: role.freeze,
    };
  }

  private miss(): InternalRoleResult {
    return {
      roleId: 'miss',
      kind: 'miss',
      yakuId: null,
      yakuName: null,
      freeze: false,
    };
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
