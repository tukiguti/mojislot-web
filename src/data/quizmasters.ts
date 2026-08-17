/**
 * クイズの出題者。**島（章）ごとに別人**で、クイズ演出のときだけ液晶に出る。
 *
 * 常駐マスコット（ジン）を置いていた頃は、表情が結果に反応するだけで情報を
 * 運んでいなかった（[33] §5）。役割をクイズ1つに絞り、代わりに島の性格を
 * 出題者の職業で出す（[14] §1）。
 *
 * 絵は 48×56 のドット絵。`tools/pixel/<職業>.txt` を
 * `tools/build_quizmaster_art.py` で `art/quizmaster/<章ID>_<表情>.png` へ書き出す。
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

/**
 * 章ID → 出題者。落としたのはプレイヤーなので、不正解でも責めない
 * （上達応援型・[14] §3）。
 */
export const QUIZMASTERS: Readonly<Record<string, Quizmaster>> = {
  hiragana_food: {
    art: 'sushi_taisho',
    name: '寿司屋の大将',
    faces: ['ask', 'correct', 'wrong'],
    lines: {
      ask: ['へい、一問いくよ！', 'こいつは何だい？', '目ぇ利くかい？'],
      correct: ['お見事！', 'いい舌してるねぇ', 'そうこなくちゃ'],
      wrong: ['惜しいねぇ', 'まだ握りが甘いな', '次で決めようや'],
      near: ['あと一寸だったな！', 'いい筋だ、もう一回！', '今のは惜しかったぜ'],
    },
  },
  katakana_animal: {
    art: 'zookeeper',
    name: '動物園の飼育員',
    faces: ['ask', 'correct', 'wrong'],
    lines: {
      ask: ['この子、わかる？', 'はい、問題！', 'よく見てね'],
      correct: ['正解！さすが！', 'よく知ってるね', 'その通り！'],
      wrong: ['あー、惜しい！', 'うーん、近かった', '次いこう！'],
      near: ['わー、あと1コマ！', 'すごく近かった！', 'いま届きそうだったね'],
    },
  },
  hiragana_verb: {
    art: 'teacher',
    name: '国語の教師',
    faces: ['ask', 'correct', 'wrong'],
    lines: {
      ask: ['では、問題です', 'これ、わかりますか？', '落ち着いて考えて'],
      correct: ['よくできました', 'その通りです', 'しっかり読めていますね'],
      wrong: ['おしかったですね', 'もう一度いきましょう', '惜しい。次は取れます'],
      near: ['あと少しでしたね', 'ほとんど合っていました', 'いい目の付け所です'],
    },
  },
  yasai: {
    art: 'greengrocer',
    name: '八百屋の店主',
    faces: ['ask', 'correct', 'wrong'],
    lines: {
      ask: ['さあ、一丁いくよ！', 'これ何だと思う？', '当ててみな！'],
      correct: ['大当たりィ！', 'いいねぇ、目が高い！', 'そうそう、それ！'],
      wrong: ['ありゃ、残念！', 'もうちょいだったな', 'まあいい、次だ次！'],
      near: ['おー、すぐそこ！', 'あと一つだったなァ', '今のは近かったぞ'],
    },
  },
  security: {
    art: 'engineer',
    name: 'セキュリティエンジニア',
    faces: ['ask', 'correct', 'wrong'],
    lines: {
      ask: ['……これ、わかる？', '一問だけ、いい？', 'ちょっと確認ね'],
      correct: ['お、正解', 'よく知ってるね', 'それで合ってる'],
      wrong: ['まあ、よくある間違い', '惜しいところまでは来てる', 'うん、次は取れるよ'],
      near: ['……惜しい、1つずれてた', 'かなり近かったよ', '方向は合ってる'],
    },
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

/** その場面の台詞を1つ選ぶ。 */
export function pickLine(master: Quizmaster, line: QuizmasterLine): string {
  const lines = master.lines[line];
  return lines[Math.floor(Math.random() * lines.length)];
}
