import { Observable } from '../lib/Observable';

/**
 * 見やすさの設定（アクセシビリティ）。
 *
 * このゲームは**光る・揺れる・弾ける**で手応えを出しているので、そのままだと
 * 遊べない人が出る。かといって演出を薄くすると打っていて楽しくないので、
 * **既定は今のまま**にして、必要な人だけ落とせる形にした。
 *
 * 4つとも「情報を減らさない」のが条件。動きや光や色を弱める代わりに、
 * それらが運んでいた意味は文字やバッジで残す。演出が持っているのは
 * 情報だけ（[31] §2）なので、意味さえ残れば出玉には影響しない。
 */

export interface A11ySettings {
  /**
   * 動きを減らす。揺れ・紙吹雪・コイン撒き・光の周回アニメを止める。
   * **リールの回転とブラーは対象外**——あれは演出ではなく操作対象そのもの。
   */
  reduceMotion: boolean;
  /** 光を弱める。全画面フラッシュを薄くし、グローとスパークルを落とす。 */
  dim: boolean;
  /** 色に頼らない表示。色だけで意味を運んでいる箇所に文字と形を添える。 */
  colorSafe: boolean;
  /** 消音中は、音でしか出ていない手応え（ビタ・テンパイ）を画面に出す。 */
  soundCue: boolean;
}

const STORAGE_KEY = 'mojislot.a11y.v1';

/**
 * OSの「視差効果を減らす」を既定にする。
 *
 * 端末側で設定している人には、こちらで改めて選ばせる理由がない。
 * 保存済みの値があればそちらが優先されるので、OSと違う選択も残せる。
 */
const prefersReducedMotion = (): boolean => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

const defaults = (): A11ySettings => ({
  reduceMotion: prefersReducedMotion(),
  dim: false,
  colorSafe: false,
  soundCue: false,
});

const CLASS_OF: Record<keyof A11ySettings, string> = {
  reduceMotion: 'a11y-reduce-motion',
  dim: 'a11y-dim',
  colorSafe: 'a11y-color-safe',
  soundCue: 'a11y-sound-cue',
};

class AccessibilityState {
  readonly settings = new Observable<A11ySettings>(defaults());

  constructor() {
    this.settings.set(this.load());
    this.applyClasses();
  }

  get(): A11ySettings {
    return this.settings.get();
  }

  set<K extends keyof A11ySettings>(key: K, value: A11ySettings[K]): void {
    const next = { ...this.settings.get(), [key]: value };
    this.settings.set(next);
    this.save(next);
    this.applyClasses();
  }

  /**
   * ルート要素へクラスを付ける。CSS 側はこのクラスで分岐する。
   * JS から止める必要があるもの（紙吹雪の生成数など）は `get()` を直接見る。
   */
  private applyClasses(): void {
    const s = this.settings.get();
    const root = document.documentElement;
    for (const key of Object.keys(CLASS_OF) as (keyof A11ySettings)[]) {
      root.classList.toggle(CLASS_OF[key], s[key]);
    }
  }

  private load(): A11ySettings {
    const base = defaults();
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return base;
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null) return base;
      const out = { ...base };
      for (const key of Object.keys(CLASS_OF) as (keyof A11ySettings)[]) {
        const v = (parsed as Record<string, unknown>)[key];
        if (typeof v === 'boolean') out[key] = v;
      }
      return out;
    } catch {
      return base;
    }
  }

  private save(s: A11ySettings): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    } catch {
      /* 保存できなくても今のセッションでは効いている */
    }
  }
}

export const a11y = new AccessibilityState();

/** 示唆のtier色 → 色名。色だけで伝えている所へ添える（`colorSafe` 用）。 */
export const TIER_COLOR_NAME: Record<string, string> = {
  blue: '青',
  green: '緑',
  red: '赤',
  gold: '金',
  rainbow: '虹',
};
