import type {
  InternalRoleState,
  Quiz,
  ShisaTier,
  Yaku,
  YakuList,
} from '../data/schemas';
import type { EffectType } from './EffectScheduler';

/**
 * 「その演出でその内部役を表現できるか」の判定と、演出が示す候補役の逆算。
 *
 * このゲームの演出は**必ず本当に当たっている内部役を指す**。示唆の色も、
 * 吹き出しに並ぶ候補役も、クイズの答えも、すべて当選役から逆算して出すので、
 * 「演出は派手なのに最初から当たっていない」というガセが構造的に起きない。
 * その代わり、演出で表現できない役を引いた時は演出そのものを出さない。
 *
 * ここを間違えると、示唆の色が当たり得ない役を指す／吹き出しに絶対に来ない役が
 * 並ぶ、といった「嘘をつく演出」になる。プレイヤーは色と候補を頼りに狙う図柄を
 * 決めるので、静かに信頼を壊す壊れ方をする。
 */

/** 演出のうち、内部役を表現する必要があるもの（none を除く）。 */
export type RepresentableEffect = Exclude<EffectType, 'none'>;

export interface EffectEligibilityDeps {
  yakuList: YakuList;
  quizzes: readonly Quiz[];
  shisaTiers: readonly ShisaTier[];
  /** 「狙え」で指せる役の文字数（＝リール数）。 */
  reelCount: number;
}

export class EffectEligibility {
  private readonly allYakus: Yaku[];

  constructor(private readonly deps: EffectEligibilityDeps) {
    const y = deps.yakuList;
    this.allYakus = [
      ...y.coreYaku,
      ...y.premiumYaku,
      ...y.bonusYaku,
      ...y.cherryYaku,
      ...y.singleYaku,
    ];
  }

  /** この役を示唆で表せる色（tier）一覧。カテゴリが tier の targets に入っているもの。 */
  tiersFor(yaku: Yaku): ShisaTier[] {
    return this.deps.shisaTiers.filter((tier) =>
      tier.targets.includes(yaku.category),
    );
  }

  /**
   * この演出でこの役を表現できるか。
   *  - shisa: その役を指せる色があること
   *  - quiz : 答えがその役になる問題があること
   *  - aim  : 3文字揃いであること（1枚役や2文字役は「狙え」で指せない）
   */
  canRepresent(effect: RepresentableEffect, yaku: Yaku): boolean {
    if (effect === 'shisa') return this.tiersFor(yaku).length > 0;
    if (effect === 'quiz') {
      return this.deps.quizzes.some((quiz) => quiz.answerYakuId === yaku.id);
    }
    return yaku.symbols.length === this.deps.reelCount;
  }

  /** この役を表現できる演出の一覧（どれも出せなければ空＝演出なし）。 */
  eligibleEffects(yaku: Yaku): RepresentableEffect[] {
    return (['shisa', 'quiz', 'aim'] as const).filter((effect) =>
      this.canRepresent(effect, yaku),
    );
  }

  /**
   * この色が出た時に「当たりうる役」の一覧（吹き出しの候補表示）。
   * 内部役テーブルから逆算する：今の状態でレートが立っていて、かつその色を
   * 引ける役だけ。＝ 並ぶ候補は必ず本当に当たりうるもので、嘘をつかない。
   */
  candidatesFor(tier: ShisaTier, state: InternalRoleState): Yaku[] {
    const seen = new Set<string>();
    const out: Yaku[] = [];
    for (const role of this.deps.yakuList.internalRoles) {
      if (!role.displayYakuId || role.rate[state] <= 0) continue;
      if (seen.has(role.displayYakuId)) continue;
      const yaku = this.allYakus.find((y) => y.id === role.displayYakuId);
      if (!yaku) continue;
      if (!this.tiersFor(yaku).some((t) => t.color === tier.color)) continue;
      seen.add(yaku.id);
      out.push(yaku);
    }
    return out;
  }

  /**
   * この役を指せる色から1つ選ぶ（weight による重み付き抽選）。
   * 指せる色が無ければ null＝示唆は出さない。
   */
  pickTier(yaku: Yaku, rand: () => number): ShisaTier | null {
    const tiers = this.tiersFor(yaku);
    if (tiers.length === 0) return null;
    const total = tiers.reduce((a, t) => a + t.weight, 0);
    let r = rand() * total;
    for (const tier of tiers) {
      r -= tier.weight;
      if (r <= 0) return tier;
    }
    return tiers[tiers.length - 1];
  }
}
