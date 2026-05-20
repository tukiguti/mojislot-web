import type { QuizState } from '../productions/QuizState';

/**
 * クイズ4択モーダルの DOM 操作。
 * #quiz-overlay を visible/hidden 切替し、選択肢ボタンを動的生成する。
 */
export class QuizOverlay {
  private readonly root: HTMLElement;
  private readonly choicesEl: HTMLElement;
  private readonly resultEl: HTMLElement;
  /** 回答後にモーダルを自動で閉じるためのタイマー */
  private dismissTimer: number | null = null;

  /** 回答後の自動クローズまでの遅延（ms） */
  private static readonly AUTO_DISMISS_MS = 1200;

  constructor(private readonly state: QuizState) {
    const root = document.getElementById('quiz-overlay');
    if (!root) throw new Error('#quiz-overlay not found');
    this.root = root;
    // 質問文は Pixi 側（QuizQuestionView）の液晶エリアに表示するため、
    // ここでは出さず 4択ボタンと結果のみ。
    this.root.innerHTML = `
      <div class="quiz-modal">
        <div class="quiz-choices"></div>
        <div class="quiz-result"></div>
      </div>
    `;
    this.choicesEl = this.root.querySelector('.quiz-choices')!;
    this.resultEl = this.root.querySelector('.quiz-result')!;

    state.phase.subscribe((phase) => this.render(phase));
  }

  private render(phase: ReturnType<QuizState['phase']['get']>): void {
    if (phase === 'inactive') {
      this.cancelDismiss();
      this.root.hidden = true;
      this.resultEl.textContent = '';
      this.resultEl.className = 'quiz-result';
      return;
    }

    const quiz = this.state.current.get();
    if (!quiz) return;

    // 新たに asking 状態に入る時は前回の自動クローズタイマーをキャンセル
    this.cancelDismiss();
    this.root.hidden = false;
    // 質問文の表示は QuizQuestionView（Pixi）側に移管したため、ここでは触れない

    if (phase === 'asking') {
      this.resultEl.textContent = '';
      this.resultEl.className = 'quiz-result';
      this.choicesEl.innerHTML = '';
      quiz.choices.forEach((choice, i) => {
        const btn = document.createElement('button');
        btn.className = 'quiz-choice';
        btn.textContent = `${i + 1}. ${choice}`;
        btn.dataset.index = String(i);
        btn.addEventListener('click', () => this.state.answer(i));
        this.choicesEl.appendChild(btn);
      });
    } else {
      // correct / wrong: ボタンを無効化して正解強調
      const btns = this.choicesEl.querySelectorAll<HTMLButtonElement>('.quiz-choice');
      btns.forEach((btn) => {
        btn.disabled = true;
        const i = Number(btn.dataset.index);
        if (i === quiz.correctIndex) btn.classList.add('correct');
      });
      const answer = quiz.choices[quiz.correctIndex];
      if (phase === 'correct') {
        this.resultEl.textContent = `正解！「${answer}」を狙え！`;
        this.resultEl.classList.add('correct');
      } else {
        this.resultEl.textContent = `不正解… 正解は「${answer}」`;
        this.resultEl.classList.add('wrong');
      }
      // 結果を見せた後はモーダル本体を自動で閉じる（QuizState の phase 自体は次の reset まで保持）
      this.dismissTimer = window.setTimeout(() => {
        this.root.hidden = true;
        this.dismissTimer = null;
      }, QuizOverlay.AUTO_DISMISS_MS);
    }
  }

  private cancelDismiss(): void {
    if (this.dismissTimer !== null) {
      window.clearTimeout(this.dismissTimer);
      this.dismissTimer = null;
    }
  }

  /** 外部から強制的にモーダルを閉じる（pullLever 時の安全策など） */
  dismiss(): void {
    this.cancelDismiss();
    this.root.hidden = true;
  }

  /** キー入力で 1〜4 を回答に流す。inactive/asking 以外では何もしない */
  handleKey(key: string): boolean {
    if (this.state.phase.get() !== 'asking') return false;
    const idx = ['1', '2', '3', '4'].indexOf(key);
    if (idx === -1) return false;
    this.state.answer(idx);
    return true;
  }
}
