import { Observable } from '../lib/Observable';
import type { Quiz, Yaku, YakuList } from '../data/schemas';

/**
 * クイズ補助の状態管理（回答操作なし方式・2026-06-27〜）。
 *
 * コンセプト：「クイズの答え＝役（食べ物）の名前」。クイズ風の出題を液晶に出し、
 * プレイヤーは回答操作をせず、全停止後に答えと成立結果を提示する
 * （モバイルでの操作性優先・停止補助はaim＝狙えと同じ自動挙動）。
 * 提示した答えの役が SlipResolver の引き込み対象になる（17_assist-and-slip.md）。
 *
 *  1. reveal(quiz, yakuList): 問題を提示（phase='shown'）
 *  2. resolve(matched): 全停止後に的中判定と答えを表示（phase='resolved'）
 *  3. targetYakuId(): 演出中は答えの役ID（引き込み対象）。inactive では null
 *
 * 旧4択方式（asking/correct/wrong・タップ回答）は撤去。
 */
export type QuizPhase = 'inactive' | 'shown' | 'resolved';

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
  readonly matched = new Observable<boolean | null>(null);

  /** クイズ風演出を提示する（回答操作はなく、答えは全停止後に表示する）。 */
  reveal(quiz: Quiz, yakuList: YakuList): void {
    this.current.set(buildRenderedQuiz(quiz, yakuList));
    this.matched.set(null);
    this.phase.set('shown');
  }

  /** 全停止後の成立結果を確定し、答え表示へ移る。提示中以外の呼び出しは無視する。 */
  resolve(matched: boolean): void {
    if (this.phase.get() !== 'shown') return;
    this.matched.set(matched);
    this.phase.set('resolved');
  }

  reset(): void {
    this.current.set(null);
    this.matched.set(null);
    this.phase.set('inactive');
  }

  isActive(): boolean {
    return this.phase.get() !== 'inactive';
  }

  /** 演出中は答えの役IDを返す（引き込みターゲット）。inactive なら null */
  targetYakuId(): string | null {
    if (this.phase.get() === 'inactive') return null;
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
