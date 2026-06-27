import { Observable } from '../lib/Observable';
import type { Quiz, Yaku, YakuList } from '../data/schemas';

/**
 * クイズ補助の状態管理（「見せるだけ」方式・2026-06-27〜）。
 *
 * コンセプト：「クイズの答え＝役（食べ物）の名前」。クイズ風の出題を液晶に出し、
 * 答えを自動提示する。プレイヤーは回答操作をしない（モバイルでの操作性優先・aim＝狙えと同じ自動挙動）。
 * 提示した答えの役が SlipResolver の引き込み対象になる（17_assist-and-slip.md）。
 *
 *  1. reveal(quiz, yakuList): yakuList から答えの役を引いて出題＋答えを提示（phase='shown'）
 *  2. targetYakuId(): 提示中は答えの役ID（引き込み対象）。inactive では null
 *
 * 旧4択方式（asking/correct/wrong・タップ回答）は撤去。
 */
export type QuizPhase = 'inactive' | 'shown';

export interface RenderedQuiz {
  id: string;
  question: string;
  /** 答えの役の名前（表示用） */
  answer: string;
  /** 答えの役ID（SlipResolver にそのまま渡せる） */
  targetYakuId: string;
}

export class QuizState {
  readonly phase = new Observable<QuizPhase>('inactive');
  readonly current = new Observable<RenderedQuiz | null>(null);

  /** クイズ風演出を提示する（出題＋答えを自動オープン、回答操作なし）。 */
  reveal(quiz: Quiz, yakuList: YakuList): void {
    this.current.set(buildRenderedQuiz(quiz, yakuList));
    this.phase.set('shown');
  }

  reset(): void {
    this.current.set(null);
    this.phase.set('inactive');
  }

  isActive(): boolean {
    return this.phase.get() === 'shown';
  }

  /** 提示中は答えの役IDを返す（引き込みターゲット）。inactive なら null */
  targetYakuId(): string | null {
    if (this.phase.get() !== 'shown') return null;
    return this.current.get()?.targetYakuId ?? null;
  }
}

function buildRenderedQuiz(quiz: Quiz, yakuList: YakuList): RenderedQuiz {
  const all: Yaku[] = [
    ...yakuList.coreYaku,
    ...yakuList.premiumYaku,
    ...yakuList.bonusYaku,
    ...yakuList.cherryYaku,
  ];
  const byId = new Map(all.map((y) => [y.id, y]));

  const answer = byId.get(quiz.answerYakuId);
  if (!answer) {
    throw new Error(`Quiz ${quiz.id}: answerYakuId "${quiz.answerYakuId}" not in YakuList`);
  }
  return {
    id: quiz.id,
    question: quiz.question,
    answer: answer.name,
    targetYakuId: answer.id,
  };
}
