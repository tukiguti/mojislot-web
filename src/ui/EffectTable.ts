import {
  EFFECT_KINDS,
  effectHitRate,
  readEffectStats,
  resetEffectStats,
  type EffectStore,
} from '../productions/EffectStats';

/**
 * 演出データの表。ドックの「データ」で開くシートの中身。
 *
 * **仕様書の期待度は出さない。** 出した瞬間に示唆を読む遊びが消える。かわりに
 * 打ち手が自分で引いた実績を数えて見せる——回すほど本当の値に近づくので、
 * 攻略情報ではなく自分の記録になる。
 *
 * まだ出ていない演出も行として並べる。ここは台のデータを見る場所で、実機の
 * カウンターも 0 の欄を並べている。**何が出るか**の発見は図鑑の担当。
 */

/** これ以上出ていれば率が読める、という目安。下回る行は薄く出す。 */
const READABLE_SEEN = 10;

export class EffectTable {
  private readonly root: HTMLElement;

  constructor(root: HTMLElement, onReset?: () => void) {
    this.root = root;
    this.root.innerHTML = `
      <div class="ef-head">
        <span class="ef-title">演出データ</span>
        <span class="ef-cols"><span>発生</span><span>当り</span><span>期待度</span></span>
      </div>
      <div class="ef-rows"></div>
      <div class="ef-note">通常時のゲームだけを数えています。ボーナス中は必ず何か出るので混ぜません。<b>薄い行はまだ回数が足りません</b>（${READABLE_SEEN}回未満）。<br />ステップアップは<b>次のゲームの結果</b>で数えます（終了色が指しているのは次ゲームなので）。</div>
      <div class="ef-actions"><button class="ef-reset" type="button">演出データをリセット</button></div>`;
    this.root
      .querySelector<HTMLButtonElement>('.ef-reset')
      ?.addEventListener('click', () => {
        if (!window.confirm('演出の発生回数と期待度をリセットしますか？')) return;
        resetEffectStats();
        this.update(readEffectStats());
        onReset?.();
      });
    this.update(readEffectStats());
  }

  update(store: EffectStore): void {
    const rows = this.root.querySelector('.ef-rows');
    if (!rows) return;
    rows.innerHTML = EFFECT_KINDS.map(({ key, label }) => {
      const rec = store[key];
      const rate = effectHitRate(rec);
      const thin = !rec || rec.seen < READABLE_SEEN;
      return `<div class="ef-row${thin ? ' thin' : ''}">
        <span class="ef-label">${label}</span>
        <span class="ef-num">${rec ? rec.seen : '—'}</span>
        <span class="ef-num ef-hit">${rec ? rec.hit : '—'}</span>
        <span class="ef-num ef-rate">${rate === null ? '—' : `${rate.toFixed(1)}%`}</span>
      </div>`;
    }).join('');
  }
}
