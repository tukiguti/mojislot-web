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

  /**
   * 図鑑の達成率。**成立する表示役すべて**が対象で、BIG・REG・チェリー・小役を数える。
   *
   * 1枚役（`singleYaku`）だけは外す。当選役を引き込めなかった時のこぼし先で、
   * 狙って揃える役ではないため集める対象にならない。
   *
   * 分子と分母も返す。カテゴリ別の内訳は図鑑の見出しに出ており、
   * 率だけだと見出しの合計と突き合わせられない。
   */
  completionRate(): { done: number; total: number; percent: number } {
    const counts = this.counts.get();
    const all = [
      ...this.yakuList.premiumYaku,
      ...this.yakuList.bonusYaku,
      ...this.yakuList.cherryYaku,
      ...this.yakuList.coreYaku,
    ];
    const done = all.filter((y) => (counts[y.id] ?? 0) > 0).length;
    return {
      done,
      total: all.length,
      percent: all.length === 0 ? 0 : Math.round((done / all.length) * 100),
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
