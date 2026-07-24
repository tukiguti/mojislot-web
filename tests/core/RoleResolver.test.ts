import { describe, expect, it } from 'vitest';
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
  },
  symbols: ['a', 'b', 'c'],
});

describe('resolveInternalRoleHits', () => {
  it('内部役と一致する表示ラインだけを成立させる', () => {
    expect(resolveInternalRoleHits('target', [hit('other'), hit('target')])).toEqual([
      hit('target'),
    ]);
  });

  it('miss（当選役なし）では偶然役が表示されても成立させない', () => {
    expect(resolveInternalRoleHits(null, [hit('other')])).toEqual([]);
  });

  it('押し順を外した時（当選役null）も成立させない＝1枚役へこぼれる', () => {
    expect(resolveInternalRoleHits(null, [hit('target')])).toEqual([]);
  });

  it('同じ内部役の複数ラインはすべて残す', () => {
    expect(resolveInternalRoleHits('target', [hit('target'), hit('target')])).toHaveLength(2);
  });
});
