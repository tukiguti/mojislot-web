/**
 * 派手演出（DOM ベース）。
 * 既定の出力先は body だが、setEffectHost で液晶領域（#game-area 内の #lcd-fx）に
 * 差し替えると、紙吹雪・フラッシュ・カットイン等が液晶内にクリップされ画面外へ出ない。
 */

/** 全 DOM 演出の出力先。main.ts から液晶ホストへ差し替える。 */
let effectHost: HTMLElement = document.body;
export function setEffectHost(el: HTMLElement): void {
  effectHost = el;
}

const CONFETTI_COLORS = [
  '#ffd700',
  '#ff66cc',
  '#66ccff',
  '#66ff88',
  '#ff6688',
  '#ffaa44',
];

/** 全画面フラッシュ。色と alpha を渡してパッと光らせる */
export function flashScreen(opts: {
  color?: string;
  alpha?: number;
  durMs?: number;
} = {}): void {
  const color = opts.color ?? '#ffffff';
  const alpha = opts.alpha ?? 0.7;
  const durMs = opts.durMs ?? 280;
  const el = document.createElement('div');
  el.className = 'screen-flash';
  el.style.background = color;
  el.style.opacity = String(alpha);
  effectHost.appendChild(el);
  requestAnimationFrame(() => {
    el.style.transition = `opacity ${durMs}ms ease-out`;
    el.style.opacity = '0';
  });
  window.setTimeout(() => el.remove(), durMs + 80);
}

/** 紙吹雪を画面上から降らせる */
export function spawnConfetti(count = 80): void {
  const container = document.createElement('div');
  container.className = 'confetti-container';
  effectHost.appendChild(container);

  for (let i = 0; i < count; i++) {
    const piece = document.createElement('div');
    piece.className = 'confetti-piece';
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.background =
      CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)];
    piece.style.animationDelay = `${Math.random() * 600}ms`;
    piece.style.animationDuration = `${1800 + Math.random() * 1500}ms`;
    piece.style.transform = `rotate(${Math.random() * 360}deg)`;
    container.appendChild(piece);
  }
  window.setTimeout(() => container.remove(), 4500);
}

/** body 全体を一時的に揺らす（cabinet の bonus アニメと干渉しない） */
export function shakeBody(durMs = 500): void {
  document.body.classList.add('shake');
  window.setTimeout(() => document.body.classList.remove('shake'), durMs);
}

/**
 * プレミアム成立カットイン。
 * 暗転 → 役名がデカく登場 → 放射状光線 → フェードアウト。
 * 完全に視覚演出なのでゲーム進行はブロックしない（pointer-events: none）。
 */
/**
 * カットインの背景。**一枚絵は任意**で、無ければ `accent` から手続き生成する。
 *
 * 絵を役の位置（premiumYaku[0] なら章の一枚絵）で暗黙に決めていた頃は、役を
 * 差し替えるたびに「いなり成立で握り寿司の絵」のような食い違いが残った。役が
 * 自分の絵を明示し、持たない役は色から組み立てる形にすると、これが起きない。
 */
export interface CutinBackdrop {
  /** 役色。光線とグローの基色になる（絵の有無にかかわらず使う）。 */
  accent: string;
  /** 一枚絵の URL。無ければ accent から背景を生成する。 */
  imageUrl?: string;
}

