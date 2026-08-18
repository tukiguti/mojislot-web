import LINES from '../../data/quizmaster-lines.json';

/**
 * クイズの出題者。**島（章）ごとに別人**で、クイズ演出のときだけ液晶に出る。
 *
 * 常駐マスコット（ジン）を置いていた頃は、表情が結果に反応するだけで情報を
 * 運んでいなかった（[33] §5）。役割をクイズ1つに絞り、代わりに島の性格を
 * 出題者の職業で出す（[14] §1）。
 *
 * 絵は 48×56 のドット絵。`tools/pixel/<職業>.txt` を
 * `tools/build_quizmaster_art.py` で `art/quizmaster/<章ID>_<表情>.png` へ書き出す。
 *
 * **台詞は `data/quizmaster-lines.json` が正**。ボイスの生成（`tools/gen_voice.py`）が
 * 同じファイルを読むので、ここに直書きすると**声と字幕がずれる**。
 */

/** 出題者が出る3場面（＝絵の3表情）。 */
export type QuizmasterFace = 'ask' | 'correct' | 'wrong';

/**
 * 台詞の場面。`near` は「1コマずれていれば揃っていた」不正解で、絵は `wrong` を使う。
 * ニアミスは以前は全ゲームでマスコットが伝えていたが、出題者はクイズ中しか居ないので
 * **この場面だけ**になった（[25] に残課題として記録）。
 */
export type QuizmasterLine = QuizmasterFace | 'near';

export interface Quizmaster {
  /** ドット絵のマップ名（＝職業）。画像のファイル名は章IDなので、参照用。 */
  readonly art: string;
  readonly name: string;
  /**
   * 収録済みの表情。**ここに無い表情は `ask` の顔で代用する**。
   * 48×56 では表情差を作る余地が薄く（`tools/PIXEL_SPEC.md`）、描けた分だけ増やす。
   */
  readonly faces: readonly QuizmasterFace[];
  /** 場面ごとの台詞。人ごとに口調を変える（島の個性を台詞でも出す）。 */
  readonly lines: Readonly<Record<QuizmasterLine, readonly string[]>>;
}

const ALL_FACES: readonly QuizmasterFace[] = ['ask', 'correct', 'wrong'];

/**
 * 章ID → 出題者。落としたのはプレイヤーなので、不正解でも責めない
 * （上達応援型・[14] §3）。
 */
export const QUIZMASTERS: Readonly<Record<string, Quizmaster>> = {
  hiragana_food: {
    art: 'sushi_taisho',
    name: '寿司屋の大将',
    faces: ALL_FACES,
    lines: LINES.hiragana_food,
  },
  katakana_animal: {
    art: 'zookeeper',
    name: '動物園の飼育員',
    faces: ALL_FACES,
    lines: LINES.katakana_animal,
  },
  hiragana_verb: {
    art: 'teacher',
    name: '国語の教師',
    faces: ALL_FACES,
    lines: LINES.hiragana_verb,
  },
  yasai: {
    art: 'greengrocer',
    name: '八百屋の店主',
    faces: ALL_FACES,
    lines: LINES.yasai,
  },
  security: {
    art: 'engineer',
    name: 'セキュリティエンジニア',
    faces: ALL_FACES,
    lines: LINES.security,
  },
};

/** その章の出題者。章に出題者を割り当てていなければ null（出題者なしで動く）。 */
export function quizmasterFor(chapterId: string): Quizmaster | null {
  return QUIZMASTERS[chapterId] ?? null;
}

/** 収録されている表情に丸める。未収録は出題の顔で代用する。 */
export function availableFace(master: Quizmaster, face: QuizmasterFace): QuizmasterFace {
  return master.faces.includes(face) ? face : 'ask';
}

/**
 * その場面の台詞を1つ選ぶ。
 *
 * **添字も返す**のが要。ボイスのファイル名が添字なので、文字列だけ返すと
 * 「表示している字幕とは別の台詞が鳴る」ことになる。
 */
export function pickLine(
  master: Quizmaster,
  line: QuizmasterLine,
): { text: string; index: number } {
  const lines = master.lines[line];
  const index = Math.floor(Math.random() * lines.length);
  return { text: lines[index], index };
}
