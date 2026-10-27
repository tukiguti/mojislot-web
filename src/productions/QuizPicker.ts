import type { Quiz } from '../data/schemas';

/**
 * クイズの出題順。答えの役ごとに、その役の問題を**全部出し切るまで同じ問題を繰り返さない**。
 *
 * 以前は `quizzes.find(answerYakuId)` で、役ごとに最初の1問しか出ていなかった
 * （21問あっても実際に出るのは役の数の8問だけ）。役ごとに袋（シャッフルした山）を持ち、
 * 空になったら引き直す。引き直した直後に前回と同じ問題が続かないよう、頭を入れ替える。
 *
 * 島を変えたら問題の一覧ごと変わるので、そのたびに作り直す。
 */
export class QuizPicker {
  private readonly bags = new Map<string, Quiz[]>();
  private readonly last = new Map<string, string>();

  constructor(
    private readonly quizzes: readonly Quiz[],
    private readonly random: () => number = Math.random,
  ) {}

  /** 答えが yakuId の問題を1つ出す。その役の問題が無ければ null。 */
  pick(yakuId: string): Quiz | null {
    let bag = this.bags.get(yakuId);
    if (!bag || bag.length === 0) {
      const pool = this.quizzes.filter((q) => q.answerYakuId === yakuId);
      if (pool.length === 0) return null;
      bag = this.shuffle(pool);
      // 袋は末尾から出す。引き直した最初の1問が前回と同じなら、先頭と入れ替える
      const prev = this.last.get(yakuId);
      if (bag.length > 1 && bag[bag.length - 1].id === prev) {
        [bag[0], bag[bag.length - 1]] = [bag[bag.length - 1], bag[0]];
      }
      this.bags.set(yakuId, bag);
    }
    const quiz = bag.pop() as Quiz;
    this.last.set(yakuId, quiz.id);
    return quiz;
  }

  private shuffle(list: readonly Quiz[]): Quiz[] {
    const a = [...list];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
}
