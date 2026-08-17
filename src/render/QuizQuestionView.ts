import { Container, Graphics, Text } from 'pixi.js';
import type { QuizState } from '../productions/QuizState';

/**
 * 演出エリア（液晶）に表示するクイズ文章。
 * 停止前は出題文、全停止後は答えと的中結果を出す。
 *
 * 左下にはクイズの出題者（`QuizmasterView`）が立つので、`insetLeft` の分だけ
 * 右へ寄せる。同じ幅を `wordWrapWidth` からも引かないと、折り返しが変わらないまま
 * 中心だけ動いて右へはみ出す。
 */

interface QuizQuestionViewOptions {
  width: number;
  height: number;
  /** 出題者に譲る左側の幅（px）。 */
  insetLeft?: number;
}

/** 1行の最大文字数。出題者に譲った残り幅と fontSize 22px から、読みやすい行長で固定する。 */
const MAX_CHARS_PER_LINE = 14;

/**
 * 日本語の出題文を「一定の文字数」で折り返す。
 * - 区切り（、。）が行末付近なら、そこで折り返して語尾が不自然に切れないようにする
 * - 英数の語（`--help` `8GB` など）の途中では折り返さない（最大 max+6 まで伸ばす）
 */
function wrapJapanese(text: string, max: number): string {
  const chars = [...text];
  const isAsciiWord = (c: string | undefined): boolean =>
    c !== undefined && /[0-9A-Za-z\-_/.]/.test(c);
  const lines: string[] = [];
  let line = '';
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    line += ch;
    const atPunctuation = /[、。，,]/.test(ch);
    const insideAsciiWord = isAsciiWord(ch) && isAsciiWord(chars[i + 1]);
    const reachedLimit = line.length >= max && !insideAsciiWord;
    if (reachedLimit || line.length >= max + 6 || (atPunctuation && line.length >= max - 5)) {
      lines.push(line);
      line = '';
    }
  }
  if (line) lines.push(line);
  return lines.join('\n');
}

export class QuizQuestionView {
  readonly container: Container;
  private readonly text: Text;
  private readonly backdrop: Graphics;

  constructor(state: QuizState, opts: QuizQuestionViewOptions) {
    this.container = new Container();

    // 文字を読みやすくするための半透明パネル。
    // 暗く落とすと「クイズ＝アツい」と telegraph しすぎるので、薄く明るめに乗せるだけにする
    //（プレイヤーが「どれかな」と考えて打つのが本作のコンセプト）。
    const padX = 24;
    const padY = 18;
    const inset = opts.insetLeft ?? 0;
    // 出題者の幅だけ左を削り、パネルと文字をまとめて右へずらす。
    const panelW = opts.width - padX * 2 - inset;
    this.backdrop = new Graphics();
    this.backdrop
      .roundRect(
        -opts.width / 2 + padX + inset,
        -opts.height / 2 + padY,
        panelW,
        opts.height - padY * 2,
        12,
      )
      .fill({ color: 0x5a3a68, alpha: 0.28 })
      .stroke({ width: 2, color: 0xff8ad8, alpha: 0.5 });
    this.container.addChild(this.backdrop);

    this.text = new Text({
      text: '',
      style: {
        fill: 0xffffff,
        fontSize: 22,
        fontFamily: 'system-ui, "Hiragino Sans", "Yu Gothic", sans-serif',
        fontWeight: 'bold',
        // 日本語は単語区切り（スペース）が無く、wordWrap だけでは折り返されずに横へ伸びて
        // 画面外へ消える。breakWords で任意位置の折り返しを許可し、保険をかける。
        wordWrap: true,
        breakWords: true,
        wordWrapWidth: panelW - 24,
        align: 'center',
        lineHeight: 32,
      },
    });
    this.text.anchor.set(0.5);
    // パネルの中心（＝出題者に譲った幅の半分だけ右）へ。
    this.text.x = inset / 2;
    this.container.addChild(this.text);

    this.container.visible = false;

    const render = () => {
      const quiz = state.current.get();
      const question = wrapJapanese(quiz?.question ?? '', MAX_CHARS_PER_LINE);
      if (quiz && state.phase.get() === 'resolved') {
        const label = state.matched.get() ? '的中！' : '未成立';
        this.text.text = `${question}\n\n${label}　答え：${quiz.answer}`;
      } else {
        this.text.text = question;
      }
    };
    state.current.subscribe(render);
    state.matched.subscribe(render);
    state.phase.subscribe((phase) => {
      this.container.visible = phase !== 'inactive';
      render();
    });
  }
}
