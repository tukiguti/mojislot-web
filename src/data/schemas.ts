import { z } from 'zod';

export const ReelStripSchema = z.object({
  id: z.string(),
  // 1リール = 21コマ。既定24コマ/秒＝1周0.88秒で、設定から20〜28コマ/秒に変更できる。
  // 回転中は速度比例のモーションブラーを掛け、停止後は図柄を鮮明に戻す。
  cells: z.array(z.string()).length(21),
});

export const ReelConfigSchema = z.object({
  mode: z.string(),
  reels: z.array(ReelStripSchema).length(3),
});

export type ReelStrip = z.infer<typeof ReelStripSchema>;
export type ReelConfig = z.infer<typeof ReelConfigSchema>;

// core=小役 / premium=BIG(7・バー揃い) / bonus=RB / cherry=チェリー(2文字役)
// single=1枚役（実機の制御用1枚役。既存文字の無意味な並び＝「単語にならなかった」出目）
export const YakuCategorySchema = z.enum([
  'core',
  'premium',
  'bonus',
  'cherry',
  'single',
]);

/**
 * レバーONで抽選する内部役の種別（実機のフラグに相当）。
 * - miss   : ハズレ。何も揃わない出目に着地させる＝0枚
 * - single : 1枚役。singleYaku のどれかを自動引き込みで揃える＝1枚。
 *            押し順を外した時のこぼし先もこのグループ（実機の押し順ベルこぼし）
 * - core/cherry/reg/big : 表示役に対応するフラグ
 */
export const InternalRoleKindSchema = z.enum([
  'miss',
  'single',
  'core',
  'cherry',
  'reg',
  'big',
]);
export const InternalRoleStateSchema = z.enum(['default', 'rescue', 'bonus']);
export const InternalRoleRateSchema = z.object({
  default: z.number().min(0).max(1),
  rescue: z.number().min(0).max(1),
  bonus: z.number().min(0).max(1),
});

/**
 * 内部役テーブル1件。**表示役（displayYakuId）と内部役を分離**する。
 * 押し順は「役の種類」ではなく**停止制御の入力**なので、ここには持たない
 * （停止位置は 内部役 × 押し順 × 押下位置 の制御で決まる）。
 */
export const InternalRoleSchema = z.object({
  id: z.string(),
  kind: InternalRoleKindSchema,
  /** 揃えさせたい表示役。miss / single は null。 */
  displayYakuId: z.string().nullable().default(null),
  /** 抽選確率（通常／救済／ボーナス中）。全内部役の合計＝1。 */
  rate: InternalRoleRateSchema,
  /**
   * この内部役に当選した時にフリーズ演出を発動する（実機の「フリーズ＝フラグ連動」）。
   * 独立抽選ではなく内部役テーブルに置くことで、フリーズが「引けたら確定」の
   * 強レア役になり、確率も他の役と同じ場所で管理できる。
   */
  freeze: z.boolean().default(false),
});

export const YakuSchema = z.object({
  id: z.string(),
  name: z.string(),
  // 通常は3文字。チェリー(2文字役=左+中)のみ2文字を許容
  symbols: z.array(z.string()).min(2).max(3),
  category: YakuCategorySchema,
  /**
   * この役の払い出し枚数。書かなければ category ごとの baseMultiplier を使う。
   *
   * 小役4種を 4/6/8/10 と散らして**枚数を役の名札にする**ために入れた。全部同じ枚数だと
   * 「何が揃ったか」を出目からしか読めないが、枚数が違えば「6枚＝あの役＝あの位置」と
   * 結びつく。リミックス島は文字がステージごとに変わるので、位置と枚数の対応だけが
   * ステージをまたいで残る共通言語になる。
   */
  payout: z.number().int().positive().optional(),
  // 図柄画像(webp)を持たない役。true なら画像読込をスキップし色タイル＋文字で描く
  noArt: z.boolean().optional(),
  /**
   * カットインの一枚絵（`public/art/` 配下のファイル名）。
   *
   * **書かなければ役色から手続き生成する。** 絵を用意した役だけここに1行足せばよく、
   * 役を差し替えても「前の役の絵が出る」が構造的に起きない。以前は章＋役の位置
   * （premiumYaku[0] なら章の一枚絵）で暗黙に決めていたため、役を入れ替えた時に
   * いなり成立で握り寿司の絵が出る、という食い違いが残った。
   */
  cutinArt: z.string().optional(),
});

