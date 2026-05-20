import { Application, Graphics } from 'pixi.js';
import { ReelEngine } from './core/ReelEngine';
import { ReelView, CELL_WIDTH, CELL_HEIGHT, VISIBLE_CELLS } from './render/ReelView';
import { YakuJudge } from './core/YakuJudge';
import { PayoutCalc } from './core/PayoutCalc';
import { CoinWallet } from './core/CoinWallet';
import {
  EffectScheduler,
  REEL_SPEED_BY_EFFECT,
  type EffectType,
} from './productions/EffectScheduler';
import { JinState } from './productions/JinState';
import { JinView } from './render/JinView';
import { EffectVisual } from './render/EffectVisual';
import { QuizState, QUIZ_BONUS_SPEED } from './productions/QuizState';
import { QuizOverlay } from './ui/QuizOverlay';
import { ZukanState } from './productions/ZukanState';
import { ZukanOverlay } from './ui/ZukanOverlay';
import {
  ReelConfigSchema,
  YakuListSchema,
  PayoutSchema,
  QuizListSchema,
} from './data/schemas';
import reelDataRaw from '../data/reels/hiragana_food.json';
import yakuDataRaw from '../data/yaku/hiragana_food.json';
import payoutDataRaw from '../data/payouts/default.json';
import quizDataRaw from '../data/quizzes/hiragana_food.json';
import './style.css';

const REEL_GAP = 16;
const REEL_COUNT = 3;
const CANVAS_W = 600;
const CANVAS_H = 600;
const LIQUID_AREA_H = 320;

