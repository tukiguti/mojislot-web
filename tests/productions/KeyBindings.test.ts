import { describe, it, expect, beforeEach } from 'vitest';
import { KeyBindings, DEFAULT_KEYS } from '../../src/productions/KeyBindings';

const KEY = 'mojislot.keyBindings.v1';

/** テストは node 環境なので、localStorage を最小限で用意する。 */
function stubStorage(): Map<string, string> {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
  return store;
}

describe('キー割り当ての保存', () => {
  let store: Map<string, string>;
  beforeEach(() => {
    store = stubStorage();
  });

  it('古い既定（ベット＝B・レバー＝スペース）のまま保存されていたら、スペース共有へ戻す', () => {
    store.set(KEY, JSON.stringify({ ...DEFAULT_KEYS, bet: 'b', lever: ' ' }));
    const kb = new KeyBindings();
    expect(kb.get('bet')).toBe(' ');
    expect(kb.actionsFor(' ')).toEqual(['bet', 'lever']);
  });

  it('レバーも変えている人のベット＝B は本人の選択なので残す', () => {
    store.set(KEY, JSON.stringify({ bet: 'b', lever: 'enter' }));
    const kb = new KeyBindings();
    expect(kb.get('bet')).toBe('b');
    expect(kb.get('lever')).toBe('enter');
  });

  it('保存するのは既定から変えたキーだけ', () => {
    const kb = new KeyBindings();
    kb.set('stop0', 'j');
    expect(JSON.parse(store.get(KEY) ?? '{}')).toEqual({ stop0: 'j' });
  });
});