export function showPremiumCutin(
  yakuName: string,
  symbols: string[],
  backdrop: CutinBackdrop,
  variant: 'big' | 'reg' = 'big',
): void {
  // 既存のカットインがあれば消す（連発でも崩れない）
  document.querySelectorAll('.premium-cutin').forEach((el) => el.remove());

  const root = document.createElement('div');
  root.className = variant === 'reg' ? 'premium-cutin reg' : 'premium-cutin';
  // 役色は CSS 変数で流す。光線・グロー・背景文字がこれを見る。
  root.style.setProperty('--cutin-accent', backdrop.accent);

  // 8 本の光線を放射
  const raysHtml = Array.from({ length: 12 })
    .map(
      (_, i) =>
        `<div class="premium-cutin-ray" style="transform: rotate(${(i * 360) / 12}deg)"></div>`,
    )
    .join('');

  const symbolsHtml = symbols
    .map(
      (s, i) =>
        `<span class="premium-cutin-symbol" style="animation-delay:${i * 90}ms">${escape(s)}</span>`,
    )
    .join('');

  // 一枚絵がある役はそれを敷き、無い役は役色のグロー＋奥に沈んだ巨大な役名で組む。
  // 文字を揃えるゲームなので、絵が無い側も「文字が主役」の見た目になるようにしている。
  const artHtml = backdrop.imageUrl
    ? `<div class="premium-cutin-art" style="background-image:url('${encodeURI(backdrop.imageUrl)}')"></div>`
    : `<div class="premium-cutin-backdrop">
         <div class="premium-cutin-ghost" aria-hidden="true">${escape(yakuName)}</div>
       </div>`;

  root.innerHTML = `
    <div class="premium-cutin-veil"></div>
    ${artHtml}
    <div class="premium-cutin-rays">${raysHtml}</div>
    <div class="premium-cutin-content">
      <div class="premium-cutin-label">${variant === 'reg' ? 'REGULAR!' : 'PREMIUM!'}</div>
      <div class="premium-cutin-symbols">${symbolsHtml}</div>
      <div class="premium-cutin-yaku">${escape(yakuName)}</div>
    </div>
  `;
  effectHost.appendChild(root);

  // 次フレームで .show を付けて遷移開始
  requestAnimationFrame(() => root.classList.add('show'));

  // 1.8s 後にフェードアウト → 削除
  window.setTimeout(() => root.classList.add('out'), 1500);
  window.setTimeout(() => root.remove(), 2100);
}

/**
 * 突入直前の「溜め」演出。中央へ光が収束 → 弾けてカットインへ橋渡しする。
 * pointer-events: none で進行はブロックしない。durMs 経過で自動的に弾け、少し後に消える。
 */
export function showEntryCharge(variant: 'big' | 'reg' = 'big', durMs = 650): void {
  document.querySelectorAll('.entry-charge').forEach((el) => el.remove());
  const el = document.createElement('div');
  el.className = variant === 'reg' ? 'entry-charge reg' : 'entry-charge';
  el.innerHTML = `<div class="entry-charge-core"></div><div class="entry-charge-ring"></div>`;
  effectHost.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  // 終盤で弾け（burst）→ 直後に除去。カットインはこの burst に合わせて呼ばれる想定。
  window.setTimeout(() => el.classList.add('burst'), Math.max(0, durMs - 140));
  window.setTimeout(() => el.remove(), durMs + 280);
}

/**
 * 遅れ演出。レバーを叩いてもリールが回り出さない「間」を見せる。
 *
 * 何が当たっているかは言わないので狙える役は増えない。**気づけるかどうかだけ**が変わる。
 * リールが回り出す前に完結するので他の演出とぶつからない。派手にすると「間」の緊張が
 * 消えるので、画面をわずかに沈ませるだけに留める。
 */
export function showDelay(durMs: number): void {
  document.querySelectorAll('.delay-hold').forEach((el) => el.remove());
  const el = document.createElement('div');
  el.className = 'delay-hold';
  el.style.setProperty('--delay-ms', `${durMs}ms`);
  effectHost.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  window.setTimeout(() => el.remove(), durMs + 240);
}

/**
 * 連チャン昇格バッジ。「{streak}連 RANK UP!」を段の色で一瞬出す。
 * 連チャンの段が上がった瞬間の高揚を演出する（pointer-events: none）。
 */
