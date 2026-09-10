import {
  bonusRate,
  effectRate,
  type MachineDay,
} from '../productions/MachineData';

/**
 * データランプ（データカウンター）。筐体の上に載る**別体の表示器**。
 *
 * ホールの台選び（`HallView`）では台ごとに出しているのに、**座って打つ画面には
 * 無かった**。実機のホールで一番見る場所がこれで、BB/RB の回数・確率・ハマり・
 * スランプグラフを見て「この台は続けるか」を決める。
 *
 * 並びは実機アプリの表示器に倣う（2026-09-09）。
 *
 * - **左＝スランプグラフ**。差枚の折れ線に BIG/REG の縦線を重ね、下に横軸の目盛り
 * - **右＝数値のマス**。上段が回数、下段がその確率で、**列で対応する**
 *   （総スタート↔合算・BB↔BB確率・RB↔RB確率・ゲーム数↔演出率）
 *
 * 「ゲーム数」は**最後のボーナスからの回転数**。内部では `sinceBonus` で、
 * 実機の表示器でいう「ボーナス間ゲーム数」にあたる。ハマりと呼ぶと沈んでいる
 * 時だけの言葉に聞こえるが、当たった直後から数え直す普通のカウンタなので
 * ゲーム数でよい。
 *
 * 数字の出どころは `MachineData`（台ID・日替わり）。**計数してもリセットされない**
 * ——あちらは1戦の区切りで、こちらは「その台の今日」だから。
 */

/** 呼び出しランプ（赤）が点く、ボーナス間ゲーム数。ホールの表示器と同じ値にする。 */
const HOT_THRESHOLD = 200;

/** 演出率が設定差として読めるようになる通常時ゲーム数。それ未満は薄く出す。 */
const EFFECT_READABLE_SPINS = 400;

/** 横軸の列数。実機の表示器と同じで、1〜10 の目盛りを振る。 */
const AXIS_COLUMNS = 10;

/** 1列あたりのゲーム数の候補。回すほど大きい方へ繰り上がる。 */
const AXIS_UNITS = [50, 100, 200, 250, 500, 1000, 2000, 5000] as const;

const signed = (n: number): string =>
  `${n > 0 ? '+' : n < 0 ? '−' : '±'}${Math.abs(n)}`;

/**
 * 横軸の1列が何ゲームか。**回すたびに目盛りが動くと読めない**ので、
 * 決まった刻みの中から「今日の回転数が10列に収まる最小のもの」を選ぶ。
 */
function axisUnit(spins: number): number {
  const need = spins / AXIS_COLUMNS;
  return AXIS_UNITS.find((u) => u >= need) ?? AXIS_UNITS[AXIS_UNITS.length - 1];
}

/**
 * スランプグラフ。差枚の折れ線と、ボーナスを引いた位置の縦線。
 *
 * 横軸は**ゲーム数**で、折れ線の点も縦線も同じ尺度に乗る。点は
 * `sampleEvery` ゲームごとなので、i 番目の点は `(i+1) * sampleEvery` 回転目。
 */
function graphSvg(d: MachineDay): string {
  const unit = axisUnit(d.spins);
  const xMax = unit * AXIS_COLUMNS;
  const gx = (games: number): number => (games / xMax) * 100;

  // 縦のグリッド（列の区切り）と ±0 の基準線は、データが無くても出す。
  // 空の箱よりも「これから何が入るか」が分かる。
  const grid = Array.from(
    { length: AXIS_COLUMNS - 1 },
    (_, i) =>
      `<line class="dl-g-grid" x1="${((i + 1) * 10).toFixed(0)}" y1="0" x2="${(
        (i + 1) * 10
      ).toFixed(0)}" y2="100" />`,
  ).join('');

  const marks = d.bonusMarks
    .filter((m) => m.at <= xMax)
    .map(
      (m) =>
        `<line class="dl-g-mark dl-g-mark-${m.kind}" x1="${gx(m.at).toFixed(
          2,
        )}" y1="0" x2="${gx(m.at).toFixed(2)}" y2="100" />`,
    )
    .join('');

  let series = '';
  if (d.samples.length > 0) {
    // 上下に振れるので中央が±0。片側 44 まで使い、天井に貼り付かせない。
    const max = Math.max(1, ...d.samples.map((v) => Math.abs(v)));
    const y = (v: number): number => 50 - (v / max) * 44;
    const pts = d.samples.map(
      (v, i) => `${gx((i + 1) * d.sampleEvery).toFixed(2)},${y(v).toFixed(2)}`,
    );
    const lastX = gx(d.samples.length * d.sampleEvery).toFixed(2);
    // 折れ線と ±0 の間を塗る。**同じ多角形を上下で切り分けて2回描く**——
    // 1色で塗ると、最後がマイナスというだけでプラスに居た区間まで赤くなり、
    // 「ずっと沈んでいた」ように読めてしまう。
    const area = `0,50 ${pts.join(' ')} ${lastX},50`;
    series = `
      <polygon class="dl-g-area plus" points="${area}" clip-path="url(#dl-clip-plus)" />
      <polygon class="dl-g-area minus" points="${area}" clip-path="url(#dl-clip-minus)" />
      <polyline class="dl-g-line" points="${pts.join(' ')}" />`;
  }

  return `<svg class="dl-g-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
    <defs>
      <clipPath id="dl-clip-plus"><rect x="0" y="0" width="100" height="50" /></clipPath>
      <clipPath id="dl-clip-minus"><rect x="0" y="50" width="100" height="50" /></clipPath>
    </defs>
    ${grid}
    ${marks}
    <line class="dl-g-zero" x1="0" y1="50" x2="100" y2="50" />
    ${series}
  </svg>`;
}

