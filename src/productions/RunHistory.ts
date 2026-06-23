/**
 * 実戦履歴（差枚ランキングの正本）。1戦 = 計数で確定した1レコード。
 * localStorage に append-only で積む。集計（機械割・差枚/1000G）は派生で算出し保存しない。
 * 会員カードのエクスポート/インポート（P6）でこのキーをそのまま受け渡す。
 */

const STORAGE_KEY = 'mojislot.runHistory.v1';

export interface RunRecord {
  /** crypto.randomUUID() — インポート時の重複排除キー */
  runId: string;
  /** 会員同一性の突合キー */
  memberId: string;
  /** 確定時点の表示名スナップショット */
  memberName: string;
  /** 台識別 */
  chapterId: string;
  /** 戦開始 epoch ms（前回計数の直後 or ゲーム起動時） */
  startedAt: number;
  /** 計数を押した瞬間 epoch ms = 確定時刻 */
  settledAt: number;
  /** この戦の貸出累計（投資） */
  investment: number;
  /** 計数時の持メダル（回収） */
  payback: number;
  /** payback - investment（差枚, 負=負け） */
  sahmai: number;
  /** 戦内回転数 */
  spinCount: number;
  /** 戦内総BET（機械割の分母） */
  totalBet: number;
  /** 戦内総払い出し（機械割の分子） */
  totalWin: number;
  /** 戦内のBIG(プレミアム)回数 */
  premiumCount: number;
  /** 戦内のREG(ボーナス)回数 */
  bonusCount: number;
}

/** 履歴を読み込む。壊れていれば空配列にフォールバックする。 */
export function loadRunHistory(): RunRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (r): r is RunRecord =>
        typeof r === 'object' &&
        r !== null &&
        typeof r.runId === 'string' &&
        typeof r.sahmai === 'number',
    );
  } catch {
    return [];
  }
}

/**
 * 1戦を追記する。append-only（過去レコードは書き換えない）。
 * 容量超過などで保存できない場合は警告のみ出してゲーム進行は止めない。
 */
export function appendRunRecord(record: RunRecord): void {
  const history = loadRunHistory();
  history.push(record);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
  } catch (err) {
    console.warn('runHistory の保存に失敗しました（容量超過の可能性）:', err);
  }
}