export function showRankUpBadge(streak: number, color: string): void {
  document.querySelectorAll('.rankup-badge').forEach((el) => el.remove());
  const el = document.createElement('div');
  el.className = 'rankup-badge';
  el.style.setProperty('--rankup-color', color);
  el.innerHTML = `<div class="rankup-sub">RANK UP!</div><div class="rankup-main">${streak}連</div>`;
  effectHost.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  window.setTimeout(() => el.classList.add('out'), 900);
  window.setTimeout(() => el.remove(), 1300);
}

/** フリーズ演出中の「FREEZE!?」バナー。clearFreezeBanner() まで残る。 */
let freezeBannerEl: HTMLElement | null = null;
export function showFreezeBanner(): void {
  clearFreezeBanner();
  const el = document.createElement('div');
  el.className = 'freeze-overlay';
  el.innerHTML = `<div class="freeze-text">FREEZE!?</div>`;
  effectHost.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  freezeBannerEl = el;
}
export function clearFreezeBanner(): void {
  if (!freezeBannerEl) return;
  const el = freezeBannerEl;
  freezeBannerEl = null;
  el.classList.add('out');
  window.setTimeout(() => el.remove(), 400);
}

/**
 * 多重ライン HIT バッジ。役名トーストと別軸で「2 LINES!!」と派手に出す。
 * ライン本数で色を変える（2=金、3=橙、4+=赤）。
 */
export function showMultiHitBadge(lineCount: number): void {
  document.querySelectorAll('.multi-hit-badge').forEach((el) => el.remove());
  const el = document.createElement('div');
  el.className = 'multi-hit-badge';
  if (lineCount >= 4) el.classList.add('fever');
  else if (lineCount === 3) el.classList.add('hot');
  el.textContent = `${lineCount} LINES!!`;
  effectHost.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  window.setTimeout(() => el.classList.add('out'), 900);
  window.setTimeout(() => el.remove(), 1400);
}

/**
 * 「狙え！◯◯◯」レバーオン示唆演出。
 * - リール回転開始時に「この役を狙え」と 3 文字を予告表示
 * - 画面上部に「狙え！」ラベル + 役名 + 3 文字（左中右の順）
 * - 各リールの上に下向き矢印を 3 本配置（プレイヤーに目標を明示）
 * - プレミアム役なら金グラデで派手に
 *
 * 矢印位置は Pixi canvas (600x600 内部解像度) 上のリール中心 x を CSS 座標に
 * 変換して算出。canvas が CSS でスケールしても追従する。
 */
export interface AimNoticeOptions {
  /** 狙うべき役の 3 文字（左/中/右の順、必ず length=3） */
  symbols: readonly string[];
  /** 各文字の色（実リールのセル色に合わせる。CSS color 文字列、length=3 想定） */
  colors?: readonly string[];
  /** 表示用の役名（任意） */
  yakuName?: string;
  /** 「狙え！」グラフィック画像の URL（任意。未指定なら CSS 文字ラベルにフォールバック） */
  imageUrl?: string;
  hasPremium: boolean;
  /** 各リール中心 x の canvas 幅比（0〜1）。未指定なら旧 600px 基準の既定値。 */
  reelCentersXFrac?: readonly number[];
  /** リール上端 y の canvas 高さ比（0〜1）。矢印をリール直上に置く。未指定なら旧既定値。 */
  reelTopYFrac?: number;
  /**
   * 矢印を出すリール（true=出す）。示唆から「狙え！」へ発展した時、
   * 停止済みリールに矢印を出さないために使う。未指定なら全リールに出す。
   */
  arrowReels?: readonly boolean[];
}

