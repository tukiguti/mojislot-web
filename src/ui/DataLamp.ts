import {
  bonusRate,
  effectRate,
  type MachineDay,
} from '../productions/MachineData';

/**
 * データランプ（データカウンター）。筐体の**上に載る別体の表示器**。
 *
 * ホールの台選び（`HallView`）では台ごとに出しているのに、**座って打つ画面には
 * 無かった**。実機のホールで一番見る場所がこれで、BB/RB の回数・合算確率・
 * ハマり・スランプグラフを見て「この台は続けるか」を決める。
 *
 * 数字の出どころは `MachineData`（台ID・日替わり）。**計数してもリセットされない**
 * ——あちらは1戦の区切りで、こちらは「その台の今日」だから。
 *
 * 設定を読める数字は演出率だけ（`MachineSetting`）。BB/RB や合算は設定差が
 * 小さすぎて事実上読めないが、**打っている実感の主役はこちら**なので出す。
 * 読めるかどうかと、見たいかどうかは別の話。
 */

/** ハマりランプが点く回転数。ホールの表示器と同じ値にする。 */
const HOT_THRESHOLD = 200;

/** 演出率が設定差として読めるようになる通常時ゲーム数。それ未満は薄く出す。 */
const EFFECT_READABLE_SPINS = 400;

const signed = (n: number): string =>
  `${n > 0 ? '+' : n < 0 ? '−' : '±'}${Math.abs(n)}`;

/**
 * スランプグラフ。差枚の推移を折れ線で描く。
 *
 * ホールのカードでは棒で描いているが、あちらは幅 120px しかないため。ここは
 * 筐体の幅いっぱいを使えるので、実機の表示器と同じ折れ線にする。
 *
 * SVG は `preserveAspectRatio="none"` で箱に合わせて伸ばす。点の数は日によって
 * 変わる（`MachineData` が溢れたら間引く）ので、横は常に 0〜100 に正規化する。
 */
function graphSvg(d: MachineDay): string {
  const n = d.samples.length;
  if (n === 0) {
    return `<svg class="dl-graph-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <line class="dl-graph-zero" x1="0" y1="50" x2="100" y2="50" />
    </svg>`;
  }
  // 上下に振れるので中央が±0。片側 44 まで使い、天井に貼り付かせない。
  const max = Math.max(1, ...d.samples.map((v) => Math.abs(v)));
  const x = (i: number): number => (n === 1 ? 50 : (i / (n - 1)) * 100);
  const y = (v: number): number => 50 - (v / max) * 44;
  const pts = d.samples.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  // 折れ線と ±0 の間を塗る。**同じ多角形を上下で切り分けて2回描く**——
  // 1色で塗ると、最後がマイナスというだけでプラスに居た区間まで赤くなり、
  // 「ずっと沈んでいた」ように読めてしまう。
  const area = `0,50 ${pts.join(' ')} ${x(n - 1).toFixed(1)},50`;
  return `<svg class="dl-graph-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
    <defs>
      <clipPath id="dl-clip-plus"><rect x="0" y="0" width="100" height="50" /></clipPath>
      <clipPath id="dl-clip-minus"><rect x="0" y="50" width="100" height="50" /></clipPath>
    </defs>
    <polygon class="dl-graph-area plus" points="${area}" clip-path="url(#dl-clip-plus)" />
    <polygon class="dl-graph-area minus" points="${area}" clip-path="url(#dl-clip-minus)" />
    <line class="dl-graph-zero" x1="0" y1="50" x2="100" y2="50" />
    <polyline class="dl-graph-line" points="${pts.join(' ')}" />
  </svg>`;
}

export class DataLamp {
  private readonly root: HTMLElement;

  constructor(root: HTMLElement, machineNumber: number) {
    this.root = root;
    this.root.innerHTML = `
      <div class="dl-head">
        <span class="dl-lamps" aria-hidden="true">
          <i class="dl-lamp dl-lamp-red"></i><i class="dl-lamp dl-lamp-yellow"></i>
        </span>
        <span class="dl-seat">${String(machineNumber).padStart(3, '0')}</span>
        <div class="dl-stats">
          <div class="dl-cell"><span>BB</span><b class="dl-bb">0</b></div>
          <div class="dl-cell"><span>RB</span><b class="dl-rb">0</b></div>
          <div class="dl-cell dl-wide"><span>合算</span><b class="dl-rate">—</b></div>
          <div class="dl-cell dl-wide"><span>総スタート</span><b class="dl-spins">0</b></div>
          <div class="dl-cell"><span>ハマり</span><b class="dl-since">0</b></div>
          <div class="dl-cell dl-wide"><span>演出</span><b class="dl-effect">—</b></div>
        </div>
      </div>
      <div class="dl-graph">
        <div class="dl-graph-box"></div>
        <span class="dl-graph-label">差枚 <b class="dl-sahmai">±0</b></span>
      </div>`;
  }

  private q<T extends HTMLElement>(sel: string): T {
    return this.root.querySelector<T>(sel)!;
  }

  update(d: MachineDay): void {
    this.q('.dl-bb').textContent = String(d.big);
    this.q('.dl-rb').textContent = String(d.reg);
    this.q('.dl-spins').textContent = String(d.spins);
    this.q('.dl-since').textContent = String(d.sinceBonus);

    const rate = bonusRate(d);
    this.q('.dl-rate').textContent = rate === null ? '—' : `1/${rate.toFixed(0)}`;

    // 演出率だけは設定を読める数字。サンプルが足りないうちは薄くして、
    // 「まだ読める数字ではない」と分かるようにする（同じ見た目だと誤読を招く）。
    const eff = effectRate(d);
    const effEl = this.q('.dl-effect');
    effEl.textContent = eff === null ? '—' : `${(eff * 100).toFixed(1)}%`;
    effEl.classList.toggle('thin', d.normalSpins < EFFECT_READABLE_SPINS);

    const sahmai = this.q('.dl-sahmai');
    sahmai.textContent = signed(d.sahmai);
    sahmai.classList.toggle('plus', d.sahmai > 0);
    sahmai.classList.toggle('minus', d.sahmai < 0);

    // ハマり＝赤、プラス差枚＝黄。ホールの表示器と同じ割り当て。
    this.root
      .querySelector('.dl-lamp-red')
      ?.classList.toggle('on', d.sinceBonus >= HOT_THRESHOLD);
    this.root
      .querySelector('.dl-lamp-yellow')
      ?.classList.toggle('on', d.sahmai > 0);

    this.q('.dl-graph-box').innerHTML = graphSvg(d);
  }
}
