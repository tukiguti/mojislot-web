import { RUN_RULESET_VERSION, loadRunHistory } from '../productions/RunHistory';
import type { RunRecord } from '../productions/RunHistory';
import { CHAPTERS } from '../data/chapters';
import { getMemberId } from '../productions/Member';
import { extractRunHistory, readCard } from '../card/CardManager';
import { CardError } from '../card/CardCodec';
import './counter.css';

/**
 * ランキング（景品カウンターのデータボードに寄った画面）。
 *
 * 1戦＝台で「計数」を押して確定した1レコード。正本は `RunHistory`（localStorage）。
 * 他人の会員カードを読み込むと**閲覧専用**でその履歴が合流し、同じ表に並ぶ。
 * 数人でカードを持ち寄って差枚を比べる、という遊び方を想定している。
 *
 * 派生指標は保存せず都度算出する: 機械割(%) = totalWin/totalBet*100、差枚 = payback − investment。
 */
export interface CounterRankingCallbacks {
  /** カウンター前へ戻る。 */
  onBack: () => void;
  /** 島へ向かう（記録が無い時の導線）。 */
  onPlay: () => void;
}

type SortKey = 'sahmai' | 'yield' | 'spins' | 'date';

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'sahmai', label: '差枚' },
  { key: 'yield', label: '機械割' },
  { key: 'spins', label: '回転数' },
  { key: 'date', label: '日付' },
];

const CHAPTER_NAME = new Map(CHAPTERS.map((c) => [c.id, c.name]));

/** スマホでは表を1戦1カードへ組み替える。11列は横に収まらない。 */
const NARROW_AT = 760;

/**
 * 比較条件の絞り込み。差枚の比較は条件が揃って初めて意味を持つので、
 * **既定を「公平に比べられる記録だけ」に寄せる**。
 * - 出玉規則が違う記録は数字の意味が違う → 最新規則のみ
 * - DEBUG操作が使えた記録は自己ベストとして扱えない → 除外
 * AUTO・ミッションは有利不利が小さいので既定では絞らない（見たい人だけ絞る）。
 */
interface Conditions {
  latestRulesetOnly: boolean;
  excludeDebug: boolean;
  manualOnly: boolean;
  missionsOnly: boolean;
  /** 'all' または「その速度で通しでプレイした記録だけ」を示すコマ/秒。 */
  speed: number | 'all';
}

const DEFAULT_CONDITIONS: Conditions = {
  latestRulesetOnly: true,
  excludeDebug: true,
  manualOnly: false,
  missionsOnly: false,
  speed: 'all',
};

/** 条件に合う記録だけを残す。旧記録（項目が無い）は条件不明として絞り込み時に落とす。 */
function applyConditions(runs: RunRecord[], c: Conditions): RunRecord[] {
  return runs.filter((r) => {
    if (c.latestRulesetOnly && r.rulesetVersion !== RUN_RULESET_VERSION) return false;
    if (c.excludeDebug && r.debugEnabled) return false;
    if (c.manualOnly && r.autoUsed !== false) return false;
    if (c.missionsOnly && r.missionsEnabled !== true) return false;
    if (c.speed !== 'all') {
      // 途中で速度を変えた記録は「その速度でやり切った」とは言えないので外す。
      if (r.reelSpeedMin !== c.speed || r.reelSpeedMax !== c.speed) return false;
    }
    return true;
  });
}

/** 履歴に登場する「通しで同じ速度だった」速度値（昇順）。 */
function presentSpeeds(runs: RunRecord[]): number[] {
  const set = new Set<number>();
  for (const r of runs) {
    if (r.reelSpeedMin !== undefined && r.reelSpeedMin === r.reelSpeedMax) {
      set.add(r.reelSpeedMin);
    }
  }
  return [...set].sort((a, b) => a - b);
}

// セッション内状態（reload で初期化）
let chapterFilter = 'all';
let sortKey: SortKey = 'sahmai';
let conditions: Conditions = { ...DEFAULT_CONDITIONS };
/** 読み込んだ会員カードの履歴（閲覧専用。localStorage には書かない）。 */
let externalRecords: RunRecord[] = [];
let loadedCards: { name: string; count: number }[] = [];

