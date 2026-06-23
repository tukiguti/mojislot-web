import { encryptCard, decryptCard, CardError } from './CardCodec';
import { CardPayloadSchema } from './cardSchema';
import type { CardPayload } from './cardSchema';
import { allCardKeys, RUN_HISTORY_KEY, FIXED_KEYS } from './storageKeys';
import { getMemberId, getMemberName } from '../productions/Member';

/**
 * 会員カードの作成（スナップショット→暗号化→DL）と復元（読込→復号→検証→適用）。
 *
 * 復元方針（ユーザー確定）:
 *  - 進捗系（stats/zukan/challenges/設定/会員ID/名）= **置換**（カードの値で上書き）
 *  - runHistory = **マージ + runId dedupe**（履歴は混ぜて重複排除）
 *  - 持メダル（CoinWallet）は非永続なので引き継がれない（UIで明示）
 */

const APP_NAME = 'mojislot-web';
const APP_VER = '0.0.0';

/** 現在の localStorage から会員カードのスナップショットを作る。 */
export function collectSnapshot(): CardPayload {
  const storage: Record<string, string> = {};
  for (const key of allCardKeys()) {
    try {
      const v = localStorage.getItem(key);
      if (v !== null) storage[key] = v;
    } catch {
      /* ignore */
    }
  }
  return {
    schema: 'mojislot.card',
    version: 2,
    createdAt: new Date().toISOString(),
    member: { id: getMemberId(), name: getMemberName() },
    app: { name: APP_NAME, buildVer: APP_VER },
    storage,
  };
}

/**
 * 2つの runHistory（生JSON文字列）をマージし runId で重複排除する純関数。
 * 既存（local）を優先し、incoming からは未知 runId のみ取り込む。返り値はJSON文字列。
 */
export function mergeRunHistory(localRaw: string | null, incomingRaw: string | undefined): string {
  const parse = (raw: string | null | undefined): unknown[] => {
    if (!raw) return [];
    try {
      const v = JSON.parse(raw);
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  };
  const seen = new Set<string>();
  const merged: unknown[] = [];
  for (const rec of [...parse(localRaw), ...parse(incomingRaw)]) {
    const runId =
      typeof rec === 'object' && rec !== null
        ? (rec as { runId?: unknown }).runId
        : undefined;
    if (typeof runId !== 'string') continue;
    if (seen.has(runId)) continue;
    seen.add(runId);
    merged.push(rec);
  }
  return JSON.stringify(merged);
}

/** カード作成 → 暗号化 → .mojicard をダウンロードする。 */
export async function downloadCard(): Promise<void> {
  const payload = collectSnapshot();
  const file = await encryptCard(payload);
  const blob = new Blob([JSON.stringify(file)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = cardFileName(payload.member.name);
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function cardFileName(name: string): string {
  const safe = name.replace(/[^\w぀-ヿ一-鿿-]/g, '_').slice(0, 24) || 'card';
  const d = new Date();
  const p = (n: number): string => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
  return `mojislot_${safe}_${stamp}.mojicard`;
}

/** ファイルを読み込み、復号・検証して CardPayload を返す（適用はしない）。 */
export async function readCard(file: File): Promise<CardPayload> {
  let raw: unknown;
  try {
    raw = JSON.parse(await file.text());
  } catch {
    throw new CardError('BAD_FORMAT', 'ファイルを読み取れませんでした（JSONとして不正）。');
  }
  const obj = await decryptCard(raw);
  const parsed = CardPayloadSchema.safeParse(obj);
  if (!parsed.success) {
    throw new CardError('BAD_FORMAT', 'カードの中身が想定の形式ではありません。');
  }
  return parsed.data;
}

export interface RestoreResult {
  replacedKeys: number;
  totalRuns: number;
}

/** カードを localStorage に適用する。進捗=置換 / runHistory=マージ+dedupe。 */
export function applyCard(payload: CardPayload): RestoreResult {
  let replacedKeys = 0;
  for (const [key, value] of Object.entries(payload.storage)) {
    if (key === RUN_HISTORY_KEY) continue; // runHistory は後でマージ
    try {
      localStorage.setItem(key, value);
      replacedKeys++;
    } catch {
      /* ignore */
    }
  }
  // runHistory はマージ + dedupe
  let totalRuns = 0;
  try {
    const merged = mergeRunHistory(
      localStorage.getItem(RUN_HISTORY_KEY),
      payload.storage[RUN_HISTORY_KEY],
    );
    localStorage.setItem(RUN_HISTORY_KEY, merged);
    totalRuns = (JSON.parse(merged) as unknown[]).length;
  } catch {
    /* ignore */
  }
  return { replacedKeys, totalRuns };
}

/** プレビュー用のカード要約（会員名・作成日・戦数・通算差枚）。 */
export function summarizeCard(payload: CardPayload): {
  name: string;
  createdAt: string;
  runCount: number;
  totalSahmai: number;
} {
  let runCount = 0;
  let totalSahmai = 0;
  try {
    const raw = payload.storage[FIXED_KEYS.runHistory];
    const arr = raw ? (JSON.parse(raw) as unknown[]) : [];
    if (Array.isArray(arr)) {
      runCount = arr.length;
      for (const r of arr) {
        const s = (r as { sahmai?: unknown }).sahmai;
        if (typeof s === 'number') totalSahmai += s;
      }
    }
  } catch {
    /* ignore */
  }
  return {
    name: payload.member.name,
    createdAt: payload.createdAt,
    runCount,
    totalSahmai,
  };
}
