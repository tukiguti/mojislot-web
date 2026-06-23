import { CardFileSchema } from './cardSchema';
import type { CardFile, CardPayload } from './cardSchema';

/**
 * 会員カードの「難読化 + 改ざん検知」コーデック。
 *
 * 正直な限界（重要）: 本アプリは GitHub Pages（public リポ）で配信されるため、
 * 下の固定鍵はソース/バンドルから誰でも読める。よって**秘匿は不可**で、
 * 実効的な価値は「AES-GCM 認証タグによる改ざん検知」だけ。順位の不正防止用ではない。
 * （詳細は計画 19 §4.6）。
 */

export type CardErrorCode = 'TAMPERED' | 'BAD_FORMAT';

export class CardError extends Error {
  constructor(
    readonly code: CardErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'CardError';
  }
}

// 固定アプリ鍵の素（public のため秘匿効果は無い。鍵導出のためだけに使う）
const KEY_MATERIAL = 'mojislot-web/member-card/v2/fixed-app-key';

const enc = new TextEncoder();
const dec = new TextDecoder();

let keyPromise: Promise<CryptoKey> | null = null;
function getKey(): Promise<CryptoKey> {
  if (!keyPromise) {
    keyPromise = crypto.subtle
      .digest('SHA-256', enc.encode(KEY_MATERIAL))
      .then((hash) =>
        crypto.subtle.importKey('raw', hash, 'AES-GCM', false, [
          'encrypt',
          'decrypt',
        ]),
      );
  }
  return keyPromise;
}

// --- base64url（URL安全・パディング無し）---
function bytesToB64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** ペイロードを暗号化して CardFile（.mojicard の中身）にする。 */
export async function encryptCard(payload: CardPayload): Promise<CardFile> {
  const key = await getKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = enc.encode(JSON.stringify(payload));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
  return {
    fmt: 'mojicard',
    v: 2,
    alg: 'AES-GCM',
    iv: bytesToB64url(iv),
    data: bytesToB64url(new Uint8Array(ct)),
  };
}

/**
 * CardFile を復号して生オブジェクトを返す。
 * 形式不正は BAD_FORMAT、authタグ検証失敗（＝改ざん/破損）は TAMPERED を投げる。
 * 返り値は未検証の unknown（呼び出し側で CardPayloadSchema.parse する）。
 */
export async function decryptCard(file: unknown): Promise<unknown> {
  const parsed = CardFileSchema.safeParse(file);
  if (!parsed.success) {
    throw new CardError('BAD_FORMAT', 'カードファイルの形式が不正です。');
  }
  const f = parsed.data;
  const key = await getKey();
  let pt: ArrayBuffer;
  try {
    pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: b64urlToBytes(f.iv) },
      key,
      b64urlToBytes(f.data),
    );
  } catch {
    throw new CardError(
      'TAMPERED',
      'カードが壊れているか改ざんされています（復号に失敗）。',
    );
  }
  try {
    return JSON.parse(dec.decode(pt));
  } catch {
    throw new CardError('TAMPERED', 'カードの中身を読み取れませんでした。');
  }
}
