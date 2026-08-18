/**
 * 素材のクレジット表記。
 *
 * **VOICEVOX は「VOICEVOX:キャラクター名」の形でキャラクター名まで出す**のが
 * 使用規約の求める形なので、使った話者を1人ずつ並べる。話者を足したり
 * 差し替えたりしたら、`tools/gen_voice.py` の `VOICES` とここを揃える。
 *
 * 表記そのものを1箇所に集めてあるのは、出す場所が増えても文言が分かれないため
 * （いまは入口と台の詳細の2箇所）。
 */

/** ボイスに使った VOICEVOX の話者。`tools/gen_voice.py` の割り当てと同じ順。 */
export const VOICEVOX_SPEAKERS: readonly string[] = [
  '麒ヶ島宗麟',
  '玄野武宏',
  'WhiteCUL',
  '青山龍星',
  '雀松朱司',
];

/** 「VOICEVOX:A / B / …」の1行。 */
export const VOICEVOX_CREDIT = `VOICEVOX:${VOICEVOX_SPEAKERS.join(' / ')}`;

/** クレジット表示のHTML（入口・台の詳細で共用）。 */
export function creditHtml(className = 'hall-credit'): string {
  return `<div class="${className}">
      <span class="hall-credit-label">音声</span>
      <span class="hall-credit-body">${VOICEVOX_CREDIT}</span>
    </div>`;
}
