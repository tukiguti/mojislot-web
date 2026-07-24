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
    expect(
      resolveInternalRoleHits(['target'], [hit('other'), hit('target')]),
    ).toEqual([hit('target')]);
  });

  it('miss（当選役なし＝空配列）では偶然役が表示されても成立させない', () => {
    expect(resolveInternalRoleHits([], [hit('other')])).toEqual([]);
  });

  it('1枚役グループ（複数ID）はどれが表示されても成立する', () => {
    expect(
      resolveInternalRoleHits(
        ['single_a', 'single_b'],
        [hit('single_b'), hit('other')],
      ),
    ).toEqual([hit('single_b')]);
  });

  it('同じ内部役の複数ラインはすべて残す', () => {
    expect(
      resolveInternalRoleHits(['target'], [hit('target'), hit('target')]),
    ).toHaveLength(2);
  });
});
