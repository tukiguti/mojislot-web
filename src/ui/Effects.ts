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
 * 「狙え！」演出：テンパイ時に残った 1 リールへ向けて派手な煽りを出す。
 * - 画面中央上部に「狙え！」ラベル + 対象文字（複数可）
 * - 対象リールの真上に下向き矢印
 *
 * 矢印位置は Pixi canvas (600x600 内部解像度) 上のリール中心 x を CSS 座標に
 * 変換して算出。canvas が CSS でスケールしても追従する。
 *
 * 連発防止: 起動時に既存の notice/arrow を一括削除してから生成。
 */
export interface AimNoticeOptions {
  symbols: readonly string[];
  reelIndex: number;
  hasPremium: boolean;
}

export function showAimNotice(opts: AimNoticeOptions): void {
  hideAimNotice();
  const canvas = document.getElementById('game') as HTMLCanvasElement | null;
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  // Pixi 内部 600px における 3 リールの中心 x（main.ts 配置と合わせる）:
  // 3 リール × 130px + 2 × 16px gap = 422、左端 89px → 中心 154 / 300 / 446
  const reelCenterFracs = [154 / 600, 300 / 600, 446 / 600];
  const idx = Math.max(0, Math.min(2, opts.reelIndex));
  const targetX = rect.left + rect.width * reelCenterFracs[idx];

  // 「狙え！」ラベル + 対象文字
  const notice = document.createElement('div');
  notice.className = 'aim-notice';
  if (opts.hasPremium) notice.classList.add('premium');
  notice.style.left = `${rect.left + rect.width / 2}px`;
  notice.style.top = `${rect.top + 8}px`;
  const label = document.createElement('div');
  label.className = 'aim-notice-label';
  label.textContent = '狙え！';
  notice.appendChild(label);
  const symbolsEl = document.createElement('div');
  symbolsEl.className = 'aim-notice-symbols';
  for (const s of opts.symbols.slice(0, 4)) {
    const span = document.createElement('span');
    span.textContent = s;
    symbolsEl.appendChild(span);
  }
  notice.appendChild(symbolsEl);
  document.body.appendChild(notice);

  // 対象リールへの下向き矢印（リール上端少し上）
  const arrow = document.createElement('div');
  arrow.className = 'aim-arrow';
  if (opts.hasPremium) arrow.classList.add('premium');
  // game-area 内のリール上端は LIQUID_AREA_H = 260 (canvas内部) なので
  // CSS 上では rect.top + rect.height * (260/600)
  arrow.style.left = `${targetX}px`;
  arrow.style.top = `${rect.top + rect.height * (260 / 600) - 8}px`;
  document.body.appendChild(arrow);

  requestAnimationFrame(() => {
    notice.classList.add('show');
    arrow.classList.add('show');
  });
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
