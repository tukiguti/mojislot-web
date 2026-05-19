import { Application } from 'pixi.js';
import { ReelEngine } from './core/ReelEngine';
import { ReelView, CELL_WIDTH, CELL_HEIGHT, VISIBLE_CELLS } from './render/ReelView';
import { YakuJudge } from './core/YakuJudge';
import { PayoutCalc } from './core/PayoutCalc';
import { CoinWallet } from './core/CoinWallet';
import {
  ReelConfigSchema,
  YakuListSchema,
  PayoutSchema,
} from './data/schemas';
import reelDataRaw from '../data/reels/hiragana_food.json';
import yakuDataRaw from '../data/yaku/hiragana_food.json';
import payoutDataRaw from '../data/payouts/default.json';
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
  const yakuList = YakuListSchema.parse(yakuDataRaw);
  const payout = PayoutSchema.parse(payoutDataRaw);

  const judge = new YakuJudge(yakuList);
  const calc = new PayoutCalc(payout);
  const wallet = new CoinWallet(payout.initialCoins);

  const engines: ReelEngine[] = [];
  const views: ReelView[] = [];

  const totalWidth = CELL_WIDTH * REEL_COUNT + REEL_GAP * (REEL_COUNT - 1);
  const startX = (app.screen.width - totalWidth) / 2;
  const reelY = (app.screen.height - CELL_HEIGHT * VISIBLE_CELLS) / 2;

  for (let i = 0; i < REEL_COUNT; i++) {
    const engine = new ReelEngine(reelConfig.reels[i]);
    const view = new ReelView(engine);
    view.container.x = startX + i * (CELL_WIDTH + REEL_GAP);
    view.container.y = reelY;
    app.stage.addChild(view.container);
    engines.push(engine);
    views.push(view);
  }

  app.ticker.add(() => {
    const now = performance.now();
    for (const engine of engines) engine.tick(now);
    for (const view of views) view.update();
  });

  // === UI 配線 ===

  const coinEl = document.getElementById('coin-display')!;
  const betEl = document.getElementById('bet-display')!;
  const leverBtn = document.getElementById('lever-btn') as HTMLButtonElement;
  const betBtn = document.getElementById('bet-btn') as HTMLButtonElement;
  const stopBtns = Array.from(
    document.querySelectorAll<HTMLButtonElement>('.stop-btn'),
  );
  const resultEl = document.getElementById('result-display')!;

  betEl.textContent = `Bet: ${calc.bet}`;
  let betPlaced = false;
  let resultTimer: number | null = null;

  const updateCoin = (n: number) => {
    coinEl.textContent = `Coin: ${n}`;
  };
  updateCoin(wallet.coins.get());
  wallet.coins.subscribe(updateCoin);

  const updateButtons = () => {
    const allStopped = engines.every((e) => e.state.get() === 'stopped');
    const allIdle = engines.every((e) => e.state.get() === 'idle');
    const anySpinning = engines.some((e) => e.state.get() === 'spinning');

    betBtn.disabled = anySpinning || !wallet.canBet(calc.bet) || betPlaced;
    leverBtn.disabled = !betPlaced || anySpinning || allStopped;
    stopBtns.forEach((btn, i) => {
      btn.disabled = engines[i].state.get() !== 'spinning';
    });

    if (allIdle && !betPlaced) {
      // Awaiting bet
    }
  };

  const showResult = (text: string, cls: 'win' | 'premium' | 'none') => {
    if (resultTimer !== null) {
      window.clearTimeout(resultTimer);
      resultTimer = null;
    }
    resultEl.textContent = text;
    resultEl.className = '';
    resultEl.classList.add('visible');
    if (cls !== 'none') resultEl.classList.add(cls);
    resultTimer = window.setTimeout(() => {
      resultEl.classList.remove('visible');
    }, 2500);
  };

  const resetForNextSpin = () => {
    betPlaced = false;
    for (const engine of engines) engine.reset();
    updateButtons();
  };

  betBtn.addEventListener('click', () => {
    if (!wallet.bet(calc.bet)) return;
    betPlaced = true;
    resultEl.classList.remove('visible');
    updateButtons();
  });

  leverBtn.addEventListener('click', () => {
    if (!betPlaced) return;
    for (const engine of engines) engine.spin();
    updateButtons();
  });

  for (const engine of engines) {
    engine.state.subscribe(() => updateButtons());
  }

  stopBtns.forEach((btn) => {
    const idx = Number(btn.dataset.reel ?? -1);
    if (idx < 0 || idx >= REEL_COUNT) return;
    btn.addEventListener('pointerdown', (ev) => {
      const engine = engines[idx];
      if (engine.state.get() !== 'spinning') return;
      engine.stop(ev.timeStamp);

      if (engines.every((e) => e.state.get() === 'stopped')) {
        const symbols = engines.map((e) => {
          const total = e.strip.cells.length;
          const ci = ((Math.round(e.position) % total) + total) % total;
          return e.strip.cells[ci];
        }) as [string, string, string];

        const result = judge.judge(symbols);
        const win = calc.calc(result.yaku);
        if (win > 0) wallet.win(win);

        if (result.yaku) {
          const cls = result.yaku.category === 'premium' ? 'premium' : 'win';
          showResult(`${result.yaku.name}！ +${win}`, cls);
          console.log('[result]', result.yaku.name, `+${win}`);
        } else {
          showResult(`はずれ (${symbols.join('')})`, 'none');
          console.log('[result] miss', symbols.join(''));
        }

        // 次のスピンに進める準備
        window.setTimeout(resetForNextSpin, 1200);
      }
    });
  });

  updateButtons();
}

bootstrap().catch((err) => {
  console.error('bootstrap failed:', err);
});