const esc = (s: string): string =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ] ?? c,
  );

const num = (n: number): string => n.toLocaleString('en-US');
const fmtSigned = (n: number): string =>
  `${n > 0 ? '+' : n < 0 ? '−' : '±'}${num(Math.abs(n))}`;
const signClass = (n: number): string => (n > 0 ? 'plus' : n < 0 ? 'minus' : 'flat');

const yieldPct = (r: RunRecord): number | null =>
  r.totalBet > 0 ? (r.totalWin / r.totalBet) * 100 : null;

const fmtDate = (ms: number): string => {
  const d = new Date(ms);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

/** 比較条件のタグ。DEBUG だけは注意情報なので目立たせる。 */
function condTags(r: RunRecord): { text: string; warn: boolean }[] {
  if (r.rulesetVersion === undefined) return [{ text: '旧記録（条件不明）', warn: true }];
  const min = r.reelSpeedMin;
  const max = r.reelSpeedMax;
  const speed =
    min === undefined || max === undefined
      ? '速度不明'
      : min === max
        ? `${min}コマ/秒`
        : `${min}–${max}コマ/秒`;
  const tags = [
    { text: `規則v${r.rulesetVersion}`, warn: false },
    {
      text: r.buildId ? `build ${r.buildId}` : r.appVersion ? `app ${r.appVersion}` : 'app版不明',
      warn: false,
    },
    { text: speed, warn: false },
    { text: r.autoUsed ? 'AUTO使用' : '手動', warn: false },
    { text: r.missionsEnabled ? 'ミッションON' : 'ミッションOFF', warn: false },
  ];
  if (r.debugEnabled) tags.push({ text: 'DEBUG', warn: true });
  return tags;
}

/** local を優先して runId で重複排除する（同じ戦は1回だけ）。 */
function dedupeByRunId(records: RunRecord[]): RunRecord[] {
  const seen = new Set<string>();
  const out: RunRecord[] = [];
  for (const r of records) {
    if (!r.runId || seen.has(r.runId)) continue;
    seen.add(r.runId);
    out.push(r);
  }
  return out;
}

function summarize(runs: RunRecord[]): {
  count: number;
  totalSahmai: number;
  best: number;
  totalSpins: number;
  yieldPct: number | null;
} {
  let totalSahmai = 0;
  let best = -Infinity;
  let totalSpins = 0;
  let sumBet = 0;
  let sumWin = 0;
  for (const r of runs) {
    totalSahmai += r.sahmai;
    best = Math.max(best, r.sahmai);
    totalSpins += r.spinCount;
    sumBet += r.totalBet;
    sumWin += r.totalWin;
  }
  return {
    count: runs.length,
    totalSahmai,
    best: runs.length ? best : 0,
    totalSpins,
    yieldPct: sumBet > 0 ? (sumWin / sumBet) * 100 : null,
  };
}

function sortRuns(runs: RunRecord[], key: SortKey): RunRecord[] {
  return [...runs].sort((a, b) => {
    switch (key) {
      case 'sahmai':
        return b.sahmai - a.sahmai;
      case 'spins':
        return b.spinCount - a.spinCount;
      case 'date':
        return b.settledAt - a.settledAt;
      case 'yield': {
        return (yieldPct(b) ?? -Infinity) - (yieldPct(a) ?? -Infinity);
      }
    }
  });
}

export function renderCounterRanking(cb: CounterRankingCallbacks): void {
  const root = document.getElementById('view-ranking');
  if (!root) return;

  const narrow = window.innerWidth < NARROW_AT;
  const myId = getMemberId();
  // 自分の正本 ＋ 読込カード（閲覧専用）を runId dedupe（local 優先）
  const combined = dedupeByRunId([...loadRunHistory(), ...externalRecords]);

  const presentIds = new Set(combined.map((r) => r.chapterId));
  const chapterTabs = CHAPTERS.filter((c) => presentIds.has(c.id));
  if (chapterFilter !== 'all' && !presentIds.has(chapterFilter)) chapterFilter = 'all';

  const byChapter =
    chapterFilter === 'all'
      ? combined
      : combined.filter((r) => r.chapterId === chapterFilter);
  const speeds = presentSpeeds(byChapter);
  if (conditions.speed !== 'all' && !speeds.includes(conditions.speed)) {
    conditions.speed = 'all';
  }
  const filtered = applyConditions(byChapter, conditions);
  const hiddenCount = byChapter.length - filtered.length;
  const runs = sortRuns(filtered, sortKey);
  const s = summarize(filtered);

  const chip = (
    label: string,
    on: boolean,
    attr: string,
    cls = '',
  ): string =>
    `<span class="ctr-chip${on ? ' on' : ''} ${cls}" ${attr} role="button" tabindex="0">${label}</span>`;

  const tabsHtml = [{ id: 'all', name: '総合' }, ...chapterTabs]
    .map((t) => chip(esc(t.name), t.id === chapterFilter, `data-chapter="${esc(t.id)}"`))
    .join('');

  const sortsHtml = SORTS.map((o) =>
    chip(
      `${o.label}${o.key === sortKey ? ' ▼' : ''}`,
      o.key === sortKey,
      `data-sort="${o.key}"`,
      'ctr-chip-sort',
    ),
  ).join('');

  const condKeys: [keyof Conditions, string][] = [
    ['latestRulesetOnly', `最新規則のみ (v${RUN_RULESET_VERSION})`],
    ['excludeDebug', 'DEBUG除外'],
    ['manualOnly', '手動のみ'],
    ['missionsOnly', 'ミッションONのみ'],
  ];
  const condsHtml = condKeys
    .map(([k, label]) =>
      chip(
        `<span class="ctr-check">✓</span>${label}`,
        conditions[k] === true,
        `data-cond="${k}"`,
        'ctr-chip-cond',
      ),
    )
    .join('');

  const speedsHtml = speeds.length
    ? `<div class="ctr-filter-row ctr-filter-speed">
         <span class="ctr-filter-label">速度</span>
         <div class="ctr-chips">
           ${chip('速度すべて', conditions.speed === 'all', 'data-speed="all"', 'ctr-chip-speed')}
           ${speeds
             .map((v) =>
               chip(`${v}`, conditions.speed === v, `data-speed="${v}"`, 'ctr-chip-speed'),
             )
             .join('')}
         </div>
       </div>`
    : '';

  const sum5 = [
    { label: '戦数', v: String(s.count), cls: '' },
    { label: '通算差枚', v: s.count ? fmtSigned(s.totalSahmai) : '—', cls: signClass(s.totalSahmai) },
    { label: '最高差枚', v: s.count ? fmtSigned(s.best) : '—', cls: 'plus' },
    {
      label: '通算機械割',
      v: s.yieldPct === null ? '—' : `${s.yieldPct.toFixed(1)}%`,
      cls: s.yieldPct === null ? '' : s.yieldPct >= 100 ? 'yield-ok' : 'yield-ng',
    },
    { label: '総回転', v: s.count ? num(s.totalSpins) : '—', cls: 'games' },
  ]
    .map(
      (c) =>
        `<div class="ctr-sumcell"><span>${c.label}</span><b class="${c.cls}">${c.v}</b></div>`,
    )
    .join('');

  const guestChips = loadedCards
    .map(
      (c) =>
        `<span class="ctr-guest">${esc(c.name)} ${c.count}戦</span>`,
    )
    .join('');

  const tagsOf = (r: RunRecord): string =>
    condTags(r)
      .map((t) => `<span class="ctr-tag${t.warn ? ' warn' : ''}">${esc(t.text)}</span>`)
      .join('');

  const rowsWide = runs
    .map((r) => {
      const y = yieldPct(r);
      const me = r.memberId === myId;
      return `
      <div class="ctr-row${me ? ' me' : ''}">
        <span class="c-date">${fmtDate(r.settledAt)}</span>
        <span class="c-member">${esc(r.memberName || '—')}${me ? '<b class="ctr-me">自分</b>' : ''}</span>
        <span class="c-machine">${esc(CHAPTER_NAME.get(r.chapterId) ?? r.chapterId)}</span>
        <span class="c-sa ${signClass(r.sahmai)}">${fmtSigned(r.sahmai)}</span>
        <span class="c-games">${num(r.spinCount)}</span>
        <span class="c-rate ${y === null ? '' : y >= 100 ? 'yield-ok' : 'yield-ng'}">${y === null ? '—' : `${y.toFixed(1)}%`}</span>
        <span class="c-inv">${num(r.investment)}</span>
        <span class="c-ret">${num(r.payback)}</span>
        <span class="c-big">${r.premiumCount}</span>
        <span class="c-reg">${r.bonusCount}</span>
        <span class="c-cond">${tagsOf(r)}</span>
      </div>`;
    })
    .join('');

  const rowsNarrow = runs
    .map((r) => {
      const y = yieldPct(r);
      const me = r.memberId === myId;
      return `
      <div class="ctr-mrow${me ? ' me' : ''}">
        <div class="ctr-mrow-head">
          <span class="ctr-mrow-date">${fmtDate(r.settledAt)}</span>
          <span class="ctr-mrow-member">${esc(r.memberName || '—')}</span>
          ${me ? '<b class="ctr-me">自分</b>' : ''}
        </div>
        <div class="ctr-mrow-main">
          <span class="ctr-mrow-machine">${esc(CHAPTER_NAME.get(r.chapterId) ?? r.chapterId)}</span>
          <span class="ctr-mrow-sa ${signClass(r.sahmai)}">${fmtSigned(r.sahmai)}</span>
        </div>
        <div class="ctr-mrow-grid">
          <div><span>回転</span><b class="games">${num(r.spinCount)}</b></div>
          <div><span>機械割</span><b class="${y === null ? '' : y >= 100 ? 'yield-ok' : 'yield-ng'}">${y === null ? '—' : `${y.toFixed(1)}%`}</b></div>
          <div><span>BIG / REG</span><b>${r.premiumCount} / ${r.bonusCount}</b></div>
          <div><span>投資</span><b>${num(r.investment)}</b></div>
          <div><span>回収</span><b>${num(r.payback)}</b></div>
        </div>
        <div class="ctr-mrow-tags">${tagsOf(r)}</div>
      </div>`;
    })
    .join('');

  const table = narrow
    ? `<div class="ctr-mrows">${rowsNarrow}</div>`
    : `<div class="ctr-tablewrap">
         <div class="ctr-table">
           <div class="ctr-row ctr-head">
             <span class="c-date">日付</span><span class="c-member">会員</span><span class="c-machine">台</span>
             <span class="c-sa">差枚</span><span class="c-games">回転</span><span class="c-rate">機械割</span>
             <span class="c-inv">投資</span><span class="c-ret">回収</span>
             <span class="c-big">BIG</span><span class="c-reg">REG</span><span class="c-cond">条件</span>
           </div>
           ${rowsWide}
         </div>
       </div>`;

  const empty = `
    <div class="ctr-empty">
      <span class="ctr-empty-mark">NO DATA</span>
      <span class="ctr-empty-text">まだ記録がありません。台を選んで遊び、「計数」を押すと1戦としてこの表に並びます。</span>
      ${hiddenCount > 0 ? '<span class="ctr-empty-hint">比較条件を緩めると表示される記録があります</span>' : ''}
      <button class="ctr-empty-go" data-act="play" type="button">島へ向かう ▶</button>
    </div>`;

  root.innerHTML = `
    <div class="ctr-rank">
      <div class="ctr-back" data-act="back" role="button" tabindex="0">
        <span>←</span><span>カウンター前に戻る（Esc）</span>
      </div>

      <div class="ctr-rank-case">
        <div class="ctr-rank-screen">
          <div class="ctr-rank-head">
            <div class="ctr-rank-title">
              <span>ラ ン キ ン グ</span>
              <i>1戦＝台で「計数」を押して確定した記録</i>
            </div>
            <div class="ctr-rank-load">
              <label class="ctr-loadbtn">
                ＋ 会員カードを読み込む（閲覧用）
                <input type="file" accept=".mojicard,application/json" data-act="guest">
              </label>
              ${loadedCards.length ? '<span class="ctr-clear" data-act="clear" role="button" tabindex="0">クリア</span>' : ''}
            </div>
          </div>

          ${
            loadedCards.length
              ? `<div class="ctr-guests">
                   <span class="ctr-guests-label">読み込み中</span>
                   ${guestChips}
                   <span class="ctr-guests-note">この画面の集計にだけ反映（保存されません）</span>
                 </div>`
              : ''
          }
          <div class="ctr-msg" data-msg hidden><span class="ctr-msg-dot"></span><span data-msg-text></span></div>

          <div class="ctr-sumgrid">${sum5}</div>

          <div class="ctr-filters">
            <div class="ctr-filter-row">
              <span class="ctr-filter-label">台</span>
              <div class="ctr-chips">${tabsHtml}</div>
            </div>
            <div class="ctr-filter-row">
              <span class="ctr-filter-label">並べ替え</span>
              <div class="ctr-chips">${sortsHtml}</div>
            </div>
            <div class="ctr-filter-row ctr-filter-cond">
              <span class="ctr-filter-label">比較条件</span>
              <div class="ctr-chips">${condsHtml}</div>
            </div>
            ${speedsHtml}
            <div class="ctr-hidden${hiddenCount > 0 ? ' on' : ''}">
              <span class="ctr-hidden-dot"></span>
              <span>${hiddenCount > 0 ? `比較条件により ${hiddenCount} 件を非表示` : '非表示 0 件'}</span>
            </div>
          </div>

          ${runs.length ? table : empty}
        </div>
      </div>
    </div>
  `;

  // ─── 配線 ───
  const rerender = (): void => renderCounterRanking(cb);

  root.querySelector('[data-act="back"]')?.addEventListener('click', cb.onBack);
  root.querySelector('[data-act="play"]')?.addEventListener('click', cb.onPlay);
  root.querySelector('[data-act="clear"]')?.addEventListener('click', () => {
    externalRecords = [];
    loadedCards = [];
    rerender();
  });

  root.querySelectorAll<HTMLElement>('[data-chapter]').forEach((el) => {
    el.addEventListener('click', () => {
      chapterFilter = el.dataset.chapter ?? 'all';
      rerender();
    });
  });
  root.querySelectorAll<HTMLElement>('[data-sort]').forEach((el) => {
    el.addEventListener('click', () => {
      sortKey = (el.dataset.sort as SortKey) ?? 'sahmai';
      rerender();
    });
  });
  root.querySelectorAll<HTMLElement>('[data-cond]').forEach((el) => {
    el.addEventListener('click', () => {
      const key = el.dataset.cond as keyof Conditions;
      if (key && key !== 'speed') conditions[key] = !conditions[key];
      rerender();
    });
  });
  root.querySelectorAll<HTMLElement>('[data-speed]').forEach((el) => {
    el.addEventListener('click', () => {
      const v = el.dataset.speed;
      conditions.speed = v === 'all' ? 'all' : Number(v);
      rerender();
    });
  });

  const guestInput = root.querySelector<HTMLInputElement>('[data-act="guest"]');
  guestInput?.addEventListener('change', async () => {
    const file = guestInput.files?.[0];
    if (!file) return;
    try {
      const payload = await readCard(file);
      const recs = extractRunHistory(payload);
      externalRecords.push(...recs);
      loadedCards.push({ name: payload.member.name, count: recs.length });
      rerender(); // 読み込めた事実はチップで分かる
    } catch (err) {
      const msg = root.querySelector<HTMLElement>('[data-msg]');
      const text = root.querySelector<HTMLElement>('[data-msg-text]');
      if (msg && text) {
        text.textContent =
          err instanceof CardError ? err.message : 'カードを読み込めませんでした。';
        msg.classList.add('ng');
        msg.hidden = false;
      }
    } finally {
      guestInput.value = '';
    }
  });
}
