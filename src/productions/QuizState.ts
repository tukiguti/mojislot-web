import { Observable } from '../lib/Observable';
import type { Quiz, Yaku, YakuList } from '../data/schemas';

/**
 * クイズ補助の状態管理。
 *
 * コンセプト：「クイズの答え＝役（食べ物）の名前」。
 * 正解すると、その役を狙う引き込みが SlipResolver で強化される。
 *
 *  1. start(quiz, yakuList): yakuList から名前を引いて 4択をシャッフル生成
 *  2. answer(index): phase を correct/wrong に確定
 *  3. リール始動時、未回答ならタイムアウト＝wrong
 *  4. targetYakuId(): 正解時のみ、引き込み対象の役IDを返す
 */
export type QuizPhase = 'inactive' | 'asking' | 'correct' | 'wrong';

export interface RenderedQuiz {
  id: string;
  question: string;
  /** 表示順の選択肢ラベル（役の名前） */
  choices: string[];
  /** choices 配列内の正解インデックス */
  correctIndex: number;
  /** 正解の役ID（SlipResolver にそのまま渡せる） */
  targetYakuId: string;
}

export class QuizState {
  readonly phase = new Observable<QuizPhase>('inactive');
  readonly current = new Observable<RenderedQuiz | null>(null);

  start(quiz: Quiz, yakuList: YakuList): void {
    this.current.set(buildRenderedQuiz(quiz, yakuList));
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

  /** 正解時のみ、引き込みターゲットの役IDを返す。それ以外は null */
  targetYakuId(): string | null {
    if (!this.isCorrect()) return null;
    return this.current.get()?.targetYakuId ?? null;
  }
}

/**
 * クイズ正解時の追加スロー（補助レベル+1）。
 * REEL_SPEED_BY_EFFECT.quiz (15) より遅いが、間延びしない程度。
 */
export const QUIZ_BONUS_SPEED = 12;

function buildRenderedQuiz(quiz: Quiz, yakuList: YakuList): RenderedQuiz {
  const all: Yaku[] = [
    ...yakuList.coreYaku,
    ...yakuList.premiumYaku,
    ...yakuList.bonusYaku,
  ];
  const byId = new Map(all.map((y) => [y.id, y]));

  const correct = byId.get(quiz.answerYakuId);
  if (!correct) {
    throw new Error(`Quiz ${quiz.id}: answerYakuId "${quiz.answerYakuId}" not in YakuList`);
  }
  const decoys = quiz.decoyYakuIds.map((id) => {
    const y = byId.get(id);
    if (!y) {
      throw new Error(`Quiz ${quiz.id}: decoyYakuId "${id}" not in YakuList`);
    }
    return y;
  });

  const ordered = shuffle([correct, ...decoys]);
  const correctIndex = ordered.findIndex((y) => y.id === correct.id);
  return {
    id: quiz.id,
    question: quiz.question,
    choices: ordered.map((y) => y.name),
    correctIndex,
    targetYakuId: correct.id,
  };
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
