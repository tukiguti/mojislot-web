import type { ZukanState } from '../productions/ZukanState';
import type { YakuList } from '../data/schemas';

/**
 * 図鑑モーダル。`Z` キーまたは外部 toggle() で開閉。
 * 未達成役は「？？？」でマスクし、達成数を併記する。
 */
export class ZukanOverlay {
  private readonly root: HTMLElement;
  private readonly listEl: HTMLElement;
  private readonly summaryEl: HTMLElement;
  private visible = false;

  constructor(
    private readonly state: ZukanState,
    private readonly yakuList: YakuList,
  ) {
    const root = document.getElementById('zukan-overlay');
    if (!root) throw new Error('#zukan-overlay not found');
    this.root = root;
    this.root.innerHTML = `
      <div class="zukan-modal">
        <div class="zukan-header">
          <h2>図鑑</h2>
          <button class="zukan-close" type="button">×</button>
        </div>
        <div class="zukan-summary"></div>
        <div class="zukan-list"></div>
        <div class="zukan-hint">[Z] で閉じる</div>
      </div>
    `;
    this.summaryEl = this.root.querySelector('.zukan-summary')!;
    this.listEl = this.root.querySelector('.zukan-list')!;
    const closeBtn = this.root.querySelector<HTMLButtonElement>('.zukan-close')!;
    closeBtn.addEventListener('click', () => this.close());

    state.counts.subscribe(() => {
      if (this.visible) this.render();
    });
    state.bitaCount.subscribe(() => {
      if (this.visible) this.render();
    });

    this.close();
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
  }
}
