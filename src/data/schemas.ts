import { z } from 'zod';

export const ReelStripSchema = z.object({
  id: z.string(),
  // 1リール = 21コマ（実機準拠）。本実装の回転は 20コマ/秒＝1周1.05秒（目押ししやすさ優先のやや遅め）。
  // 実機は0.75秒/周だがWeb版はモーションブラーが無く、実機速度だと図柄が追えないため意図的に遅く補償。
  // （将来ブラー実装で実機速度化の余地）。速度は EffectScheduler 参照。
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
  // 1ゲームの掛け枚数（毎ゲーム消費するコスト）。実機の3枚掛け＝有効ライン多めのリアリティ用。
  // 払い出しには掛けない（払い出し＝役 base × コンボ倍率）。
  betPerSpin: z.number().int().positive(),
  // 役カテゴリ別の「コンボなしの払い出し枚数」そのもの（旧称 multiplier だが bet には掛けない）。
  baseMultiplier: z.object({
    core: z.number(),
    premium: z.number(),
    bonus: z.number(),
    cherry: z.number().default(2),
  }),
  // ボーナス中の素点倍率。現行設計では 1.0＝combo無しなら通常もボーナス中も同じ払い出し。
  // ボーナスの価値は「演出100%でコンボを伸ばせる」点にあり、素点ブーストは持たせない。
  bonusZoneMultiplier: z.number(),
  initialCoins: z.number().int().nonnegative(),
  // 連チャン（コンボ）数→配当倍率。しきい値で評価（順不同・最大一致を採用）。
  // 出玉設計の主役＝コンボ（通常時はほぼ増えず、連を伸ばすほど枚数が伸びる）。
  // 実運用カーブは data/payouts が正（現行 2連1.5〜20連7.0）。省略時は下記フォールバック。
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
  // ボーナス倍率×コンボ倍率の積算上限。combined をここで頭打ちにする（コンボ天井）。
  // コンボ主役化に伴い data/payouts では 7.0（最上位tierと一致）。省略時フォールバックは 3.0。
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

/** 示唆の期待度ランク色（青<黄<緑<赤<金）。tint・ステータス・ジン台詞に使う。 */
export const ShisaTierColorSchema = z.enum(['blue', 'yellow', 'green', 'red', 'gold']);
export type ShisaTierColor = z.infer<typeof ShisaTierColorSchema>;

/**
 * 示唆の1段階（期待度tier）。色が上がるほど引き込みが強く・対象が広がる。
 *  - 青→黄→緑: 小役(core/cherry)の最終リール引き込みを 2→3→4コマ に段階強化（bonus/premiumは対象外）
 *  - 赤: 小役引き込みを切り、RB(bonus)を引き込み対象に追加（第1・第2停止も中段引き込み）
 *  - 金: さらに BB(premium=7揃い/バー揃いの2役)も引き込み対象に追加
 */
const ShisaTierSchema = z.object({
  color: ShisaTierColorSchema,
  /** この tier の抽選ウェイト（配列内の総和で正規化。合計≈1 を想定）。 */
  weight: z.number().min(0),
  /** 小役(core/cherry)の最終リール引き込み窓（コマ）。0=引き込まない（赤/金）。 */
  coreCells: z.number().int().nonnegative(),
  /** RB(bonus)の最終リール引き込み窓（コマ）。0=対象外。 */
  bonusCells: z.number().int().nonnegative(),
  /** BB(premium=7揃い/バー揃い)の最終リール引き込み窓（コマ）。0=対象外。 */
  premiumCells: z.number().int().nonnegative(),
  /** bonus/premium の第1・第2停止の中段引き込み窓（コマ・aim相当）。0=第1/2は自力。 */
  noticeHintCells: z.number().int().nonnegative(),
});
export type ShisaTier = z.infer<typeof ShisaTierSchema>;

/** 示唆tierの既定（青55/黄25/緑12/赤6/金2%）。data/tuning が正、ここはフォールバック。 */
const DEFAULT_SHISA_TIERS: ShisaTier[] = [
  { color: 'blue', weight: 0.55, coreCells: 2, bonusCells: 0, premiumCells: 0, noticeHintCells: 0 },
  { color: 'yellow', weight: 0.25, coreCells: 3, bonusCells: 0, premiumCells: 0, noticeHintCells: 0 },
  { color: 'green', weight: 0.12, coreCells: 4, bonusCells: 0, premiumCells: 0, noticeHintCells: 0 },
  { color: 'red', weight: 0.06, coreCells: 0, bonusCells: 8, premiumCells: 0, noticeHintCells: 4 },
  { color: 'gold', weight: 0.02, coreCells: 0, bonusCells: 8, premiumCells: 8, noticeHintCells: 4 },
];

/**
 * 予告（狙え/クイズ）が BB(premium)/RB(bonus) を対象にする重み。1=フィルタなし、0=小役限定。
 * ここがボーナス突入率とおかわり率を直接決める（演出の頻度ではなく「予告の中身」で出玉を制御する）。
 * ボーナス中の値を小さくするほど、おかわりが「赤/金示唆」に寄ったレアな契機になる。
 */
const NoticeWeightSchema = z
  .object({
    /** 通常時：狙えの予告役抽選で bonus/premium にかける重み倍率。 */
    aimBonusWeight: z.number().min(0).default(0.1),
    /** 通常時：クイズ出題で「答えが bonus/premium」の問題にかける重み倍率。 */
    quizBonusWeight: z.number().min(0).default(0.2),
    /** ボーナス中：狙えの予告役（0=小役のみ予告＝おかわりは示唆の赤/金だけ）。 */
    bonusAimBonusWeight: z.number().min(0).default(0),
    /** ボーナス中：クイズの BB/RB 問題。 */
    bonusQuizBonusWeight: z.number().min(0).default(0.15),
  })
  .default({
    aimBonusWeight: 0.1,
    quizBonusWeight: 0.2,
    bonusAimBonusWeight: 0,
    bonusQuizBonusWeight: 0.15,
  });

/**
 * 演出なし時の小役蹴り。
 * 「演出中に目押しできれば獲れる」技術介入機にするため、**演出が無いスピンは小役も揃わない**
 * （＝実機の小役非当選に相当）。これが無いと目押しの上手いプレイヤーが通常時に無限に増やせる。
 * ボーナス中と確定告知ランプ点灯中は適用しない。
 */
const KickCoreSchema = z
  .object({
    enabled: z.boolean().default(true),
    /** 蹴りの発動確率（0..1）。 */
    probability: z.number().min(0).max(1).default(0.8),
    /** 「揃わない位置」を探す最大コマ数。窓内に無ければ蹴らない＝たまに揃う。 */
    maxCells: z.number().int().nonnegative().default(4),
  })
  .default({ enabled: true, probability: 0.8, maxCells: 4 });

export const TuningSchema = z.object({
  /** ベット毎の演出抽選レート（通常／ハマり救済／ボーナス中）。各合計≈1.0 を想定。 */
  effectRates: z.object({
    default: EffectRatesSchema,
    rescue: EffectRatesSchema,
    bonus: EffectRatesSchema,
  }),
  /** 連続ハズレがこの回数以上で救済レートへ切替。 */
  rescueMissThreshold: z.number().int().positive().default(30),
  /** ボーナス区間の継続スピン数と、ボーナス中だけ差し替える示唆tier。 */
  bonus: z
    .object({
      spinsPerBig: z.number().int().positive().default(10),
      spinsPerReg: z.number().int().positive().default(5),
      /**
       * ボーナス中の示唆tier（省略時は assist.shisaTiers を流用）。
       * ボーナス中は演出100%なので、通常と同じ赤6%/金2%だと「おかわり」が毎セット当たって
       * 区間が終わらなくなる。ここで赤/金を絞ることでおかわりをレアな契機にする。
       */
      shisaTiers: z.array(ShisaTierSchema).min(1).optional(),
    })
    .default({ spinsPerBig: 10, spinsPerReg: 5 }),
  /** 予告（狙え/クイズ）が BB/RB を対象にする重み。突入率・おかわり率の主ダイヤル。 */
  notice: NoticeWeightSchema,
  /** 引き込み/蹴り（目押し補助）の強さ。コマ数が大きいほど揃いやすい。 */
  assist: z
    .object({
      /** 通常テンパイ（示唆など）の最終リール引き込み最大コマ数（実機準拠＝4）。 */
      assistMaxCells: z.number().int().nonnegative().default(4),
      /** 予告役(狙え/クイズ)の最終リール引き込み最大コマ数（拡大＝狙えば獲れる・既定8）。 */
      noticeAssistMaxCells: z.number().int().nonnegative().default(8),
      /** 予告役の第1・第2停止の中段引き込み最大コマ数（最終リール以外も引き込む・既定4）。 */
      aimHintMaxCells: z.number().int().nonnegative().default(4),
      /** 偶然の bonus/premium 揃いを蹴る最大コマ数。 */
      kickMaxCells: z.number().int().nonnegative().default(2),
      /** 蹴りの発動確率（0..1）。 */
      kickProbability: z.number().min(0).max(1).default(0.5),
      /** 示唆の期待度tier（青<黄<緑<赤<金）。引いた示唆はこの配列から重み抽選される。 */
      shisaTiers: z.array(ShisaTierSchema).min(1).default(DEFAULT_SHISA_TIERS),
      /** 演出なしスピンで小役(core/cherry)も蹴るか（技術介入機の前提＝演出中だけ獲れる）。 */
      kickCore: KickCoreSchema,
    })
    .default({
      assistMaxCells: 4,
      noticeAssistMaxCells: 8,
      aimHintMaxCells: 4,
      kickMaxCells: 2,
      kickProbability: 0.5,
      shisaTiers: DEFAULT_SHISA_TIERS,
      kickCore: { enabled: true, probability: 0.8, maxCells: 4 },
    }),
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
  /**
   * リール速度（コマ/秒）。実機（ジャグラー等）は約28コマ/秒＝0.75秒/周。
   * モーションブラー（ReelView）実装前は残像が無く、実機速度だと図柄が追えずカクついて見えたため
   * 20（1.05秒/周）に落としていた。ブラー実装後は実機速度が使える。
   * 速度を上げると 1コマ = 1000/speed ms が短くなり、目押しは相対的にシビアになる（出玉も下がる）。
   */
  reelSpeed: z.number().positive().default(20),
  /**
   * モーションブラーの強さ係数。0=ブラー無し。
   * ブラー強度 = （1フレームの移動px）× この係数。速度に比例して自動で強くなる。
   */
  motionBlurStrength: z.number().min(0).default(0.34),
  /** ビタ押し成功窓（±ms）。 */
  bitaWindowMs: z.number().positive().default(12),
  /** 突入直前の「溜め」演出の長さ（ms）。 */
  entryChargeMs: z.number().nonnegative().default(650),
});

export type Tuning = z.infer<typeof TuningSchema>;
