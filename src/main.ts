import { Application } from 'pixi.js';
import { ReelEngine } from './core/ReelEngine';
import { ReelView, CELL_WIDTH, CELL_HEIGHT, VISIBLE_CELLS } from './render/ReelView';
import { ReelConfigSchema } from './data/schemas';
import reelDataRaw from '../data/reels/hiragana_food.json';
import './style.css';

const REEL_GAP = 12;
const REEL_COUNT = 3;

async function bootstrap() {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  if (!canvas) throw new Error('#game canvas not found');

  const app = new Application();
  await app.init({
    canvas,
    width: 800,
    height: 600,
    backgroundColor: 0x1a1a1a,
    antialias: true,
    resolution: window.devicePixelRatio || 1,
    autoDensity: true,
    preference: 'webgl',
  });

  const reelConfig = ReelConfigSchema.parse(reelDataRaw);

  const engines: ReelEngine[] = [];
  const views: ReelView[] = [];

  const totalWidth = CELL_WIDTH * REEL_COUNT + REEL_GAP * (REEL_COUNT - 1);
  const startX = (app.screen.width - totalWidth) / 2;
  const y = (app.screen.height - CELL_HEIGHT * VISIBLE_CELLS) / 2;

  for (let i = 0; i < REEL_COUNT; i++) {
    const engine = new ReelEngine(reelConfig.reels[i]);
    const view = new ReelView(engine);
    view.container.x = startX + i * (CELL_WIDTH + REEL_GAP);
    view.container.y = y;
    app.stage.addChild(view.container);
    engines.push(engine);
    views.push(view);
  }

  app.ticker.add(() => {
    const now = performance.now();
    for (const engine of engines) engine.tick(now);
    for (const view of views) view.update();
  });

  const leverBtn = document.getElementById('lever-btn');
  leverBtn?.addEventListener('click', () => {
    for (const engine of engines) engine.spin();
    console.log('[lever] all reels spin');
  });

  document.querySelectorAll<HTMLButtonElement>('.stop-btn').forEach((btn) => {
    const idx = Number(btn.dataset.reel ?? -1);
    if (idx < 0 || idx >= REEL_COUNT) return;
    btn.addEventListener('pointerdown', (ev) => {
      const result = engines[idx].stop(ev.timeStamp);
      console.log(`[stop reel=${idx}]`, result);
      if (engines.every((e) => e.state.get() === 'stopped')) {
        const symbols = engines.map((e) => {
          const total = e.strip.cells.length;
          const ci = ((Math.round(e.position) % total) + total) % total;
          return e.strip.cells[ci];
        });
        console.log('[all stopped] payline =', symbols.join(''));
      }
    });
  });
}

bootstrap().catch((err) => {
  console.error('bootstrap failed:', err);
});
