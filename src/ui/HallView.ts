import { CHAPTERS, setCurrentChapterId } from '../data/chapters';
import {
  ISLANDS,
  MACHINES,
  SEATS_PER_ISLAND,
  chapterIdOfMachine,
  getCurrentMachine,
  REMIX_ISLAND_ID,
  islandById,
  isTrialMachine,
  machinesOfIsland,
  setCurrentMachineId,
  type Island,
  type Machine,
} from '../data/machines';
import { lineColorOf, themeVars } from '../data/islandThemes';
import { PayoutSchema, TuningSchema, YakuListSchema, type YakuList } from '../data/schemas';
import { hallPolicyFor, isTargeted, type HallPolicy } from '../productions/HallPolicy';
import { getMemberName } from '../productions/Member';
import { RUN_RULESET_VERSION, loadRunHistory } from '../productions/RunHistory';
import {
  bonusRate,
  effectRate,
  readAllMachineDays,
  readMachineDay,
  type MachineDay,
} from '../productions/MachineData';
import payoutDataRaw from '../../data/payouts/default.json';
import tuningDataRaw from '../../data/tuning/default.json';
import './hall.css';

/**
 * ホール（台を選ぶ）。入口 → 島 → 寄り の3段階で打つ台を決める。
 *
 * 章カード5枚の一覧を、実機のホールと同じ**24台から1台を選ぶ**体験に置き換えたもの。
 * 同じ島の4台はリール配列が同じで、違うのは**設定だけ**。だから配列を覚える技術は
 * 島の中で持ち越せて、台移動しても無駄にならない。
 *
 * デザインの一次情報は claude.ai/design の「MOJISLOT 台を選ぶ.dc.html」。
 * 構造と寸法は style.css の `.hall-*`、色は島テーマ（`--isl-*`）から来る。
 *
 * プレイ設定（ミッション/リール絵柄/AUTO/デバッグ）は**寄り画面の座る直前**に置いた。
 * 打つ直前が最後に確認する場所なので、選ぶ→設定→遊ぶの順序が壊れない。
 */

export interface HallViewCallbacks {
  /** 台と設定を確定してゲームを起動する。 */
  onLaunch: () => void;
  /** 景品カウンター（会員カード）へ。 */
  onCard: () => void;
  /** 景品カウンター（ランキング）へ。 */
  onRanking: () => void;
}

/** プレイ設定の保存先。既存コードが読む正本に合わせる（PlaySetup から引き継ぎ）。 */
const MISSIONS_KEY = 'mojislot.challengesEnabled.v1';
const REEL_ART_KEY = 'mojislot.reelArt.v1';
const DEBUG_KEY = 'mojislot.debugVisible.v1';
const PLAY_SETUP_KEY = 'mojislot.playSetup.v1';

/** スマホ用マークアップへ切り替える幅。CSSではなく状態で分岐する（入口は構造ごと違う）。 */
const NARROW_AT = 760;
/** ハマりの警告しきい値（回転数）。実機の呼出ランプが赤くなる目安。 */
const HOT_THRESHOLD = 200;
/** 入場アニメーションの長さ。ドア0.8秒＋ズーム1.15秒より少し後で切り替える。 */
const ENTER_MS = 1150;
/** 台カードの倍率を測り直す間隔。フォント読み込み等で後からずれるため。 */
const FIT_MS = 400;
/**
 * 演出率が「読める数字」になる通常時ゲーム数。設定1（約25%）と設定6（約35%）が
 * 3σで分かれるのが約400ゲームなので、そこを境に表示の濃さを変える。
 */
const EFFECT_READABLE_SPINS = 400;

const payout = PayoutSchema.parse(payoutDataRaw);
const tuning = TuningSchema.parse(tuningDataRaw);

const esc = (s: string): string =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ] ?? c,
  );