export function showAimNotice(opts: AimNoticeOptions): void {
  hideAimNotice();
  const canvas = document.getElementById('game') as HTMLCanvasElement | null;
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  // リール座標比は呼び出し側（現行 canvas 寸法を知る main.ts）から受け取る。
  // 未指定時のフォールバックは旧 600x600 時代の値。
  const reelCenterFracs = opts.reelCentersXFrac ?? [154 / 600, 300 / 600, 446 / 600];

  // 「狙え！」ラベル + 役名 + 3 文字
  const notice = document.createElement('div');
  notice.className = 'aim-notice';
  if (opts.hasPremium) notice.classList.add('premium');
  notice.style.left = `${rect.left + rect.width / 2}px`;
  notice.style.top = `${rect.top + 8}px`;
  notice.style.width = `${rect.width}px`;
  // 「狙え！」見出し: 画像があれば一枚絵、無ければ CSS 文字ラベルにフォールバック。
  if (opts.imageUrl) {
    const img = document.createElement('img');
    img.className = 'aim-notice-img';
    img.src = opts.imageUrl;
    img.alt = '狙え！';
    img.decoding = 'async';
    notice.appendChild(img);
    if (opts.yakuName) {
      const yaku = document.createElement('div');
      yaku.className = 'aim-notice-yaku';
      yaku.textContent = `${opts.yakuName} を狙え`;
      notice.appendChild(yaku);
    }
  } else {
    const label = document.createElement('div');
    label.className = 'aim-notice-label';
    label.textContent = opts.yakuName ? `狙え！ ${opts.yakuName}` : '狙え！';
    notice.appendChild(label);
  }
  document.body.appendChild(notice);

  // 狙う図柄は**各リールの上**に1文字ずつ置く（どのリールで何を狙うかを直結させる）。
  // 中央にまとめて並べる旧方式は廃止（リール上の表示と二重になるため）。
  const reelTopFrac = opts.reelTopYFrac ?? 260 / 600;
  // 矢印は高さ28pxの三角。先端がリール上端の少し**上**で止まるよう -38 に置く
  // （-8 だとリールに20px食い込んで図柄が隠れていた）。図柄タイルはさらに上。
  const reelTopY = rect.top + rect.height * reelTopFrac - 38;
  const symbolY = rect.top + rect.height * reelTopFrac - 96;
  for (let i = 0; i < 3; i++) {
    if (opts.arrowReels && !opts.arrowReels[i]) continue;
    const sym = opts.symbols[i];
    if (sym !== undefined) {
      const tile = document.createElement('div');
      tile.className = 'aim-reel-symbol';
      if (opts.hasPremium) tile.classList.add('premium');
      tile.textContent = sym;
      const c = opts.colors?.[i];
      if (c) {
        tile.style.color = c;
        tile.style.borderColor = c;
        tile.style.textShadow = `0 0 4px rgba(0,0,0,1), 0 0 10px ${c}`;
      }
      tile.style.left = `${rect.left + rect.width * reelCenterFracs[i]}px`;
      tile.style.top = `${symbolY}px`;
      tile.style.animationDelay = `${i * 120}ms`;
      document.body.appendChild(tile);
      requestAnimationFrame(() => tile.classList.add('show'));
    }
    const arrow = document.createElement('div');
    arrow.className = 'aim-arrow';
    if (opts.hasPremium) arrow.classList.add('premium');
    arrow.style.left = `${rect.left + rect.width * reelCenterFracs[i]}px`;
    arrow.style.top = `${reelTopY}px`;
    // 矢印は順番にバウンス（左→中→右）させる
    arrow.style.animationDelay = `${i * 120}ms`;
    document.body.appendChild(arrow);
    requestAnimationFrame(() => arrow.classList.add('show'));
  }
  requestAnimationFrame(() => notice.classList.add('show'));
}

export function hideAimNotice(): void {
  document
    .querySelectorAll('.aim-notice, .aim-arrow, .aim-reel-symbol')
    .forEach((el) => {
      el.classList.add('out');
      window.setTimeout(() => el.remove(), 240);
    });
}

