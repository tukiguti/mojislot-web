import { z } from 'zod';

export const ReelStripSchema = z.object({
  id: z.string(),
  // 1リール = 21コマ（実機準拠）。本実装の回転は 30コマ/秒＝1周≒0.7秒（実機並み）
  // （実機は1周0.75〜0.78秒）。速度は EffectScheduler 参照。
  cells: z.array(z.string()).length(21),
});

export const ReelConfigSchema = z.object({
  mode: z.string(),
  reels: z.array(ReelStripSchema).length(3),
});

export type ReelStrip = z.infer<typeof ReelStripSchema>;
export type ReelConfig = z.infer<typeof ReelConfigSchema>;

// core=小役 / premium=BIG(7・バー揃い) / bonus=RB / cherry=チェリー(2文字役)
export const YakuCategorySchema = z.enum(['core', 'premium', 'bonus', 'cherry']);

export const YakuSchema = z.object({
  id: z.string(),
  name: z.string(),
  // 通常は3文字。チェリー(2文字役=左+中)のみ2文字を許容
  symbols: z.array(z.string()).min(2).max(3),
  category: YakuCategorySchema,
  // 図柄画像(webp)を持たない役。true なら画像読込をスキップし色タイル＋文字で描く
  noArt: z.boolean().optional(),
});

export const YakuListSchema = z.object({
  mode: z.string(),
  coreYaku: z.array(YakuSchema),
  premiumYaku: z.array(YakuSchema),
  bonusYaku: z.array(YakuSchema).default([]),
  // チェリー（2文字役・左+中の2リールで成立）。ジャグラー型のみ使用
  cherryYaku: z.array(YakuSchema).default([]),
});

export type YakuCategory = z.infer<typeof YakuCategorySchema>;
export type Yaku = z.infer<typeof YakuSchema>;
export type YakuList = z.infer<typeof YakuListSchema>;

export const PayoutSchema = z.object({
  betPerSpin: z.number().int().positive(),
  baseMultiplier: z.object({
    core: z.number(),
    premium: z.number(),
    bonus: z.number(),
    cherry: z.number().default(2),
  }),
  bonusZoneMultiplier: z.number(),
  initialCoins: z.number().int().nonnegative(),
  // 連チャン（コンボ）数→配当倍率。しきい値で評価（順不同・最大一致を採用）。
  // 省略時は旧来の 3連1.2 / 5連1.5 / 10連2.0。
  streakTiers: z
    .array(
      z.object({
        minStreak: z.number().int().positive(),
        mult: z.number().positive(),
      }),
    )
    .default([
      { minStreak: 3, mult: 1.2 },
      { minStreak: 5, mult: 1.5 },
      { minStreak: 10, mult: 2.0 },
    ]),
  // 「狙え！」予告役が実際に成立した時の達成ボーナス倍率（その役ライン分の配当に上乗せ）。
  aimBonusMultiplier: z.number().positive().default(1.5),
  // ボーナス倍率×コンボ倍率の積算上限。出玉が伸びすぎないよう combined をここで頭打ちにする。
  // 省略時は 3.0（core: bet3 × base3.4 × 3.0 ≒ 30枚 が上限）。
  maxComboMultiplier: z.number().positive().default(3),
});

export type Payout = z.infer<typeof PayoutSchema>;

/**
 * クイズの答え＝役（食べ物）の名前。正解するとその役が引き込み対象になる。
 *  - answerYakuId: 正解の役（YakuListのidを参照）
 *  - decoyYakuIds: 不正解選択肢の役のid（3つ）。表示時にシャッフルする
 */
export const QuizSchema = z.object({
  id: z.string(),
  question: z.string(),
  answerYakuId: z.string(),
  decoyYakuIds: z.array(z.string()).length(3),
});

export const QuizListSchema = z.object({
  mode: z.string(),
  quizzes: z.array(QuizSchema).min(1),
});

export type Quiz = z.infer<typeof QuizSchema>;
export type QuizList = z.infer<typeof QuizListSchema>;

/**
 * チューニング（演出レート・補助・フリーズ・しきい値などの調整値）。
 * 従来コードに散在していた定数を1ファイルに集約し、出現確率や演出頻度を弄りやすくする。
 * 各値は省略時に既定へフォールバックする（部分指定OK）。
 */
const EffectRatesSchema = z.object({
  none: z.number().min(0),
  shisa: z.number().min(0),
  quiz: z.number().min(0),
  aim: z.number().min(0),
});

export const TuningSchema = z.object({
  /** ベット毎の演出抽選レート（通常／ハマり救済／ボーナス中）。各合計≈1.0 を想定。 */
  effectRates: z.object({
    default: EffectRatesSchema,
    rescue: EffectRatesSchema,
    bonus: EffectRatesSchema,
  }),
  /** 連続ハズレがこの回数以上で救済レートへ切替。 */
  rescueMissThreshold: z.number().int().positive().default(30),
  /** ボーナス区間の継続スピン数。 */
  bonus: z
    .object({
      spinsPerBig: z.number().int().positive().default(10),
      spinsPerReg: z.number().int().positive().default(5),
    })
    .default({ spinsPerBig: 10, spinsPerReg: 5 }),
  /** 引き込み/蹴り（目押し補助）の強さ。コマ数が大きいほど揃いやすい。 */
  assist: z
    .object({
      /** 最終リールの引き込み最大コマ数（実機準拠＝4）。 */
      assistMaxCells: z.number().int().nonnegative().default(4),
      /** 第1・第2停止の中段引き込み最大コマ数（控えめ＝2）。 */
      aimHintMaxCells: z.number().int().nonnegative().default(2),
      /** 偶然のboner/premium揃いを蹴る最大コマ数。 */
      kickMaxCells: z.number().int().nonnegative().default(2),
      /** 蹴りの発動確率（0..1）。 */
      kickProbability: z.number().min(0).max(1).default(0.5),
    })
    .default({ assistMaxCells: 4, aimHintMaxCells: 2, kickMaxCells: 2, kickProbability: 0.5 }),
  /** フリーズ演出。 */
  freeze: z
    .object({
      /** レバーオン時のフリーズ抽選確率（通常時のみ）。 */
      rate: z.number().min(0).max(1).default(0.005),
      /** フリーズ中の倍速回転スピード（コマ/秒）。 */
      spinSpeed: z.number().positive().default(60),
    })
    .default({ rate: 0.005, spinSpeed: 60 }),
  /** 確定告知ランプ（点灯=ボーナス確定・種別は内部確定で伏せる）。 */
  announceLamp: z
    .object({
      /** レバーオン時の点灯抽選確率（通常時のみ）。 */
      rate: z.number().min(0).max(1).default(0.0033),
      /** 確定種別がBIGになる割合（残りはREG）。 */
      bigRatio: z.number().min(0).max(1).default(0.3),
      /** 点灯中、確定役の図柄へ引き込む最大コマ数（強め＝揃えに行きやすい）。 */
      assistMaxCells: z.number().int().nonnegative().default(8),
    })
    .default({ rate: 0.0033, bigRatio: 0.3, assistMaxCells: 8 }),
  /** ビタ押し成功窓（±ms）。 */
  bitaWindowMs: z.number().positive().default(12),
  /** 突入直前の「溜め」演出の長さ（ms）。 */
  entryChargeMs: z.number().nonnegative().default(650),
});

export type Tuning = z.infer<typeof TuningSchema>;
