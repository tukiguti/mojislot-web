/**
 * 会員の同一性（差枚ランキングの突合キー）。
 * 表示名の設定UIは会員カード作成（P6）で追加する。ここでは読み取りと初回ID生成のみ。
 */

const ID_KEY = 'mojislot.memberId.v1';
const NAME_KEY = 'mojislot.memberName.v1';
const SINCE_KEY = 'mojislot.memberSince.v1';
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
    // 券面に出す発行日。**IDを作った瞬間にだけ**記録する。
    // 後から埋めると実際とは違う日付になるので、記録の無い会員は「—」のままにする。
    localStorage.setItem(SINCE_KEY, new Date().toISOString());
    return id;
  } catch {
    // localStorage 不可の環境でも記録は進めたいので、その場限りのIDを返す
    return crypto.randomUUID();
  }
}

/**
 * 会員証の発行日（ISO文字列）。この項目が出来る前に発行された会員は持っていないので
 * null を返す。分からない日付を埋めるより空欄のほうが正しい。
 */
export function getMemberSince(): string | null {
  try {
    return localStorage.getItem(SINCE_KEY);
  } catch {
    return null;
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