export const YakuListSchema = z
  .object({
    mode: z.string(),
    coreYaku: z.array(YakuSchema),
    premiumYaku: z.array(YakuSchema),
    bonusYaku: z.array(YakuSchema).default([]),
    // チェリー（2文字役・左+中の2リールで成立）。ジャグラー型のみ使用
    cherryYaku: z.array(YakuSchema).default([]),
    /**
     * 1枚役（実機の制御用1枚役）。既存リール文字の無意味な並びで、単語役と被らない。
     * single フラグ時はこのグループの**どれか**を自動引き込みで揃える（中段のみ）。
     * 押し順ミスのこぼし先・停止制御の受け皿を兼ねる。複数種で引き込みカバー率を稼ぐ。
     */
    singleYaku: z.array(YakuSchema).default([]),
    /** 内部役テーブル（表示役と分離。押し順役・1枚役を含む）。 */
    internalRoles: z.array(InternalRoleSchema).min(1),
  })
  .superRefine((list, ctx) => {
    const yakuIds = new Set(
      [
        ...list.coreYaku,
        ...list.cherryYaku,
        ...list.bonusYaku,
        ...list.premiumYaku,
      ].map((y) => y.id),
    );
    list.singleYaku.forEach((y, i) => {
      if (y.category !== 'single') {
        ctx.addIssue({
          code: 'custom',
          path: ['singleYaku', i, 'category'],
          message: `singleYaku「${y.id}」の category は single にしてください`,
        });
      }
      if (y.symbols.length !== 3) {
        ctx.addIssue({
          code: 'custom',
          path: ['singleYaku', i, 'symbols'],
          message: `singleYaku「${y.id}」は3文字（中段一直線で揃える）にしてください`,
        });
      }
    });
    for (const state of InternalRoleStateSchema.options) {
      const total = list.internalRoles.reduce(
        (sum, role) => sum + role.rate[state],
        0,
      );
      if (Math.abs(total - 1) >= 1e-9) {
        ctx.addIssue({
          code: 'custom',
          path: ['internalRoles'],
          message: `内部役の${state}確率は合計を1にしてください（現在${total}）`,
        });
      }
    }
    list.internalRoles.forEach((role, i) => {
      const needsDisplay =
        role.kind !== 'miss' && role.kind !== 'single';
      if (needsDisplay && !role.displayYakuId) {
        ctx.addIssue({
          code: 'custom',
          path: ['internalRoles', i, 'displayYakuId'],
          message: `内部役 ${role.id}（${role.kind}）には displayYakuId が必要です`,
        });
      }
      if (!needsDisplay && role.displayYakuId) {
        ctx.addIssue({
          code: 'custom',
          path: ['internalRoles', i, 'displayYakuId'],
          message: `内部役 ${role.id}（${role.kind}）は displayYakuId を持てません`,
        });
      }
      if (role.displayYakuId && !yakuIds.has(role.displayYakuId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['internalRoles', i, 'displayYakuId'],
          message: `内部役 ${role.id} の displayYakuId「${role.displayYakuId}」が役に存在しません`,
        });
      }
    });
  });

export type YakuCategory = z.infer<typeof YakuCategorySchema>;
export type InternalRoleKind = z.infer<typeof InternalRoleKindSchema>;
export type InternalRoleState = z.infer<typeof InternalRoleStateSchema>;
export type InternalRoleRate = z.infer<typeof InternalRoleRateSchema>;
export type InternalRole = z.infer<typeof InternalRoleSchema>;
export type Yaku = z.infer<typeof YakuSchema>;
export type YakuList = z.infer<typeof YakuListSchema>;

