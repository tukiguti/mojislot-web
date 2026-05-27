/**
 * BGM エンジン（Web Audio API ベースの簡易ループ）。
 *
 * - 外部音源ファイル不要：オシレータでメロディを構築し、AudioBufferSourceNode で
 *   loop:true 再生する
 * - 通常 BGM（軽快なポップ）/ ボーナス BGM（高揚感のあるアップテンポ）の 2 系統
 * - SfxEngine と同じ AudioContext を共有することも可能だが、独立 ctx の方が
 *   gain 制御がシンプル
 * - mute は SfxEngine と共通 UI で扱う（外から setMuted で同期）
 */

export type BgmTrack = 'normal' | 'bonus';

interface NoteSpec {
  /** 周波数 (Hz)。0 は休符 */
  freq: number;
  /** 拍数（基準: 1拍 = 0.25秒） */
  beats: number;
}

/**
 * 通常 BGM のメロディ（軽快な8小節）。テンポ 120 BPM 想定。
 * 簡単な C メジャー進行で長く聴いても飽きにくいフレーズに留める。
 */
const NORMAL_MELODY: NoteSpec[] = [
  { freq: 523, beats: 1 }, // C5
  { freq: 659, beats: 1 }, // E5
  { freq: 784, beats: 1 }, // G5
  { freq: 659, beats: 1 }, // E5
  { freq: 587, beats: 1 }, // D5
  { freq: 698, beats: 1 }, // F5
  { freq: 880, beats: 1 }, // A5
  { freq: 698, beats: 1 }, // F5
  { freq: 523, beats: 1 }, // C5
  { freq: 784, beats: 1 }, // G5
  { freq: 1047, beats: 1 }, // C6
  { freq: 784, beats: 1 }, // G5
  { freq: 659, beats: 2 }, // E5
  { freq: 523, beats: 2 }, // C5
];

/**
 * ボーナス BGM。テンポを上げて、高音中心のフレーズで「当たり中感」を演出。
 */
const BONUS_MELODY: NoteSpec[] = [
  { freq: 880, beats: 0.5 }, // A5
  { freq: 1047, beats: 0.5 }, // C6
  { freq: 1319, beats: 0.5 }, // E6
  { freq: 1047, beats: 0.5 }, // C6
  { freq: 988, beats: 0.5 }, // B5
  { freq: 1175, beats: 0.5 }, // D6
  { freq: 1568, beats: 0.5 }, // G6
  { freq: 1175, beats: 0.5 }, // D6
  { freq: 880, beats: 0.5 }, // A5
  { freq: 1175, beats: 0.5 }, // D6
  { freq: 1760, beats: 0.5 }, // A6
  { freq: 1319, beats: 0.5 }, // E6
  { freq: 1047, beats: 1 }, // C6
  { freq: 1319, beats: 1 }, // E6
];

/** 拍 → 秒（テンポ 120BPM = 1拍 0.5s だが本実装は 1拍 0.25s 基準） */
const BEAT_SEC_NORMAL = 0.28;
const BEAT_SEC_BONUS = 0.18;

export class BgmEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private currentSource: AudioBufferSourceNode | null = null;
  private currentTrack: BgmTrack | null = null;
  /** init 前に play() が呼ばれた場合に保留するトラック */
  private pendingTrack: BgmTrack | null = null;
  private muted = false;
  private targetVolume = 0.12;

  init(): void {
    if (!this.ctx) {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.muted ? 0 : this.targetVolume;
      this.masterGain.connect(this.ctx.destination);
    }
    // 自動再生制限で suspended のままなら、user gesture 内で resume
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    // 保留中のトラックがあれば再生開始
    if (this.pendingTrack !== null) {
      const t = this.pendingTrack;
      this.pendingTrack = null;
      this.play(t);
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.masterGain && this.ctx) {
      // 即座にミュート（クリック音回避のため短いランプ）
      const t = this.ctx.currentTime;
      this.masterGain.gain.cancelScheduledValues(t);
      this.masterGain.gain.linearRampToValueAtTime(
        muted ? 0 : this.targetVolume,
        t + 0.05,
      );
    }
  }

  /**
   * 指定トラックを再生（既に同じトラック再生中なら何もしない）。
   * ctx 未初期化の場合は pendingTrack に保留し、init() 呼び出し時に開始する。
   * user gesture 前に呼ばれてもオーディオ自動再生制限を回避できる。
   */
  play(track: BgmTrack): void {
    if (this.currentTrack === track) return;
    if (!this.ctx || !this.masterGain) {
      this.pendingTrack = track;
      return;
    }
    this.stop();
    const buffer = this.renderTrackToBuffer(track);
    if (!buffer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.connect(this.masterGain);
    src.start();
    this.currentSource = src;
    this.currentTrack = track;
  }

  /** 再生停止（ctx は残す） */
  stop(): void {
    if (this.currentSource) {
      try {
        this.currentSource.stop();
      } catch {
        /* already stopped */
      }
      this.currentSource.disconnect();
      this.currentSource = null;
    }
    this.currentTrack = null;
  }

  /**
   * メロディ配列を AudioBuffer に焼き付ける（loop 用）。
   * 各音は短いアタック + 持続 + 短いリリースの簡易エンベロープ。
   * サイン波 + 軽い倍音で柔らかい音色。
   */
  private renderTrackToBuffer(track: BgmTrack): AudioBuffer | null {
    if (!this.ctx) return null;
    const melody = track === 'bonus' ? BONUS_MELODY : NORMAL_MELODY;
    const beatSec = track === 'bonus' ? BEAT_SEC_BONUS : BEAT_SEC_NORMAL;
    const totalSec = melody.reduce((s, n) => s + n.beats * beatSec, 0);
    const sampleRate = this.ctx.sampleRate;
    const buffer = this.ctx.createBuffer(
      1,
      Math.ceil(totalSec * sampleRate),
      sampleRate,
    );
    const data = buffer.getChannelData(0);

    let cursor = 0;
    for (const note of melody) {
      const dur = note.beats * beatSec;
      const samples = Math.floor(dur * sampleRate);
      if (note.freq === 0) {
        cursor += samples;
        continue;
      }
      const omega = 2 * Math.PI * note.freq;
      const attackSamples = Math.min(samples, Math.floor(sampleRate * 0.012));
      const releaseSamples = Math.min(samples, Math.floor(sampleRate * 0.04));
      const sustainStart = attackSamples;
      const releaseStart = samples - releaseSamples;
      const baseVol = 0.32;
      for (let i = 0; i < samples; i++) {
        const t = i / sampleRate;
        // 基音 + 2 倍音（弱め）でわずかに厚みを出す
        const sample =
          Math.sin(omega * t) * 0.75 + Math.sin(omega * 2 * t) * 0.18;
        // エンベロープ
        let env = baseVol;
        if (i < sustainStart) env *= i / attackSamples;
        else if (i >= releaseStart) env *= (samples - i) / releaseSamples;
        data[cursor + i] = sample * env;
      }
      cursor += samples;
    }
    return buffer;
  }
}
