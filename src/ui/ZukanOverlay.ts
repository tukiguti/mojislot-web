import type { ZukanState } from '../productions/ZukanState';
import type { YakuList } from '../data/schemas';
import type { PlayStats } from '../productions/PlayStats';
import {
  CHALLENGES,
  type ChallengeTracker,
} from '../productions/Challenges';

/**
 * 図鑑モーダル。`Z` キーまたは外部 toggle() で開閉。
 * 未達成役は「？？？」でマスクし、達成数を併記する。
 * プレイ統計（PlayStats）と、章切替/リセット操作も併せて提供する。
 */
export class ZukanOverlay {
  private readonly root: HTMLElement;
  private readonly listEl: HTMLElement;
  private readonly summaryEl: HTMLElement;
  private readonly statsEl: HTMLElement;
  private readonly missionsListEl: HTMLElement;
  private visible = false;

  constructor(
    private readonly state: ZukanState,
    private readonly yakuList: YakuList,
    private readonly playStats: PlayStats,
    private readonly challengeTracker: ChallengeTracker,
  ) {
    const root = document.getElementById('zukan-overlay');
    if (!root) throw new Error('#zukan-overlay not found');
    this.root = root;
    const collapsed = ZukanOverlay.loadMissionsCollapsed();
    this.root.innerHTML = `
      <div class="zukan-modal">
        <div class="zukan-header">
          <h2>図鑑</h2>
          <button class="zukan-close" type="button">×</button>
        </div>
        <div class="zukan-summary"></div>
        <div class="zukan-stats"></div>
        <div class="zukan-missions${collapsed ? ' collapsed' : ''}">
          <button class="zukan-missions-header" type="button">
            <span class="zukan-missions-label">ミッション</span>
            <span class="zukan-missions-progress"></span>
            <span class="zukan-missions-toggle">▼</span>
          </button>
          <div class="zukan-missions-list"></div>
        </div>
        <div class="zukan-list"></div>
        <div class="zukan-hint">[Z] で閉じる ／ 設定は ⚙ ボタンへ</div>
      </div>
    `;
    this.summaryEl = this.root.querySelector('.zukan-summary')!;
    this.statsEl = this.root.querySelector('.zukan-stats')!;
    this.missionsListEl = this.root.querySelector('.zukan-missions-list')!;
    this.listEl = this.root.querySelector('.zukan-list')!;
    const closeBtn = this.root.querySelector<HTMLButtonElement>('.zukan-close')!;
    closeBtn.addEventListener('click', () => this.close());

    // ミッション折りたたみトグル
    const missionsEl = this.root.querySelector<HTMLElement>('.zukan-missions')!;
    const missionsHeader =
      this.root.querySelector<HTMLButtonElement>('.zukan-missions-header')!;
    missionsHeader.addEventListener('click', () => {
      const nowCollapsed = !missionsEl.classList.contains('collapsed');
      missionsEl.classList.toggle('collapsed', nowCollapsed);
      ZukanOverlay.saveMissionsCollapsed(nowCollapsed);
    });

    state.counts.subscribe(() => {
      if (this.visible) this.render();
    });
    state.bitaCount.subscribe(() => {
      if (this.visible) this.render();
    });
    playStats.stats.subscribe(() => {
      if (this.visible) this.render();
    });
    challengeTracker.achieved.subscribe(() => {
      if (this.visible) this.render();
    });
    challengeTracker.enabled.subscribe(() => {
      if (this.visible) this.render();
    });

    this.close();
  }

  private static readonly MISSIONS_COLLAPSED_KEY =
    'mojislot.zukanMissionsCollapsed.v1';

  static loadMissionsCollapsed(): boolean {
    try {
      return (
        localStorage.getItem(ZukanOverlay.MISSIONS_COLLAPSED_KEY) === '1'
      );
    } catch {
      return false;
    }
  }

  static saveMissionsCollapsed(v: boolean): void {
    try {
      localStorage.setItem(
        ZukanOverlay.MISSIONS_COLLAPSED_KEY,
        v ? '1' : '0',
      );
    } catch {
      /* ignore */
    }
  }