const signed = (n: number): string => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${Math.abs(n)}`;

/** 曜日つきの日付。ホールの看板に出す。 */
function todayLabel(now: Date): string {
  const w = ['日', '月', '火', '水', '木', '金', '土'][now.getDay()];
  return `${now.getMonth() + 1}/${now.getDate()} (${w})`;
}

/** 章の役リスト。配当表とリールの停止表示に使うので、島を開いた時だけ読む。 */
const yakuCache = new Map<string, YakuList>();
function yakuOf(chapterId: string): YakuList {
  const hit = yakuCache.get(chapterId);
  if (hit) return hit;
  const chapter = CHAPTERS.find((c) => c.id === chapterId);
  if (!chapter) throw new Error(`章「${chapterId}」がありません`);
  const parsed = YakuListSchema.parse(chapter.yakuData);
  yakuCache.set(chapterId, parsed);
  return parsed;
}

const wordOf = (symbols: readonly string[]): string => symbols.join('');

/** 着席できない島か。いまはステージ切替が未実装のリミックス島だけ。 */
const closed = (island: Island): boolean => island.id === REMIX_ISLAND_ID;

/**
 * 島の役（小役4・チェリー・REG・BIG2）。配当表と筐体の図柄に使う。
 *
 * リミックス島は章を複数持つので、**小役は章をまたいで1つずつ**取る。i番目の章から
 * i番目の小役を取れば 4/6/8/10 の枚数の階段は保たれる。ボーナスは最後の章から丸ごと
 * 取る（REG＝BIG2種から文字を借りる構成規則を島の中で成立させるため）。
 */
function islandYaku(island: Island, seat = 1): {
  words: string[];
  pays: number[];
  cherry: string;
  reg: string;
  big: string[];
} {
  // 試打コーナーは席ごとに1機種。その席の章だけを見る。
  if (island.trial) {
    const y = yakuOf(island.chapterIds[seat - 1] ?? island.chapterIds[0]);
    return {
      words: y.coreYaku.map((k) => wordOf(k.symbols)),
      pays: y.coreYaku.map((k) => k.payout ?? 0),
      cherry: wordOf(y.cherryYaku[0].symbols),
      reg: wordOf(y.bonusYaku[0].symbols),
      big: y.premiumYaku.map((k) => wordOf(k.symbols)),
    };
  }
  const lists = island.chapterIds.map(yakuOf);
  const bonusFrom = lists[lists.length - 1];
  const cores =
    lists.length === 1
      ? lists[0].coreYaku
      : lists[0].coreYaku.map((_, i) => (lists[i] ?? lists[0]).coreYaku[i]);
  return {
    words: cores.map((k) => wordOf(k.symbols)),
    pays: cores.map((k) => k.payout ?? 0),
    cherry: wordOf(bonusFrom.cherryYaku[0].symbols),
    reg: wordOf(bonusFrom.bonusYaku[0].symbols),
    big: bonusFrom.premiumYaku.map((k) => wordOf(k.symbols)),
  };
}

/**
 * 筐体のリール窓に出す3×3。席ごとに違う停止位置にして「同じ配列・違う止まり方」を見せる。
 * 中段はBIG図柄。打つ前の飾りなので当選とは無関係。
 */
function reelGrid(island: Island, seat: number): string[] {
  const { words, big } = islandYaku(island, seat);
  // 席数は島によって違う（試打コーナーは5席）が小役は4つなので、必ず折り返す。
  const rows = [
    words[(seat - 1) % words.length],
    big[0],
    words[seat % words.length],
  ];
  const out: string[] = [];
  rows.forEach((w, r) => {
    for (let c = 0; c < 3; c++) out.push(w[(c + r + seat) % 3] ?? '');
  });
  return out;
}

/** 1台ぶんの表示値。データが無い台は「—」で、まだ誰も打っていないことを示す。 */
interface MachineView {
  machine: Machine;
  island: Island;
  day: MachineDay;
  played: boolean;
  hot: boolean;
  plus: boolean;
  target: boolean;
}

function viewOf(
  machine: Machine,
  day: MachineDay,
  policy: HallPolicy,
): MachineView {
  return {
    machine,
    island: islandById(machine.islandId) ?? ISLANDS[0],
    day,
    played: day.spins > 0,
    hot: day.sinceBonus >= HOT_THRESHOLD,
    plus: day.sahmai > 0,
    target: isTargeted(machine, policy),
  };
}

/** ホール方針のタグ（狙い目バッジの文字）。掲示が無い日は空。 */
function policyTag(policy: HallPolicy): string {
  switch (policy.kind) {
    case 'tail':
      return `末尾${policy.tail}`;
    case 'island':
      return '強化島';
    case 'corner':
      return '角狙い';
    default:
      return '';
  }
}

// ═══════════ 部品 ═══════════

/**
 * スランプグラフ。差枚の推移を0〜100%の高さに正規化する。
 * 実データ（MachineDay.samples）だけで描き、点が無ければ何も出さない。
 */
function graphBars(day: MachineDay): string {
  if (day.samples.length === 0) return '';
  const max = Math.max(1, ...day.samples.map((v) => Math.abs(v)));
  return day.samples
    .map((v) => {
      // 中央が±0。上下に振れるので 50% を基準に半分ずつ使う。
      const h = 50 + (v / max) * 44;
      return `<span class="hall-graph-bar" style="height:${h.toFixed(0)}%"></span>`;
    })
    .join('');
}

/**
 * 演出の出方。**設定を読める唯一の数字**なのでカウンターに出す。
 *
 * 設定差は演出率に乗せてあり（`MachineSetting`）、2台を3σで見分けるのに
 * 演出率なら約400ゲーム、合成確率だと28万ゲーム要る。数字にしないと
 * 「なんとなく出てる気がする」で終わってしまう。
 *
 * 母数は通常時のゲーム数。ハズレと1枚役は元から演出が出ないので、
 * ここには**画面上「演出が出た」ように見えたゲーム**の割合が出る。
 */
function effectMeter(d: MachineDay): string {
  const rate = effectRate(d);
  if (rate === null) {
    return `<div class="hall-effmeter empty"><span>演出</span><b>—</b></div>`;
  }
  // 設定1で約25%・設定6で約35%。目盛りはその間に置く。
  const pct = rate * 100;
  const fill = Math.max(0, Math.min(100, ((pct - 20) / 20) * 100));
  // 400ゲーム弱で設定1と6が3σで分かれる。それより手前は薄く出して
  // 「まだ読める数字ではない」と分かるようにする（同じ見た目だと誤読を招く）。
  const thin = d.normalSpins < EFFECT_READABLE_SPINS;
  return `
    <div class="hall-effmeter${thin ? ' thin' : ''}" ${thin ? 'title="まだサンプルが足りません"' : ''}>
      <span class="hall-effmeter-label">演出</span>
      <span class="hall-effmeter-bar"><i style="width:${fill.toFixed(0)}%"></i></span>
      <b class="hall-effmeter-value">${pct.toFixed(1)}%</b>
      <span class="hall-effmeter-n">${d.effectSpins}/${d.normalSpins}</span>
    </div>`;
}

/**
 * 筐体のタイトルパネルに出す名前。通常は島名だが、**試打コーナーは席ごとに機種が違う**ので
 * その台の章名を出す（全部「試打コーナー」だと何の台か分からない）。
 */
/**
 * その台の筐体デザインを引く島ID。試打コーナーは席ごとに機種が違うので、
 * **島のテーマではなくその機種のテーマ**を着せる（並べた時に何の台か色で分かる）。
 */
function themeIdOf(v: MachineView): string {
  return v.island.trial ? chapterIdOfMachine(v.machine) : v.island.id;
}

function machineTitle(v: MachineView): string {
  if (!v.island.trial) return v.island.name;
  const id = chapterIdOfMachine(v.machine);
  return CHAPTERS.find((c) => c.id === id)?.name ?? v.island.name;
}

/** データ表示器（ホール設備・全島共通のデザイン）。筐体とは別体で上に載る。 */
function dataCounter(v: MachineView): string {
  const d = v.day;
  const num = (n: number): string => (v.played ? String(n) : '—');
  return `
    <div class="hall-counter">
      <div class="hall-lamps">
        <span class="hall-lamp hall-lamp-red${v.hot ? ' on' : ''}"></span>
        <span class="hall-lamp hall-lamp-yellow${v.plus ? ' on' : ''}"></span>
        <span class="hall-lamp hall-lamp-green${v.target ? ' on' : ''}"></span>
        <span class="hall-lamp-gloss"></span>
      </div>
      <div class="hall-seg">
        <span class="hall-seg-label">台番</span>
        <span class="hall-seg-value">${String(v.machine.number).padStart(3, '0')}</span>
      </div>
      <div class="hall-counter-grid">
        <div class="hall-counter-cell"><span>BB</span><b class="hall-num-bb">${num(d.big)}</b></div>
        <div class="hall-counter-cell"><span>RB</span><b class="hall-num-rb">${num(d.reg)}</b></div>
        <div class="hall-counter-cell"><span>総スタート</span><b class="hall-num-games">${num(d.spins)}</b></div>
      </div>
      <div class="hall-graph">
        <span class="hall-graph-base"></span>
        ${graphBars(d)}
        <span class="hall-graph-label">差枚 ${v.played ? signed(d.sahmai) : '±0'}</span>
      </div>
      ${effectMeter(d)}
    </div>`;
}

/** 筐体。シャーシは全島共通で、パネル・リール窓・ボタンだけがテーマで変わる。 */
function cabinet(v: MachineView, size: 'floor' | 'seat'): string {
  const cells = reelGrid(v.island, v.machine.seat)
    .map((ch) => `<span class="hall-cell">${esc(ch)}</span>`)
    .join('');
  const insert =
    size === 'seat'
      ? `<span class="hall-info-lamp">INSERT</span>`
      : '';
  const settle =
    size === 'seat'
      ? `<div class="hall-settle"><span class="hall-slot-mouth"></span><span class="hall-settle-btn">精算</span></div>`
      : `<span class="hall-slot-mouth"></span>`;
  return `
    <div class="hall-cabinet hall-cabinet-${size}">
      <div class="hall-toplamp"></div>
      <div class="hall-titlepanel"><span>${esc(machineTitle(v))}</span></div>
      <div class="hall-lcd">
        <span class="hall-lcd-scan"></span>
        <span class="hall-lcd-text">演出液晶</span>
        <span class="hall-lcd-glow"></span>
      </div>
      <div class="hall-reelframe">
        <div class="hall-reelgrid">${cells}</div>
        <span class="hall-payline"></span>
        <span class="hall-payline-dot hall-payline-dot-l"></span>
        <span class="hall-payline-dot hall-payline-dot-r"></span>
      </div>
      <div class="hall-infopanel">
        <span class="hall-info-label">CREDIT</span>
        <span class="hall-info-value">00</span>
        <div class="hall-info-lamps">
          <span class="hall-info-lamp hall-info-replay">REPLAY</span>
          ${insert}
          <span class="hall-info-lamp">START</span>
        </div>
        <span class="hall-info-label">PAYOUT</span>
        <span class="hall-info-value">00</span>
      </div>
      <div class="hall-ctrl">
        <div class="hall-bets">
          <span class="hall-maxbet">MAX</span>
          <span class="hall-1bet">1BET</span>
        </div>
        <div class="hall-lever">
          <span class="hall-lever-ball"></span>
          <span class="hall-lever-rod"></span>
        </div>
        <div class="hall-stops">
          <span class="hall-stop"></span>
          <span class="hall-stop"></span>
          <span class="hall-stop"></span>
        </div>
        ${settle}
      </div>
      <div class="hall-lowerpanel"><span>MOJISLOT</span></div>
      <div class="hall-tray"></div>
    </div>`;
}

/** 島に並ぶ1台（表示器＋筐体＋丸椅子＋選択枠）と、その右の台間サンド。 */
function machineCard(v: MachineView, selected: boolean): string {
  return `
    <div class="hall-slot">
      <div class="hall-machine${selected ? ' selected' : ''}" data-machine="${v.machine.id}"
           style="${themeVars(themeIdOf(v))}" role="button" tabindex="0">
        ${dataCounter(v)}
        ${cabinet(v, 'floor')}
        <div class="hall-stool"><span class="hall-stool-seat"></span><span class="hall-stool-pole"></span></div>
        <span class="hall-selframe"></span>
      </div>
      <div class="hall-sand">
        <span class="hall-sand-lamp"></span>
        <span class="hall-sand-mouth"></span>
      </div>
    </div>`;
}

// ═══════════ 画面 ═══════════

/** カウンター前で選んでいる場所。 */
export type CounterSpot = 'card' | 'rank';

interface HallState {
  phase: 'entrance' | 'entering' | 'floor' | 'counter' | 'seat';
  /** 表示中の場所。0〜島数-1 が島、島数が景品カウンター。 */
  nav: number;
  /** 選択中の台ID。 */
  selId: string;
  /** 寄りで見ている台ID（島を移動しても寄りの中身が変わらないよう保持）。 */
  seatId: string;
  /** カウンター前で選んでいる場所。 */
  spot: CounterSpot;
  /** 場所を切り替えた向き。島のスライドと動きを揃えるために持つ。 */
  slide: 'none' | 'left' | 'right';
  narrow: boolean;
  scale: number;
}

/** mountHallView の戻り。会員カード/ランキングから戻る時にカウンター前へ寄せる。 */
export interface HallViewHandle {
  showCounter(spot: CounterSpot): void;
}

export function mountHallView(cb: HallViewCallbacks): HallViewHandle {
  const found = document.getElementById('view-play');
  // 置き場所が無い環境（テスト等）では何もしないハンドルを返す。
  if (!found) return { showCounter: () => {} };
  // render()/wire() は巻き上げられる関数宣言なので、絞り込み済みの const に持ち替える。
  const root: HTMLElement = found;

  /**
   * 場所の並び。**左端が景品カウンター**で、その右に島が続く。
   * 実際のホールでも景品カウンターは入って手前の端にあり、島の列はその奥へ伸びる。
   * `nav` 0 = カウンター、1..N = ISLANDS[nav-1]。
   */
  const PLACES = ISLANDS.length + 1;
  const COUNTER_NAV = 0;
  const islandAt = (nav: number): Island => ISLANDS[nav - 1] ?? ISLANDS[0];
  const navOfIsland = (idx: number): number => idx + 1;

  const initial = getCurrentMachine();
  const st: HallState = {
    phase: 'entrance',
    nav: navOfIsland(Math.max(0, ISLANDS.findIndex((i) => i.id === initial.islandId))),
    selId: initial.id,
    seatId: initial.id,
    spot: 'card',
    slide: 'none',
    narrow: window.innerWidth < NARROW_AT,
    scale: 1,
  };

  let track: HTMLElement | null = null;
  let fitTimer: number | null = null;
  let enterTimer: number | null = null;
  let touch: { x: number; y: number; col: HTMLElement | null; left: number } | null =
    null;

  const now = (): Date => new Date();
  const policy = (): HallPolicy => hallPolicyFor(now());
  const days = (): Map<string, MachineDay> =>
    readAllMachineDays(
      MACHINES.map((m) => m.id),
      now(),
    );

  const machineOf = (id: string): Machine =>
    MACHINES.find((m) => m.id === id) ?? MACHINES[0];

  const selMachine = (): Machine => machineOf(st.selId);

  // ─── 倍率の実測 ───
  // 台カードは固定寸法で作り、画面に合わせるのは1つの倍率だけ。各パーツを個別に
  // clamp() で可変にすると最小値の合計が画面高を超えて上端が切れる（デザインの罠1）。
  const fit = (): void => {
    const narrow = window.innerWidth < NARROW_AT;
    if (narrow !== st.narrow) {
      st.narrow = narrow;
      render();
      return;
    }
    if (!track) return;
    const row = track.querySelector<HTMLElement>('[data-card-row]');
    const box = track.getBoundingClientRect();
    if (!row || !row.offsetHeight || !box.height) return;
    // 6px 引いてから切り捨てる。切り上げると1pxはみ出して選択枠の上辺が切れる。
    const byH = (box.height - 6) / row.offsetHeight;
    const raw = narrow
      ? Math.min(1, byH)
      : Math.min(1, byH, (box.width - 6) / row.offsetWidth);
    const next = Math.floor(raw * 1000) / 1000;
    if (Math.abs(next - st.scale) < 0.0005) return;
    st.scale = next;
    track
      .querySelectorAll<HTMLElement>('[data-card-row]')
      .forEach((el) => (el.style.transform = `scale(${next.toFixed(3)})`));
  };

  /**
   * 幅の見張りは**どの局面でも回し続ける**。以前は島の画面でしか回しておらず、
   * カウンターや入口にいる間に幅が変わっても次の作り直しまで気付かなかった。
   * 台カードの実測（重い方）は `track` がある島の画面でだけ走る。
   */
  const startFit = (): void => {
    if (fitTimer !== null) return;
    fitTimer = window.setInterval(fit, FIT_MS);
  };

  // ─── 移動 ───
  /**
   * 局面を切り替える。`slide` は「新しい画面がどちら側から入ってくるか」。
   * 島どうしはトラックの transform で滑るが、島↔カウンターは画面ごと作り直すので、
   * 同じ長さ・同じイージングで横に滑らせないと**そこだけ動きが変わって見える**。
   */
  const go = (phase: HallState['phase'], slide: HallState['slide'] = 'none'): void => {
    st.phase = phase;
    st.slide = slide;
    render();
  };

  const enterHall = (): void => {
    if (st.phase !== 'entrance') return;
    st.phase = 'entering';
    render();
    if (enterTimer !== null) window.clearTimeout(enterTimer);
    enterTimer = window.setTimeout(() => go('floor'), ENTER_MS);
  };

  /**
   * 場所を1つ横へ。島から島へは選択台が同じ席番号を引き継ぐ（隣の島の同じ位置へ歩く感じ）。
   * 島の端から先は景品カウンターで、そこは画面ごと切り替わる。
   */
  const move = (d: number): void => {
    const nav = (st.nav + d + PLACES) % PLACES;
    const dir: HallState['slide'] = d > 0 ? 'right' : 'left';
    if (nav === COUNTER_NAV) {
      st.nav = nav;
      go('counter', dir);
      return;
    }
    const seat = selMachine().seat;
    const island = islandAt(nav);
    const next =
      machinesOfIsland(island.id).find((m) => m.seat === seat) ??
      machinesOfIsland(island.id)[0];
    const wasCounter = st.nav === COUNTER_NAV;
    st.nav = nav;
    st.selId = next.id;
    if (wasCounter) go('floor', dir);
    else updateFloor();
  };

  const toSeat = (id: string): void => {
    st.selId = id;
    st.seatId = id;
    go('seat');
  };

  // ─── 入口 ───
  const guideRows = (): string =>
    ISLANDS.map((island, idx) => {
      // 試打コーナーは機種が混在するので、小役ではなく**並んでいる機種名**を出す。
      const lineup = island.trial
        ? island.chapterIds
            .map((id) => CHAPTERS.find((c) => c.id === id)?.name ?? id)
            .join('・')
        : islandYaku(island, 1).words.join('・');
      const seats = island.seats ?? SEATS_PER_ISLAND;
      const range = `${island.no}1 – ${island.no}${seats}`;
      const tail = closed(island)
        ? `<span class="hall-guide-wip">調整中</span>`
        : island.trial
          ? `<span class="hall-guide-open">設定6</span>`
          : `<span class="hall-guide-range">${range}</span>`;
      return `
        <div class="hall-guide-row" data-island="${idx}" role="button" tabindex="0">
          <span class="hall-guide-bar" style="background:${lineColorOf(island.id)}"></span>
          <span class="hall-guide-text">
            <b>${esc(island.name)}</b>
            <i>${esc(lineup)}</i>
          </span>
          ${tail}
        </div>`;
    }).join('');

  const doorSilhouettes = (heights: number[]): string =>
    ISLANDS.map(
      (island, i) =>
        `<span class="hall-door-sil" style="height:${heights[i] ?? 150}px;border-top-color:${lineColorOf(island.id)}"></span>`,
    ).join('');

  const entranceCommon = (): {
    poster: string;
    today: string;
    running: number;
  } => {
    const p = policy();
    const all = days();
    return {
      poster: p.poster ?? '本日は通常営業です',
      today: todayLabel(now()),
      running: MACHINES.filter((m) => (all.get(m.id)?.spins ?? 0) > 0).length,
    };
  };

  const entranceWide = (): string => {
    const c = entranceCommon();
    return `
      <div class="hall-entrance${st.phase === 'entering' ? ' entering' : ''}">
        <span class="hall-sky"></span>
        <span class="hall-wall"></span>
        <span class="hall-road"></span>
        <span class="hall-signglow"></span>

        <div class="hall-bigsign">
          <div class="hall-bigsign-box">
            <span class="hall-bigsign-sub">SLOT HALL</span>
            <span class="hall-bigsign-logo">MOJISLOT</span>
            <span class="hall-bigsign-chase"></span>
          </div>
          <div class="hall-openrow">
            <div class="hall-openbadge"><span class="hall-openlamp"></span><span>営業中</span></div>
            <span class="hall-opentime">9:00 – 22:45　${esc(c.today)}</span>
          </div>
        </div>

        <div class="hall-door" data-act="enter" role="button" tabindex="0">
          <span class="hall-door-inner"></span>
          <span class="hall-door-ceil"></span>
          <div class="hall-door-sils">${doorSilhouettes([150, 168, 158, 172, 146, 162])}</div>
          <div class="hall-door-panel hall-door-l"></div>
          <div class="hall-door-panel hall-door-r"></div>
          <span class="hall-door-label">AUTO DOOR</span>
        </div>
        <span class="hall-mat"></span>

        <div class="hall-board">
          <div class="hall-board-face">
            <span class="hall-board-badge">本日の掲示</span>
            <span class="hall-board-text">${esc(c.poster)}</span>
            <span class="hall-board-note">※ 確約ではありません</span>
            <div class="hall-board-foot">
              <span>設置 ${MACHINES.length}台 ／ ${ISLANDS.length}島</span>
              <span>本日 稼働 ${c.running}台</span>
            </div>
          </div>
          <div class="hall-board-leg"></div>
        </div>

        <div class="hall-guide">
          <div class="hall-guide-head">
            <span class="hall-guide-title">島 案 内</span>
            <span class="hall-guide-count">全${ISLANDS.length}島</span>
          </div>
          ${guideRows()}
        </div>

        <div class="hall-counterlinks">
          <span class="hall-counterlinks-title">景品カウンター</span>
          <div class="hall-counterlinks-row">
            <div class="hall-counterlink" data-act="card" role="button" tabindex="0">会員カード</div>
            <div class="hall-counterlink" data-act="ranking" role="button" tabindex="0">ランキング</div>
          </div>
        </div>

        <div class="hall-enter">
          <div class="hall-enter-btn" data-act="enter" role="button" tabindex="0">入 場 す る</div>
          <span class="hall-enter-hint">Enter / クリックで入場　—　場内は ← → で島、1–4 で台、Enter で決定</span>
        </div>
      </div>`;
  };

  const entranceNarrow = (): string => {
    const c = entranceCommon();
    return `
      <div class="hall-entrance narrow${st.phase === 'entering' ? ' entering' : ''}">
        <span class="hall-road"></span>
        <div class="hall-head-sm">
          <span class="hall-bigsign-sub">SLOT HALL</span>
          <span class="hall-bigsign-logo">MOJISLOT</span>
          <div class="hall-openrow">
            <div class="hall-openbadge"><span class="hall-openlamp"></span><span>営業中</span></div>
            <span class="hall-opentime">${esc(c.today)}</span>
          </div>
        </div>

        <div class="hall-door sm" data-act="enter" role="button" tabindex="0">
          <span class="hall-door-inner"></span>
          <span class="hall-door-ceil"></span>
          <div class="hall-door-sils">${doorSilhouettes([96, 108, 101, 112, 93, 104])}</div>
          <div class="hall-door-panel hall-door-l"></div>
          <div class="hall-door-panel hall-door-r"></div>
          <span class="hall-door-label">AUTO DOOR</span>
        </div>
        <span class="hall-mat sm"></span>

        <div class="hall-sm-body">
          <div class="hall-board-face sm">
            <span class="hall-board-badge">本日の掲示</span>
            <span class="hall-board-text">${esc(c.poster)}</span>
            <div class="hall-board-foot">
              <span>設置 ${MACHINES.length}台 ／ ${ISLANDS.length}島</span>
              <span>本日 稼働 ${c.running}台</span>
            </div>
          </div>
          <div class="hall-guide sm">
            <div class="hall-guide-head">
              <span class="hall-guide-title">島 案 内</span>
              <span class="hall-guide-count">全${ISLANDS.length}島</span>
            </div>
            ${guideRows()}
          </div>
        </div>

        <div class="hall-enter sm">
          <div class="hall-enter-btn" data-act="enter" role="button" tabindex="0">入 場 す る</div>
          <div class="hall-counterlinks-row">
            <div class="hall-counterlink" data-act="card" role="button" tabindex="0">会員カード</div>
            <div class="hall-counterlink" data-act="ranking" role="button" tabindex="0">ランキング</div>
          </div>
          <span class="hall-enter-hint">島は左右スワイプ／台をタップで詳細</span>
        </div>
      </div>`;
  };

  /** 画面ごと入れ替わる時のスライド方向。島のトラックと同じ動きに見せるため。 */
  const slideClass = (): string =>
    st.slide === 'none' ? '' : ` from-${st.slide}`;

  /** 場所インジケータ。左端が景品カウンター（幅を狭くして種類の違いを出す）。 */
  const dotsHtml = (): string =>
    [
      `<span class="hall-dot hall-dot-counter${st.nav === COUNTER_NAV ? ' on' : ''}" data-dot="${COUNTER_NAV}" style="--dot:#ffd166"></span>`,
    ]
      .concat(
        ISLANDS.map(
          (island, i) =>
            `<span class="hall-dot${navOfIsland(i) === st.nav ? ' on' : ''}" data-dot="${navOfIsland(i)}" style="--dot:${lineColorOf(island.id)}"></span>`,
        ),
      )
      .join('');

  // ─── 島 ───
  const floorHtml = (): string => {
    const p = policy();
    const all = days();
    const cols = ISLANDS.map((island) => {
      const cards = machinesOfIsland(island.id)
        .map((m) => {
          const day = all.get(m.id);
          return day ? machineCard(viewOf(m, day, p), m.id === st.selId) : '';
        })
        .join('');
      return `
        <div class="hall-col" data-island-col
             style="${themeVars(island.id)};width:${(100 / ISLANDS.length).toFixed(4)}%">
          <div class="hall-cardrow" data-card-row>
            <span class="hall-endboard"></span>
            ${cards}
          </div>
        </div>`;
    }).join('');

    const dots = dotsHtml();

    return `
      <div class="hall-floor${slideClass()}"${st.narrow ? ' data-narrow' : ''}>
        <div class="hall-ceiling"><span class="hall-ceiling-edge"></span><span class="hall-fluoro"></span></div>
        <div class="hall-far">
          ${Array.from({ length: 9 }, () => '<span class="hall-far-bar"></span>').join('')}
          <span class="hall-far-fade"></span>
        </div>
        <div class="hall-carpet"></div>

        <div class="hall-islandsign" data-island-sign>
          <div class="hall-islandsign-rods"><span></span><span></span></div>
          <div class="hall-islandsign-box" data-sign-box></div>
        </div>

        <div class="hall-aisle hall-aisle-l" data-act="prev" role="button" tabindex="0">
          <span class="hall-aisle-mark">◀</span><span class="hall-aisle-label">前の島</span>
        </div>
        <div class="hall-aisle hall-aisle-r" data-act="next" role="button" tabindex="0">
          <span class="hall-aisle-mark">▶</span><span class="hall-aisle-label">次の島</span>
        </div>

        <div class="hall-dots" data-dots>${dots}</div>

        <div class="hall-track" data-track>
          <div class="hall-slider" data-slider>${cols}</div>
        </div>

        <div class="hall-footbar">
          <div class="hall-footrow">
            <div class="hall-foot-exit" data-act="exit" role="button" tabindex="0">
              <span>←</span><span>入口</span>
            </div>
            <div class="hall-foot-counter" data-act="to-counter" role="button" tabindex="0">
              <span class="hall-foot-counter-bar"></span><span>景品カウンター</span>
            </div>
            <div class="hall-foot-space"></div>
            <div class="hall-foot-go" data-act="zoom" role="button" tabindex="0" data-confirm></div>
          </div>
        </div>
      </div>`;
  };

  /** 島の移動と選択だけを差分で反映する（スライドの transition を殺さないため）。 */
  const updateFloor = (): void => {
    if (st.phase !== 'floor') return;
    const island = islandAt(st.nav);
    const slider = root.querySelector<HTMLElement>('[data-slider]');
    if (slider) {
      slider.style.transform = `translateX(-${((st.nav - 1) * 100) / ISLANDS.length}%)`;
    }
    const sign = root.querySelector<HTMLElement>('[data-sign-box]');
    if (sign) {
      const wip = closed(island);
      sign.setAttribute('style', themeVars(island.id));
      sign.innerHTML = `
        <span class="hall-islandsign-name">${esc(island.name)}</span>
        <span class="hall-islandsign-sep"></span>
        <span class="hall-islandsign-range">${island.no}1 – ${island.no}${island.seats ?? SEATS_PER_ISLAND}</span>
        ${wip ? '<span class="hall-islandsign-wip">調 整 中</span>' : ''}`;
    }
    root.querySelectorAll<HTMLElement>('[data-dot]').forEach((el) => {
      el.classList.toggle('on', Number(el.dataset.dot) === st.nav);
    });
    root.querySelectorAll<HTMLElement>('.hall-machine').forEach((el) => {
      el.classList.toggle('selected', el.dataset.machine === st.selId);
    });
    const goBtn = root.querySelector<HTMLElement>('[data-confirm]');
    if (goBtn) goBtn.textContent = `${selMachine().number}番台を見る ▶`;
    // 隣が景品カウンターなら通路の表示をそう言い換える（「前の島」ではないので）
    const label = (nav: number): string =>
      nav === COUNTER_NAV ? '景品カウンター' : '';
    const prevNav = (st.nav - 1 + PLACES) % PLACES;
    const nextNav = (st.nav + 1) % PLACES;
    const setLabel = (sel: string, nav: number, fallback: string): void => {
      const el = root.querySelector<HTMLElement>(`${sel} .hall-aisle-label`);
      if (el) el.textContent = label(nav) || fallback;
    };
    setLabel('.hall-aisle-l', prevNav, '前の島');
    setLabel('.hall-aisle-r', nextNav, '次の島');
  };

  // ─── 景品カウンター前（引きの絵） ───

  /** 景品棚。飾りなので中身は固定。色は各島の主色から借りて場内の統一感を出す。 */
  const SHELF: { c: string; h: number }[][] = [
    [
      { c: 'linear-gradient(#c8342a,#8a1c16)', h: 62 },
      { c: 'linear-gradient(#d99a20,#8a6210)', h: 82 },
      { c: 'linear-gradient(#e8dcc8,#a89880)', h: 54 },
    ],
    [
      { c: 'linear-gradient(#2e6b30,#1c4a1e)', h: 74 },
      { c: 'linear-gradient(#43d9ff,#1a6a8a)', h: 56 },
      { c: 'linear-gradient(#b8a0ff,#5a4a90)', h: 88 },
    ],
    [
      { c: 'linear-gradient(#e8dcc8,#a89880)', h: 58 },
      { c: 'linear-gradient(#c8342a,#8a1c16)', h: 78 },
      { c: 'linear-gradient(#d99a20,#8a6210)', h: 66 },
    ],
  ];

  const shelfHtml = (flip: boolean): string => {
    const rows = flip ? [...SHELF].reverse() : SHELF;
    const shelves = rows
      .map(
        (row, i) =>
          `<div class="hall-shelf-row${i === rows.length - 1 ? ' last' : ''}">${row
            .map((x) => `<span style="height:${x.h}%;background:${x.c}"></span>`)
            .join('')}</div>`,
      )
      .join('');
    return `
      <div class="hall-shelf">
        <span class="hall-shelf-label">景　品</span>
        ${shelves}
        <span class="hall-shelf-gloss"></span>
      </div>`;
  };

  /** データボードに出す本日の上位3件。条件は既定（最新規則・DEBUG除外）と揃える。 */
  const topThree = (): { no: number; member: string; machine: string; sahmai: number }[] => {
    const today = new Date();
    const sameDay = (ms: number): boolean => {
      const d = new Date(ms);
      return (
        d.getFullYear() === today.getFullYear() &&
        d.getMonth() === today.getMonth() &&
        d.getDate() === today.getDate()
      );
    };
    return loadRunHistory()
      .filter(
        (r) =>
          sameDay(r.settledAt) &&
          r.rulesetVersion === RUN_RULESET_VERSION &&
          !r.debugEnabled,
      )
      .sort((a, b) => b.sahmai - a.sahmai)
      .slice(0, 3)
      .map((r, i) => ({
        no: i + 1,
        member: r.memberName || '—',
        machine: islandById(r.chapterId)?.name ?? r.chapterId,
        sahmai: r.sahmai,
      }));
  };

  const boardRows = (): string => {
    const top = topThree();
    if (top.length === 0) {
      return `<span class="hall-databoard-nodata">NO DATA</span>`;
    }
    return top
      .map(
        (r) => `
        <div class="hall-boardrow">
          <span class="hall-boardrow-no">${r.no}</span>
          <span class="hall-boardrow-member">${esc(r.member)}</span>
          <span class="hall-boardrow-machine">${esc(r.machine)}</span>
          <span class="hall-boardrow-sa ${r.sahmai > 0 ? 'plus' : r.sahmai < 0 ? 'minus' : ''}">${signed(r.sahmai)}</span>
        </div>`,
      )
      .join('');
  };

  const dataBoard = (): string => `
    <div class="hall-databoard${st.spot === 'rank' ? ' selected' : ''}" data-act="rank" role="button" tabindex="0">
      <div class="hall-databoard-rods"><span></span><span></span></div>
      <div class="hall-databoard-case">
        <div class="hall-databoard-screen">
          <div class="hall-databoard-head">
            <span class="hall-databoard-title">ラ ン キ ン グ</span>
            <span class="hall-databoard-sub">本日の差枚 上位</span>
          </div>
          ${boardRows()}
        </div>
      </div>
      <span class="hall-spotframe"></span>
    </div>`;

  const receptionDesk = (): string => `
    <div class="hall-desk${st.spot === 'card' ? ' selected' : ''}" data-act="card-spot" role="button" tabindex="0">
      <div class="hall-desk-top">
        <div class="hall-ticket">
          <div class="hall-ticket-face">
            <span class="hall-ticket-label">呼出番号</span>
            <span class="hall-ticket-no">12</span>
          </div>
          <span class="hall-ticket-stand"></span>
        </div>
        <div class="hall-membercard">
          <span class="hall-membercard-brand">MOJISLOT MEMBER</span>
          <span class="hall-membercard-name">${esc(getMemberName())}</span>
          <span class="hall-membercard-stripe"></span>
        </div>
        <div class="hall-reader-mini">
          <span class="hall-reader-mini-slot"></span>
          <span class="hall-reader-mini-lamp"></span>
        </div>
        <div class="hall-bell">
          <span class="hall-bell-dome"></span>
          <span class="hall-bell-base"></span>
          <span class="hall-bell-label">呼出</span>
        </div>
      </div>
      <span class="hall-desk-edge"></span>
      <div class="hall-desk-front">
        <div class="hall-showcase">
          <span class="hall-showcase-label">特 殊 景 品</span>
          <div class="hall-showcase-row">
            ${'<span class="gold"></span>'.repeat(4)}
          </div>
          <div class="hall-showcase-row last">
            ${'<span class="silver"></span>'.repeat(4)}
          </div>
          <span class="hall-showcase-gloss"></span>
        </div>
        <div class="hall-acryl">
          <span class="hall-acryl-title">会 員 カ ー ド</span>
          <span class="hall-acryl-sub">発行・読み込み　—　1 キーで選択</span>
        </div>
      </div>
      <span class="hall-spotframe"></span>
    </div>`;

  const counterWide = (): string => `
    <div class="hall-counterfront${slideClass()}">
      <div class="hall-ceiling"><span class="hall-ceiling-edge"></span><span class="hall-fluoro"></span></div>
      <div class="hall-far hall-far-counter">
        ${Array.from({ length: 9 }, () => '<span class="hall-far-bar"></span>').join('')}
        <span class="hall-far-fade side"></span>
      </div>
      <span class="hall-backwall"></span>
      <span class="hall-carpet"></span>

      <div class="hall-cfsign">
        <div class="hall-islandsign-rods"><span></span><span></span></div>
        <div class="hall-cfsign-box">
          <span class="hall-cfsign-title">景 品 カ ウ ン タ ー</span>
          <div class="hall-cfsign-tags">
            <span class="t1">景品交換</span><span class="sep"></span>
            <span class="t2">両替</span><span class="sep"></span>
            <span class="t3">会員登録</span>
          </div>
        </div>
      </div>

      <div class="hall-dots hall-dots-static">${dotsHtml()}</div>

      <div class="hall-aisle hall-aisle-l" data-act="prev" role="button" tabindex="0">
        <span class="hall-aisle-mark">◀</span><span class="hall-aisle-label">前の島</span>
      </div>
      <div class="hall-aisle hall-aisle-r" data-act="next" role="button" tabindex="0">
        <span class="hall-aisle-mark">▶</span><span class="hall-aisle-label">次の島</span>
      </div>

      <div class="hall-cfwall">
        ${shelfHtml(false)}
        ${dataBoard()}
        ${shelfHtml(true)}
      </div>

      <div class="hall-cfspace"></div>
      ${receptionDesk()}

      <div class="hall-footbar hall-footbar-counter">
        <div class="hall-foot-exit" data-act="exit" role="button" tabindex="0">
          <span>←</span><span>入口</span>
        </div>
        <div class="hall-foot-hint">← → で場所を移動　1 / 2 で選択　Enter で寄る　Esc 入口</div>
        <div class="hall-foot-go" data-act="zoom-spot" role="button" tabindex="0">${
          st.spot === 'card' ? '会員カードを見る ▶' : 'ランキングを見る ▶'
        }</div>
      </div>
    </div>`;

  const counterNarrow = (): string => `
    <div class="hall-counterfront narrow${slideClass()}">
      <span class="hall-cf-topline"></span>
      <div class="hall-aisle hall-aisle-l" data-act="prev" role="button" tabindex="0">
        <span class="hall-aisle-mark">◀</span><span class="hall-aisle-label">前の島</span>
      </div>
      <div class="hall-aisle hall-aisle-r" data-act="next" role="button" tabindex="0">
        <span class="hall-aisle-mark">▶</span><span class="hall-aisle-label">次の島</span>
      </div>
      <span class="hall-carpet sm"></span>

      <div class="hall-cfsign-box sm">
        <span class="hall-cfsign-title">景 品 カ ウ ン タ ー</span>
      </div>
      <div class="hall-dots hall-dots-static">${dotsHtml()}</div>

      <div class="hall-cf-shelfrow">
        <div class="hall-shelf sm">
          ${SHELF.flat()
            .map((x) => `<span style="height:${x.h}%;background:${x.c}"></span>`)
            .join('')}
          <span class="hall-shelf-gloss"></span>
        </div>
        <div class="hall-ticket-face sm">
          <span class="hall-ticket-label">呼出番号</span>
          <span class="hall-ticket-no">12</span>
        </div>
      </div>

      <div class="hall-databoard sm" data-act="rank" role="button" tabindex="0">
        <div class="hall-databoard-screen">
          <div class="hall-databoard-head">
            <span class="hall-databoard-title">ランキング</span>
            <span class="hall-databoard-sub">差枚 上位</span>
          </div>
          ${boardRows()}
          <span class="hall-databoard-tap">タップで寄る</span>
        </div>
      </div>

      <div class="hall-desk sm" data-act="card-spot" role="button" tabindex="0">
        <div class="hall-desk-top">
          <div class="hall-membercard">
            <span class="hall-membercard-brand">MOJISLOT MEMBER</span>
            <span class="hall-membercard-name">${esc(getMemberName())}</span>
            <span class="hall-membercard-stripe"></span>
          </div>
          <div class="hall-reader-mini">
            <span class="hall-reader-mini-slot"></span>
            <span class="hall-reader-mini-lamp"></span>
          </div>
        </div>
        <span class="hall-desk-edge"></span>
        <div class="hall-desk-front sm">
          <span class="hall-acryl-title">会 員 カ ー ド</span>
          <span class="hall-acryl-sub">発行・読み込み</span>
        </div>
      </div>

      <div class="hall-cfspace"></div>

      <div class="hall-cf-exit" data-act="exit" role="button" tabindex="0">← 入口に戻る</div>
    </div>`;

  // ─── 寄り ───
  const toggleRow = (
    opt: string,
    title: string,
    sub: string,
    on: boolean,
  ): string => `
    <label class="hall-toggle">
      <span class="hall-toggle-text"><b>${title}</b><i>${sub}</i></span>
      <input type="checkbox" data-opt="${opt}" ${on ? 'checked' : ''}>
      <span class="hall-toggle-switch"></span>
    </label>`;

  const playSettings = (): string => {
    const missionsOn = localStorage.getItem(MISSIONS_KEY) !== '0';
    const artOn = localStorage.getItem(REEL_ART_KEY) === 'image';
    const debugOn = localStorage.getItem(DEBUG_KEY) === '1';
    let autoOn = true;
    try {
      const raw = sessionStorage.getItem(PLAY_SETUP_KEY);
      if (raw) autoOn = (JSON.parse(raw) as { auto?: unknown }).auto !== false;
    } catch {
      /* 既定のまま */
    }
    return `
      <details class="hall-settings">
        <summary class="hall-settings-head">プレイ設定</summary>
        <div class="hall-settings-body">
          ${toggleRow('missions', 'ミッション', '達成状況を記録してトーストで通知', missionsOn)}
          ${toggleRow('reelart', 'リール絵柄に画像を使う', '既定OFF＝色タイル＋文字。ONで図柄画像（作り直し中）', artOn)}
          ${toggleRow('auto', 'AUTOモード', 'ONでAUTOボタンを表示（自動消化）', autoOn)}
          ${toggleRow('debug', 'デバッグボタン', '設定内に演出の強制発動ボタンを表示', debugOn)}
        </div>
      </details>`;
  };

  const seatHtml = (): string => {
    const m = machineOf(st.seatId);
    const p = policy();
    const day = readMachineDay(m.id, now());
    const v = viewOf(m, day, p);
    const y = islandYaku(v.island, m.seat);
    const wip = closed(v.island);
    const rate = bonusRate(day);
    const eff = effectRate(day);
    const tag = policyTag(p);
    const num = (n: number): string => (v.played ? String(n) : '—');

    const koyaku = y.words
      .map(
        (w, i) =>
          `<div class="hall-pay-row"><span class="hall-pay-name">${esc(w)}</span><span class="hall-pay-mai">${y.pays[i]}枚</span></div>`,
      )
      .join('');

    return `
      <div class="hall-seat" style="${themeVars(themeIdOf(v))}">
        <span class="hall-seat-floor"></span>
        <div class="hall-seat-back" data-act="back" role="button" tabindex="0">
          <span>←</span><span>島に戻る（Esc）</span>
        </div>
        <div class="hall-seat-body">
          <div class="hall-seat-cabinet">
            <div class="hall-lamps hall-lamps-seat">
              <span class="hall-lamp hall-lamp-red${v.hot ? ' on' : ''}"></span>
              <span class="hall-lamp hall-lamp-yellow${v.plus ? ' on' : ''}"></span>
              <span class="hall-lamp hall-lamp-green${v.target ? ' on' : ''}"></span>
              <span class="hall-lamp-gloss"></span>
            </div>
            ${cabinet(v, 'seat')}
          </div>

          <div class="hall-detail">
            <div class="hall-detail-head">
              <span class="hall-detail-no">${m.number}</span>
              <span class="hall-detail-unit">番台</span>
              <span class="hall-detail-island">${esc(v.island.name)}</span>
              ${isTrialMachine(m) ? '<span class="hall-badge hall-badge-trial">試打台・設定6</span>' : ''}
              ${!isTrialMachine(m) && m.corner ? '<span class="hall-badge">角台</span>' : ''}
              ${v.target && tag ? `<span class="hall-badge hall-badge-target">${esc(tag)}</span>` : ''}
            </div>

            <div class="hall-detail-grid">
              <div><span>BB</span><b class="hall-num-bb">${num(day.big)}</b></div>
              <div><span>RB</span><b class="hall-num-rb">${num(day.reg)}</b></div>
              <div><span>総スタート</span><b class="hall-num-games">${num(day.spins)}</b></div>
              <div><span>最大ハマり</span><b class="${v.hot ? 'hall-num-hot' : ''}">${num(day.sinceBonus)}</b></div>
              <div><span>差枚</span><b class="${v.plus ? 'hall-num-plus' : 'hall-num-flat'}">${v.played ? signed(day.sahmai) : '±0'}</b></div>
              <div><span>合成確率</span><b>${rate === null ? '—' : `1/${rate.toFixed(0)}`}</b></div>
              <div><span>演出</span><b class="hall-num-eff">${
                eff === null ? '—' : `${(eff * 100).toFixed(1)}%`
              }</b></div>
              <div><span>通常時G</span><b>${day.normalSpins || '—'}</b></div>
            </div>

            <div class="hall-paytable">
              <span class="hall-paytable-title">配 当 表</span>
              <div class="hall-pay-group">
                <div class="hall-pay-line">
                  <span class="hall-pay-kind">BIG</span>
                  <span class="hall-pay-word big">${esc(y.big.join('・'))}</span>
                  <span class="hall-pay-mai">${payout.baseMultiplier.premium}枚 ＋ ${tuning.bonus.spinsPerBig}ゲーム</span>
                </div>
                <div class="hall-pay-line">
                  <span class="hall-pay-kind">REG</span>
                  <span class="hall-pay-word">${esc(y.reg)}</span>
                  <span class="hall-pay-mai">${payout.baseMultiplier.bonus}枚 ＋ ${tuning.bonus.spinsPerReg}ゲーム</span>
                </div>
                <div class="hall-pay-line">
                  <span class="hall-pay-kind">チェリー</span>
                  <span class="hall-pay-word cherry">${esc(y.cherry)}</span>
                  <span class="hall-pay-mai">${payout.baseMultiplier.cherry}枚</span>
                </div>
                <span class="hall-pay-note">REGはBIG2種から文字を借用　${esc(y.big[0])} ＋ ${esc(y.big[1])} → ${esc(y.reg)}</span>
              </div>
              <div class="hall-pay-koyaku">
                <div class="hall-pay-koyaku-head">
                  <span>小役</span><span>枚数が多いほど確率は低い</span>
                </div>
                ${koyaku}
              </div>
            </div>

            ${
              isTrialMachine(m)
                ? `<div class="hall-trialnote">
                     設定6で開放してある台です。設定を探さずに打てますが、条件が違うので
                     <b>ここでの記録はランキングの比較条件で既定除外</b>されます。
                   </div>`
                : ''
            }
            ${wip ? '' : playSettings()}

            ${
              wip
                ? `<div class="hall-notice">
                     <span class="hall-notice-badge">お 知 ら せ</span>
                     <span class="hall-notice-title">この島は入替・調整中です</span>
                     <span class="hall-notice-body">全図柄を混ぜた台のため、配当の調整が終わるまでご遊技いただけません。稼働開始はあらためて掲示します。</span>
                   </div>`
                : `<div class="hall-sit" data-act="sit" role="button" tabindex="0">この台に座る　Enter</div>`
            }
            <div class="hall-seat-another" data-act="back" role="button" tabindex="0">別の台を見る</div>
          </div>
        </div>
      </div>`;
  };

  // ─── 描画 ───
  function render(): void {

    if (st.phase === 'entrance' || st.phase === 'entering') {
      root.innerHTML = st.narrow ? entranceNarrow() : entranceWide();
      track = null;
    } else if (st.phase === 'counter') {
      root.innerHTML = st.narrow ? counterNarrow() : counterWide();
      track = null;
    } else if (st.phase === 'floor') {
      root.innerHTML = floorHtml();
      track = root.querySelector<HTMLElement>('[data-track]');
      const slider = root.querySelector<HTMLElement>('[data-slider]');
      if (slider) {
        // 6島ぶんを横に並べた帯。1島あたり 100/6 %。
        slider.style.width = `${ISLANDS.length * 100}%`;
      }
      updateFloor();
      // 初回はレイアウト確定後に測る（この時点では offsetHeight が 0 のことがある）
      window.setTimeout(fit, 0);
    } else {
      root.innerHTML = seatHtml();
      track = null;
    }
    wire();
  }

  // ─── 配線 ───
  const persistSettings = (): void => {
    const checked = (opt: string): boolean =>
      root.querySelector<HTMLInputElement>(`input[data-opt="${opt}"]`)?.checked ??
      false;
    try {
      localStorage.setItem(MISSIONS_KEY, checked('missions') ? '1' : '0');
      localStorage.setItem(REEL_ART_KEY, checked('reelart') ? 'image' : 'plain');
      localStorage.setItem(DEBUG_KEY, checked('debug') ? '1' : '0');
      sessionStorage.setItem(
        PLAY_SETUP_KEY,
        JSON.stringify({ auto: checked('auto') }),
      );
    } catch {
      /* storage 不可でもゲーム開始は妨げない */
    }
  };

  const sit = (): void => {
    const m = machineOf(st.seatId);
    const island = islandById(m.islandId);
    if (island && closed(island)) return; // 調整中の島には座れない
    setCurrentMachineId(m.id);
    setCurrentChapterId(chapterIdOfMachine(m));
    persistSettings();
    cb.onLaunch();
  };

  const zoomSpot = (): void => {
    if (st.spot === 'card') cb.onCard();
    else cb.onRanking();
  };

  const actions: Record<string, () => void> = {
    enter: enterHall,
    card: cb.onCard,
    ranking: cb.onRanking,
    exit: () => go('entrance'),
    back: () => go('floor'),
    prev: () => move(-1),
    next: () => move(1),
    zoom: () => toSeat(st.selId),
    sit,
    // 島の足元バーから景品カウンターへ歩く（場所として移動する）
    'to-counter': () => {
      st.nav = COUNTER_NAV;
      go('counter', 'left'); // カウンターは左端なので左から入ってくる
    },
    // カウンター前で受付／データボードを押したら、選ぶだけでなくそのまま寄る
    'card-spot': () => {
      st.spot = 'card';
      cb.onCard();
    },
    rank: () => {
      st.spot = 'rank';
      cb.onRanking();
    },
    'zoom-spot': zoomSpot,
  };

  function wire(): void {
    root.querySelectorAll<HTMLElement>('[data-act]').forEach((el) => {
      const fn = actions[el.dataset.act ?? ''];
      if (fn) el.addEventListener('click', fn);
    });
    root.querySelectorAll<HTMLElement>('[data-island]').forEach((el) => {
      el.addEventListener('click', () => {
        const idx = Number(el.dataset.island);
        st.nav = navOfIsland(idx);
        const first = machinesOfIsland(ISLANDS[idx].id)[0];
        st.selId = first.id;
        enterHall();
      });
    });
    root.querySelectorAll<HTMLElement>('[data-dot]').forEach((el) => {
      el.addEventListener('click', () => {
        const nav = Number(el.dataset.dot);
        const dir: HallState['slide'] = nav > st.nav ? 'right' : 'left';
        if (nav === COUNTER_NAV) {
          st.nav = nav;
          go('counter', dir);
          return;
        }
        const wasCounter = st.nav === COUNTER_NAV;
        st.nav = nav;
        st.selId = machinesOfIsland(islandAt(nav).id)[0].id;
        if (wasCounter) go('floor', dir);
        else updateFloor();
      });
    });
    root.querySelectorAll<HTMLElement>('.hall-machine').forEach((el) => {
      el.addEventListener('click', () => toSeat(el.dataset.machine ?? st.selId));
    });
    if (track) {
      track.addEventListener('touchstart', onTouchStart, { passive: true });
      track.addEventListener('touchend', onTouchEnd, { passive: true });
    }
  }

  // ─── スワイプ ───
  // 島内の横スクロールと同じ軸で競合するので、内側が端に着いている時だけ島を移動する。
  function onTouchStart(e: TouchEvent): void {
    const t = e.touches[0];
    const target = e.target as HTMLElement | null;
    const col = target?.closest<HTMLElement>('[data-island-col]') ?? null;
    touch = { x: t.clientX, y: t.clientY, col, left: col?.scrollLeft ?? 0 };
  }

  function onTouchEnd(e: TouchEvent): void {
    const tr = touch;
    touch = null;
    if (!tr) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - tr.x;
    const dy = t.clientY - tr.y;
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.4) return;
    const col = tr.col;
    if (col) {
      const max = col.scrollWidth - col.clientWidth;
      if (max > 2 && Math.abs(col.scrollLeft - tr.left) > 4) return;
      if (dx < 0 && col.scrollLeft < max - 2) return;
      if (dx > 0 && col.scrollLeft > 2) return;
    }
    move(dx < 0 ? 1 : -1);
  }

  // ─── キーボード ───
  window.addEventListener('keydown', (e) => {
    if (root.hidden) return; // 他のビューを見ている間は拾わない
    if (st.phase === 'entering') return;
    if (st.phase === 'entrance') {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        enterHall();
      }
      return;
    }
    if (st.phase === 'seat') {
      if (e.key === 'Escape') go('floor');
      if (e.key === 'Enter') {
        e.preventDefault();
        sit();
      }
      return;
    }
    if (st.phase === 'counter') {
      if (e.key === 'ArrowLeft') move(-1);
      else if (e.key === 'ArrowRight') move(1);
      else if (e.key === 'Escape') go('entrance');
      else if (e.key === '1') {
        st.spot = 'card';
        render();
      } else if (e.key === '2') {
        st.spot = 'rank';
        render();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        zoomSpot();
      }
      return;
    }
    if (e.key === 'ArrowLeft') move(-1);
    else if (e.key === 'ArrowRight') move(1);
    else if (e.key === 'Escape') go('entrance');
    else if (e.key === 'Enter') {
      e.preventDefault();
      toSeat(st.selId);
    } else if (/^[1-4]$/.test(e.key)) {
      const seat = Number(e.key);
      const m = machinesOfIsland(islandAt(st.nav).id).find((x) => x.seat === seat);
      if (m) {
        st.selId = m.id;
        updateFloor();
      }
    }
  });

  window.addEventListener('resize', fit);
  startFit();
  render();

  return {
    showCounter(spot: CounterSpot): void {
      st.spot = spot;
      st.nav = COUNTER_NAV;
      st.phase = 'counter';
      render();
    },
  };
}
