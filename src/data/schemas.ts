import { z } from 'zod';

export const ReelStripSchema = z.object({
  id: z.string(),
  cells: z.array(z.string()).length(10),
});

export const ReelConfigSchema = z.object({
  mode: z.string(),
  reels: z.array(ReelStripSchema).length(3),
});

export type ReelStrip = z.infer<typeof ReelStripSchema>;
export type ReelConfig = z.infer<typeof ReelConfigSchema>;

export const YakuCategorySchema = z.enum(['core', 'premium', 'bonus']);

export const YakuSchema = z.object({
  id: z.string(),
  name: z.string(),
  symbols: z.array(z.string()).length(3),
  category: YakuCategorySchema,
});

export const YakuListSchema = z.object({
  mode: z.string(),
  coreYaku: z.array(YakuSchema),
  premiumYaku: z.array(YakuSchema),
  bonusYaku: z.array(YakuSchema).default([]),
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
  }),
  bonusZoneMultiplier: z.number(),
  initialCoins: z.number().int().nonnegative(),
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
