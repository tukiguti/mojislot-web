/**
 * キー割り当て。
 *
 * 以前は `main.ts` の keydown ハンドラに直書きで、`a`/`s`/`d` などが固定だった。
 * 左手で止めたい人や、キーボードの配列が違う人が変えられない。ここに集めて
 * 保存できるようにする（2026-09-08）。
 *
 * **押した瞬間の精度が出玉に効くゲーム**なので、押しやすい位置に置けることは
 * 見た目の好みではなく成績に直結する。ビタ押しの判定は ±12ms しかない。
 */

/** 割り当てを変えられる操作。 */
export type Action =
  | 'bet'
  | 'lever'
  | 'stop0'
  | 'stop1'
  | 'stop2'
  | 'auto'
  | 'mute'
  | 'zukan'
  | 'settings'
  | 'reelStrip';

/** 設定画面に出す順と名前。ゲーム操作を上に、開閉ものを下に置く。 */
export const ACTION_LABELS: readonly { action: Action; label: string }[] = [
  { action: 'bet', label: 'ベット' },
  { action: 'lever', label: 'レバー' },
  { action: 'stop0', label: '左リール停止' },
  { action: 'stop1', label: '中リール停止' },
  { action: 'stop2', label: '右リール停止' },
  { action: 'auto', label: 'オート' },
  { action: 'mute', label: '消音' },
  { action: 'reelStrip', label: 'リール配列' },
  { action: 'zukan', label: '図鑑' },
  { action: 'settings', label: '設定' },
];

export type KeyMap = Record<Action, string>;

/** 既定。実機の左から順に a・s・d で止める並びを踏襲する。 */
export const DEFAULT_KEYS: KeyMap = {
  bet: 'b',
  lever: ' ',
  stop0: 'a',
  stop1: 's',
  stop2: 'd',
  auto: 'o',
  mute: 'm',
  zukan: 'z',
  settings: ',',
  reelStrip: 'r',
};

const STORAGE_KEY = 'mojislot.keyBindings.v1';

/** 表示用のキー名。スペースなど、そのままだと読めないものを置き換える。 */
export function keyLabel(key: string): string {
  if (key === ' ') return 'Space';
  if (key === 'arrowleft') return '←';
  if (key === 'arrowright') return '→';
  if (key === 'arrowup') return '↑';
  if (key === 'arrowdown') return '↓';
  if (key === 'escape') return 'Esc';
  if (key === 'enter') return 'Enter';
  return key.toUpperCase();
}

/**
 * `KeyboardEvent` から、割り当てに使う文字を取り出す。
 * スペースは `key` が `' '` になる環境と `'spacebar'` になる環境があるので `code` で拾う。
 */
export function eventKey(ev: KeyboardEvent): string {
  if (ev.code === 'Space') return ' ';
  return ev.key.toLowerCase();
}

/** 割り当てに使えないキー。ブラウザやページの操作を奪うと戻せなくなる。 */
const RESERVED = new Set(['tab', 'escape', 'f5', 'control', 'alt', 'shift', 'meta']);

export function isAssignable(key: string): boolean {
  return key.length > 0 && !RESERVED.has(key);
}

export class KeyBindings {
  private map: KeyMap;

  constructor() {
    this.map = { ...DEFAULT_KEYS, ...this.load() };
  }

  private load(): Partial<KeyMap> {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return {};
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null) return {};
      const out: Partial<KeyMap> = {};
      for (const { action } of ACTION_LABELS) {
        const v = (parsed as Record<string, unknown>)[action];
        if (typeof v === 'string' && isAssignable(v)) out[action] = v;
      }
      return out;
    } catch {
      return {};
    }
  }

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.map));
    } catch {
      /* 保存できなくても遊べる（プライベートウィンドウ等） */
    }
  }

  get(action: Action): string {
    return this.map[action];
  }

  /** そのキーに割り当てられている操作。無ければ null。 */
  actionFor(key: string): Action | null {
    for (const { action } of ACTION_LABELS) {
      if (this.map[action] === key) return action;
    }
    return null;
  }

  /**
   * 割り当てを変える。**同じキーが既に他で使われていたら、そちらを空ける**——
   * 重複を許すと1回の入力で2つ動いてしまう。
   */
  set(action: Action, key: string): boolean {
    if (!isAssignable(key)) return false;
    const holder = this.actionFor(key);
    if (holder === action) return true;
    if (holder) this.map[holder] = '';
    this.map[action] = key;
    this.save();
    return true;
  }

  reset(): void {
    this.map = { ...DEFAULT_KEYS };
    this.save();
  }

  /** 表示用のスナップショット。 */
  snapshot(): KeyMap {
    return { ...this.map };
  }
}
