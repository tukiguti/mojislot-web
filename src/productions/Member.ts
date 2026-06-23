/**
 * 会員の同一性（差枚ランキングの突合キー）。
 * 表示名の設定UIは会員カード作成（P6）で追加する。ここでは読み取りと初回ID生成のみ。
 */

const ID_KEY = 'mojislot.memberId.v1';
const NAME_KEY = 'mojislot.memberName.v1';
const DEFAULT_NAME = 'ゲスト';

/**
 * 会員ID（UUID）。未生成なら初回に1度だけ発行して永続化する。
 * RunRecord の memberId・会員カードの突合に使う。
 */
export function getMemberId(): string {
  try {
    const existing = localStorage.getItem(ID_KEY);
    if (existing) return existing;
    const id = crypto.randomUUID();
    localStorage.setItem(ID_KEY, id);
    return id;
  } catch {
    // localStorage 不可の環境でも記録は進めたいので、その場限りのIDを返す
    return crypto.randomUUID();
  }
}

/** 表示名。未設定なら既定名。会員カード作成で上書きされる。 */
export function getMemberName(): string {
  try {
    return localStorage.getItem(NAME_KEY) || DEFAULT_NAME;
  } catch {
    return DEFAULT_NAME;
  }
}

/** 表示名を設定する。空文字なら既定名に戻す（キー削除）。 */
export function setMemberName(name: string): void {
  try {
    const trimmed = name.trim();
    if (trimmed) localStorage.setItem(NAME_KEY, trimmed);
    else localStorage.removeItem(NAME_KEY);
  } catch {
    /* ignore */
  }
}
