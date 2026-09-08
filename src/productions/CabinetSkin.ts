/**
 * 筐体の皮（スキン）。
 *
 * 見た目は `src/skins.css` が `body[data-skin]` で持つ。ここは**どれを選んでいるか**
 * だけを扱う。色や質感の値はこのファイルに書かない——CSS 変数の一覧を TypeScript
 * 側にも持つと、片方だけ直して食い違う（配列と派生データで同じ失敗をしている）。
 *
 * `royal` は `:root` の既定値そのものなので、属性を外すだけで戻る。
 */

export type SkinId = 'royal' | 'midnight' | 'retro';

export const SKINS: readonly { id: SkinId; name: string; note: string }[] = [
  {
    id: 'royal',
    name: 'ロイヤル',
    note: 'クローム×紫×金。今までの皮に、面取りと段差を足して厚みを出したもの。',
  },
  {
    id: 'midnight',
    name: 'ミッドナイト',
    note: '黒のヘアライン仕上げに電光シアン。金を使わない現代機の路線。STOP も氷青。',
  },
  {
    id: 'retro',
    name: 'レトロ',
    note: '木目の筐体にクリームの操作板、赤い7セグ、電球色のマーキー。角は落とさない。',
  },
];

const STORAGE_KEY = 'mojislot.cabinetSkin.v1';
const DEFAULT_SKIN: SkinId = 'royal';

function isSkinId(v: unknown): v is SkinId {
  return typeof v === 'string' && SKINS.some((s) => s.id === v);
}

export function loadSkin(): SkinId {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return isSkinId(raw) ? raw : DEFAULT_SKIN;
  } catch {
    return DEFAULT_SKIN;
  }
}

/** `body` に属性を張る。royal は既定値なので属性ごと外す。 */
export function applySkin(id: SkinId): void {
  if (id === DEFAULT_SKIN) document.body.removeAttribute('data-skin');
  else document.body.setAttribute('data-skin', id);
}

export function saveSkin(id: SkinId): void {
  applySkin(id);
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* 保存できなくても、そのセッション中は選んだ皮で遊べる */
  }
}