/** 右のマス1つ。上段＝回数、下段＝確率。見出しは帯にして値と分ける。 */
function cell(key: string, head: string, unit = ''): string {
  return `<div class="dl-cell">
    <span class="dl-cell-head">${head}</span>
    <span class="dl-cell-value"><b class="dl-${key}">—</b>${
      unit ? `<i>${unit}</i>` : ''
    }</span>
  </div>`;
}

export class DataLamp {
  private readonly root: HTMLElement;

  constructor(root: HTMLElement, machineNumber: number) {
    this.root = root;
    this.root.innerHTML = `
      <div class="dl-graph">
        <div class="dl-legend">
          <span class="dl-lamps" aria-hidden="true">
            <i class="dl-lamp dl-lamp-red"></i><i class="dl-lamp dl-lamp-yellow"></i>
          </span>
          <span class="dl-seat">${String(machineNumber).padStart(3, '0')}</span>
          <span class="dl-leg dl-leg-big">BB</span>
          <span class="dl-leg dl-leg-reg">RB</span>
          <span class="dl-leg dl-leg-line">差枚 <b class="dl-sahmai">±0</b></span>
          <span class="dl-leg-unit">×<b class="dl-unit">100</b>G</span>
        </div>
        <div class="dl-graph-box"></div>
        <div class="dl-axis">${Array.from(
          { length: AXIS_COLUMNS },
          (_, i) => `<span>${i + 1}</span>`,
        ).join('')}</div>
      </div>
      <div class="dl-cells">
        ${cell('spins', '総スタート', 'G')}
        ${cell('bb', 'BB', '回')}
        ${cell('rb', 'RB', '回')}
        ${cell('since', 'ゲーム数', 'G')}
        ${cell('rate', '合算確率')}
        ${cell('bbrate', 'BB確率')}
        ${cell('rbrate', 'RB確率')}
        ${cell('effect', '演出率')}
      </div>`;
  }

  private q<T extends HTMLElement>(sel: string): T {
    return this.root.querySelector<T>(sel)!;
  }

  update(d: MachineDay): void {
    this.q('.dl-spins').textContent = String(d.spins);
    this.q('.dl-bb').textContent = String(d.big);
    this.q('.dl-rb').textContent = String(d.reg);
    this.q('.dl-since').textContent = String(d.sinceBonus);

    const oneIn = (count: number): string =>
      count > 0 ? `1/${(d.spins / count).toFixed(0)}` : '—';
    const total = bonusRate(d);
    this.q('.dl-rate').textContent = total === null ? '—' : `1/${total.toFixed(0)}`;
    this.q('.dl-bbrate').textContent = oneIn(d.big);
    this.q('.dl-rbrate').textContent = oneIn(d.reg);

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

    this.q('.dl-unit').textContent = String(axisUnit(d.spins));

    // ゲーム数が伸びたら赤、プラス差枚なら黄。ホールの表示器と同じ割り当て。
    this.root
      .querySelector('.dl-lamp-red')
      ?.classList.toggle('on', d.sinceBonus >= HOT_THRESHOLD);
    this.root
      .querySelector('.dl-lamp-yellow')
      ?.classList.toggle('on', d.sahmai > 0);

    this.q('.dl-graph-box').innerHTML = graphSvg(d);
  }
}
