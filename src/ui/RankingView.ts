import { loadRunHistory } from '../productions/RunHistory';
import type { RunRecord } from '../productions/RunHistory';
import { CHAPTERS } from '../data/chapters';

/**
 * ランキング画面（#/ranking）。現ブラウザの実戦履歴（RunHistory）を集計表示する。
 * 会員カードのインポート（他人の履歴を足す）は P6 で追加。ここでは自分の記録のみ。
 *
 * 派生指標は保存せず都度算出: 機械割(%) = totalWin/totalBet*100、差枚は payback - investment。
 */
export interface RankingViewCallbacks {
  onBack: () => void;
  onPlay: () => void;
}

type SortKey = 'sahmai' | 'yield' | 'spins' | 'date';

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'sahmai', label: '差枚' },
  { key: 'yield', label: '機械割' },
  { key: 'spins', label: '回転数' },
  { key: 'date', label: '日付' },
];

// 章ID → 表示名（隠し章含む全台から引く）
const CHAPTER_NAME = new Map(CHAPTERS.map((c) => [c.id, c.name]));

// セッション内のタブ/並べ替え状態（reload で初期化）
let chapterFilter = 'all';
let sortKey: SortKey = 'sahmai';

const fmtSigned = (n: number): string => `${n > 0 ? '+' : ''}${n}`;
const signClass = (n: number): string =>
  n > 0 ? 'num-plus' : n < 0 ? 'num-minus' : '';

const yieldPct = (r: RunRecord): number | null =>
  r.totalBet > 0 ? (r.totalWin / r.totalBet) * 100 : null;

const fmtDate = (ms: number): string => {
  const d = new Date(ms);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

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
  const sorted = [...runs];
  sorted.sort((a, b) => {
    switch (key) {
      case 'sahmai':
        return b.sahmai - a.sahmai;
      case 'spins':
        return b.spinCount - a.spinCount;
      case 'date':
        return b.settledAt - a.settledAt;
      case 'yield': {
        const ya = yieldPct(a) ?? -Infinity;
        const yb = yieldPct(b) ?? -Infinity;
        return yb - ya;
      }
    }
  });
  return sorted;
}

export function renderRankingView(cb: RankingViewCallbacks): void {
  const root = document.getElementById('view-ranking');
  if (!root) return;

  const all = loadRunHistory();

  if (all.length === 0) {
    root.innerHTML = `
      <div class="ranking-view">
        <header class="ranking-head">
          <button class="setup-back" data-act="back" type="button">← TOP</button>
          <h1 class="ranking-title" data-view-title>ランキング</h1>
        </header>
        <div class="ranking-empty">
          <p>まだ記録がありません。</p>
          <p class="ranking-empty-sub">台を選んで遊び、<b>計数</b>すると1戦ごとにここへ並びます。</p>
          <button class="setup-launch" data-act="play" type="button">遊ぶ ▶</button>
        </div>
      </div>
    `;
    root.querySelector('[data-act="back"]')?.addEventListener('click', cb.onBack);
    root.querySelector('[data-act="play"]')?.addEventListener('click', cb.onPlay);
    return;
  }

  // 履歴に登場する章のみタブ化（CHAPTERS の並び順を維持）
  const presentIds = new Set(all.map((r) => r.chapterId));
  const chapterTabs = CHAPTERS.filter((c) => presentIds.has(c.id));
  if (chapterFilter !== 'all' && !presentIds.has(chapterFilter)) {
    chapterFilter = 'all';
  }

  const filtered =
    chapterFilter === 'all'
      ? all
      : all.filter((r) => r.chapterId === chapterFilter);
  const runs = sortRuns(filtered, sortKey);
  const s = summarize(filtered);

  const tabsHtml = [{ id: 'all', name: '総合' }, ...chapterTabs]
    .map(
      (t) =>
        `<button class="ranking-tab${t.id === chapterFilter ? ' active' : ''}" data-chapter="${t.id}" type="button">${t.name}</button>`,
    )
    .join('');

  const sortsHtml = SORTS.map(
    (o) =>
      `<button class="ranking-sort-btn${o.key === sortKey ? ' active' : ''}" data-sort="${o.key}" type="button">${o.label}</button>`,
  ).join('');

  const card = (label: string, value: string, cls = ''): string =>
    `<div class="ranking-card"><span class="ranking-card-label">${label}</span><span class="ranking-card-value ${cls}">${value}</span></div>`;

  const summaryHtml = [
    card('戦数', `${s.count}`),
    card('通算差枚', fmtSigned(s.totalSahmai), signClass(s.totalSahmai)),
    card('自己ベスト', fmtSigned(s.best), signClass(s.best)),
    card(
      '通算機械割',
      s.yieldPct === null ? '—' : `${s.yieldPct.toFixed(1)}%`,
      s.yieldPct === null ? '' : s.yieldPct >= 100 ? 'num-plus' : 'num-minus',
    ),
    card('総回転', `${s.totalSpins}`),
  ].join('');

  const rowsHtml = runs
    .map((r) => {
      const y = yieldPct(r);
      return `
      <tr>
        <td class="rk-date">${fmtDate(r.settledAt)}</td>
        <td>${CHAPTER_NAME.get(r.chapterId) ?? r.chapterId}</td>
        <td class="rk-num ${signClass(r.sahmai)}">${fmtSigned(r.sahmai)}</td>
        <td class="rk-num">${r.spinCount}</td>
        <td class="rk-num ${y === null ? '' : y >= 100 ? 'num-plus' : 'num-minus'}">${y === null ? '—' : `${y.toFixed(1)}%`}</td>
        <td class="rk-num">${r.investment}</td>
        <td class="rk-num">${r.payback}</td>
        <td class="rk-num">${r.premiumCount}</td>
        <td class="rk-num">${r.bonusCount}</td>
      </tr>`;
    })
    .join('');

  root.innerHTML = `
    <div class="ranking-view">
      <header class="ranking-head">
        <button class="setup-back" data-act="back" type="button">← TOP</button>
        <h1 class="ranking-title" data-view-title>ランキング</h1>
      </header>
      <div class="ranking-summary">${summaryHtml}</div>
      <div class="ranking-controls">
        <div class="ranking-tabs">${tabsHtml}</div>
        <div class="ranking-sort"><span class="ranking-sort-label">並べ替え</span>${sortsHtml}</div>
      </div>
      <div class="ranking-table-wrap">
        <table class="ranking-table">
          <thead>
            <tr>
              <th>日付</th><th>台</th><th>差枚</th><th>回転</th><th>機械割</th>
              <th>投資</th><th>回収</th><th>BIG</th><th>REG</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>
    </div>
  `;

  root.querySelector('[data-act="back"]')?.addEventListener('click', cb.onBack);
  root.querySelectorAll<HTMLButtonElement>('.ranking-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      chapterFilter = btn.dataset.chapter ?? 'all';
      renderRankingView(cb);
    });
  });
  root.querySelectorAll<HTMLButtonElement>('.ranking-sort-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      sortKey = (btn.dataset.sort as SortKey) ?? 'sahmai';
      renderRankingView(cb);
    });
  });
}
