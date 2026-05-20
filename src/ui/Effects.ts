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
