import { z } from 'zod';

/**
 * data/ の JSON が持つデータ版（`dataVersion`）。形式を変えたらその種類の版を上げ、
 * 古い形式のファイルを読み込んだ時点で分かるようにする（黙って別の意味に読まない）。
 */
export const DATA_VERSION = {
  reels: 1,
  yaku: 1,
  quizzes: 1,
  stops: 2,
  payouts: 1,
  tuning: 1,
  quizmasterLines: 1,
} as const;

export function dataVersion(expected: number, label: string) {
  return z.literal(expected, {
    error: (iss) =>
      iss.input === undefined
        ? `${label}に dataVersion がありません（期待する版は ${expected}）`
        : `${label}の dataVersion が ${String(iss.input)} です。この版のコードは ${expected} を読みます`,
  });
}

export const ReelStripSchema = z.object({
  id: z.string(),
  // 1リール = 21コマ。既定24コマ/秒＝1周0.88秒で、設定から20〜28コマ/秒に変更できる。
  // 回転中は速度比例のモーションブラーを掛け、停止後は図柄を鮮明に戻す。
  cells: z.array(z.string()).length(21),
});

export const ReelConfigSchema = z.object({
  dataVersion: dataVersion(DATA_VERSION.reels, 'リール配列（data/reels）'),
  mode: z.string(),
  /**
   * 目印の図柄（島の漢字1字・2026-10-02）。各リールの 0・7・14 番に置き、どの役にも
   * 属さない。狙う時の目安（真下にボーナス図柄）と、ボーナス中のビタ役の図柄を兼ねる。
   * 無い島は目印なし。
   */
  landmark: z.string().optional(),
  reels: z.array(ReelStripSchema).length(3),
});

export type ReelStrip = z.infer<typeof ReelStripSchema>;
export type ReelConfig = z.infer<typeof ReelConfigSchema>;

// core=小役 / premium=BIG(7・バー揃い) / bonus=RB / cherry=チェリー(2文字役)
// single=1枚役（実機の制御用1枚役。既存文字の無意味な並び＝「単語にならなかった」出目）
// chance=目印揃い（リーチ目＝中段・チャンス目＝中段以外。2026-10-12・drafts/reach-eye-redesign）
export const YakuCategorySchema = z.enum([
  'core',
  'premium',
  'bonus',
  'cherry',
  'single',
  'chance',
]);

/** ペイラインのID（core/Paylines.ts の PaylineId と同じ並び）。 */
export const PaylineIdSchema = z.enum(['top', 'middle', 'bottom', 'diag_tlbr', 'diag_bltr']);

/**
 * レバーONで抽選する内部役の種別（実機のフラグに相当）。
 * - miss   : ハズレ。何も揃わない出目に着地させる＝0枚
 * - single : 1枚役。singleYaku のどれかを自動引き込みで揃える＝1枚。
 *            押し順を外した時のこぼし先もこのグループ（実機の押し順ベルこぼし）
 * - core/cherry/reg/big : 表示役に対応するフラグ
 * - chance : 目印揃い（リーチ目・チャンス目）。`carry` があれば同時にそのボーナスが成立する。
 *            ボーナスを伴っても big/reg にしないのは、通常時の big/reg は前兆の経路でしか
 *            成立させない（抽選で引いた big/reg はハズレに置き換える）ため
 */