/**
 * 示唆予告（候補提示）。示唆はカテゴリしか示さないので、**そのtierで当たりうる役を
 * 全部並べて「どれかな…？」と迷わせる**のが狙い（初期コンセプト＝考えて打つ）。
 * 第1・第2停止で内部役の図柄が中段に来たら、呼び出し側が hideShisaNotice() →
 * showAimNotice() に切り替えて「狙え！」へ発展させる。
 */
export interface ShisaCandidate {
  name: string;
  /** 役の文字（チェリー等の2文字役もあり得る） */
  symbols: readonly string[];
  /** 各文字の色（実リールのセル色に合わせる） */
  colors?: readonly string[];
}

export interface ShisaNoticeOptions {
  candidates: readonly ShisaCandidate[];
  /** tier色。枠と見出しの色に反映する。 */
  color: 'blue' | 'green' | 'red' | 'gold' | 'rainbow';
  /** 見出し文（未指定なら候補数から自動）。押し順ナビは「どれだ？」を渡す。 */
  headline?: string;
}

export function showShisaNotice(opts: ShisaNoticeOptions): void {
  hideShisaNotice();
  const canvas = document.getElementById('game') as HTMLCanvasElement | null;
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();

  const notice = document.createElement('div');
  notice.className = `shisa-notice tier-${opts.color}`;
  notice.style.left = `${rect.left + rect.width / 2}px`;
  notice.style.top = `${rect.top + 8}px`;
  notice.style.width = `${rect.width}px`;

  const head = document.createElement('div');
  head.className = 'shisa-notice-head';
  head.textContent =
    opts.headline ?? (opts.candidates.length > 1 ? 'どれかな…？' : 'これだ…？');
  notice.appendChild(head);

  const list = document.createElement('div');
  list.className = 'shisa-candidates';
  opts.candidates.forEach((c, ci) => {
    const row = document.createElement('div');
    row.className = 'shisa-cand';
    row.style.animationDelay = `${ci * 90}ms`;
    const name = document.createElement('span');
    name.className = 'shisa-cand-name';
    name.textContent = c.name;
    row.appendChild(name);
    const syms = document.createElement('span');
    syms.className = 'shisa-cand-symbols';
    c.symbols.forEach((s, i) => {
      const span = document.createElement('span');
      span.textContent = s;
      const col = c.colors?.[i];
      if (col) {
        span.style.color = col;
        span.style.borderColor = col;
      }
      syms.appendChild(span);
    });
    row.appendChild(syms);
    list.appendChild(row);
  });
  notice.appendChild(list);
  document.body.appendChild(notice);
  requestAnimationFrame(() => notice.classList.add('show'));
}

export function hideShisaNotice(): void {
  document.querySelectorAll('.shisa-notice').forEach((el) => {
    el.classList.add('out');
    window.setTimeout(() => el.remove(), 240);
  });
}


/**
 * ボタン押下位置から外側へ広がる円形リップル。
 * 短命（450ms）で残らない。LEVER/STOP/BET 等の操作フィードバック用。
 */
export function spawnButtonRipple(
  buttonEl: HTMLElement,
  color = '#ffd700',
): void {
  const rect = buttonEl.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const size = Math.max(rect.width, rect.height) * 1.6;
  const ripple = document.createElement('div');
  ripple.className = 'btn-ripple';
  ripple.style.left = `${cx - size / 2}px`;
  ripple.style.top = `${cy - size / 2}px`;
  ripple.style.width = `${size}px`;
  ripple.style.height = `${size}px`;
  ripple.style.borderColor = color;
  document.body.appendChild(ripple);
  requestAnimationFrame(() => ripple.classList.add('expand'));
  window.setTimeout(() => ripple.remove(), 500);
}

/**
 * ボーナス期間中、画面全体に散る金色スパークルを継続的に湧かせる。
 * startBonusSparkle() で開始、stopBonusSparkle() で停止＆掃除。
 * 連発防止のため、内部 timer を持ち重複起動を許さない。
 */
let bonusSparkleTimer: number | null = null;
let bonusSparkleContainer: HTMLElement | null = null;

