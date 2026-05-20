/**
 * ジン（マスコット）のセリフ吹き出し。
 * イベントごとに 3〜5 候補からランダムで一言。
 * 演出エリア内に絶対配置し、1.8秒で自然に消える。
 */

export type JinSpeechEvent =
  | 'bet'
  | 'shisa'
  | 'quiz'
  | 'correct'
  | 'wrong'
  | 'win'
  | 'premium'
  | 'miss'
  | 'tenpai'
  | 'near';

const SPEECH_BY_EVENT: Record<JinSpeechEvent, readonly string[]> = {
  bet: ['いってみよう！', 'がんばれ〜', 'よし！'],
  shisa: ['！？', '何かありそう…', 'おっ？'],
  quiz: ['クイズだじょ〜', '考えるじょ〜', '正解わかる？'],
  correct: ['やった！', 'さすが！', 'いえい！'],
  wrong: ['残念…', 'おしい〜', 'まだまだ！'],
  win: ['揃った！', 'やったね！', 'いえ〜い！'],
  premium: ['すごい！！', 'プレミアム！！', '大当たり〜！'],
  miss: ['むむ…', '次がんばろ〜', 'うーん'],
  tenpai: ['きたーー！', 'リーチ！', 'ここだ！'],
  near: ['あぁ〜！', 'もうちょい！', 'おしぃ〜'],
};

export class JinSpeech {
  private readonly el: HTMLElement;
  private hideTimer: number | null = null;

  constructor(parent: HTMLElement) {
    const el = document.createElement('div');
    el.className = 'jin-speech';
    el.hidden = true;
    parent.appendChild(el);
    this.el = el;
  }

  say(eventKey: JinSpeechEvent): void {
    const lines = SPEECH_BY_EVENT[eventKey];
    if (lines.length === 0) return;
    const text = lines[Math.floor(Math.random() * lines.length)];
    this.show(text);
  }

  /** 任意の文字列で表示したい場合（チュートリアル等） */
  saySpecific(text: string): void {
    this.show(text);
  }

  private show(text: string): void {
    if (this.hideTimer !== null) {
      window.clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
    this.el.textContent = text;
    this.el.hidden = false;
    // クラスの付け外しを次フレームに分けることで CSS transition を確実に発火
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
}