export const InternalRoleKindSchema = z.enum([
  'miss',
  'single',
  'core',
  'cherry',
  'reg',
  'big',
  'chance',
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
  /**
   * 同時に成立させるボーナス（premiumYaku / bonusYaku の役ID）。chance の内部役だけが持つ。
   * 目印が揃ったあと、このボーナスを揃えるまで持ち越す。
   */
  carry: z.string().nullable().default(null),
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
   * この役の色（`#rrggbb`）。構成文字はドット文字のスプライトを tint するので、
   * ここで指定した色がそのままリール上の文字色になる。
   *
   * **書かなければカテゴリごとのパレットから登場順に配る**（`render/SymbolStyle.ts`）。
   * 色を役データ側に置いたのは、小役の色が「同じリールに載る文字どうしで字形が近い
   * ほど色を遠ざける」という**役の顔ぶれに依存した設計**だからで、役を差し替えたときに
   * 色の見直しが同じファイルの同じ行で目に入る。パレットを順番に配る実装だと、役を
   * 1つ入れ替えただけで無関係な役の色まで玉突きでずれる。
   *
   * 赤と青はボーナス（BIG1・BIG2）に予約してあるので小役には指定しない。
   */
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, '色は #rrggbb 形式で書いてください')
    .optional(),
  /**
   * カットインの一枚絵（`public/art/` 配下のファイル名）。
   *
   * **書かなければ役色から手続き生成する。** 絵を用意した役だけここに1行足せばよく、
   * 役を差し替えても「前の役の絵が出る」が構造的に起きない。以前は章＋役の位置
   * （premiumYaku[0] なら章の一枚絵）で暗黙に決めていたため、役を入れ替えた時に
   * いなり成立で握り寿司の絵が出る、という食い違いが残った。
   */
  cutinArt: z.string().optional(),
  /**
   * この役が成立するライン。書かなければ有効ライン全部。目印揃いは同じ3文字で、
   * 中段ならリーチ目・それ以外ならチャンス目と、ラインで役が分かれる。
   */
  lines: z.array(PaylineIdSchema).optional(),
});

