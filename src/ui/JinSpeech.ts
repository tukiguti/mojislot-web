/**
 * ジン（マスコット）のセリフ吹き出し。
 * イベントごとに 3〜5 候補からランダムで一言。
 * 演出エリア内に絶対配置し、1.8秒で自然に消える。
 */

export type JinSpeechEvent =
  | 'bet'
  | 'shisa'
  // 示唆の期待度tier別（青→金で煽り強化）
  | 'shisaWeak' // 青
  | 'shisaMid' // 黄
  | 'shisaStrong' // 緑（小役濃厚）
  | 'shisaBonus' // 赤（RB期待）
  | 'shisaPremium' // 金（激アツ・BB）
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
  shisaWeak: ['ん？', '何かあるかも？', 'おや？'],
  shisaMid: ['おっ？', 'ちょっと期待！', 'んん？'],
  shisaStrong: ['これは…！', '小役きそう！', 'いい予感！'],
  shisaBonus: ['ボーナスの予感！', 'アツいじょ〜！', 'RB狙えるじょ！'],
  shisaPremium: ['激アツだじょ！！', '大当たりの予感！！', 'ビッグ来るじょ〜！！'],
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
  /** true の間は say()/saySpecific() を無視し、表示中の吹き出しも消す。
   *  クイズ・カットイン等の大型演出中にジン本体と一緒に引っ込めるために使う。 */
  private suppressed = false;

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

  /** 即座に吹き出しを隠す（クイズ・カットイン等、他演出と被るときに使う）。 */
  hide(): void {
    if (this.hideTimer !== null) {
      window.clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
    this.el.classList.remove('show');
    this.el.hidden = true;
  }

  /** 抑制状態を切り替える。true にすると以後の say() を無視し、表示中なら即座に消す。 */
  setSuppressed(value: boolean): void {
    this.suppressed = value;
    if (value) this.hide();
  }

  private show(text: string): void {
    // 大型演出中（抑制中）は一切表示しない。遷移後に say() が呼ばれても再表示させない。
    if (this.suppressed) return;
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
