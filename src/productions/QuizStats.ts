import { Observable } from '../lib/Observable';
import type { Quiz } from '../data/schemas';

/**
 * クイズの**問題ごと**の成績。
 *
 * 全体の的中率（`PlayStats.quizRate`）は「クイズが得意か」しか映さない。
 * 落としているのが特定の問題に偏っているのか、まんべんなく外しているのかが
 * 分からないので、**同じ問題をまた落とす**のを止めようがなかった。
 *
 * クイズは答えの役を引き込み対象にする演出なので、外す＝取りこぼし＝出玉。
 * どの問題で落としているかが分かれば、そこだけ覚えて直せる。
 *
 * **章ごとに1つ**の記録にする（図鑑と違ってリミックス台でも分けない）。
 * 図鑑を分けたのは「集める」目標を別に立てるためだったが、こちらは
 * **苦手を潰す**ための記録なので、打った場所で分断すると用を成さない。
 */

const KEY_PREFIX = 'mojislot.quizStats.v1';

/** 1問ぶんの成績。 */
export interface QuizRecord {
  /** 出題された回数。 */
  seen: number;
  /** そのうち答えの役を揃えられた回数。 */
  correct: number;
}

export type QuizCounts = Readonly<Record<string, QuizRecord>>;

/**
 * 率が読める最低の母数。
 *
 * データカウンターの演出率と同じ考え方で、**母数が足りない率は率として見せない**。
 * 1回外しただけの問題が「的中率0%・最も苦手」として一覧の先頭に来ると、
 * 本当に苦手な問題が下に埋もれる。
 */
export const MIN_SAMPLES = 3;

export class QuizStats {
  readonly counts = new Observable<QuizCounts>({});
  private readonly storageKey: string;

  constructor(chapterId: string) {
    this.storageKey = `${KEY_PREFIX}.${chapterId}`;
    this.counts.set(this.load());
  }

  record(quizId: string, correct: boolean): void {
    const prev = this.counts.get();
    const cur = prev[quizId] ?? { seen: 0, correct: 0 };
    const next: QuizCounts = {
      ...prev,
      [quizId]: {
        seen: cur.seen + 1,
        correct: cur.correct + (correct ? 1 : 0),
      },
    };
    this.counts.set(next);
    this.save(next);
  }

  get(quizId: string): QuizRecord | null {
    return this.counts.get()[quizId] ?? null;
  }

  /**
   * 苦手な順に並べた一覧。**出題されたことのある問題だけ**返す。
   *
   * 未出題の問題文を先に見せない（図鑑で未成立の役を伏せているのと同じ理由——
   * 出会う前に答えを読めてしまうと、その1問が演出として死ぬ）。
   *
   * 並びは「まず母数の足りている問題を的中率の低い順」、そのあと
   * 「母数の足りない問題を誤答数の多い順」。読める数字を上に置く。
   */
  weakest(quizzes: readonly Quiz[]): {
    quiz: Quiz;
    seen: number;
    correct: number;
    /** 的中率（0〜1）。母数が足りていても率は率なので、表示側で母数を添える。 */
    rate: number;
    /** 率として読める母数があるか。 */
    reliable: boolean;
  }[] {
    const counts = this.counts.get();
    return quizzes
      .map((quiz) => {
        const rec = counts[quiz.id];
        if (!rec || rec.seen === 0) return null;
        return {
          quiz,
          seen: rec.seen,
          correct: rec.correct,
          rate: rec.correct / rec.seen,
          reliable: rec.seen >= MIN_SAMPLES,
        };
      })
      .filter((v): v is NonNullable<typeof v> => v !== null)
      .sort((a, b) => {
        if (a.reliable !== b.reliable) return a.reliable ? -1 : 1;
        if (a.rate !== b.rate) return a.rate - b.rate;
        return b.seen - a.seen;
      });
  }

  /** 出題されたことのある問題数と、全問題数。 */
  coverage(quizzes: readonly Quiz[]): { seen: number; total: number } {
    const counts = this.counts.get();
    return {
      seen: quizzes.filter((q) => (counts[q.id]?.seen ?? 0) > 0).length,
      total: quizzes.length,
    };
  }

  reset(): void {
    this.counts.set({});
    this.save({});
  }

  private load(): QuizCounts {
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (!raw) return {};
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null) return {};
      const out: Record<string, QuizRecord> = {};
      for (const [id, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof v !== 'object' || v === null) continue;
        const { seen, correct } = v as Record<string, unknown>;
        if (typeof seen !== 'number' || typeof correct !== 'number') continue;
        if (!Number.isFinite(seen) || seen <= 0) continue;
        // 的中数が出題数を超えている記録は壊れているので落とす。
        out[id] = {
          seen: Math.floor(seen),
          correct: Math.max(0, Math.min(Math.floor(seen), Math.floor(correct))),
        };
      }
      return out;
    } catch {
      return {};
    }
  }

  private save(counts: QuizCounts): void {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(counts));
    } catch {
      /* 記録が失われるだけなので握りつぶす */
    }
  }
}