  open(): void {
    this.visible = true;
    this.root.hidden = false;
    this.render();
  }

  close(): void {
    this.visible = false;
    this.root.hidden = true;
  }

  toggle(): void {
    if (this.visible) this.close();
    else this.open();
  }

  private render(): void {
    const counts = this.state.counts.get();
    const rate = this.state.completionRate();

    const bita = this.state.bitaCount.get();
    this.summaryEl.innerHTML = `
      <span class="zukan-rate">達成率: <strong>${rate.total}%</strong></span>
      <span class="zukan-rate-sub">コア ${rate.core}% / プレミアム ${rate.premium}% / ビタ ${bita}回</span>
    `;

    const s = this.playStats.stats.get();
    const hitRate = this.playStats.hitRate().toFixed(1);
    const net = this.playStats.netGain();
    const netSign = net >= 0 ? '+' : '';
    this.statsEl.innerHTML = `
      <div class="zukan-stats-row"><span>スピン数</span><span>${s.spinCount}</span></div>
      <div class="zukan-stats-row"><span>役成立率</span><span>${hitRate}%</span></div>
      <div class="zukan-stats-row"><span>収支</span><span class="${net >= 0 ? 'positive' : 'negative'}">${netSign}${net}</span></div>
      <div class="zukan-stats-row"><span>最大配当</span><span>${s.maxWin}</span></div>
      <div class="zukan-stats-row"><span>最大連チャン</span><span>${s.maxStreak}</span></div>
      <div class="zukan-stats-row"><span>クイズ的中</span><span>${s.quizCorrect} / ${s.quizTotal}（${this.playStats.quizRate().toFixed(1)}%）</span></div>
      <div class="zukan-stats-row"><span>プレミアム / ボーナス</span><span>${s.premiumCount} / ${s.bonusCount}</span></div>
    `;

    const renderSection = (title: string, yakus: YakuList['coreYaku'], cls: string) => {
      const items = yakus
        .map((y) => {
          const c = counts[y.id] ?? 0;
          const done = c > 0;
          const name = done ? y.name : '？？？';
          const symbols = done ? y.symbols.join(' ') : '? ? ?';
          return `
            <div class="zukan-row ${done ? 'done' : 'locked'}">
              <span class="zukan-symbols">${symbols}</span>
              <span class="zukan-name">${name}</span>
              <span class="zukan-count">${done ? `×${c}` : '—'}</span>
            </div>
          `;
        })
        .join('');
      return `
        <div class="zukan-section ${cls}">
          <h3>${title}</h3>
          ${items}
        </div>
      `;
    };

    this.listEl.innerHTML =
      renderSection('プレミアム役', this.yakuList.premiumYaku, 'premium') +
      renderSection('コア役', this.yakuList.coreYaku, 'core');

    // ミッション一覧
    const stats = this.playStats.stats.get();
    const bitaCount = this.state.bitaCount.get();
    const zukanCounts = this.state.counts.get();
    const ctx = {
      stats,
      bitaCount,
      zukanCounts,
      yakuList: this.yakuList,
    };
    const achievedSet = this.challengeTracker.achieved.get();

    // ヘッダー進捗表示（無効中はバッジ付き）
    const progressEl = this.root.querySelector<HTMLElement>(
      '.zukan-missions-progress',
    );
    const enabled = this.challengeTracker.enabled.get();
    if (progressEl) {
      const disabledTag = enabled ? '' : ' <span class="missions-off-badge">OFF</span>';
      progressEl.innerHTML = `${achievedSet.size} / ${CHALLENGES.length}${disabledTag}`;
    }

    this.missionsListEl.innerHTML = CHALLENGES.map((c) => {
      const done = achievedSet.has(c.id);
      const prog = c.progress?.(ctx);
      const progText = prog ? `${prog.current} / ${prog.target}` : '';
      return `
        <div class="mission-row ${done ? 'done' : ''}">
          <div>
            <div class="mission-title">${escapeHtml(c.title)}</div>
            <div class="mission-desc">${escapeHtml(c.description)}</div>
            ${progText ? `<div class="mission-progress">${progText}</div>` : ''}
          </div>
        </div>
      `;
    }).join('');
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
