import { describe, it } from 'vitest';
import { hallPolicyFor, settingForMachine } from '../../src/productions/HallPolicy';
import { MACHINES, REMIX_ISLAND_ID } from '../../src/data/machines';

/** SIX=1 で「その日の設定6は何台あるか」を数える調査用。通常のテスト実行では走らない。 */
describe.skipIf(!process.env.SIX)('設定6の密度', () => {
  it('数える', () => {
    const kinds: Record<string, number> = {};
    const hist: Record<number, number> = {};
    for (let i = 0; i < 400; i++) {
      const d = new Date(2026, 0, 1 + i);
      const p = hallPolicyFor(d);
      kinds[p.kind] = (kinds[p.kind] ?? 0) + 1;
      const n = MACHINES.filter(
        (m) => m.islandId !== REMIX_ISLAND_ID && settingForMachine(m, d, p) === 6,
      ).length;
      hist[n] = (hist[n] ?? 0) + 1;
    }
    console.log('方針の内訳（400日）:', kinds);
    console.log('その日の設定6の台数の分布:', hist);
  });
});