export const YakuListSchema = z
  .object({
    dataVersion: dataVersion(DATA_VERSION.yaku, '役（data/yaku）'),
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
    /** 目印揃い（リーチ目・チャンス目）。払い出し1枚・倍率なし・コンボはつながる。 */
    chanceYaku: z.array(YakuSchema).default([]),
    /** 内部役テーブル（表示役と分離。押し順役・1枚役を含む）。 */
    internalRoles: z.array(InternalRoleSchema).min(1),
  })
  .superRefine((list, ctx) => {
    // 小役は4種を枚数で区別するので、カテゴリ既定では表せず payout が要る。
    // ここを緩めると baseMultiplier に小役の共通枠を戻すことになり、
    // 「枚数が役の名札」という設計（[31章] §3③）が崩れる。
    list.coreYaku.forEach((y, i) => {
      if (y.payout === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['coreYaku', i, 'payout'],
          message: `小役「${y.id}」には payout（払い出し枚数）が必要です`,
        });
      }
    });
    const yakuIds = new Set(
      [
        ...list.coreYaku,
        ...list.cherryYaku,
        ...list.bonusYaku,
        ...list.premiumYaku,
        ...list.chanceYaku,
      ].map((y) => y.id),
    );
    const bonusIds = new Set([...list.bonusYaku, ...list.premiumYaku].map((y) => y.id));
    const chanceIds = new Set(list.chanceYaku.map((y) => y.id));
    list.internalRoles.forEach((role, i) => {
      if (role.carry !== null && (role.kind !== 'chance' || !bonusIds.has(role.carry))) {
        ctx.addIssue({
          code: 'custom',
          path: ['internalRoles', i, 'carry'],
          message: `内部役 ${role.id} の carry はチャンスの内部役だけが持ち、ボーナスの役IDにしてください`,
        });
      }
      if (role.kind === 'chance' && !chanceIds.has(role.displayYakuId ?? '')) {
        ctx.addIssue({
          code: 'custom',
          path: ['internalRoles', i, 'displayYakuId'],
          message: `内部役 ${role.id}（chance）の displayYakuId は chanceYaku の役にしてください`,
        });
      }
    });
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
  dataVersion: dataVersion(DATA_VERSION.payouts, '配当（data/payouts）'),
  // 1ゲームの掛け枚数（毎ゲーム消費するコスト）。実機の3枚掛け＝有効ライン多めのリアリティ用。
  // 払い出しには掛けない（払い出し＝役 base × コンボ倍率）。
  betPerSpin: z.number().int().positive(),
  /**
   * 役カテゴリ別の「コンボなしの払い出し枚数」そのもの（旧称 multiplier だが bet には掛けない）。
   * 役が `payout` を持っていればそちらが優先。
   *
   * **小役（core）はここに無い。** 小役は4種を枚数で区別する（4/6/8/10・[31章]）ので、
   * カテゴリ1つでは表せず、役ごとの `payout` が必須になる（`YakuListSchema` が強制する）。
   * 以前はここに `core` を置いていたが、全小役が payout を持つため誰も読まない値になっていた。
   */
  baseMultiplier: z.object({
    premium: z.number(),
    bonus: z.number(),
    cherry: z.number().default(2),
    /** 1枚役（惜しい出目）の払い出し。全ハズレは0枚。 */
    single: z.number().default(1),
  }),
  // ボーナス中の素点倍率。実運用値は data/payouts/default.json が正（現行1.4）。
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
  /**
   * **ボーナス図柄が揃った時の払い出し**（通常時の初当たり・ボーナス中のおかわり共通）。
   * 実機のボーナス成立がリプレイ相当なのと同じで、BET と同額の 3 枚だけ返す
   * （2026-09-13。以前は BIG 15枚 / REG 10枚）。倍率もコンボも乗せない。
   */
  bonusYakuPayout: z.number().nonnegative().default(3),
  // ボーナス倍率×コンボ倍率の積算上限。combined をここで頭打ちにする（コンボ天井）。
  // 腕による機械割の開きを抑える主要な調整点で、10.0→4.5→3.0 と下げてきた。
  // 現行 data/payouts では 3.0。省略時フォールバックも 3.0。
  maxComboMultiplier: z.number().positive().default(3),
  /**
   * ビタ押し（＝引き込みも蹴りも使わず、役に必要なリールを**全部**自力で止めた）時の
   * 配当倍率。上乗せ分のみを加算する。**出玉に効く技術介入はこれだけ**——
   * 狙え・クイズの的中に付けていた加算は廃止した（2026-09-12）。
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
  dataVersion: dataVersion(DATA_VERSION.quizzes, 'クイズ（data/quizzes）'),
  mode: z.string(),
  quizzes: z.array(QuizSchema).min(1),
});

/**
 * 停止テーブル。実機のリール制御表に相当する。
 *
 * **第1停止** `firstStop[内部役ID][リールindex][押下位置] = スベリコマ数(0〜4)`。
 * まだどの役もロックし得ない（3文字役は3リール、チェリーは2リール必要）ので
 * 蹴りが発火せず、停止位置は完全に自由＝ここが出目の設計点になる。
 * ここは生成できるが**手で書き換えてよい**。書き換えても②ゼロ保証は
 * 蹴りが守るので崩れない（監査テストが全押下位置で検証する）。
 *
 * **第2・第3停止は全押し順ぶん持つ**（2026-10-14〜。それまでは順押しだけで、
 * ほかの押し順は実行時の探索へ落ちていた）。`StopController` を通して焼くので
 * 探索と同じ値になり、`tests/data/stop-table-equivalence` が全押し順で突き合わせる。
 * 手で書き換えるものではない。
 *
 * 押し順を含めると6倍に膨らむので、1内部役ぶんを**数字の文字列**に詰め
 * （1文字＝スベリ0〜4。数値の配列で持つと1要素に `,` が付いて倍になる）、
 * 同じ文字列は `slipPool` に1つだけ置いて表からは番号で指す。同じ図柄を揃える
 * 内部役（BIG とそのフリーズ版など）や、通常時とボーナス中で表が同じになることが多い。
 *  - 第2停止 `secondStop[押し順][内部役ID]` は 21×21 文字。押し順のキーは
 *    「第1停止のリール」「第2停止のリール」を並べた2桁（`"01"`＝左→中）。
 *    添字は `第1停止の停止位置 × 21 + 押下位置`
 *  - 第3停止 `thirdStop[最後のリール][内部役ID]` は 21×21×21 文字。止まっている
 *    2リールの停止位置だけで決まり、どちらを先に止めたかは効かない（左→中→右も
 *    中→左→右も同じ表）。添字は `(若い番号のリールの停止位置 × 21 + もう一方) × 21 + 押下位置`
 * 添字はどれも**停止位置**であって押下位置ではない。混同すると静かにずれる。
 *
 * ボーナス中用の `bonusSecondStop` / `bonusThirdStop` は構造が同じ。ボーナス中だけ
 * 許可リストに1枚役（こぼし先）が加わり、当選役を引き込めなかった最終停止で拾いに行く。
 * 表は内部役IDでしか引けずこの違いを区別できないので別に持つ（通常時の表を使うと
 * 受け皿が消え、実測で「→1枚」8.6%→0.0%・機械割-2pt）。第1停止は許可リストの影響を
 * 受けないので共用する。
 */
/** スベリコマ数（0〜4）。 */
const SlipSchema = z.number().int().min(0).max(4);

