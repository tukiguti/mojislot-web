/**
 * AudioContext を1つに束ねる。
 *
 * SE も BGM も、外部音源を鳴らすようになってからは**同じ ctx でなければならない**——
 * `decodeAudioData` が返す AudioBuffer は作った ctx に紐づいていて、別 ctx の
 * BufferSource には挿せない。SfxEngine と BgmEngine がそれぞれ ctx を持っていた頃の
 * 名残で init() のシグネチャは変えていないが、中身はここを見に来る。
 *
 * ブラウザの自動再生制限があるので、**最初の生成は user gesture の中で**行うこと。
 */
let ctx: AudioContext | null = null;

/** 共有 AudioContext。未生成なら作る。Web Audio 非対応なら null。 */
export function audioContext(): AudioContext | null {
  if (ctx) return ctx;
  const Ctx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctx) return null;
  ctx = new Ctx();
  return ctx;
}

/** 自動再生制限で suspended のままなら起こす。user gesture 内から呼ぶ。 */
export function resumeAudio(): void {
  if (ctx && ctx.state === 'suspended') void ctx.resume();
}
