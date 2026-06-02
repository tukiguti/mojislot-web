/**
 * 画面全体の派手演出（DOM ベース）。
 * Pixi 側ではなく DOM で出すので、cabinet 外まで影響を出せる（紙吹雪が画面端まで）。
 */

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
  document.body.appendChild(el);
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
  document.body.appendChild(container);

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
export function showPremiumCutin(yakuName: string, symbols: string[]): void {
  // 既存のカットインがあれば消す（連発でも崩れない）
  document.querySelectorAll('.premium-cutin').forEach((el) => el.remove());

  const root = document.createElement('div');
  root.className = 'premium-cutin';

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

  root.innerHTML = `
    <div class="premium-cutin-veil"></div>
    <div class="premium-cutin-rays">${raysHtml}</div>
    <div class="premium-cutin-content">
      <div class="premium-cutin-label">PREMIUM!</div>
      <div class="premium-cutin-symbols">${symbolsHtml}</div>
      <div class="premium-cutin-yaku">${escape(yakuName)}</div>
    </div>
  `;
  document.body.appendChild(root);

  // 次フレームで .show を付けて遷移開始
  requestAnimationFrame(() => root.classList.add('show'));

  // 1.8s 後にフェードアウト → 削除
  window.setTimeout(() => root.classList.add('out'), 1500);
  window.setTimeout(() => root.remove(), 2100);
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
  document.body.appendChild(el);
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
  hasPremium: boolean;
  /** 各リール中心 x の canvas 幅比（0〜1）。未指定なら旧 600px 基準の既定値。 */
  reelCentersXFrac?: readonly number[];
  /** リール上端 y の canvas 高さ比（0〜1）。矢印をリール直上に置く。未指定なら旧既定値。 */
  reelTopYFrac?: number;
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
  const label = document.createElement('div');
  label.className = 'aim-notice-label';
  label.textContent = opts.yakuName ? `狙え！ ${opts.yakuName}` : '狙え！';
  notice.appendChild(label);
  const symbolsEl = document.createElement('div');
  symbolsEl.className = 'aim-notice-symbols';
  opts.symbols.slice(0, 3).forEach((s, i) => {
    const span = document.createElement('span');
    span.textContent = s;
    // 文字色を実リールのセル色に合わせる（揃った時の見た目と一致させる）。
    const c = opts.colors?.[i];
    if (c) {
      span.style.color = c;
      span.style.borderColor = c;
      span.style.textShadow = `0 0 4px rgba(0,0,0,1), 0 0 10px ${c}`;
    }
    symbolsEl.appendChild(span);
  });
  notice.appendChild(symbolsEl);
  document.body.appendChild(notice);

  // 3 リール全てに下向き矢印（プレイヤーに「ここで狙え」を明示）。
  // 矢印先端をリール上端の少し上に置く（リールを指す）。
  const reelTopFrac = opts.reelTopYFrac ?? 260 / 600;
  const reelTopY = rect.top + rect.height * reelTopFrac - 8;
  for (let i = 0; i < 3; i++) {
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
  document.querySelectorAll('.aim-notice, .aim-arrow').forEach((el) => {
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
  document.body.appendChild(bonusSparkleContainer);

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

function escape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