/** 停止テーブルのデータ版（`DATA_VERSION.stops`）。生成側が書き込む。 */
export const STOP_TABLE_VERSION = DATA_VERSION.stops;

/** 第2停止の押し順キー（第1停止のリール＋第2停止のリール）。 */
export const SECOND_STOP_ORDERS = ['01', '02', '10', '12', '20', '21'] as const;
/** 第3停止のキー（最後に止めるリール）。 */
export const THIRD_STOP_FINALS = ['0', '1', '2'] as const;

/** 第2停止・第3停止の1内部役ぶんの文字数。 */
export const SECOND_STOP_LENGTH = 21 * 21;
export const THIRD_STOP_LENGTH = 21 * 21 * 21;

/** `slipPool` の番号。 */
const PoolIndexSchema = z.number().int().nonnegative();
const SecondStopSchema = z.record(
  z.enum(SECOND_STOP_ORDERS),
  z.record(z.string(), PoolIndexSchema),
);
const ThirdStopSchema = z.record(
  z.enum(THIRD_STOP_FINALS),
  z.record(z.string(), PoolIndexSchema),
);

export const StopTableSchema = z.object({
  dataVersion: dataVersion(DATA_VERSION.stops, '停止テーブル（data/stops）'),
  mode: z.string(),
  firstStop: z.record(
    z.string(),
    z.array(z.array(SlipSchema).length(21)).length(3),
  ),
  /** 第2・第3停止の表の中身（詰めた文字列）。表からは番号で指す。 */
  slipPool: z
    .array(z.string().regex(/^[0-4]+$/, 'スベリは 0〜4 の数字で詰めてください'))
    .default([]),
  secondStop: SecondStopSchema.optional(),
  thirdStop: ThirdStopSchema.optional(),
  bonusSecondStop: SecondStopSchema.optional(),
  bonusThirdStop: ThirdStopSchema.optional(),
}).superRefine((t, ctx) => {
  // 表が指す番号がプールにあり、長さがその停止の表の大きさに合うこと
  const check = (name: string, table: Record<string, Record<string, number>> | undefined, len: number) => {
    for (const [key, byRole] of Object.entries(table ?? {})) {
      for (const [role, idx] of Object.entries(byRole)) {
        const packed = t.slipPool[idx];
        if (packed === undefined || packed.length !== len) {
          ctx.addIssue({
            code: 'custom',
            path: [name, key, role],
            message: `${name}.${key}.${role} の番号 ${idx} が指す表が無いか、長さが ${len} でありません`,
          });
        }
      }
    }
  };
  check('secondStop', t.secondStop, SECOND_STOP_LENGTH);
  check('bonusSecondStop', t.bonusSecondStop, SECOND_STOP_LENGTH);
  check('thirdStop', t.thirdStop, THIRD_STOP_LENGTH);
  check('bonusThirdStop', t.bonusThirdStop, THIRD_STOP_LENGTH);
});

export type StopTable = z.infer<typeof StopTableSchema>;

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
export const ShisaTierColorSchema = z.enum([
  'blue',
  'green',
  'red',
  'gold',
  'rainbow',
]);
export type ShisaTierColor = z.infer<typeof ShisaTierColorSchema>;

/**
 * 示唆が指せる役の枠。**役IDではなく位置で書く。**
 *
 * tuning は全島で共有するので、島ごとに違う役IDは書けない。全島とも
 * 「小役4＋チェリー1＋REG1＋BIG2」で構造が同じなので、位置で指せば足りる。
 */
export const YakuSlotSchema = z.enum([
  'core0',
  'core1',
  'core2',
  'core3',
  'cherry',
  'reg',
  'big0',
  'big1',
]);
export type YakuSlot = z.infer<typeof YakuSlotSchema>;

/** 示唆の1段階。`targets` に含まれる枠の内部役が当選した時だけこの色が出る。 */
const ShisaTierSchema = z.object({
  color: ShisaTierColorSchema,
  /** 同じ内部役に複数tierが該当する時の抽選ウェイト。 */
  weight: z.number().min(0),
  /** この色が指す役の枠（＝当たりうる役の範囲）。 */
  targets: z.array(YakuSlotSchema).min(1),
});
export type ShisaTier = z.infer<typeof ShisaTierSchema>;