async function bootstrap() {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  if (!canvas) throw new Error('#game canvas not found');

  const app = new Application();
  await app.init({
    canvas,
    width: CANVAS_W,
    height: CANVAS_H,
    backgroundColor: 0x080808,
    antialias: true,
    resolution: window.devicePixelRatio || 1,
    autoDensity: true,
    preference: 'webgl',
  });

  const reelConfig = ReelConfigSchema.parse(reelDataRaw);
  const yakuList = YakuListSchema.parse(yakuDataRaw);
  const payout = PayoutSchema.parse(payoutDataRaw);
  const quizList = QuizListSchema.parse(quizDataRaw);

  const judge = new YakuJudge(yakuList);
  const calc = new PayoutCalc(payout);
  const wallet = new CoinWallet(payout.initialCoins);
  const scheduler = new EffectScheduler();
  const jinState = new JinState();
  const quizState = new QuizState();
  const quizOverlay = new QuizOverlay(quizState);
  const zukanState = new ZukanState(yakuList);
  const zukanOverlay = new ZukanOverlay(zukanState, yakuList);

  // 液晶エリアの土台（演出はあとで重ねる）
  const liquidBg = new Graphics();
  liquidBg.rect(0, 0, CANVAS_W, LIQUID_AREA_H);
  liquidBg.fill({ color: 0x101820 });
  app.stage.addChild(liquidBg);

  // 演出ビジュアル（液晶＋リール背景の色味、フラッシュ）
  const effectVisual = new EffectVisual({
    width: CANVAS_W,
    liquidHeight: LIQUID_AREA_H,
    totalHeight: CANVAS_H,
  });
  app.stage.addChild(effectVisual.bgLayer);

  // 液晶下端をうっすら明るく（ジンの足元に光を当てたような感じ）
  const liquidFloor = new Graphics();
  liquidFloor.ellipse(CANVAS_W / 2, LIQUID_AREA_H - 8, 180, 24);
  liquidFloor.fill({ color: 0xffd700, alpha: 0.08 });
  app.stage.addChild(liquidFloor);

  // ジン（マスコット）配置
  const jinView = new JinView(jinState);
  jinView.container.x = CANVAS_W / 2;
  jinView.container.y = LIQUID_AREA_H / 2 + 20;
  app.stage.addChild(jinView.container);

  // リールエリアの背景帯
  const reelBg = new Graphics();
  reelBg.rect(0, LIQUID_AREA_H, CANVAS_W, CANVAS_H - LIQUID_AREA_H);
  reelBg.fill({ color: 0x000000 });
  app.stage.addChild(reelBg);

  const engines: ReelEngine[] = [];
  const views: ReelView[] = [];

  const totalWidth = CELL_WIDTH * REEL_COUNT + REEL_GAP * (REEL_COUNT - 1);
  const startX = (app.screen.width - totalWidth) / 2;
  const reelY = LIQUID_AREA_H + (CANVAS_H - LIQUID_AREA_H - CELL_HEIGHT * VISIBLE_CELLS) / 2;

  for (let i = 0; i < REEL_COUNT; i++) {
    const engine = new ReelEngine(reelConfig.reels[i]);
    const view = new ReelView(engine);
    view.container.x = startX + i * (CELL_WIDTH + REEL_GAP);
    view.container.y = reelY;
    app.stage.addChild(view.container);
    engines.push(engine);
    views.push(view);
  }

  // フラッシュなどの前景エフェクトはリールの上に重ねる
  app.stage.addChild(effectVisual.fxLayer);

  app.ticker.add(() => {
    const now = performance.now();
    for (const engine of engines) engine.tick(now);
    for (const view of views) view.update();
    jinView.update(now);
    effectVisual.update();
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
  const effectStatusEl = document.getElementById('effect-status')!;
  let betPlaced = false;
  let resultTimer: number | null = null;

  const pickRandomQuiz = () =>
    quizList.quizzes[Math.floor(Math.random() * quizList.quizzes.length)];

  const applyEffect = (effect: EffectType) => {
    const speed = REEL_SPEED_BY_EFFECT[effect];
    for (const engine of engines) engine.setSpeed(speed);
    effectVisual.apply(effect);

    effectStatusEl.classList.remove('shisa', 'quiz');
    if (effect === 'shisa') {
      effectStatusEl.textContent = '示唆';
      effectStatusEl.classList.add('shisa');
      jinState.set('shisa');
    } else if (effect === 'quiz') {
      effectStatusEl.textContent = 'クイズ補助';
      effectStatusEl.classList.add('quiz');
      jinState.set('quiz');
      quizState.start(pickRandomQuiz());
    } else {
      effectStatusEl.textContent = '通常';
      jinState.set('idle');
    }
  };
  applyEffect('none');

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
    quizState.reset();
    applyEffect('none');
    updateButtons();
  };

  const flashButton = (btn: HTMLButtonElement) => {
    btn.classList.add('flash');
    window.setTimeout(() => btn.classList.remove('flash'), 100);
  };

  const placeBet = () => {
    if (betBtn.disabled) return;
    if (!wallet.bet(calc.bet)) return;
    betPlaced = true;
    resultEl.classList.remove('visible');
    flashButton(betBtn);
    // ベット時に演出抽選 → リール速度に反映
    applyEffect(scheduler.roll());
    updateButtons();
  };

  const pullLever = () => {
    if (leverBtn.disabled) return;
    if (!betPlaced) return;
    // 未回答クイズはタイムアウト扱い → 正解時のみ追加減速を適用
    quizState.finalizeIfUnanswered();
    if (quizState.isCorrect()) {
      for (const engine of engines) engine.setSpeed(QUIZ_BONUS_SPEED);
    }
    for (const engine of engines) engine.spin();
    flashButton(leverBtn);
    updateButtons();
  };

  const stopReel = (idx: number, timestamp: number) => {
    if (idx < 0 || idx >= REEL_COUNT) return;
    const engine = engines[idx];
    if (engine.state.get() !== 'spinning') return;
    engine.stop(timestamp);
    flashButton(stopBtns[idx]);

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
        jinState.set('cheer');
        zukanState.record(result.yaku.id);
        console.log('[result]', result.yaku.name, `+${win}`);
      } else {
        showResult(`はずれ (${symbols.join('')})`, 'none');
        jinState.set('miss');
        console.log('[result] miss', symbols.join(''));
      }

      window.setTimeout(resetForNextSpin, 1200);
    }
  };

  betBtn.addEventListener('click', placeBet);
  leverBtn.addEventListener('click', pullLever);
  stopBtns.forEach((btn) => {
    const idx = Number(btn.dataset.reel ?? -1);
    btn.addEventListener('pointerdown', (ev) => stopReel(idx, ev.timeStamp));
  });

  const zukanBtn = document.getElementById('zukan-btn') as HTMLButtonElement;
  zukanBtn.addEventListener('click', () => zukanOverlay.toggle());

  for (const engine of engines) {
    engine.state.subscribe(() => updateButtons());
  }

  // === キーボードショートカット ===
  // B = BET, Space = LEVER, A/S/D = STOP 左/中/右
  const KEY_TO_REEL: Record<string, number> = {
    a: 0,
    s: 1,
    d: 2,
  };

  window.addEventListener('keydown', (ev) => {
    if (ev.repeat) return;
    if (
      ev.target instanceof HTMLInputElement ||
      ev.target instanceof HTMLTextAreaElement
    ) {
      return;
    }
    const key = ev.key.toLowerCase();

    // クイズ表示中は 1〜4 で回答（他キーは食わない）
    if (quizOverlay.handleKey(key)) {
      ev.preventDefault();
      return;
    }

    if (key === 'b') {
      ev.preventDefault();
      placeBet();
      return;
    }
    if (key === ' ' || ev.code === 'Space') {
      ev.preventDefault();
      pullLever();
      return;
    }
    if (key in KEY_TO_REEL) {
      ev.preventDefault();
      stopReel(KEY_TO_REEL[key], ev.timeStamp);
      return;
    }
    if (key === 'z') {
      ev.preventDefault();
      zukanOverlay.toggle();
      return;
    }
  });

  updateButtons();
}

bootstrap().catch((err) => {
  console.error('bootstrap failed:', err);
});
