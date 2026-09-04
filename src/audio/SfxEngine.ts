/**
 * 効果音エンジン。
 *
 * **実音源があればそれを鳴らし、無ければオシレータで合成する**の二段構え。
 * 実音源は `public/audio/sfx/` に置いた m4a（`tools/convert_sounds.py` が変換）で、
 * 読めなかった時は合成音へ落ちる——音源を消しても遊べる状態を保つため。
 * 合成のほうは音源が揃う前の暫定ではなく、ベット音やリール停止音のように
 * **実音源を用意していない場面の本番**でもある。
 *
 * AudioContext は user gesture（最初のクリック等）で init() する必要があり、
 * BGM とは AudioBus 経由で同じものを共有する（AudioBuffer は ctx に紐づくため）。
 * muted ならノイズを出さない（フラグは外から制御）。
 */
import { audioContext, resumeAudio } from './AudioBus';
import { sampleBank } from './SampleBank';

/** 先読みする SE。合計 0.7MB ほどなので init 時に全部取りに行く。 */
const SFX_KEYS = [
  'sfx/lever',
  'sfx/wait',
  'sfx/coin',
  'sfx/count',
  'sfx/start_weak',
  'sfx/start_weak2',
  'sfx/start_strong',
  'sfx/clear_weak',
  'sfx/clear_strong',
  'sfx/clear_strong2',
  'sfx/fail',
  'sfx/big',
  'sfx/big2',
  'sfx/reg',
  'sfx/freeze',
] as const;

/**
 * 払い出し音の粒の間隔。素材そのものが 120ms 間隔の8連なので、それより長く取って
 * 粒が団子にならないようにしている。
 */
const PAYOUT_STEP_MS = 150;
/** 払い出し音の上限。ボーナス中の大量払い出しで延々鳴り続けないように。 */
const PAYOUT_MAX_SHOTS = 12;
/** 何枚ごとに1発鳴らすか。3枚＝1ゲームのベット枚数。 */
const PAYOUT_COINS_PER_SHOT = 3;

