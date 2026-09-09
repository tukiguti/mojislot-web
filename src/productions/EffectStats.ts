/**
 * 演出ごとの発生回数と、そこからボーナスへ繋がった回数。
 *
 * **打ち手が自分で期待度を作るための帳簿。** 仕様書に書いてある期待度を画面に
 * 出してしまうと、示唆を読む遊びが消える。かわりに「自分が引いた実績」を数えて
 * 見せる——回すほど本当の値に近づくので、**攻略情報ではなく自分の記録**になる。
 *
 * 母数は**通常時のゲームだけ**。ボーナス中は演出の意味が変わる（無演出が0で必ず
 * 何か出る）ので、混ぜると率が動く。`MachineData` の演出率と同じ規則。
 *
 * デバッグで強制した演出は数えない。狙って出せるものを混ぜると帳簿が壊れる。
 *
 * **ステップアップだけは次のゲームで採点する。** あの終了色が指しているのは
 * 「次ゲームがボーナスか」なので、出たゲームの結果で数えると意味が変わる
 * （レバーで光って停止ごとに色が進み、決まった色で**次ゲーム**を予告する）。
 *
 * `MachineData` が台ごと・日替わりなのに対して、こちらは**通算**。期待度は台や日で
 * 変わるものではなく、サンプルが多いほど読める数字なので溜め続ける。
 */

const STORAGE_KEY = 'mojislot.effectStats.v1';

/** 帳簿に並べる演出。**表示順がそのまま画面の順**になる。 */
export const EFFECT_KINDS = [
  { key: 'shisa-blue', label: '示唆 青' },
  { key: 'shisa-green', label: '示唆 緑' },
  { key: 'shisa-red', label: '示唆 赤' },
  { key: 'shisa-gold', label: '示唆 金' },
  { key: 'shisa-rainbow', label: '示唆 虹' },
  { key: 'quiz', label: 'クイズ' },
  { key: 'aim', label: '狙え！' },
  { key: 'step-green', label: 'ステップ 緑' },
  { key: 'step-red', label: 'ステップ 赤' },
  { key: 'step-gold', label: 'ステップ 金' },
  { key: 'delay', label: '遅れ' },
  { key: 'lamp', label: '確定ランプ' },
  { key: 'freeze', label: 'フリーズ' },
] as const;

export type EffectKey = (typeof EFFECT_KINDS)[number]['key'];

export interface EffectRecord {
  /** 通常時に出た回数。 */
  seen: number;
  /** うちボーナスへ繋がった回数。 */
  hit: number;
}

export type EffectStore = Partial<Record<EffectKey, EffectRecord>>;

const isKey = (v: string): v is EffectKey =>
  EFFECT_KINDS.some((k) => k.key === v);

export function readEffectStats(): EffectStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return {};
    const out: EffectStore = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (!isKey(k) || typeof v !== 'object' || v === null) continue;
      const rec = v as Record<string, unknown>;
      const seen = typeof rec.seen === 'number' ? rec.seen : 0;
      const hit = typeof rec.hit === 'number' ? rec.hit : 0;
      if (seen > 0 || hit > 0) out[k] = { seen, hit };
    }
    return out;
  } catch {
    return {};
  }
}

function write(store: EffectStore): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    /* 保存できなくても遊べる方を優先する */
  }
}

/**
 * 1ゲームぶんを記録する。
 *
 * @param keys そのゲームで出た演出。**同じ演出が2回出ても1回**として数える
 *   （1ゲームの結果は1つしかないので、2回数えると分母だけ増える）。
 * @param bonus そのゲームでボーナスが成立したか。
 */
export function recordEffects(
  keys: readonly string[],
  bonus: boolean,
): EffectStore {
  const store = readEffectStats();
  for (const key of new Set(keys)) {
    if (!isKey(key)) continue;
    const cur = store[key] ?? { seen: 0, hit: 0 };
    store[key] = { seen: cur.seen + 1, hit: cur.hit + (bonus ? 1 : 0) };
  }
  write(store);
  return store;
}

export function resetEffectStats(): void {
  write({});
}

/** 期待度（%）。1回も出ていなければ null。 */
export function effectHitRate(rec: EffectRecord | undefined): number | null {
  if (!rec || rec.seen === 0) return null;
  return (rec.hit / rec.seen) * 100;
}
