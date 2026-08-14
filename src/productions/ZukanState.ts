import { Observable } from '../lib/Observable';
import { CHAPTERS } from '../data/chapters';
import { YakuListSchema, type YakuList } from '../data/schemas';

/**
 * 図鑑（揃えた役の達成回数）の状態管理。
 * localStorage に永続化し、ページ再読込でも保持する。
 *
 * Phase 5 で Unity 移植する際は localStorage を PlayerPrefs に置き換える想定なので、
 * 永続化処理は load()/save() に閉じてある。
 */

const STORAGE_KEY_PREFIX = 'mojislot.zukan.v1';
const BITA_KEY = 'mojislot.bita.v1';

/**
 * リミックス台の記録を入れる区画。
 *
 * 同じ「いわし」でも、寿司島で揃えたのとリミックス台で揃えたのは**別勘定**にする。
 * リミックス台はステージが勝手に入れ替わるので、島で集めた図鑑と混ぜると
 * 「いつの間にか埋まっていた」になり、集めた実感が薄まる。分けておくと
 * **リミックスだけで全5章を埋める**という別の目標が立つ。
 */
export const REMIX_ZUKAN_SCOPE = 'remix';

export type ZukanCounts = Readonly<Record<string, number>>;

/** 保存キー。区画が付くと別勘定になる（島＝区画なし／リミックス＝`remix`）。 */
const zukanKey = (chapterId: string, scope?: string): string =>
  scope
    ? `${STORAGE_KEY_PREFIX}.${scope}.${chapterId}`
    : `${STORAGE_KEY_PREFIX}.${chapterId}`;

const readCounts = (key: string): ZukanCounts => {
  try {
    const raw = localStorage.getItem(key);
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
};

/** 図鑑の対象役（1枚役は除く。狙って揃える役ではないため）。 */
const collectibleYaku = (list: YakuList) => [
  ...list.premiumYaku,
  ...list.bonusYaku,
  ...list.cherryYaku,
  ...list.coreYaku,
];

/**
 * リミックス区画の**全章まとめた**達成度。
 *
 * リミックス台はステージが入れ替わるので、開いている図鑑はそのステージの章だけになる。
 * それだけだと「リミックスで全章を埋める」という目標がどこにも見えないので、
 * 全章の合計を別に出す。章ごとの内訳も返す（どの章が残っているかが要る）。
 */
export function remixOverallCompletion(): {
  done: number;
  total: number;
  percent: number;
  perChapter: { id: string; name: string; done: number; total: number }[];
} {
  const perChapter = CHAPTERS.filter((c) => !c.hidden).map((c) => {
    const list = YakuListSchema.parse(c.yakuData);
    const all = collectibleYaku(list);
    const counts = readCounts(zukanKey(c.id, REMIX_ZUKAN_SCOPE));
    return {
      id: c.id,
      name: c.name,
      done: all.filter((y) => (counts[y.id] ?? 0) > 0).length,
      total: all.length,
    };
  });
  const done = perChapter.reduce((s, c) => s + c.done, 0);
  const total = perChapter.reduce((s, c) => s + c.total, 0);
  return {
    done,
    total,
    percent: total === 0 ? 0 : Math.round((done / total) * 100),
    perChapter,
  };
}

export class ZukanState {
  readonly counts = new Observable<ZukanCounts>({});
  readonly bitaCount = new Observable<number>(0);
  private readonly storageKey: string;

  /** この図鑑の区画（リミックス台なら `REMIX_ZUKAN_SCOPE`・島なら undefined）。 */
  readonly scope: string | undefined;

  constructor(
    private readonly yakuList: YakuList,
    chapterId: string,
    scope?: string,
  ) {
    this.scope = scope;
    this.storageKey = zukanKey(chapterId, scope);
    this.migrateLegacyIfNeeded(chapterId);
    this.counts.set(this.load());
    this.bitaCount.set(this.loadBita());
  }

  /** 旧キー（章なし）が残っていたら hiragana_food に1回だけ移行 */
  private migrateLegacyIfNeeded(chapterId: string): void {
    if (this.scope) return; // 別勘定の区画には旧データを流し込まない
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
    const all = collectibleYaku(this.yakuList);
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
    return readCounts(this.storageKey);
  }

  private save(counts: ZukanCounts): void {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(counts));
    } catch {
      // QuotaExceeded など。図鑑が失われるだけなので握りつぶす
    }
  }
}
