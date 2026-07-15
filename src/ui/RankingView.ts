import { loadRunHistory } from '../productions/RunHistory';
import type { RunRecord } from '../productions/RunHistory';
import { CHAPTERS } from '../data/chapters';
import { getMemberId } from '../productions/Member';
import { readCard, extractRunHistory } from '../card/CardManager';
import { CardError } from '../card/CardCodec';

/**
 * ランキング画面（#/ranking）。実戦履歴（RunHistory）を集計表示する。
 * - 自分のブラウザの履歴（localStorage の正本）
 * - 読み込んだ会員カードの履歴（**閲覧専用**・session メモリのみ・保存しない・runId dedupe）
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

// セッション内状態（reload で初期化）
let chapterFilter = 'all';
let sortKey: SortKey = 'sahmai';
// 読み込んだ会員カードの履歴（閲覧専用。localStorage には書かない）
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

/** 比較条件を可視化する。項目追加前の履歴は「旧記録」として残し、互換性を保つ。 */
const runConditions = (r: RunRecord): string => {
  if (r.rulesetVersion === undefined) return '旧記録（条件不明）';
  const min = r.reelSpeedMin;
  const max = r.reelSpeedMax;
  const speed =
    min === undefined || max === undefined
      ? '速度不明'
      : min === max
        ? `${min}コマ/秒`
        : `${min}–${max}コマ/秒`;
  const tags = [
    `規則v${r.rulesetVersion}`,
    r.appVersion ? `app ${r.appVersion}` : 'app版不明',
    speed,
    r.autoUsed ? 'AUTO使用' : '手動',
    r.missionsEnabled ? 'ミッションON' : 'ミッションOFF',
  ];
  if (r.debugEnabled) tags.push('DEBUG');
  return tags.join(' / ');
};

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

/** カード読込セクション（空状態でも出す）。 */
function cardLoadSectionHtml(): string {
  const chips = loadedCards
    .map(
      (c) =>
        `<span class="ranking-chip">${esc(c.name)}<span class="ranking-chip-count">${c.count}戦</span></span>`,
    )
    .join('');
  return `
    <section class="ranking-cards">
      <div class="ranking-cards-row">
        <label class="card-file">
          <input type="file" accept=".mojicard,application/json" data-act="rank-file">
          <span class="card-file-label">会員カードを読み込む（閲覧用）</span>
        </label>
        ${loadedCards.length ? `<button class="ranking-card-clear" data-act="clear-cards" type="button">読込をクリア</button>` : ''}
      </div>
      ${loadedCards.length ? `<div class="ranking-card-chips">${chips}</div>` : ''}
      <p class="card-msg ranking-card-msg" data-rank-msg hidden></p>
      <p class="ranking-cards-note">読み込んだカードはこの画面の集計にだけ反映され、保存されません（リロードで消えます）。</p>
    </section>`;
}

