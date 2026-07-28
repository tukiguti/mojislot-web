// none/shisa/quiz/aim はレート抽選（rollAvailable）で選ぶ。push（押し順ナビ）は押し順役に
// 対して強制付与され、レート抽選の対象には入らない。
export type EffectType = 'none' | 'shisa' | 'quiz' | 'aim';

export interface EffectRates {
  none: number;
  shisa: number;
  quiz: number;
  /** レバーオン時に「狙え！◯◯◯」と特定役を予告する示唆演出 */
  aim: number;
}

/**
 * EffectScheduler の既定レート（コンストラクタ未指定時のフォールバック）。
 * 実運用のレート（通常/救済/ボーナス中）と救済しきい値は data/tuning/default.json が正で、
 * main.ts が状況に応じて setRates で切り替える。
 */
export const DEFAULT_RATES: EffectRates = {
  none: 0.6,
  shisa: 0.2,
  quiz: 0.1,
  aim: 0.1,
};

export class EffectScheduler {
  constructor(private rates: EffectRates = DEFAULT_RATES) {}

  /** ボーナスゾーン中などで一時的に rates を切替えるために使う */
  setRates(rates: EffectRates): void {
    this.rates = rates;
  }

  /**
   * 内部役を表現できる演出候補に **none（無演出）を足して**、現在レートを重みに抽選する。
   * 内部役missは呼び出し側でnone固定にするため、通常はshisa/quiz/aimを渡す。
   * push（押し順ナビ）はレート抽選の対象外なので、レートを持つ演出だけを受け取る。
   *
   * none を候補に入れるのは「当たっていれば必ず演出が出る＝必ず狙える」を避けるため。
   * ボーナス中は rates.bonus.none = 0 なので重み0で落ち、自動的に無演出は出ない。
   * 以前は候補が表現できる演出だけで、rates.none がどこからも読まれない死んだ値だった。
   *
   * 正規化は渡された候補の中だけで行う。3文字役は shisa/quiz/aim が揃うので none は
   * レートどおりだが、aim を使えないチェリー（2文字役）だけ none がわずかに厚くなる。
   */
  rollAvailable(available: readonly (keyof EffectRates)[]): EffectType {
    const unique = [...new Set<keyof EffectRates>(['none', ...available])];
    const weighted = unique
      .map((effect) => ({ effect, weight: this.rates[effect] }))
      .filter((entry) => entry.weight > 0);
    const total = weighted.reduce((sum, entry) => sum + entry.weight, 0);
    if (total <= 0) return 'none';
    let cursor = Math.random() * total;
    for (const entry of weighted) {
      cursor -= entry.weight;
      if (cursor < 0) return entry.effect;
    }
    return weighted[weighted.length - 1].effect;
  }
}

/**
 * リール速度のフォールバック（コマ/秒）。実運用の既定値は data/tuning が正。
 * 24コマ/秒では1コマ約42ms、21コマを約0.88秒で1周する。
 */
export const REEL_BASE_SPEED = 24;