/**
 * 示唆tierの既定。data/tuning が正、ここはフォールバック。
 *
 * 旧構成は 青＝小役4＋チェリーの**5択**で、色以外に手がかりが無く当てずっぽうになっていた。
 * 5択は腕で埋められないので、目押しが本体のこのゲームでは示唆だけが運の演出になっていた。
 * 青と緑に割って2〜3択まで詰めてある。
 *
 * 赤（REG確定）と金（REGかBIG1の2択）は同じ役を指し得る。**どちらも左2文字の狙い方は同じ**
 * （REGはBIG1と頭2文字を共有する・[28章]）なので、金が出ても手は変わらず期待値だけ上がる。
 * 虹はもう一方のBIGだけを指す最上位。
 */
const DEFAULT_SHISA_TIERS: ShisaTier[] = [
  { color: 'blue', weight: 1, targets: ['core0', 'core1'] },
  { color: 'green', weight: 1, targets: ['core2', 'core3', 'cherry'] },
  { color: 'red', weight: 3, targets: ['reg'] },
  { color: 'gold', weight: 1, targets: ['reg', 'big0'] },
  { color: 'rainbow', weight: 1, targets: ['big1'] },
];

/**
 * 遅れ演出の既定。data/tuning が正、ここはフォールバック。
 *
 * ボーナス（reg/big）へ大きく寄せてあるので、遅れの内訳はボーナスが7割前後になる。
 * 出現率そのものは 1/200 前後で、**出たら意味があるが出なくても否定にならない**濃度。
 *
 * 小役は0で、非ボーナスの受け皿は**チェリーだけ**。チェリーには昇格抽選（成立時5%で
 * ボーナス確定）が付いているので、遅れの外れ側もボーナスへ繋がる目が残る。
 * ここを0にすると遅れが「ボーナス確定」になり、示唆の赤・虹と役割が被る。
 */
const DEFAULT_DELAY = {
  ms: 320,
  rate: { core: 0.0, cherry: 0.02, reg: 0.45, big: 0.6 },
};

/**
 * ステップアップの1色ぶん。
 *  - rate: 終了色の振り分け（4色の合計1）
 *  - bonusRate: 予告したゲームがボーナスになる率（設定の倍率はここへ掛かる）
 *  - bigRate: そのボーナスが BIG の率（残りは REG）
 *  - chain: 連続演出。2ゲーム目へ続く率と、2ゲーム目から3ゲーム目へ続く率。
 *    **強い色ほど続きやすくしてある**ので、続いたこと自体が本当に期待度を上げる
 */
const StepColorTuningSchema = z.object({
  rate: z.number().min(0).max(1),
  bonusRate: z.number().min(0).max(1),
  bigRate: z.number().min(0).max(1),
  chain: z.object({
    second: z.number().min(0).max(1),
    third: z.number().min(0).max(1),
  }),
});

/**
 * ステップアップの既定。data/tuning が正、ここはフォールバック。値の根拠は
 * `productions/StepUp.ts` の冒頭。1回のステップアップから出るボーナスは 0.3855。
 */
const DEFAULT_STEP_UP = {
  entryRate: 0.055,
  triggerMinPayout: 5,
  colors: {
    blue: { rate: 0.45, bonusRate: 0.12, bigRate: 0.15, chain: { second: 0, third: 0 } },
    green: { rate: 0.35, bonusRate: 0.53, bigRate: 0.24, chain: { second: 0.1, third: 0.1 } },
    red: { rate: 0.18, bonusRate: 0.7, bigRate: 0.35, chain: { second: 0.35, third: 0.4 } },
    gold: { rate: 0.02, bonusRate: 1.0, bigRate: 0.92, chain: { second: 0.6, third: 0.8 } },
  },
};

/**
 * 予兆（無音・バックライト消灯）の既定。data/tuning が正、ここはフォールバック。
 * **ボーナスのフラグがある無演出のゲームでしか出さない**（2026-07-29 の方針）。
 */
const DEFAULT_OMEN = {
  rate: { reg: 0.08, big: 0.12, chance: 0.25 },
  kinds: { silence: 1, backlight: 1 },
  backlightAt: { lever: 1, stop1: 1, stop2: 1 },
};