export const PayoutSchema = z.object({
  // 1ゲームの掛け枚数（毎ゲーム消費するコスト）。実機の3枚掛け＝有効ライン多めのリアリティ用。
  // 払い出しには掛けない（払い出し＝役 base × コンボ倍率）。
  betPerSpin: z.number().int().positive(),
  // 役カテゴリ別の「コンボなしの払い出し枚数」そのもの（旧称 multiplier だが bet には掛けない）。
  // 役が payout を持っていればそちらが優先で、ここはカテゴリ既定値。
  baseMultiplier: z.object({
    /** 小役の既定。実データの小役は payout で 4/6/8/10 に散らしてある（[31章]）。 */
    core: z.number(),
    premium: z.number(),
    bonus: z.number(),
    cherry: z.number().default(2),
    /** 1枚役（2個テンパイ＝惜しい出目）の払い出し。全ハズレは0枚。 */
    single: z.number().default(1),
  }),
  // ボーナス中の素点倍率。実運用値は data/payouts/default.json が正（現行2.2）。
  bonusZoneMultiplier: z.number(),
  initialCoins: z.number().int().nonnegative(),
  // 連チャン（コンボ）数→配当倍率。しきい値で評価（順不同・最大一致を採用）。
  // 出玉設計の主役＝コンボ（通常時はほぼ増えず、連を伸ばすほど枚数が伸びる）。
  // 実運用カーブは data/payouts が正（現行 2連1.25〜20連3.6）。省略時は下記フォールバック。
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
  // 腕による機械割の開きを抑える主要な調整点で、10.0→4.5→3.0 と下げてきた。
  // 現行 data/payouts では 3.0。省略時フォールバックも 3.0。
  maxComboMultiplier: z.number().positive().default(3),
  /**
   * ビタ押し（＝引き込みも蹴りも使わず、役に必要なリールを**全部**自力で止めた）時の
   * 配当倍率。上乗せ分のみを加算する（aimBonusMultiplier と同じ扱い）。
   * 到達率は腕で大きく開く（実測: 初心者3.9% / 中級9.8% / 上級26.6% / 神68.9%）。
   */
  bitaMultiplier: z.number().positive().default(1.5),
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

/**
 * 停止テーブル（第1停止）。実機のリール制御表に相当する。
 * `firstStop[内部役ID][リールindex][押下位置] = スベリコマ数(0〜4)`。
 *
 * 第1停止は**まだどの役もロックし得ない**（3文字役は3リール、チェリーは2リール必要）ので
 * 蹴りが発火せず、停止位置は完全に自由＝ここが出目（リーチ目・入り目）の設計点になる。
 * 第2・第3停止は「当選役を揃える／非当選役を避ける」の制約でほぼ一意に決まるため、
 * 表は持たずアルゴリズムに委ねる（[26_reel-guarantee] の②ゼロ保証もそちらで担保）。
 *
 * このファイルは生成できるが**手で書き換えてよい**。書き換えても②ゼロ保証は
 * 第2・第3停止の蹴りが守るので崩れない（監査テストが全押下位置で検証する）。
 */
export const StopTableSchema = z.object({
  mode: z.string(),
  firstStop: z.record(
    z.string(),
    z.array(z.array(z.number().int().min(0).max(4)).length(21)).length(3),
  ),
});
export type StopTable = z.infer<typeof StopTableSchema>;

/**
 * リーチ目表。出目キー（`左上中下|中…|右…`）→ 確定するボーナス種別。
 * 停止制御を全数実行して「ボーナスフラグでしか出ない出目」を抽出したもので、
 * 手で描いた絵ではなく制御の副産物。生成は tests/tools/find-reach-eyes.test.ts。
 */
export const ReachEyeTableSchema = z.object({
  mode: z.string(),
  eyes: z.record(z.string(), z.enum(['reg', 'big', 'both'])),
});
export type ReachEyeTable = z.infer<typeof ReachEyeTableSchema>;

export type Quiz = z.infer<typeof QuizSchema>;
export type QuizList = z.infer<typeof QuizListSchema>;

/**
 * チューニング（演出レート・補助・フリーズ・しきい値などの調整値）。
 * 従来コードに散在していた定数を1ファイルに集約し、出現確率や演出頻度を弄りやすくする。
 * 各値は省略時に既定へフォールバックする（部分指定OK）。
 */
export const EffectRatesSchema = z
  .object({
    none: z.number().min(0),
    shisa: z.number().min(0),
    quiz: z.number().min(0),
    aim: z.number().min(0),
  })
  .refine(
    (rates) =>
      Math.abs(rates.none + rates.shisa + rates.quiz + rates.aim - 1) < 1e-9,
    { message: '演出レート none/shisa/quiz/aim の合計は 1 にしてください' },
  );

/**
 * 示唆のランク色（青<赤<金）。tint・ステータス・ジン台詞に使う。
 * 停止制御は**内部役だけで決まる**ようになった（実機準拠）ので、色は
 * 「どのカテゴリの当選か」という**情報だけ**を表す。引き込みの強さは色で変わらない。
 * 旧・黄と緑は青と同じ意味（小役確定）になるため廃止（2026-07-25）。
 */
export const ShisaTierColorSchema = z.enum(['blue', 'red', 'gold']);
export type ShisaTierColor = z.infer<typeof ShisaTierColorSchema>;

/** 示唆の1段階。`targets` に含まれるカテゴリの内部役が当選した時だけこの色が出る。 */
const ShisaTierSchema = z.object({
  color: ShisaTierColorSchema,
  /** 同じ内部役に複数tierが該当する時の抽選ウェイト。 */
  weight: z.number().min(0),
  /** この色が示すカテゴリ（＝当たりうる役の範囲）。 */
  targets: z.array(YakuCategorySchema).min(1),
});
export type ShisaTier = z.infer<typeof ShisaTierSchema>;

/** 示唆tierの既定。data/tuning が正、ここはフォールバック。 */
const DEFAULT_SHISA_TIERS: ShisaTier[] = [
  { color: 'blue', weight: 1, targets: ['core', 'cherry'] },
  { color: 'red', weight: 1, targets: ['bonus'] },
  { color: 'gold', weight: 1, targets: ['premium'] },
];

export const TuningSchema = z.object({
  /** ベット毎の演出抽選レート（通常／ハマり救済／ボーナス中）。各合計は1.0必須。 */
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
  /**
   * 引き込み（目押し補助）。実機同様、**引き込み窓は内部役だけで決まり演出では変わらない**。
   * 難易度はリール配列（図柄の間隔）が担う＝4コマ内に図柄が無ければ取りこぼす。
   */
  assist: z
    .object({
      /** 当選役を引き込む最大コマ数（実機準拠＝最大スベリ4コマ）。 */
      pullInCells: z.number().int().nonnegative().default(4),
      /** 示唆tier（色＝当選カテゴリの情報。引き込みには影響しない）。 */
      shisaTiers: z.array(ShisaTierSchema).min(1).default(DEFAULT_SHISA_TIERS),
    })
    .default({ pullInCells: 4, shisaTiers: DEFAULT_SHISA_TIERS }),
  /**
   * フリーズ演出。**発生確率はここには無い**——
   * `data/yaku/<章>.json` の `freeze: true` を持つ内部役のレートが確率そのもの
   * （実機と同じフラグ連動。独立抽選ではない）。
   */
  freeze: z
    .object({
      /** フリーズ中の倍速回転スピード（コマ/秒）。 */
      spinSpeed: z.number().positive().default(60),
    })
    .default({ spinSpeed: 60 }),
  /** 確定告知ランプ（点灯=ボーナス確定・種別は内部確定で伏せる）。 */
  announceLamp: z
    .object({
      /** レバーオン時の点灯抽選確率（通常時のみ）。 */
      rate: z.number().min(0).max(1).default(0.0033),
      /** 確定種別がBIGになる割合（残りはREG）。 */
      bigRatio: z.number().min(0).max(1).default(0.3),
    })
    .default({ rate: 0.0033, bigRatio: 0.3 }),
  /**
   * チェリー重複（実機のレア役＋ボーナス同時当選）。
   * チェリーが**実際に揃った**時だけ抽選し、当たれば確定告知ランプを点灯させて
   * 次ゲーム以降をボーナス確定にする。チェリーは2文字役で他の小役と質が違うので、
   * 「引けたら次に期待できる」レア役としての意味づけを与える。
   */
  cherryBonus: z
    .object({
      /** チェリー成立1回あたりの当籤率。 */
      rate: z.number().min(0).max(1).default(0.05),
      /** 確定種別がBIGになる割合（残りはREG）。 */
      bigRatio: z.number().min(0).max(1).default(0.3),
      /** 成立表示の余韻を残してから告知するまでの待ち（ms）。 */
      delayMs: z.number().int().nonnegative().default(900),
    })
    .default({ rate: 0.05, bigRatio: 0.3, delayMs: 900 }),
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
