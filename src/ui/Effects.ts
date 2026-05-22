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

function escape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