export function startBonusSparkle(): void {
  if (bonusSparkleTimer !== null) return;
  bonusSparkleContainer = document.createElement('div');
  bonusSparkleContainer.className = 'bonus-sparkle-layer';
  effectHost.appendChild(bonusSparkleContainer);

  const spawn = () => {
    if (!bonusSparkleContainer) return;
    // 1 度に 1〜3 粒生む
    const burst = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < burst; i++) {
      const p = document.createElement('div');
      p.className = 'bonus-sparkle';
      // 画面端から少し内側にランダム配置
      p.style.left = `${5 + Math.random() * 90}%`;
      p.style.top = `${5 + Math.random() * 90}%`;
      const size = 4 + Math.random() * 8;
      p.style.width = `${size}px`;
      p.style.height = `${size}px`;
      p.style.animationDuration = `${800 + Math.random() * 700}ms`;
      bonusSparkleContainer.appendChild(p);
      // 自動 cleanup（アニメーション後）
      window.setTimeout(() => p.remove(), 1600);
    }
  };
  spawn();
  bonusSparkleTimer = window.setInterval(spawn, 180);
}

export function stopBonusSparkle(): void {
  if (bonusSparkleTimer !== null) {
    window.clearInterval(bonusSparkleTimer);
    bonusSparkleTimer = null;
  }
  if (bonusSparkleContainer) {
    bonusSparkleContainer.remove();
    bonusSparkleContainer = null;
  }
}

/**
 * 役成立時の「+N」フロート。`anchor`（コイン表示）の右横から浮き上がる。
 *
 * 出力先は body 固定。液晶ホストに入れるとクリップされて、
 * 液晶の外に置いてあるコイン表示の横まで届かない。
 */
export function showCoinFloat(
  anchor: HTMLElement,
  amount: number,
  premium: boolean,
): void {
  const el = document.createElement('div');
  el.className = 'coin-float' + (premium ? ' premium' : '');
  el.textContent = `+${amount}`;
  document.body.appendChild(el);
  const rect = anchor.getBoundingClientRect();
  el.style.left = `${rect.left + rect.width + 6}px`;
  el.style.top = `${rect.top}px`;
  requestAnimationFrame(() => el.classList.add('rise'));
  window.setTimeout(() => el.remove(), 1400);
}

/** 大配当時：🪙 を `anchor`（筐体）の中心から下方向へ複数飛ばす。 */
export function showCoinBurst(anchor: HTMLElement, count: number): void {
  const startRect = anchor.getBoundingClientRect();
  const cx = startRect.left + startRect.width / 2;
  const cy = startRect.top + startRect.height / 2;
  for (let i = 0; i < count; i++) {
    const el = document.createElement('div');
    el.className = 'coin-burst';
    el.textContent = '🪙';
    document.body.appendChild(el);
    const startJitter = (Math.random() - 0.5) * 80;
    el.style.left = `${cx + startJitter}px`;
    el.style.top = `${cy}px`;
    const angle = (Math.random() - 0.5) * Math.PI; // -90°..90°（下方向）
    const distance = 220 + Math.random() * 180;
    const dx = Math.sin(angle) * distance;
    const dy = Math.cos(angle) * distance + 100;
    window.setTimeout(() => {
      el.style.transform = `translate(${dx}px, ${dy}px) rotate(${(Math.random() - 0.5) * 720}deg)`;
      el.classList.add('fly');
    }, i * 35);
    window.setTimeout(() => el.remove(), 1700 + i * 35);
  }
}

/** 隠し章の解除など、ゲーム進行の外側の知らせ。3.5秒で自然に消える。 */
export function showSecretToast(text: string): void {
  const el = document.createElement('div');
  el.className = 'secret-toast';
  el.textContent = text;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  window.setTimeout(() => el.classList.remove('show'), 3500);
  window.setTimeout(() => el.remove(), 4000);
}

function escape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
