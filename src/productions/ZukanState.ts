import { Observable } from '../lib/Observable';
import type { YakuList } from '../data/schemas';

/**
 * 図鑑（揃えた役の達成回数）の状態管理。
 * localStorage に永続化し、ページ再読込でも保持する。
 *
 * Phase 5 で Unity 移植する際は localStorage を PlayerPrefs に置き換える想定なので、
 * 永続化処理は load()/save() に閉じてある。
 */

const STORAGE_KEY = 'mojislot.zukan.v1';

export type ZukanCounts = Readonly<Record<string, number>>;

export class ZukanState {
  readonly counts = new Observable<ZukanCounts>({});

  constructor(private readonly yakuList: YakuList) {
    this.counts.set(this.load());
  }

  record(yakuId: string): void {
    const prev = this.counts.get();
    const next: ZukanCounts = { ...prev, [yakuId]: (prev[yakuId] ?? 0) + 1 };
    this.counts.set(next);
    this.save(next);
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
  }

  private load(): ZukanCounts {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
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
      localStorage.setItem(STORAGE_KEY, JSON.stringify(counts));
    } catch {
      // QuotaExceeded など。図鑑が失われるだけなので握りつぶす
    }
  }
}
