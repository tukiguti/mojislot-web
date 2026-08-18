/**
 * 出題者のボイス再生。
 *
 * **このゲームで唯一の外部音源**。SE と BGM はオシレータ合成（`SfxEngine` /
 * `BgmEngine`）で音源ファイルを持たないが、人の声だけは合成では作れない。
 * VOICEVOX で作った m4a を `tools/gen_voice.py` が書き出す。
 *
 * 島ごとに別人なので、**現在の島のぶんだけ**先読みする（1人12本・約170KB）。
 * 全員ぶんは60本・約830KBあり、最初に全部読むのは重い。
 *
 * ミュートは SE と同じ操作でまとめて切り替える（`main.ts` の updateMuteUI）。
 */
export class VoiceEngine {
  private readonly base: string;
  /** `<章ID>/<場面>_<添字>` → 要素。作り直すと先読みが無駄になるので使い回す。 */
  private readonly clips = new Map<string, HTMLAudioElement>();
  private chapterId: string | null = null;
  private current: HTMLAudioElement | null = null;
  private muted = false;

  /** @param base 音源URLの根（`audio/`）。 */
  constructor(base: string) {
    this.base = base;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (muted) this.stop();
  }

  /**
   * その島の出題者のボイスを先読みする。台替わり（リミックス）でも呼ぶ。
   * 待たない——読めていなければ `play` が鳴らさないだけで、進行は止めない。
   */
  preload(chapterId: string, names: readonly string[]): void {
    this.chapterId = chapterId;
    for (const name of names) this.element(chapterId, name);
  }

  /**
   * 台詞を鳴らす。`index` は `pickLine` が返した添字で、**字幕と同じ台詞**を指す。
   * 前の声が残っていれば止める（重なると何を言っているか分からなくなる）。
   */
  play(scene: string, index: number): void {
    if (this.muted || !this.chapterId) return;
    const el = this.element(this.chapterId, `${scene}_${index}`);
    this.stop();
    el.currentTime = 0;
    // 自動再生を止められた時など、鳴らないだけで進行に影響させない。
    void el.play().catch(() => undefined);
    this.current = el;
  }

  stop(): void {
    if (!this.current) return;
    this.current.pause();
    this.current = null;
  }

  private element(chapterId: string, name: string): HTMLAudioElement {
    const key = `${chapterId}/${name}`;
    const cached = this.clips.get(key);
    if (cached) return cached;
    const el = new Audio(`${this.base}quizmaster/${key}.m4a`);
    el.preload = 'auto';
    el.volume = 0.9;
    // **DOM に付いていない Audio は preload だけでは取りに行かない**（Chrome で実測。
    // 再生した時点でまだ duration も取れていなかった）。load() を明示して取得を始めさせる。
    el.load();
    this.clips.set(key, el);
    return el;
  }
}
