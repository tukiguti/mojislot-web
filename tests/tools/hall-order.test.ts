import { describe, it } from 'vitest';
import { ISLANDS, MACHINES } from '../../src/data/machines';

/** ORDER=1 で島の並びと台番を一覧する（調整用）。 */
describe.skipIf(!process.env.ORDER)('ホールの並び', () => {
  it('一覧', () => {
    for (const i of ISLANDS) {
      const ms = MACHINES.filter((m) => m.islandId === i.id);
      console.log(
        `島${i.no} ${i.name.padEnd(7, '　')} 台番 ${ms[0].number}–${ms[ms.length - 1].number} (${ms.length}台)`,
      );
    }
  });
});