export class SfxEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private muted = false;

  /** user gesture から呼ぶこと。複数回呼んでも安全 */
  init(): void {
    if (this.ctx) {
      resumeAudio();
      return;
    }
    const ctx = audioContext();
    if (!ctx) return;
    this.ctx = ctx;
    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = 0.3;
    this.masterGain.connect(ctx.destination);
    // 音源の読み込みは待たない。届く前に鳴らした音は合成へ落ちるだけ。
    sampleBank.attach(ctx);
    void sampleBank.loadAll(SFX_KEYS);
  }

  /** BGM が同じ ctx を使うために公開する。init 前は null。 */
  context(): AudioContext | null {
    return this.ctx;
  }

  /**
   * 実音源を1発。**読めていなければ false**——呼び側はそのまま合成音へ落とす。
   * @param gain 素材はどれもピーク -1dB で揃っているので、場面ごとの重みはここで付ける。
   */
  private sample(name: string, gain: number, delayMs = 0): boolean {
    if (this.muted || !this.ctx || !this.masterGain) return false;
    return sampleBank.play(`sfx/${name}`, this.masterGain, { gain, delayMs });
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
    if (this.sample('lever', 0.8)) return;
    this.sweep({ startFreq: 180, endFreq: 600, durMs: 180, type: 'sawtooth', vol: 0.3 });
  }
  stop(): void {
    this.beep({ freq: 140, durMs: 90, type: 'square', vol: 0.45 });
  }
  bita(): void {
    this.beep({ freq: 1400, durMs: 110, type: 'sine', vol: 0.45 });
  }
  /**
   * 段階演出が1段上がる音。段が進むほど高くする。
   *
   * **停止音（stop）に重ねる**ので、単体で目立たせない——押した手応えの主役は
   * 停止音のほうで、こちらはその上に薄く乗る成分。音量を上げると押し心地が濁る。
   */
  stepUp(step: number): void {
    const freq = 520 + Math.max(0, step - 1) * 180;
    this.beep({ freq, durMs: 80, type: 'triangle', vol: 0.22 });
  }

  /**
   * 小役が揃った音。**ここは合成のまま**——「演出クリア弱」を当てると、
   * 演出が何もない普通の小役でもクリア音が鳴り、演出が成功した時との差が消える。
   * 揃った枚数は payout() の粒の数が伝える。
   */
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
  /**
   * 多重ライン HIT 用ファンファーレ。ライン本数で広がりを変える。
   * 2本: アルペジオ + 上昇 / 3本以上: 和音を二回叩いて高音まで駆け上がる。
   */
  winMulti(lineCount: number): void {
    if (this.sample('clear_strong', 0.8)) return;
    const tail = Math.min(lineCount, 5);
    const baseSeq = [
      { freq: 784, durMs: 70, type: 'square' as OscillatorType, vol: 0.4 },
      { freq: 988, durMs: 70, type: 'square' as OscillatorType, vol: 0.4 },
      { freq: 1175, durMs: 70, type: 'square' as OscillatorType, vol: 0.4 },
      { freq: 1568, durMs: 90, type: 'square' as OscillatorType, vol: 0.42 },
    ];
    const climb: { freq: number; durMs: number; type?: OscillatorType; vol?: number }[] =
      [];
    // 本数に応じて上方へ音階を積む（最大 5 本ぶん）
    for (let i = 0; i < tail; i++) {
      climb.push({
        freq: 1760 + i * 220,
        durMs: i === tail - 1 ? 380 : 90,
        type: 'sawtooth',
        vol: 0.42,
      });
    }
    this.sequence([...baseSeq, ...climb], 18);
  }
  winPremium(): void {
    if (this.sample('clear_strong2', 0.85)) return;
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
    if (this.sample('fail', 0.55)) return;
    this.beep({ freq: 180, durMs: 220, type: 'triangle', vol: 0.18 });
  }

  shisa(): void {
    if (this.sample('start_weak', 0.7)) return;
    this.sequence(
      [
        { freq: 784, durMs: 100, type: 'sine', vol: 0.35 },
        { freq: 1175, durMs: 140, type: 'sine', vol: 0.35 },
      ],
      40,
    );
  }
  quiz(): void {
    if (this.sample('start_weak2', 0.7)) return;
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
    if (this.sample('clear_weak', 0.7)) return;
    this.sequence(
      [
        { freq: 1175, durMs: 90, type: 'sine', vol: 0.4 },
        { freq: 1568, durMs: 220, type: 'sine', vol: 0.4 },
      ],
      30,
    );
  }
  quizWrong(): void {
    if (this.sample('fail', 0.55)) return;
    this.beep({ freq: 220, durMs: 280, type: 'sawtooth', vol: 0.28 });
  }
  tenpai(): void {
    if (this.sample('start_weak', 0.7)) return;
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
    if (this.sample('start_strong', 0.85)) return;
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
  /** 突入直前の「溜め」: 低→高へ駆け上がるチャージ音 */
  charge(): void {
    this.sweep({ startFreq: 180, endFreq: 1900, durMs: 620, type: 'sawtooth', vol: 0.34 });
  }
  /** 確定告知ランプ点灯音: 明るいきらめきチャイム */
  lamp(): void {
    this.sequence(
      [
        { freq: 1318, durMs: 90, type: 'sine', vol: 0.4 },
        { freq: 1760, durMs: 90, type: 'sine', vol: 0.4 },
        { freq: 2349, durMs: 280, type: 'sine', vol: 0.45 },
      ],
      30,
    );
  }
  /** フリーズ発生音: 重い停止音 → きらめく上昇 */
  freeze(): void {
    if (this.sample('freeze', 0.9)) return;
    this.beep({ freq: 70, durMs: 280, type: 'square', vol: 0.5 });
    this.sequence(
      [
        { freq: 1568, durMs: 90, type: 'sine', vol: 0.4 },
        { freq: 2093, durMs: 90, type: 'sine', vol: 0.4 },
        { freq: 2637, durMs: 220, type: 'sine', vol: 0.45 },
      ],
      45,
    );
  }
  /**
   * ボーナス突入ファンファーレ。
   *
   * **格の違いを音で出す**——通常のBIGは 5.3 秒の `big`、フリーズを経由した
   * 7揃いだけが 8.7 秒の `big2` を鳴らす。REG は別素材。
   * 引数なしで呼ぶと REG 相当（隠し章の解除音などに流用している）。
   */
  bonusEnter(kind: 'big' | 'reg' = 'reg', grand = false): void {
    const key = kind === 'big' ? (grand ? 'big2' : 'big') : 'reg';
    if (this.sample(key, 0.85)) return;
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

  /**
   * 払い出し音。**枚数ぶん粒を並べる**——3枚で1発、15枚なら5発。
   * 得た枚数が音の長さとして体に入るので、数字を読まなくても大きさが分かる。
   *
   * 素材（`coin`）自体が 120ms 間隔の8連で、それを 150ms ずらして重ねる。
   * 実音源が無い時は何もしない——役の成立音は winCore 側が別に鳴らしている。
   */
  payout(coins: number): void {
    if (coins <= 0) return;
    const shots = Math.min(
      PAYOUT_MAX_SHOTS,
      Math.ceil(coins / PAYOUT_COINS_PER_SHOT),
    );
    for (let i = 0; i < shots; i++) {
      if (!this.sample('coin', 0.5, i * PAYOUT_STEP_MS)) return;
    }
  }

  /** ウェイト音。前ゲームから間が空いていない時のレバーONに重ねる。 */
  wait(): void {
    this.sample('wait', 0.5);
  }

  /** 計数音。持メダルを流して1戦を締める時。 */
  count(): void {
    this.sample('count', 0.7);
  }
}