export const TuningSchema = z.object({
  dataVersion: dataVersion(DATA_VERSION.tuning, 'チューニング（data/tuning）'),
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
       * おかわり（消化中の再当選）で足すゲーム数。**新規突入より薄い**——
       * 当選率を上げて何度も乗せる形にしてあるので、突入と同じ量を足すと
       * ボーナスが終わらなくなる（[21] payout.md §上乗せ）。
       */
      okawariSpinsBig: z.number().int().nonnegative().default(5),
      okawariSpinsReg: z.number().int().nonnegative().default(3),
      /**
       * **ビタチャンス**（2026-10-02）。ボーナス中のレバーONでこの率で発生し、そのゲームは
       * 目印をぴったり押したリールが滑らない。3つ揃えば上乗せ（bitaAddSpins）。
       * 揃う確率は腕で大きく違う（試算で初心者1%・中級6%・上級32%・神96%）ので、
       * 1回のボーナスで乗る回数に上限（bitaMaxPerBonus）を置く——上限が無いと神の
       * 1ゲームあたりの期待上乗せが1を超え、ボーナスが終わらなくなる。
       */
      bitaChanceRate: z.number().min(0).max(1).default(0.15),
      bitaAddSpins: z.number().int().nonnegative().default(2),
      bitaMaxPerBonus: z.number().int().nonnegative().default(3),
      /**
       * ボーナス中の示唆tier（省略時は assist.shisaTiers を流用）。
       * ボーナス中は演出100%なので、通常と同じ赤6%/金2%だと「おかわり」が毎セット当たって
       * 区間が終わらなくなる。ここで赤/金を絞ることでおかわりをレアな契機にする。
       */
      shisaTiers: z.array(ShisaTierSchema).min(1).optional(),
    })
    .default({
      spinsPerBig: 10,
      spinsPerReg: 5,
      okawariSpinsBig: 5,
      okawariSpinsReg: 3,
      bitaChanceRate: 0.15,
      bitaAddSpins: 2,
      bitaMaxPerBonus: 3,
    }),
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
      /**
       * 取りこぼしで点ける時の**通常の間**（ms）。第3停止からこれだけ置いて点く。
       * 420ms（何も起きないゲームの間合い）を超えると次ゲームの回転中に点くので、
       * 通常はそれより短く取る。
       */
      missDelayMs: z.number().min(0).default(120),
      /** 「遅れ」の間（ms）。BIG確定のプレミア。 */
      lateDelayMs: z.number().min(0).default(380),
      /**
       * **演出が出ていたゲームでボーナスをこぼした時**に確定ランプが点く確率。
       *
       * 無演出でこぼした時は必ず点く——そこが唯一の告知だから。演出が出ていた
       * ゲームは「何を狙えばいいか」を既に教えてあるので、告知は half でよい。
       * 点かなかった側は、リーチ目や出目の違和感から自分で気づく余地が残る。
       */
      missAnnounceWithEffect: z.number().min(0).max(1).default(0.5),
      /**
       * 点き方のプレミア。**BIGを持っている時だけ**抽選し、出れば種別がBIGだと分かる。
       * ジャグラーのランプと同じで、点く速さそのものが情報になる。
       * REGの時は必ず通常の間で点くので、通常＝どちらもあり得る。
       */
      premium: z
        .object({
          /** 即点灯（第3停止と同時） */
          instant: z.number().min(0).max(1).default(0.06),
          /** 遅れ点灯 */
          late: z.number().min(0).max(1).default(0.06),
          /** 次ゲームのレバーで点く */
          nextLever: z.number().min(0).max(1).default(0.04),
        })
        .default({ instant: 0.06, late: 0.06, nextLever: 0.04 }),
      /** 確定ランプ点灯中にこの回数こぼしたら、当選役を明かす。 */
      revealAfterMisses: z.number().int().min(1).default(7),
      /**
       * 単独の告知抽選のうち、**レバーONで点ける（先告知）**割合（2026-10-14）。
       * 残りは後告知：そのゲームを演出なしのボーナスのゲームにし、こぼした時の
       * 確定ランプ（第3停止の後・即点灯／遅れ／次レバーのプレミア込み）で知らせる。
       * ジャグラーと同じく、ランプは後告知が主で先告知は一部、という配分にする。
       */
      leverShare: z.number().min(0).max(1).default(0.25),
    })
    .default({
      rate: 0.0033,
      bigRatio: 0.3,
      missDelayMs: 120,
      lateDelayMs: 380,
      missAnnounceWithEffect: 0.5,
      premium: { instant: 0.06, late: 0.06, nextLever: 0.04 },
      revealAfterMisses: 7,
      leverShare: 0.25,
    }),
  /**
   * チェリー昇格。チェリーが**実際に揃った**時だけ抽選し、当たれば確定告知ランプを
   * 点灯させて次ゲーム以降をボーナス確定にする。チェリーは2文字役で他の小役と質が
   * 違うので、「引けたら次に期待できる」レア役としての意味づけを与える。
   *
   * 実機の重複当選は内部抽選の時点で同時当選するので、チェリーをこぼしても権利は残る。
   * こちらは成立**後**の抽選なのでこぼすと抽選が起きない。機構が違うため重複とは呼ばない。
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
   * 目印揃いのあと（2026-10-12・drafts/reach-eye-redesign）。リーチ目は必ずその場で確定ランプ。
   * ボーナスを伴うチャンス目は、確定ランプ・次ゲームの狙え・次ゲームのクイズへ振り分ける
   * （重みの比。狙え・クイズが出せない役なら残りで振り分け直す）。
   */
  chanceEye: z
    .object({
      follow: z
        .object({
          lamp: z.number().nonnegative(),
          aim: z.number().nonnegative(),
          quiz: z.number().nonnegative(),
        })
        .default({ lamp: 0.4, aim: 0.3, quiz: 0.3 }),
      /**
       * ボーナスの無いチャンス目のあと、次ゲームで BIG の狙え（出せればクイズ）を出して
       * **外れる**割合（2026-10-13）。これが無いと、チャンス目のあとに狙え・クイズが出た
       * 時点でボーナス確定と読めてしまう。
       */
      fakeFollowRate: z.number().min(0).max(1).default(0.3),
    })
    .default({ follow: { lamp: 0.4, aim: 0.3, quiz: 0.3 }, fakeFollowRate: 0.3 }),
  /**
   * 矛盾（2026-10-12・drafts/reach-eye-redesign §5）。正しく押したのに揃わない、を
   * ボーナスの時だけ起こす。
   *  - decoyRate：通常時のボーナスのゲームで出す演出（狙え・示唆・クイズ）のうち、
   *    **小役を指す**割合。小役のフラグは無いので揃わない（コンボも切れない）＝矛盾。
   *    小役がテンパイしていれば、最後のリールでずれて止まりリーチ目になる。ボーナスは持ち越す
   */
  contradiction: z
    .object({
      decoyRate: z.number().min(0).max(1).default(0.2),
    })
    .default({ decoyRate: 0.2 }),
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
  /** 突入直前の「溜め」演出の長さ（ms）。 */
  entryChargeMs: z.number().nonnegative().default(650),
  /**
   * 1ゲームの間合い。
   *
   * `resultMs` は**結果の表示を片付けるまで**の時間（テンパイの点滅・狙え・クイズの答え）。
   * 2026-10-13 から BET は全停止の直後に受け付け、その前に BET されたら BET の時点で片付ける。
   * ボーナス終了（bonusEnd）だけは、リザルトへ繋ぐ間として BET もこの時間待つ。
   * 読むものの量で分ける——クイズは答えと的中を読む必要があり、ハズレは何もない。
   *
   * `spinUpMs` は**リールごとの加速時間**（見た目）。3本を少しずつ変えてあり、
   * 揃って回り出さないので機械らしさが出る。短くしてある——ゆっくり見せると
   * レバーを叩いてから打てるまでがもたつく。
   *
   * `stopLockMs` は**レバーONから停止ボタンを受け付けるまで**の時間（待ち）。
   * 見た目と待ちは別物なので分けてある。実機でも「もう回っているのに押せない」
   * 状態はあり、加速し切ったあとも少し待たされる。
   *
   * **実際のロックは加速の最大値と `stopLockMs` の大きい方。** 加速し切って
   * いないリールは物理的に止められないので、待ちをそれより短くしても効かない。
   *
   * 加速中も待ちの間も目押しはできないので、ここが出目に効くことはない。
   */
  pace: z
    .object({
      /** リールごとの加速時間（ms）。リール数ぶん並べる。 */
      spinUpMs: z.array(z.number().nonnegative()).min(1),
      stopLockMs: z.number().nonnegative(),
      resultMs: z.object({
        /** 何も起きなかったゲーム。 */
        none: z.number().nonnegative(),
        /** 役が成立したゲーム（ハイライトとコインを見せる）。 */
        win: z.number().nonnegative(),
        /** クイズが出たゲーム（答えと的中を読む）。 */
        quiz: z.number().nonnegative(),
        /** ボーナスの区間が終わったゲーム（リザルトへ繋ぐ）。 */
        bonusEnd: z.number().nonnegative(),
      }),
    })
    .default({
      spinUpMs: [110, 150, 125],
      stopLockMs: 450,
      resultMs: { none: 420, win: 820, quiz: 1400, bonusEnd: 1200 },
    }),
  /**
   * 遅れ演出。レバーONからリールが回り出すまで一瞬の間を置く。
   *
   * **ハズレでは絶対に出さない**（`miss` と `single` の率は0）。何が当たっているかは
   * 言わないが「何かは当たっている」ことは必ず本当なので、ガセにならない。
   * 出現率は内部役の種別ごとに決め、ボーナスへ寄せてある＝**濃厚だが確定ではない**。
   */
  delay: z
    .object({
      /** 間の長さ（ms）。 */
      ms: z.number().nonnegative(),
      /** 内部役の種別ごとの発生率。miss と single は演出側で0固定。 */
      rate: z.object({
        core: z.number().min(0).max(1),
        cherry: z.number().min(0).max(1),
        reg: z.number().min(0).max(1),
        big: z.number().min(0).max(1),
      }),
    })
    .default(DEFAULT_DELAY),
  /**
   * ステップアップ（段階演出）と、それを複数ゲームへ延ばす連続演出。
   *
   * 契機はチェリーと払い出し `triggerMinPayout` 枚以上の小役で、そのうち `entryRate`
   * だけが入る。BIG/REG は通常抽選から落としてあり、ここ経由でしか出ない——
   * **色の率を動かすとボーナス確率がそのまま動く。**
   */
  stepUp: z
    .object({
      entryRate: z.number().min(0).max(1),
      triggerMinPayout: z.number().int().nonnegative(),
      colors: z.object({
        blue: StepColorTuningSchema,
        green: StepColorTuningSchema,
        red: StepColorTuningSchema,
        gold: StepColorTuningSchema,
      }),
    })
    .default(DEFAULT_STEP_UP),
  /**
   * 予兆。レバーで無音になる・リールのバックライトが消える。
   *
   * **ボーナスのフラグがある無演出のゲームでしか出ない**＝出たらボーナスは本当にある。
   * 強レア役とボーナス専用に取っておく方針（2026-07-29）で、無演出の穴埋めには使わない。
   * ボーナス中・持ち越し中・確定ランプ点灯中・フリーズでは出さない。
   *  - rate: フラグの種類ごとの発生率（chance はボーナスを持ち越すチャンス目の内部役）
   *  - kinds: 出た時の種類の重み
   *  - backlightAt: バックライトが消える場面の重み（レバー／第1停止／第2停止）
   */
  omen: z
    .object({
      rate: z.object({
        reg: z.number().min(0).max(1),
        big: z.number().min(0).max(1),
        chance: z.number().min(0).max(1),
      }),
      kinds: z.object({
        silence: z.number().nonnegative(),
        backlight: z.number().nonnegative(),
      }),
      backlightAt: z.object({
        lever: z.number().nonnegative(),
        stop1: z.number().nonnegative(),
        stop2: z.number().nonnegative(),
      }),
    })
    .default(DEFAULT_OMEN),
});

export type Tuning = z.infer<typeof TuningSchema>;

/**
 * 出題者の台詞（data/quizmaster-lines.json）。章ID → 場面ごとの台詞。
 * ボイスの生成（tools/gen_voice.py）も同じファイルを読む。
 */
const QuizmasterSceneLinesSchema = z.object({
  ask: z.array(z.string()).min(1),
  correct: z.array(z.string()).min(1),
  wrong: z.array(z.string()).min(1),
  near: z.array(z.string()).min(1),
});
export const QuizmasterLinesSchema = z
  .object({
    dataVersion: dataVersion(DATA_VERSION.quizmasterLines, '出題者の台詞（data/quizmaster-lines.json）'),
  })
  .catchall(QuizmasterSceneLinesSchema);
export type QuizmasterLines = z.infer<typeof QuizmasterLinesSchema>;
