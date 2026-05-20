import { Observable } from '../lib/Observable';
import type { YakuList } from '../data/schemas';

/**
 * 図鑑（揃えた役の達成回数）の状態管理。
 * localStorage に永続化し、ページ再読込でも保持する。
 *
 * Phase 5 で Unity 移植する際は localStorage を PlayerPrefs に置き換える想定なので、
 * 永続化処理は load()/save() に閉じてある。
 */

const STORAGE_KEY_PREFIX = 'mojislot.zukan.v1';
const BITA_KEY = 'mojislot.bita.v1';

export type ZukanCounts = Readonly<Record<string, number>>;

export class ZukanState {
  readonly counts = new Observable<ZukanCounts>({});
  readonly bitaCount = new Observable<number>(0);
  private readonly storageKey: string;

  constructor(
    private readonly yakuList: YakuList,
    chapterId: string,
  ) {
    this.storageKey = `${STORAGE_KEY_PREFIX}.${chapterId}`;
    this.migrateLegacyIfNeeded(chapterId);
    this.counts.set(this.load());
    this.bitaCount.set(this.loadBita());
  }

  /** 旧キー（章なし）が残っていたら hiragana_food に1回だけ移行 */
  private migrateLegacyIfNeeded(chapterId: string): void {
    if (chapterId !== 'hiragana_food') return;
    try {
      const legacy = localStorage.getItem(STORAGE_KEY_PREFIX);
      if (legacy && !localStorage.getItem(this.storageKey)) {
        localStorage.setItem(this.storageKey, legacy);
        localStorage.removeItem(STORAGE_KEY_PREFIX);
      }
    } catch {
      /* ignore */
    }
  }

  record(yakuId: string): void {
    const prev = this.counts.get();
    const next: ZukanCounts = { ...prev, [yakuId]: (prev[yakuId] ?? 0) + 1 };
    this.counts.set(next);
    this.save(next);
  }

  recordBita(): void {
    const next = this.bitaCount.get() + 1;
    this.bitaCount.set(next);
    try {
      localStorage.setItem(BITA_KEY, String(next));
    } catch {
      /* 握りつぶし */
    }
  }

  private loadBita(): number {
    try {
      const raw = localStorage.getItem(BITA_KEY);
      if (!raw) return 0;
      const n = Number(raw);
      return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
    } catch {
      return 0;
    }
  }

  /** 各カテゴリの達成率（％、四捨五入）を返す */
  completionRate(): { core: number; premium: number; total: number } {
    const counts = this.counts.get();
    const coreTotal = this.yakuList.coreYaku.length;
    const premiumTotal = this.yakuList.premiumYaku.length;
    const coreDone = this.yakuList.coreYaku.filter((y) => (counts[y.id] ?? 0) > 0).length;
    const premiumDone = this.yakuList.premiumYaku.filter((y) => (counts[y.id] ?? 0) > 0).length;
    return {
      core: coreTotal === 0 ? 0 : Math.round((coreDone / coreTotal) * 100),
      premium: premiumTotal === 0 ? 0 : Math.round((premiumDone / premiumTotal) * 100),
      total:
        coreTotal + premiumTotal === 0
          ? 0
          : Math.round(((coreDone + premiumDone) / (coreTotal + premiumTotal)) * 100),
    };
  }

  reset(): void {
    this.counts.set({});
    this.save({});
    this.bitaCount.set(0);
    try {
      localStorage.removeItem(BITA_KEY);
    } catch {
      /* 握りつぶし */
    }
  }

  private load(): ZukanCounts {
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null) return {};
      const out: Record<string, number> = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
          out[k] = Math.floor(v);
        }
      }
      return out;
    } catch {
      return {};
    }
  }

  private save(counts: ZukanCounts): void {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(counts));
    } catch {
      // QuotaExceeded など。図鑑が失われるだけなので握りつぶす
    }
  }
}
