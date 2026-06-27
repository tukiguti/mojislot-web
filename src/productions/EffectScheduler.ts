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

  roll(): EffectType {
    const r = Math.random();
    if (r < this.rates.none) return 'none';
    if (r < this.rates.none + this.rates.shisa) return 'shisa';
    if (r < this.rates.none + this.rates.shisa + this.rates.quiz) return 'quiz';
    return 'aim';
  }
}

/**
 * リール速度（コマ/秒）。全演出共通＝20コマ/秒に固定（演出による速度変動は使わない）。
 * 1コマ = 1000/20 = 50ms。1周 = 21/20 = 1.05 秒（＝約57回転/分）。
 * 実機（ジャグラー等）は0.75秒/周＝80回転/分だが、本実装はあえて遅め。
 *   理由: Web版はモーションブラー（残像）が無く、実機速度だと図柄が追えず逆にカクついて見える。
 *   目押ししやすさ優先で遅くし、ブラー欠如を「遅さ」で補償している（体感はこちらが実機寄り）。
 *   → 将来モーションブラーを実装すれば実機速度（28コマ/秒＝0.75秒/周）へ上げられる【未実装メモ】。
 *   （経緯: 一度28→30で速くしたが「ブラー無しでカクつき逆に実機から遠い」と判明し20へ戻した。）
 * ビタ成功窓は別途 tuning.bitaWindowMs（既定±12ms）。50ms/コマでは中心±¼コマ相当。
 * 引き込み上限4コマ（押下0.19秒以内停止）は速度と独立に実機準拠。
 */
export const REEL_BASE_SPEED = 20;
