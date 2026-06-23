import { z } from 'zod';

/**
 * 会員カードのスキーマ（Zod）。復号後のペイロードを parse して、
 * 壊れた/想定外のカードを安全に弾く。`storage` は localStorage の生スナップショット
 * （キー→値文字列）。各モジュールの内部構造に密結合しないため後方互換が効きやすい。
 */

/** 暗号化後のファイル最終形（.mojicard の中身）。 */
export const CardFileSchema = z.object({
  fmt: z.literal('mojicard'),
  v: z.number(),
  alg: z.string(),
  iv: z.string(),
  data: z.string(),
});
export type CardFile = z.infer<typeof CardFileSchema>;

/** 復号後のペイロード。 */
export const CardPayloadSchema = z.object({
  schema: z.literal('mojislot.card'),
  version: z.number(),
  createdAt: z.string(),
  member: z.object({
    id: z.string(),
    name: z.string(),
  }),
  app: z.object({
    name: z.string(),
    buildVer: z.string(),
  }),
  // localStorage の生スナップショット（キー→値文字列）
  storage: z.record(z.string(), z.string()),
});
export type CardPayload = z.infer<typeof CardPayloadSchema>;
