import { z } from 'zod';

export const ReelStripSchema = z.object({
  id: z.string(),
  // 1リール = 21コマ（実機準拠）。本実装の回転は 20コマ/秒＝1周≒1.05秒
  // （実機は1周0.75〜0.78秒。目押し優先でやや遅め）。速度は EffectScheduler 参照。
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
