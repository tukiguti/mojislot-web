import { Application, Graphics } from 'pixi.js';
import { ReelEngine } from './core/ReelEngine';
import { ReelView, CELL_WIDTH, CELL_HEIGHT, VISIBLE_CELLS } from './render/ReelView';
import { YakuJudge } from './core/YakuJudge';
import { PayoutCalc } from './core/PayoutCalc';
import { CoinWallet } from './core/CoinWallet';
import {
  EffectScheduler,
  REEL_SPEED_BY_EFFECT,
  DEFAULT_RATES,
  type EffectType,
} from './productions/EffectScheduler';
import { BonusZone } from './productions/BonusZone';
import { JinState } from './productions/JinState';
import { JinView } from './render/JinView';
import { EffectVisual } from './render/EffectVisual';
import { QuizState, QUIZ_BONUS_SPEED } from './productions/QuizState';
import { QuizOverlay } from './ui/QuizOverlay';
import { QuizQuestionView } from './render/QuizQuestionView';
import { ZukanState } from './productions/ZukanState';
import { ZukanOverlay } from './ui/ZukanOverlay';
import {
  SlipResolver,
  SLIP_NONE,
  SLIP_SHISA,
  SLIP_QUIZ_CORRECT,
  type SlipPolicy,
} from './productions/SlipResolver';
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

function requireEl<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(
      `#${id} not found. ブラウザを強制リロード（Cmd+Shift+R）してみてください。`,
    );
  }
  return el as T;
}

