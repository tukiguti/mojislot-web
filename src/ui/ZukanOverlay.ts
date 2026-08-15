import {
  REMIX_ZUKAN_SCOPE,
  remixOverallCompletion,
  type ZukanState,
} from '../productions/ZukanState';
import type { Quiz, YakuList } from '../data/schemas';
import { MIN_SAMPLES, type QuizStats } from '../productions/QuizStats';
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
  private readonly quizListEl: HTMLElement;
  private visible = false;

  constructor(
    private readonly state: ZukanState,
    private readonly yakuList: YakuList,
    private readonly playStats: PlayStats,
    private readonly challengeTracker: ChallengeTracker,
    /** クイズの問題別成績（苦手な問題を見つけるため）。 */
    private readonly quizStats: QuizStats,
    /** この章の全問題。未出題の問題は伏せるので、母数として使う。 */
    private readonly quizzes: readonly Quiz[],
    /**
     * ボーナスとチェリーの払い出し。BIG・REG・チェリーは役に `payout` を持たず
     * `baseMultiplier` 側で決まるので、表示のためにここへ渡す。
     * 台選びの寄り画面の配当表と同じ値を出すため（片方だけ「—」だと食い違って見える）。
     */
    private readonly bonusPay: {
      premium: number;
      bonus: number;
      cherry: number;
      spinsPerBig: number;
      spinsPerReg: number;
    },
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
        <div class="zukan-missions zukan-quizstats collapsed">
          <button class="zukan-missions-header" type="button">
            <span class="zukan-missions-label">クイズの成績</span>
            <span class="zukan-quiz-progress"></span>
            <span class="zukan-missions-toggle">▼</span>
          </button>
          <div class="zukan-quiz-list"></div>
        </div>
        <div class="zukan-list"></div>
        <div class="zukan-hint">[Z] で閉じる ／ 設定は ⚙ ボタンへ</div>
      </div>
    `;
    this.summaryEl = this.root.querySelector('.zukan-summary')!;
    this.statsEl = this.root.querySelector('.zukan-stats')!;
    this.missionsListEl = this.root.querySelector('.zukan-missions-list')!;
    this.quizListEl = this.root.querySelector('.zukan-quiz-list')!;
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

    // クイズの成績は既定で畳んでおく。打っている最中に開くものではなく、
    // 「また同じ問題を落とした」と思った時に見に行くもの。
    const quizEl = this.root.querySelector<HTMLElement>('.zukan-quizstats')!;
    quizEl
      .querySelector<HTMLButtonElement>('.zukan-missions-header')!
      .addEventListener('click', () =>
        quizEl.classList.toggle('collapsed'),
      );
    quizStats.counts.subscribe(() => {
      if (this.visible) this.render();
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
    // カテゴリ別の率はここに出さない。セクション見出しの達成数と二重に出すと、
    // 対象カテゴリが増えた時に「コア100%なのに達成率83%」のように食い違って見える。
    //
    // リミックス台は記録が島と別勘定で、開いている図鑑はいまのステージの章だけになる。
    // それだけだと「リミックスで全章を埋める」という目標がどこにも見えないので、
    // 全章の合計と章ごとの内訳を足す（どの章が残っているかまで出さないと動けない）。
    const remix =
      this.state.scope === REMIX_ZUKAN_SCOPE ? remixOverallCompletion() : null;
    this.summaryEl.innerHTML = `
      <span class="zukan-rate">達成率: <strong>${rate.percent}%</strong></span>
      <span class="zukan-rate-sub">${rate.done} / ${rate.total} 役 ・ ビタ ${bita}回</span>
      ${
        remix
          ? `<div class="zukan-remix">
               <div class="zukan-remix-head">
                 リミックス通算 <strong>${remix.percent}%</strong>
                 <span class="zukan-remix-sub">${remix.done} / ${remix.total} 役（全${remix.perChapter.length}章）</span>
               </div>
               <div class="zukan-remix-chapters">
                 ${remix.perChapter
                   .map(
                     (c) =>
                       `<span class="zukan-remix-chip${c.done === c.total ? ' done' : ''}">${c.name} ${c.done}/${c.total}</span>`,
                   )
                   .join('')}
               </div>
             </div>`
          : ''
      }
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

    // 払い出し枚数は**役の名札**（小役は 4/6/8/10 で役が逆算できる）。
    //
    // 名前や図柄と違い、**未成立でも隠さない**。台を選ぶ寄り画面に配当表が出ていて
    // 座る前から全役の枚数が読めるので、ここで伏せても情報は守られず、
    // 同じ数字が画面によって見えたり見えなかったりするだけになる。
    // 図鑑側の役割は打っている最中に手元で引けること。
    const bp = this.bonusPay;
    const renderSection = (title: string, yakus: YakuList['coreYaku'], cls: string) => {
      if (yakus.length === 0) return '';
      // 見出しに達成数を出す。カテゴリが4つあるので、上の達成率だけだと
      // どこが埋まっていないのかが分からない。
      const doneCount = yakus.filter((y) => (counts[y.id] ?? 0) > 0).length;
      const items = yakus
        .map((y) => {
          const c = counts[y.id] ?? 0;
          const done = c > 0;
          const name = done ? y.name : '？？？';
          const symbols = done ? y.symbols.join(' ') : '? ? ?';
          // ボーナスは枚数だけ出すと小役より安く見える。恩恵は区間なのでゲーム数も添える。
          const pay =
            y.payout !== undefined
              ? `${y.payout}枚`
              : y.category === 'premium'
                ? `${bp.premium}枚＋${bp.spinsPerBig}G`
                : y.category === 'bonus'
                  ? `${bp.bonus}枚＋${bp.spinsPerReg}G`
                  : y.category === 'cherry'
                    ? `${bp.cherry}枚`
                    : '—';
          return `
            <div class="zukan-row ${done ? 'done' : 'locked'}">
              <span class="zukan-symbols">${symbols}</span>
              <span class="zukan-name">${name}</span>
              <span class="zukan-pay">${pay}</span>
              <span class="zukan-count">${done ? `×${c}` : '—'}</span>
            </div>
          `;
        })
        .join('');
      return `
        <div class="zukan-section ${cls}">
          <h3>${title}<span class="zukan-section-count">${doneCount}/${yakus.length}</span></h3>
          ${items}
        </div>
      `;
    };

    // REGとチェリーも**成立する役**なので集めた記録として出す。記録自体は
    // 以前から貯まっていて（成立した hits を全部 record している）、出していなかっただけ。
    // 1枚役だけは載せない——こぼしの受け皿で、狙って揃える役ではないため。
    this.listEl.innerHTML =
      renderSection('プレミアム役', this.yakuList.premiumYaku, 'premium') +
      renderSection('ボーナス役', this.yakuList.bonusYaku, 'bonus') +
      renderSection('チェリー', this.yakuList.cherryYaku, 'cherry') +
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

    this.renderQuizStats();
  }

  /**
   * クイズの問題別成績。**苦手な順**に並べる。
   *
   * 全体の的中率だけでは「どの問題で落としているか」が分からず、同じ問題をまた
   * 落とすのを止めようがなかった。クイズは答えの役を引き込み対象にする演出なので、
   * 外す＝取りこぼし＝出玉。潰せる苦手は潰せたほうがよい。
   *
   * 未出題の問題は出さない。出会う前に問題文を読めてしまうと、その1問が演出として死ぬ。
   */
  private renderQuizStats(): void {
    const rows = this.quizStats.weakest(this.quizzes);
    const cov = this.quizStats.coverage(this.quizzes);
    const progressEl = this.root.querySelector<HTMLElement>('.zukan-quiz-progress');
    if (progressEl) progressEl.textContent = `${cov.seen} / ${cov.total} 問`;

    if (rows.length === 0) {
      this.quizListEl.innerHTML = `
        <div class="quiz-stat-empty">まだクイズ演出に出会っていません。出題された問題だけがここに並びます。</div>`;
      return;
    }

    this.quizListEl.innerHTML =
      `<div class="quiz-stat-note">苦手な順。<b>${MIN_SAMPLES}回未満は率が読めない</b>ので下にまとめてあります。</div>` +
      rows
        .map((r) => {
          const pct = Math.round(r.rate * 100);
          const cls = !r.reliable ? 'thin' : pct < 50 ? 'weak' : pct < 80 ? 'mid' : 'good';
          return `
        <div class="quiz-stat-row ${cls}">
          <div class="quiz-stat-q">${escapeHtml(r.quiz.question)}</div>
          <div class="quiz-stat-num">
            <span class="quiz-stat-rate">${pct}%</span>
            <span class="quiz-stat-seen">${r.correct} / ${r.seen} 回</span>
          </div>
        </div>`;
        })
        .join('');
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
