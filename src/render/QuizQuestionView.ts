import { Container, Graphics, Text } from 'pixi.js';
import type { QuizState } from '../productions/QuizState';

/**
 * 演出エリア（液晶）に表示するクイズ文章。
 * クイズ中はジン（マスコット）を隠して、ここに大きく出題文だけを出す。
 */

interface QuizQuestionViewOptions {
  width: number;
  height: number;
}

export class QuizQuestionView {
  readonly container: Container;
  private readonly text: Text;
  private readonly backdrop: Graphics;

  constructor(state: QuizState, opts: QuizQuestionViewOptions) {
    this.container = new Container();

    // 文字を読みやすくするための半透明パネル
    const padX = 24;
    const padY = 18;
    this.backdrop = new Graphics();
    this.backdrop
      .roundRect(
        -opts.width / 2 + padX,
        -opts.height / 2 + padY,
        opts.width - padX * 2,
        opts.height - padY * 2,
        12,
      )
      .fill({ color: 0x1a0d20, alpha: 0.55 })
      .stroke({ width: 2, color: 0xff66cc, alpha: 0.7 });
    this.container.addChild(this.backdrop);

    this.text = new Text({
      text: '',
      style: {
        fill: 0xffffff,
        fontSize: 22,
        fontFamily: 'system-ui, "Hiragino Sans", "Yu Gothic", sans-serif',
        fontWeight: 'bold',
        wordWrap: true,
        wordWrapWidth: opts.width - padX * 2 - 24,
        align: 'center',
        lineHeight: 32,
      },
    });
    this.text.anchor.set(0.5);
    this.container.addChild(this.text);

    this.container.visible = false;

    state.current.subscribe((quiz) => {
      this.text.text = quiz?.question ?? '';
    });
    state.phase.subscribe((phase) => {
      this.container.visible = phase !== 'inactive';
    });
  }
}