export function renderRankingView(cb: RankingViewCallbacks): void {
  const root = document.getElementById('view-ranking');
  if (!root) return;

  const myId = getMemberId();
  // 自分の正本 + 読込カード（閲覧専用）を runId dedupe（local 優先）
  const combined = dedupeByRunId([...loadRunHistory(), ...externalRecords]);

  const headerHtml = `
    <header class="ranking-head">
      <button class="setup-back" data-act="back" type="button">← TOP</button>
      <h1 class="ranking-title" data-view-title>ランキング</h1>
    </header>`;

  if (combined.length === 0) {
    root.innerHTML = `
      <div class="ranking-view">
        ${headerHtml}
        ${cardLoadSectionHtml()}
        <div class="ranking-empty">
          <p>まだ記録がありません。</p>
          <p class="ranking-empty-sub">台を選んで遊び、<b>計数</b>すると1戦ごとにここへ並びます。<br>他の人の会員カードを読み込んで見ることもできます。</p>
          <button class="setup-launch" data-act="play" type="button">遊ぶ ▶</button>
        </div>
      </div>
    `;
    wireCommon(root, cb);
    return;
  }

  // 履歴に登場する章のみタブ化（CHAPTERS の並び順を維持）
  const presentIds = new Set(combined.map((r) => r.chapterId));
  const chapterTabs = CHAPTERS.filter((c) => presentIds.has(c.id));
  if (chapterFilter !== 'all' && !presentIds.has(chapterFilter)) {
    chapterFilter = 'all';
  }

  const filtered =
    chapterFilter === 'all'
      ? combined
      : combined.filter((r) => r.chapterId === chapterFilter);
  const runs = sortRuns(filtered, sortKey);
  const s = summarize(filtered);

  const tabsHtml = [{ id: 'all', name: '総合' }, ...chapterTabs]
    .map(
      (t) =>
        `<button class="ranking-tab${t.id === chapterFilter ? ' active' : ''}" data-chapter="${esc(t.id)}" type="button">${esc(t.name)}</button>`,
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
    card('最高差枚', fmtSigned(s.best), signClass(s.best)),
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
      const isMe = r.memberId === myId;
      const memberCell = `${esc(r.memberName || '—')}${isMe ? '<span class="rk-me-badge">自分</span>' : ''}`;
      return `
      <tr${isMe ? ' class="rk-me-row"' : ''}>
        <td class="rk-date">${fmtDate(r.settledAt)}</td>
        <td class="rk-member">${memberCell}</td>
        <td>${esc(CHAPTER_NAME.get(r.chapterId) ?? r.chapterId)}</td>
        <td class="rk-num ${signClass(r.sahmai)}">${fmtSigned(r.sahmai)}</td>
        <td class="rk-num">${r.spinCount}</td>
        <td class="rk-num ${y === null ? '' : y >= 100 ? 'num-plus' : 'num-minus'}">${y === null ? '—' : `${y.toFixed(1)}%`}</td>
        <td class="rk-num">${r.investment}</td>
        <td class="rk-num">${r.payback}</td>
        <td class="rk-num">${r.premiumCount}</td>
        <td class="rk-num">${r.bonusCount}</td>
        <td class="rk-conditions">${esc(runConditions(r))}</td>
      </tr>`;
    })
    .join('');

  root.innerHTML = `
    <div class="ranking-view">
      ${headerHtml}
      <div class="ranking-summary">${summaryHtml}</div>
      ${cardLoadSectionHtml()}
      <div class="ranking-controls">
        <div class="ranking-tabs">${tabsHtml}</div>
        <div class="ranking-sort"><span class="ranking-sort-label">並べ替え</span>${sortsHtml}</div>
      </div>
      <div class="ranking-table-wrap">
        <table class="ranking-table">
          <thead>
            <tr>
              <th>日付</th><th>会員</th><th>台</th><th>差枚</th><th>回転</th><th>機械割</th>
              <th>投資</th><th>回収</th><th>BIG</th><th>REG</th><th>条件</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>
    </div>
  `;

  wireCommon(root, cb);
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

/** 戻る・遊ぶ・カード読込/クリアの配線（空状態/通常で共通）。 */
function wireCommon(root: HTMLElement, cb: RankingViewCallbacks): void {
  root.querySelector('[data-act="back"]')?.addEventListener('click', cb.onBack);
  root.querySelector('[data-act="play"]')?.addEventListener('click', cb.onPlay);
  root
    .querySelector('[data-act="clear-cards"]')
    ?.addEventListener('click', () => {
      externalRecords = [];
      loadedCards = [];
      renderRankingView(cb);
    });

  const fileInput = root.querySelector<HTMLInputElement>('[data-act="rank-file"]');
  fileInput?.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    const msg = root.querySelector<HTMLElement>('[data-rank-msg]');
    try {
      const payload = await readCard(file);
      const recs = extractRunHistory(payload);
      externalRecords.push(...recs);
      loadedCards.push({ name: payload.member.name, count: recs.length });
      renderRankingView(cb); // チップ・テーブル更新（読み込めた事実はチップで分かる）
    } catch (err) {
      if (msg) {
        msg.textContent =
          err instanceof CardError ? err.message : 'カードを読み込めませんでした。';
        msg.classList.add('error');
        msg.hidden = false;
      }
    }
  });
}
