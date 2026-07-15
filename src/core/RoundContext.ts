import type { EffectType } from '../productions/EffectScheduler';
import type { InternalRoleResult } from '../productions/InternalRoleLottery';

export type RoundSource =
  | 'lottery'
  | 'debug'
  | 'freeze'
  | 'announce'
  | 'held-bonus';

/** BET後、レバーONから全停止まで不変の1ゲーム状態。 */
export interface RoundContext {
  roundNumber: number;
  internalRole: InternalRoleResult;
  effect: EffectType;
  source: RoundSource;
  bonusActive: boolean;
}

export function createRoundContext(params: RoundContext): RoundContext {
  return { ...params, internalRole: { ...params.internalRole } };
}
