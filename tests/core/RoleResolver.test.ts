import { describe, expect, it } from 'vitest';
import type { RoundContext } from '../../src/core/RoundContext';
import { resolveInternalRoleHits } from '../../src/core/RoleResolver';
import type { PaylineHit } from '../../src/core/YakuJudge';

const hit = (id: string): PaylineHit => ({
  paylineId: 'middle',
  paylineName: '中段',
  yaku: {
    id,
    name: id,
    symbols: ['a', 'b', 'c'],
    category: 'core',
    internalRoleKind: 'core',
  },
  symbols: ['a', 'b', 'c'],
});

const round = (yakuId: string | null): RoundContext => ({
  roundNumber: 1,
  internalRole: {
    kind: yakuId ? 'core' : 'miss',
    yakuId,
    yakuName: yakuId,
  },
  effect: yakuId ? 'quiz' : 'none',
  source: 'lottery',
  bonusActive: false,
});

describe('resolveInternalRoleHits', () => {
  it('内部役と一致する表示ラインだけを成立させる', () => {
    expect(resolveInternalRoleHits(round('target'), [hit('other'), hit('target')])).toEqual([
      hit('target'),
    ]);
  });

  it('missでは偶然役が表示されても成立させない', () => {
    expect(resolveInternalRoleHits(round(null), [hit('other')])).toEqual([]);
  });

  it('同じ内部役の複数ラインはすべて残す', () => {
    expect(resolveInternalRoleHits(round('target'), [hit('target'), hit('target')])).toHaveLength(2);
  });
});
