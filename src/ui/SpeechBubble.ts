/**
 * 出題者の吹き出し（DOM・液晶の中）。
 *
 * ジンが常駐していた頃は BET・テンパイ・役成立まで15種の台詞を持っていたが、
 * うち5種はどこからも呼ばれておらず、**最頻演出のクイズでは一言も喋っていなかった**
 * （[33] §5）。出題者へ置き換えるにあたって、喋る場面を出題／正解／不正解の
 * 3つに絞り、台詞そのものは人ごとのデータ（`data/quizmasters.ts`）へ移した。
 * ここに残すのは「文字を出して消す」だけ。
 */
export class SpeechBubble {
  private readonly el: HTMLElement;
  private hideTimer: number | null = null;

  constructor(parent: HTMLElement) {
    const el = document.createElement('div');
    el.className = 'speech-bubble';
    el.hidden = true;
    parent.appendChild(el);
    this.el = el;
  }

  show(text: string): void {
    this.clearTimer();
    this.el.textContent = text;
    this.el.hidden = false;
    // クラスの付け外しを次フレームに分けて CSS transition を確実に発火させる
    this.el.classList.remove('show');
    requestAnimationFrame(() => this.el.classList.add('show'));
    this.hideTimer = window.setTimeout(() => {
      this.el.classList.remove('show');
      this.hideTimer = window.setTimeout(() => {
        this.el.hidden = true;
        this.hideTimer = null;
      }, 240);
    }, 1700);
  }

  hide(): void {
    this.clearTimer();
    this.el.classList.remove('show');
    this.el.hidden = true;
  }

  private clearTimer(): void {
    if (this.hideTimer !== null) {
      window.clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
  }
}
