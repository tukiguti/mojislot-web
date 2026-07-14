/**
 * TOP ランディング。3導線（遊ぶ / 会員カード / ランキング）。
 * Pixi 未起動の軽量 DOM ビュー。コールバック注入で結線（main-entry）。
 */
export interface TopViewCallbacks {
  onPlay: () => void;
  onCard: () => void;
  onRanking: () => void;
}

export function mountTopView(cb: TopViewCallbacks): void {
  const root = document.getElementById('view-top');
  if (!root) return;

  const base = import.meta.env.BASE_URL;
  root.innerHTML = `
    <div class="landing">
      <h1 class="landing-title" data-view-title>
        <img class="landing-logo" src="${base}art/logo.webp" alt="文字スロ ―MOJISLOT―" />
      </h1>
      <p class="landing-sub">日本語3文字スロット ／ ビタ押し技術介入</p>
      <nav class="landing-menu">
        <button class="landing-btn" data-act="play" type="button">
          <span class="landing-btn-jp">遊ぶ</span>
          <span class="landing-btn-en">PLAY</span>
        </button>
        <button class="landing-btn" data-act="card" type="button">
          <span class="landing-btn-jp">会員カード</span>
          <span class="landing-btn-en">MEMBER CARD</span>
        </button>
        <button class="landing-btn" data-act="ranking" type="button">
          <span class="landing-btn-jp">ランキング</span>
          <span class="landing-btn-en">RANKING</span>
        </button>
      </nav>
    </div>
  `;

  root.querySelector('[data-act="play"]')?.addEventListener('click', cb.onPlay);
  root.querySelector('[data-act="card"]')?.addEventListener('click', cb.onCard);
  root.querySelector('[data-act="ranking"]')?.addEventListener('click', cb.onRanking);
}
