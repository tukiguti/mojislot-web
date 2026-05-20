import { Observable } from '../lib/Observable';

/**
 * ジンの表情・状態。レンダリングからは独立しているため Unity 移植時もそのまま使える。
 *  - idle:    平常時。デフォルト
 *  - shisa:   示唆中。期待感を煽る表情
 *  - quiz:    クイズ補助発動中。集中している表情
 *  - cheer:   役成立時の喜び
 *  - miss:    はずれ時のがっかり
 */
export type JinExpression = 'idle' | 'shisa' | 'quiz' | 'cheer' | 'miss';

export class JinState {
  readonly expression = new Observable<JinExpression>('idle');

  set(expression: JinExpression): void {
    this.expression.set(expression);
  }

  get(): JinExpression {
    return this.expression.get();
  }
}
