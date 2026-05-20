import { Observable } from '../lib/Observable';
import type { Quiz } from '../data/schemas';

/**
 * クイズ補助の状態管理。
 * 「演出 quiz が当たる → start() でクイズ表示 → answer() で正誤確定
 *   → リール始動時にスナップショット（correct/wrong）でリール速度を決定」の流れ。
 */
export type QuizPhase = 'inactive' | 'asking' | 'correct' | 'wrong';

export class QuizState {
  readonly phase = new Observable<QuizPhase>('inactive');
  readonly current = new Observable<Quiz | null>(null);

  start(quiz: Quiz): void {
    this.current.set(quiz);
    this.phase.set('asking');
  }

  answer(index: number): QuizPhase {
    const q = this.current.get();
    if (!q || this.phase.get() !== 'asking') return this.phase.get();
    const next: QuizPhase = index === q.correctIndex ? 'correct' : 'wrong';
    this.phase.set(next);
    return next;
  }

  /** リール始動時、未回答ならタイムアウト＝wrong 扱い */
  finalizeIfUnanswered(): void {
    if (this.phase.get() === 'asking') {
      this.phase.set('wrong');
    }
  }

  reset(): void {
    this.current.set(null);
    this.phase.set('inactive');
  }

  isCorrect(): boolean {
    return this.phase.get() === 'correct';
  }
}

/**
 * クイズ正解時の追加スロー（補助レベル+1）。
 * REEL_SPEED_BY_EFFECT.quiz (10) よりさらに遅いが、ビタ狙いが極端に易しすぎない値。
 */
export const QUIZ_BONUS_SPEED = 8;
