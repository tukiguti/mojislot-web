/**
 * 効果音エンジン（Web Audio API ベースの簡易シンセ）。
 *
 * - 外部音源ファイル不要：オシレータと ADSR でその場で合成
 * - AudioContext は user gesture（最初のクリック等）で init() する必要あり
 *   ブラウザの自動再生制限を回避するため、毎呼び出しは無視できる
 * - muted ならノイズを出さない（フラグは外から制御）
 */

export class SfxEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private muted = false;

  /** user gesture から呼ぶこと。複数回呼んでも安全 */
  init(): void {
    if (this.ctx) return;
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0.25;
    this.masterGain.connect(this.ctx.destination);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
  }

  isMuted(): boolean {
    return this.muted;
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    return this.muted;
  }

  // === 基本プリミティブ ===

  /** 単発トーン（ADSR 簡易版） */
  private beep(opts: {
    freq: number;
    durMs: number;
    type?: OscillatorType;
    vol?: number;
    attackMs?: number;
  }): void {
    if (this.muted || !this.ctx || !this.masterGain) return;
    const t = this.ctx.currentTime;
    const dur = opts.durMs / 1000;
    const attack = (opts.attackMs ?? 8) / 1000;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = opts.type ?? 'square';
    osc.frequency.value = opts.freq;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(opts.vol ?? 0.4, t + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(this.masterGain);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  /** 周波数スイープ（チャージ系） */
  private sweep(opts: {
    startFreq: number;
    endFreq: number;
    durMs: number;
    type?: OscillatorType;
    vol?: number;
  }): void {
    if (this.muted || !this.ctx || !this.masterGain) return;
    const t = this.ctx.currentTime;
    const dur = opts.durMs / 1000;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = opts.type ?? 'sawtooth';
    osc.frequency.setValueAtTime(opts.startFreq, t);
    osc.frequency.exponentialRampToValueAtTime(opts.endFreq, t + dur);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(opts.vol ?? 0.35, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(this.masterGain);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  /** 連続音のシーケンス（メロディ風） */
  private sequence(
    notes: { freq: number; durMs: number; type?: OscillatorType; vol?: number }[],
    gapMs = 30,
  ): void {
    if (this.muted) return;
    let delay = 0;
    for (const note of notes) {
      window.setTimeout(() => this.beep(note), delay);
      delay += note.durMs + gapMs;
    }
  }

  // === ゲーム用 SFX ===

  bet(): void {
    this.beep({ freq: 660, durMs: 70, type: 'square', vol: 0.3 });
  }
  lever(): void {
    this.sweep({ startFreq: 180, endFreq: 600, durMs: 180, type: 'sawtooth', vol: 0.3 });
  }
  stop(): void {
    this.beep({ freq: 140, durMs: 90, type: 'square', vol: 0.45 });
  }
  bita(): void {
    this.beep({ freq: 1400, durMs: 110, type: 'sine', vol: 0.45 });
  }

  winCore(): void {
    this.sequence(
      [
        { freq: 880, durMs: 100, type: 'square' },
        { freq: 1175, durMs: 100, type: 'square' },
        { freq: 1568, durMs: 250, type: 'square' },
      ],
      20,
    );
  }
  winPremium(): void {
    this.sequence(
      [
        { freq: 660, durMs: 100, type: 'sawtooth' },
        { freq: 880, durMs: 100, type: 'sawtooth' },
        { freq: 1175, durMs: 100, type: 'sawtooth' },
        { freq: 1568, durMs: 100, type: 'sawtooth' },
        { freq: 2093, durMs: 450, type: 'sawtooth' },
      ],
      25,
    );
  }
  miss(): void {
    this.beep({ freq: 180, durMs: 220, type: 'triangle', vol: 0.18 });
  }

  shisa(): void {
    this.sequence(
      [
        { freq: 784, durMs: 100, type: 'sine', vol: 0.35 },
        { freq: 1175, durMs: 140, type: 'sine', vol: 0.35 },
      ],
      40,
    );
  }
  quiz(): void {
    this.sequence(
      [
        { freq: 587, durMs: 80, type: 'square', vol: 0.35 },
        { freq: 740, durMs: 80, type: 'square', vol: 0.35 },
        { freq: 988, durMs: 80, type: 'square', vol: 0.35 },
        { freq: 1319, durMs: 220, type: 'square', vol: 0.35 },
      ],
      25,
    );
  }
  quizCorrect(): void {
    this.sequence(
      [
        { freq: 1175, durMs: 90, type: 'sine', vol: 0.4 },
        { freq: 1568, durMs: 220, type: 'sine', vol: 0.4 },
      ],
      30,
    );
  }
  quizWrong(): void {
    this.beep({ freq: 220, durMs: 280, type: 'sawtooth', vol: 0.28 });
  }
  tenpai(): void {
    this.sequence(
      [
        { freq: 698, durMs: 80, type: 'sine', vol: 0.35 },
        { freq: 880, durMs: 80, type: 'sine', vol: 0.35 },
        { freq: 1175, durMs: 280, type: 'sine', vol: 0.42 },
      ],
      20,
    );
  }
  tenpaiPremium(): void {
    this.sequence(
      [
        { freq: 523, durMs: 80, type: 'sawtooth', vol: 0.4 },
        { freq: 698, durMs: 80, type: 'sawtooth', vol: 0.4 },
        { freq: 880, durMs: 80, type: 'sawtooth', vol: 0.4 },
        { freq: 1175, durMs: 80, type: 'sawtooth', vol: 0.4 },
        { freq: 1568, durMs: 350, type: 'sawtooth', vol: 0.45 },
      ],
      20,
    );
  }
  bonusEnter(): void {
    this.sequence(
      [
        { freq: 523, durMs: 90, type: 'square', vol: 0.4 },
        { freq: 659, durMs: 90, type: 'square', vol: 0.4 },
        { freq: 784, durMs: 90, type: 'square', vol: 0.4 },
        { freq: 988, durMs: 90, type: 'square', vol: 0.4 },
        { freq: 1175, durMs: 90, type: 'square', vol: 0.4 },
        { freq: 1568, durMs: 90, type: 'square', vol: 0.4 },
        { freq: 2093, durMs: 500, type: 'square', vol: 0.4 },
      ],
      25,
    );
  }
}
