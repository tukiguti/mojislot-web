/**
 * 外部音源（m4a）の読み込みと再生。
 *
 * SE と BGM の実音源はここが一手に持つ。`tools/convert_sounds.py` が
 * `public/audio/{sfx,bgm}/<スラッグ>.m4a` に書き出したものを、キー
 * `sfx/lever` のような **拡張子なしの相対パス**で引く。
 *
 * 読めなかったものは黙って null を返す——音が出ないだけで進行は止めない。
 * SfxEngine はその時オシレータ合成へ落ちるので、音源を消しても遊べる。
 */
export class SampleBank {
  private ctx: AudioContext | null = null;
  private readonly buffers = new Map<string, AudioBuffer>();
  /** 二重ロード防止。失敗も含めて1キー1回だけ取りに行く。 */
  private readonly inflight = new Map<string, Promise<AudioBuffer | null>>();

  /**
   * 音源URLの根。`import.meta.env.BASE_URL` を前置した値を起動時に `setBase` で
   * 入れ直す（配信先を変えてもここを直さずに済むように）。
   */
  private base: string;

  /** @param base 既定の根。実際の値は main.ts が `setBase` で上書きする。 */
  constructor(base: string) {
    this.base = base;
  }

  /** 音源URLの根を差し替える。読み込み前に呼ぶこと。 */
  setBase(base: string): void {
    this.base = base;
  }

  /** 共有 ctx を渡す。これより前の load は ctx 待ちで止まる。 */
  attach(ctx: AudioContext): void {
    this.ctx = ctx;
  }

  /** 読み込み済みバッファ。まだなら null。 */
  get(key: string): AudioBuffer | null {
    return this.buffers.get(key) ?? null;
  }

  /**
   * 読み込んでデコードする。同じキーへの多重呼び出しは1回にまとめる。
   * 失敗しても投げない（音源が無い環境でも動かすため）。
   */
  async load(key: string): Promise<AudioBuffer | null> {
    const cached = this.buffers.get(key);
    if (cached) return cached;
    const running = this.inflight.get(key);
    if (running) return running;

    const task = (async (): Promise<AudioBuffer | null> => {
      const ctx = this.ctx;
      if (!ctx) return null;
      try {
        const res = await fetch(`${this.base}${key}.m4a`);
        if (!res.ok) return null;
        const buf = await ctx.decodeAudioData(await res.arrayBuffer());
        this.buffers.set(key, buf);
        return buf;
      } catch {
        return null;
      }
    })();
    this.inflight.set(key, task);
    return task;
  }

  /** まとめて先読み。待たない使い方を想定している。 */
  async loadAll(keys: readonly string[]): Promise<void> {
    await Promise.all(keys.map((k) => this.load(k)));
  }

  /**
   * 1発鳴らす。**読めていなければ false** を返すので、呼び側は合成音へ落とせる。
   * @param delayMs 遅らせて鳴らす。払い出しの連打はこれで粒を並べる。
   */
  play(
    key: string,
    dest: AudioNode,
    opts: { gain?: number; delayMs?: number } = {},
  ): boolean {
    const ctx = this.ctx;
    const buf = this.buffers.get(key);
    if (!ctx || !buf) return false;
    const at = ctx.currentTime + (opts.delayMs ?? 0) / 1000;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const gain = opts.gain ?? 1;
    if (gain === 1) {
      src.connect(dest);
    } else {
      const g = ctx.createGain();
      g.gain.value = gain;
      src.connect(g).connect(dest);
    }
    src.start(at);
    return true;
  }

  /**
   * バッファの**実データ範囲**を秒で返す（無音でない最初と最後）。
   *
   * ループ用の BGM は頭も尻も無音ゼロで作ってあるが、AAC はエンコーダ遅延で
   * 先頭に無音が入り、末尾にもパディングが付く。そのまま loop させると
   * つなぎ目で数十msの空白が鳴る。ここで実データの端を拾って loopStart /
   * loopEnd に入れれば、フォーマットに関係なくつながる。
   */
  static dataRange(buf: AudioBuffer): [number, number] {
    const d = buf.getChannelData(0);
    let peak = 0;
    for (let i = 0; i < d.length; i++) {
      const a = Math.abs(d[i]);
      if (a > peak) peak = a;
    }
    const thr = peak * 0.005;
    let s = 0;
    while (s < d.length && Math.abs(d[s]) <= thr) s++;
    let e = d.length - 1;
    while (e > s && Math.abs(d[e]) <= thr) e--;
    return [s / buf.sampleRate, (e + 1) / buf.sampleRate];
  }
}

/** ゲーム全体で1つ。VoiceEngine と同じ `audio/` を根にする。 */
export const sampleBank = new SampleBank('audio/');