async function bootstrap() {
  const canvas = requireEl<HTMLCanvasElement>('game');

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
  const slipResolver = new SlipResolver(yakuList);
  const bonusZone = new BonusZone();
  // 現在の滑り方針。BET時に確定し、レバー時点ではすでに固まっている
  let currentSlipPolicy: SlipPolicy = SLIP_NONE;

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

  // クイズ中はジンを隠して、ここにクイズ文章を大きく出す
  const quizQuestionView = new QuizQuestionView(quizState, {
    width: CANVAS_W,
    height: LIQUID_AREA_H,
  });
  quizQuestionView.container.x = CANVAS_W / 2;
  quizQuestionView.container.y = LIQUID_AREA_H / 2;
  app.stage.addChild(quizQuestionView.container);

  // クイズ表示中はマスコットを隠す
  quizState.phase.subscribe((phase) => {
    jinView.container.visible = phase === 'inactive';
  });

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

  const coinEl = requireEl('coin-display');
  const betTextEl = requireEl('bet-text');
  const leverBtn = requireEl<HTMLButtonElement>('lever-btn');
  const betBtn = requireEl<HTMLButtonElement>('bet-btn');
  const stopBtns = Array.from(
    document.querySelectorAll<HTMLButtonElement>('.stop-btn'),
  );
  const resultEl = requireEl('result-display');
  const zukanBtn = requireEl<HTMLButtonElement>('zukan-btn');
  const bitaBadges = [
    requireEl('bita-0'),
    requireEl('bita-1'),
    requireEl('bita-2'),
  ];
  const bitaTimers: (number | null)[] = [null, null, null];
  const bonusStatusEl = requireEl('bonus-status');
  const cabinetEl = requireEl('cabinet');

  betTextEl.textContent = `Bet: ${calc.bet}`;
  const effectStatusEl = requireEl('effect-status');
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
      currentSlipPolicy = SLIP_SHISA;
    } else if (effect === 'quiz') {
      effectStatusEl.textContent = 'クイズ補助';
      effectStatusEl.classList.add('quiz');
      jinState.set('quiz');
      quizState.start(pickRandomQuiz());
      // クイズは正解判定後に SLIP_QUIZ_CORRECT に上書きされる
      currentSlipPolicy = SLIP_NONE;
    } else {
      effectStatusEl.textContent = '通常';
      jinState.set('idle');
      currentSlipPolicy = SLIP_NONE;
    }
  };
  applyEffect('none');

  const updateCoin = (n: number) => {
    coinEl.textContent = `Coin: ${n}`;
  };
  updateCoin(wallet.coins.get());
  wallet.coins.subscribe(updateCoin);

  const updateBonusUI = () => {
    const active = bonusZone.active.get();
    const remaining = bonusZone.remaining.get();
    if (active) {
      bonusStatusEl.hidden = false;
      bonusStatusEl.textContent = `BONUS 残り${remaining}`;
      cabinetEl.classList.add('bonus');
    } else {
      bonusStatusEl.hidden = true;
      bonusStatusEl.textContent = '';
      cabinetEl.classList.remove('bonus');
    }
  };
  bonusZone.active.subscribe(updateBonusUI);
  bonusZone.remaining.subscribe(updateBonusUI);
  updateBonusUI();

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
    clearAllBitaBadges();
    applyEffect('none');
    updateButtons();
  };

  const flashButton = (btn: HTMLButtonElement) => {
    btn.classList.add('flash');
    window.setTimeout(() => btn.classList.remove('flash'), 100);
  };

  // ビタ押し判定の閾値（ms）
  const BITA_MS = 33;
  const NEAR_MS = 80;

  const showBitaBadge = (idx: number, errorMs: number) => {
    const badge = bitaBadges[idx];
    badge.className = 'bita-badge show';
    if (errorMs <= BITA_MS) {
      badge.classList.add('bita');
      badge.textContent = `ビタ！ ${Math.round(errorMs)}ms`;
    } else if (errorMs <= NEAR_MS) {
      badge.classList.add('near');
      badge.textContent = `±${Math.round(errorMs)}ms`;
    } else {
      badge.classList.add('far');
      badge.textContent = `±${Math.round(errorMs)}ms`;
    }
    if (bitaTimers[idx] !== null) window.clearTimeout(bitaTimers[idx]!);
    bitaTimers[idx] = window.setTimeout(() => {
      badge.className = 'bita-badge';
      badge.textContent = '';
      bitaTimers[idx] = null;
    }, 1500);
  };

  const clearAllBitaBadges = () => {
    bitaBadges.forEach((b, i) => {
      b.className = 'bita-badge';
      b.textContent = '';
      if (bitaTimers[i] !== null) {
        window.clearTimeout(bitaTimers[i]!);
        bitaTimers[i] = null;
      }
    });
  };

  const placeBet = () => {
    if (betBtn.disabled) return;
    if (!wallet.bet(calc.bet)) return;
    betPlaced = true;
    resultEl.classList.remove('visible');
    flashButton(betBtn);
    // ボーナス中は演出レートを上昇＆残り回数を1消費
    if (bonusZone.isActive()) {
      scheduler.setRates(bonusZone.config.bonusEffectRates);
      bonusZone.consumeSpin();
    } else {
      scheduler.setRates(DEFAULT_RATES);
    }
    applyEffect(scheduler.roll());
    updateButtons();
  };

  const pullLever = () => {
    if (leverBtn.disabled) return;
    if (!betPlaced) return;
    // 未回答クイズはタイムアウト扱い → 正解時のみ追加減速＆強い引き込み
    quizState.finalizeIfUnanswered();
    if (quizState.isCorrect()) {
      for (const engine of engines) engine.setSpeed(QUIZ_BONUS_SPEED);
      currentSlipPolicy = SLIP_QUIZ_CORRECT;
    }
    // レバー押下でクイズUIは確実に閉じる（リールが見えるように）
    quizOverlay.dismiss();
    for (const engine of engines) engine.spin();
    flashButton(leverBtn);
    updateButtons();
  };

  const stopReel = (idx: number, timestamp: number) => {
    if (idx < 0 || idx >= REEL_COUNT) return;
    const engine = engines[idx];
    if (engine.state.get() !== 'spinning') return;

    // 滑り（引き込み）を解決
    const total = engine.strip.cells.length;
    const basePos = (((Math.round(engine.position) % total) + total) % total);
    const stoppedSymbols = engines.map((e) => {
      if (e.state.get() !== 'stopped') return null;
      const t = e.strip.cells.length;
      const ci = ((Math.round(e.position) % t) + t) % t;
      return e.strip.cells[ci];
    });
    const slipCells = slipResolver.resolve({
      reelIndex: idx,
      basePosition: basePos,
      strip: engine.strip,
      stoppedSymbols,
      policy: currentSlipPolicy,
    });

    const result = engine.stop(timestamp, slipCells);
    showBitaBadge(idx, result.errorMs);
    if (result.errorMs <= BITA_MS) zukanState.recordBita();
    flashButton(stopBtns[idx]);

    if (engines.every((e) => e.state.get() === 'stopped')) {
      const symbols = engines.map((e) => {
        const total = e.strip.cells.length;
        const ci = ((Math.round(e.position) % total) + total) % total;
        return e.strip.cells[ci];
      }) as [string, string, string];

      const result = judge.judge(symbols);
      const win = calc.calc(result.yaku, bonusZone.isActive());
      if (win > 0) wallet.win(win);

      if (result.yaku) {
        const cls = result.yaku.category === 'premium' ? 'premium' : 'win';
        const bonusTag = bonusZone.isActive() ? ' ×BONUS' : '';
        showResult(`${result.yaku.name}！ +${win}${bonusTag}`, cls);
        jinState.set('cheer');
        zukanState.record(result.yaku.id);
        // プレミアム成立でボーナス突入（active 中なら残り回数リセット＝おかわり）
        if (result.yaku.category === 'premium') {
          bonusZone.trigger();
        }
        console.log('[result]', result.yaku.name, `+${win}${bonusTag}`);
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
