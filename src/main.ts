import { Application, Graphics } from 'pixi.js';
import { ReelEngine } from './core/ReelEngine';
import { ReelView, CELL_WIDTH, CELL_HEIGHT, VISIBLE_CELLS } from './render/ReelView';
import { symbolColorCss } from './render/SymbolStyle';
import { YakuJudge } from './core/YakuJudge';
import { PayoutCalc, streakMultiplier } from './core/PayoutCalc';
import { CoinWallet } from './core/CoinWallet';
import {
  EffectScheduler,
  REEL_SPEED_BY_EFFECT,
  DEFAULT_RATES,
  RESCUE_RATES,
  RESCUE_MISS_THRESHOLD,
  type EffectType,
} from './productions/EffectScheduler';
import { BonusZone } from './productions/BonusZone';
import { SfxEngine } from './audio/SfxEngine';
import { TenpaiDetector } from './productions/TenpaiDetector';
import { PlayStats } from './productions/PlayStats';
import { NearMissDetector } from './productions/NearMissDetector';
import { flashScreen, spawnConfetti, shakeBody, showPremiumCutin } from './ui/Effects';
import { JinSpeech } from './ui/JinSpeech';
import { ChallengeTracker } from './productions/Challenges';
import { showMissionToast } from './ui/MissionToast';
import { SettingsOverlay } from './ui/SettingsOverlay';
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
import payoutDataRaw from '../data/payouts/default.json';
import { getCurrentChapter, getCurrentChapterId } from './data/chapters';
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

  const chapter = getCurrentChapter();
  const chapterId = getCurrentChapterId();
  const reelConfig = ReelConfigSchema.parse(chapter.reelData);
  const yakuList = YakuListSchema.parse(chapter.yakuData);
  const payout = PayoutSchema.parse(payoutDataRaw);
  const quizList = QuizListSchema.parse(chapter.quizData);

  const judge = new YakuJudge(yakuList);
  const calc = new PayoutCalc(payout);
  const wallet = new CoinWallet(payout.initialCoins);
  const scheduler = new EffectScheduler();
  const jinState = new JinState();
  const quizState = new QuizState();
  const quizOverlay = new QuizOverlay(quizState);
  const slipResolver = new SlipResolver(yakuList);
  const bonusZone = new BonusZone();
  const sfx = new SfxEngine();
  const tenpaiDetector = new TenpaiDetector(yakuList);
  const nearMissDetector = new NearMissDetector(yakuList);
  const playStats = new PlayStats();
  const zukanState = new ZukanState(yakuList, chapterId);
  const challengeTracker = new ChallengeTracker();
  const zukanOverlay = new ZukanOverlay(
    zukanState,
    yakuList,
    playStats,
    challengeTracker,
  );
  const settingsOverlay = new SettingsOverlay(
    chapterId,
    wallet,
    payout.initialCoins,
    playStats,
    zukanState,
    challengeTracker,
  );
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
    for (const view of views) view.update(now);
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
  const muteBtn = requireEl<HTMLButtonElement>('mute-btn');
  const autoBtn = requireEl<HTMLButtonElement>('auto-btn');
  const settingsBtn = requireEl<HTMLButtonElement>('settings-btn');
  const streakStatusEl = requireEl('streak-status');
  const rescueStatusEl = requireEl('rescue-status');
  const bonusBannerEl = requireEl('bonus-banner');
  const jinSpeech = new JinSpeech(requireEl('game-area'));

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
      sfx.shisa();
      jinSpeech.say('shisa');
    } else if (effect === 'quiz') {
      effectStatusEl.textContent = 'クイズ補助';
      effectStatusEl.classList.add('quiz');
      jinState.set('quiz');
      quizState.start(pickRandomQuiz(), yakuList);
      // クイズは正解判定後に SLIP_QUIZ_CORRECT に上書きされる
      currentSlipPolicy = SLIP_NONE;
      sfx.quiz();
      // クイズ文章を液晶に出すのでセリフは控えめ
    } else {
      effectStatusEl.textContent = '通常';
      jinState.set('idle');
      currentSlipPolicy = SLIP_NONE;
    }
  };
  applyEffect('none');

  // コイン残量に応じてヘッダー色を警告状態に
  const updateCoinWarning = (n: number) => {
    coinEl.classList.remove('warning', 'critical');
    if (n <= 15) coinEl.classList.add('critical');
    else if (n <= 50) coinEl.classList.add('warning');
  };

  // コイン表示をなめらかにカウントアップ
  let displayedCoin = wallet.coins.get();
  let coinAnimRaf: number | null = null;
  const animateCoinTo = (target: number) => {
    updateCoinWarning(target);
    if (coinAnimRaf !== null) cancelAnimationFrame(coinAnimRaf);
    const start = displayedCoin;
    const diff = target - start;
    if (diff === 0) {
      coinEl.textContent = `Coin: ${target}`;
      return;
    }
    const durMs = Math.min(900, 200 + Math.abs(diff) * 8);
    const startTime = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - startTime) / durMs);
      const eased = 1 - Math.pow(1 - t, 3);
      displayedCoin = Math.round(start + diff * eased);
      coinEl.textContent = `Coin: ${displayedCoin}`;
      if (t < 1) {
        coinAnimRaf = requestAnimationFrame(step);
      } else {
        displayedCoin = target;
        coinAnimRaf = null;
      }
    };
    coinAnimRaf = requestAnimationFrame(step);
  };
  coinEl.textContent = `Coin: ${displayedCoin}`;
  updateCoinWarning(displayedCoin);
  wallet.coins.subscribe(animateCoinTo);

  // 役成立時の +N フロート
  const showCoinFloat = (amount: number, premium: boolean) => {
    const el = document.createElement('div');
    el.className = 'coin-float' + (premium ? ' premium' : '');
    el.textContent = `+${amount}`;
    document.body.appendChild(el);
    const rect = coinEl.getBoundingClientRect();
    el.style.left = `${rect.left + rect.width + 6}px`;
    el.style.top = `${rect.top}px`;
    requestAnimationFrame(() => el.classList.add('rise'));
    window.setTimeout(() => el.remove(), 1400);
  };

  /** 大配当時：🪙 を画面下に向かって複数飛ばす（カジノっぽい演出） */
  const showCoinBurst = (count: number) => {
    const startRect = cabinetEl.getBoundingClientRect();
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
  };

  // 章名をヘッダー（演出ステータス上）に出すため、effectStatus の title に
  // 章説明を入れておく（ホバーで確認）
  effectStatusEl.title = `${chapter.name}：${chapter.description}`;

  // 連チャン表示（倍率も併記）＋ cabinet の連チャンオーラ
  const updateStreakUI = (streak: number) => {
    if (streak >= 2) {
      const mult = streakMultiplier(streak);
      const multTag = mult > 1 ? ` ×${mult}` : '';
      streakStatusEl.hidden = false;
      streakStatusEl.textContent = `${streak} 連${multTag}`;
    } else {
      streakStatusEl.hidden = true;
      streakStatusEl.textContent = '';
    }
    cabinetEl.classList.remove(
      'streak-aura',
      'streak-aura-hot',
      'streak-aura-fever',
    );
    if (streak >= 10) cabinetEl.classList.add('streak-aura', 'streak-aura-fever');
    else if (streak >= 5) cabinetEl.classList.add('streak-aura', 'streak-aura-hot');
    else if (streak >= 3) cabinetEl.classList.add('streak-aura');
  };
  playStats.stats.subscribe((s) => updateStreakUI(s.streak));
  updateStreakUI(playStats.stats.get().streak);

  // ハマり救済バッジ
  const updateRescueUI = (missStreak: number) => {
    if (missStreak >= RESCUE_MISS_THRESHOLD) {
      rescueStatusEl.hidden = false;
      rescueStatusEl.textContent = `救済 +${missStreak - RESCUE_MISS_THRESHOLD}`;
    } else {
      rescueStatusEl.hidden = true;
      rescueStatusEl.textContent = '';
    }
  };
  playStats.stats.subscribe((s) => updateRescueUI(s.missStreak));
  updateRescueUI(playStats.stats.get().missStreak);

  // BONUS! バナー
  const showBonusBanner = () => {
    bonusBannerEl.innerHTML = '<div class="bonus-banner-text">BONUS!</div>';
    bonusBannerEl.hidden = false;
    window.setTimeout(() => {
      bonusBannerEl.hidden = true;
      bonusBannerEl.innerHTML = '';
    }, 1700);
  };

  // === デバッグアクション（設定モーダルから呼ばれる） ===
  settingsOverlay.setDebugActions({
    triggerBonus: () => {
      bonusZone.trigger();
      sfx.bonusEnter();
      // デバッグ：プレミアム役が無くても代表的な役名でカットインを試せる
      const premium = yakuList.premiumYaku[0];
      if (premium) {
        showPremiumCutin(premium.name, premium.symbols);
      }
      flashScreen({ color: '#ffd700', alpha: 0.85, durMs: 400 });
      spawnConfetti(100);
      shakeBody(600);
      window.setTimeout(() => {
        showBonusBanner();
        jinSpeech.say('premium');
      }, 1300);
    },
    triggerShisa: () => {
      // 強制的に shisa 演出を発動（リール速度＆ジン表情＆フラッシュ）
      applyEffect('shisa');
    },
    triggerQuiz: () => {
      // 強制クイズ：演出＋液晶に出題を出す
      applyEffect('quiz');
    },
    triggerWinTest: () => {
      // 役成立SE＋中央ハイライト＋コインフロート＋紙吹雪少々
      sfx.winCore();
      for (const v of views) v.highlightCenter(1400);
      showCoinFloat(24, false);
      showCoinBurst(5);
      jinSpeech.say('win');
    },
    triggerTenpaiSe: () => {
      sfx.tenpai();
      jinSpeech.say('tenpai');
      // どれか1リールに枠フラッシュ
      views[2].startTenpaiFlash(false);
      window.setTimeout(() => views[2].stopTenpaiFlash(), 2500);
    },
    addCoins: (n: number) => {
      wallet.win(n);
    },
    fillEffects: () => {
      flashScreen({ color: '#ffffff', alpha: 0.6, durMs: 280 });
      spawnConfetti(60);
      shakeBody(450);
    },
  });

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

  const showResult = (text: string, cls: 'win' | 'premium' | 'none' | 'near') => {
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
    for (const v of views) v.stopTenpaiFlash();
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
    sfx.init(); // user gesture でオーディオ起動
    if (!wallet.bet(calc.bet)) return;
    betPlaced = true;
    resultEl.classList.remove('visible');
    flashButton(betBtn);
    sfx.bet();
    // BET 時のセリフは時々（25%）
    if (Math.random() < 0.25) jinSpeech.say('bet');
    // ボーナス > 救済 > 通常 の優先順位で演出レートを決定
    if (bonusZone.isActive()) {
      scheduler.setRates(bonusZone.config.bonusEffectRates);
      bonusZone.consumeSpin();
    } else if (playStats.stats.get().missStreak >= RESCUE_MISS_THRESHOLD) {
      scheduler.setRates(RESCUE_RATES);
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
    // 正解/不正解SE は quizState.phase.subscribe で一括して鳴らす
    quizState.finalizeIfUnanswered();
    if (quizState.isCorrect()) {
      for (const engine of engines) engine.setSpeed(QUIZ_BONUS_SPEED);
      currentSlipPolicy = SLIP_QUIZ_CORRECT;
    }
    // レバー押下でクイズUIは確実に閉じる（リールが見えるように）
    quizOverlay.dismiss();
    for (const engine of engines) engine.spin();
    flashButton(leverBtn);
    sfx.lever();
    updateButtons();
  };

  // クイズの回答結果（クリック/キー）で SE＋統計＋セリフ
  quizState.phase.subscribe((phase) => {
    if (phase === 'correct') {
      sfx.quizCorrect();
      playStats.recordQuiz(true);
      jinSpeech.say('correct');
    } else if (phase === 'wrong') {
      sfx.quizWrong();
      playStats.recordQuiz(false);
      jinSpeech.say('wrong');
    }
  });

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
      // クイズ正解時はその役だけを引き込みターゲットに
      targetYakuId: quizState.targetYakuId(),
    });

    const result = engine.stop(timestamp, slipCells);
    showBitaBadge(idx, result.errorMs);
    if (result.errorMs <= BITA_MS) {
      zukanState.recordBita();
      sfx.bita();
    } else {
      sfx.stop();
    }
    views[idx].triggerStopBounce();
    flashButton(stopBtns[idx]);

    // 第2停止後：テンパイ検出 → 残ったリールを減速＆枠フラッシュ＆SE
    const stoppedNow = engines.map((e) => {
      if (e.state.get() !== 'stopped') return null;
      const t = e.strip.cells.length;
      const ci = ((Math.round(e.position) % t) + t) % t;
      return e.strip.cells[ci];
    });
    if (stoppedNow.filter((s) => s !== null).length === 2) {
      const tenpai = tenpaiDetector.detect(stoppedNow);
      if (tenpai) {
        const targetEngine = engines[tenpai.missingReelIndex];
        const slowed = Math.max(6, targetEngine.currentSpeed * 0.55);
        targetEngine.setSpeed(slowed);
        views[tenpai.missingReelIndex].startTenpaiFlash(tenpai.hasPremium);
        if (tenpai.hasPremium) sfx.tenpaiPremium();
        else sfx.tenpai();
        jinSpeech.say('tenpai');
      }
    }

    if (engines.every((e) => e.state.get() === 'stopped')) {
      const symbols = engines.map((e) => {
        const total = e.strip.cells.length;
        const ci = ((Math.round(e.position) % total) + total) % total;
        return e.strip.cells[ci];
      }) as [string, string, string];

      const result = judge.judge(symbols);
      const willHit = result.yaku !== null;
      const isPremium = result.yaku?.category === 'premium';
      // 成立後の連チャン数で配当倍率を評価（3連達成スピンから恩恵が乗る）
      const streakAfter = willHit ? playStats.stats.get().streak + 1 : 0;
      const streakMult = streakMultiplier(streakAfter);
      const win = calc.calc(result.yaku, bonusZone.isActive(), streakMult);
      if (win > 0) wallet.win(win);

      playStats.recordSpin({
        bet: calc.bet,
        win,
        hit: willHit,
        premium: isPremium,
        bonusTriggered: isPremium,
      });

      // チャレンジ達成チェック（少し遅延させて結果トーストと被らないように）
      window.setTimeout(() => {
        const newlyAchieved = challengeTracker.evaluate({
          stats: playStats.stats.get(),
          bitaCount: zukanState.bitaCount.get(),
          zukanCounts: zukanState.counts.get(),
          yakuList,
        });
        newlyAchieved.forEach((c, i) => {
          window.setTimeout(() => {
            wallet.win(c.reward);
            showMissionToast(c);
            sfx.bita(); // 短いキラーン音を流用
          }, i * 350);
        });
      }, 1500);

      if (result.yaku) {
        const cls = isPremium ? 'premium' : 'win';
        const bonusTag = bonusZone.isActive() ? ' ×BONUS' : '';
        const streakTag = streakMult > 1 ? ` ×${streakMult}連` : '';
        showResult(`${result.yaku.name}！ +${win}${bonusTag}${streakTag}`, cls);
        jinState.set('cheer');
        zukanState.record(result.yaku.id);
        // 全リール中央セルをハイライト
        for (const v of views) v.highlightCenter(1400);
        // コイン獲得 +N フロート表示
        if (win > 0) showCoinFloat(win, isPremium);
        // 大配当はコインバースト（プレミアム=多め）
        if (isPremium) showCoinBurst(28);
        else if (win >= 50) showCoinBurst(12);
        else if (win >= 24) showCoinBurst(5);
        // プレミアム成立でボーナス突入＋全画面演出（active 中なら残り回数リセット＝おかわり）
        if (isPremium) {
          bonusZone.trigger();
          sfx.bonusEnter();
          // カットイン：暗転＋役名ドン（1.5s）
          showPremiumCutin(result.yaku!.name, result.yaku!.symbols);
          flashScreen({ color: '#ffd700', alpha: 0.85, durMs: 400 });
          spawnConfetti(100);
          shakeBody(600);
          // BONUSバナー＆セリフはカットインの後ろに少し遅らせる
          window.setTimeout(() => {
            showBonusBanner();
            jinSpeech.say('premium');
          }, 1300);
        } else {
          sfx.winCore();
          jinSpeech.say('win');
        }
      } else {
        // ニアミス検出：±1コマで揃ったはずの役があれば「おしい！」表示
        const positions = engines.map((e) => {
          const t = e.strip.cells.length;
          return ((Math.round(e.position) % t) + t) % t;
        });
        const nearMisses = nearMissDetector.detect(
          symbols,
          engines.map((e) => e.strip),
          positions,
        );
        if (nearMisses.length > 0) {
          const first = nearMisses[0];
          showResult(
            `おしい！「${first.yaku.name}」まで${nearMisses.length > 1 ? `あと ${nearMisses.length}通り` : '1コマ'}`,
            'near',
          );
          jinSpeech.say('near');
        } else {
          showResult(`はずれ (${symbols.join('')})`, 'none');
          jinSpeech.say('miss');
        }
        jinState.set('miss');
        sfx.miss();
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

  // === オートスピン ===
  // 状態を見て BET → LEVER → STOP×3 を 350ms 間隔でループ。
  // クイズ表示中は強制的に1番（左端）を回答する（25%で正解、まあまあ揃う）。
  let autoMode = false;
  let autoTimer: number | null = null;

  const clearAutoTimer = () => {
    if (autoTimer !== null) {
      window.clearTimeout(autoTimer);
      autoTimer = null;
    }
  };

  const stepAuto = () => {
    if (!autoMode) return;
    if (!wallet.canBet(calc.bet) && !betPlaced) {
      // コイン不足で停止
      stopAuto();
      return;
    }

    const states = engines.map((e) => e.state.get());
    const anySpinning = states.includes('spinning');
    const allIdle = states.every((s) => s === 'idle');
    const allStopped = states.every((s) => s === 'stopped');

    if (!betPlaced && allIdle) {
      placeBet();
    } else if (betPlaced && allIdle) {
      // クイズ表示中なら適当な選択を入れる（簡易ロジック）
      if (quizState.phase.get() === 'asking') {
        const q = quizState.current.get();
        if (q) quizState.answer(Math.floor(Math.random() * 4));
      }
      pullLever();
    } else if (anySpinning) {
      const idx = states.findIndex((s) => s === 'spinning');
      if (idx !== -1) stopReel(idx, performance.now());
    } else if (allStopped) {
      // 判定後 resetForNextSpin が走るまで待つ
    }

    autoTimer = window.setTimeout(stepAuto, 350);
  };

  const startAuto = () => {
    autoMode = true;
    autoBtn.textContent = 'AUTO ON';
    autoBtn.classList.add('on');
    sfx.init();
    stepAuto();
  };

  const stopAuto = () => {
    autoMode = false;
    autoBtn.textContent = 'AUTO';
    autoBtn.classList.remove('on');
    clearAutoTimer();
  };

  autoBtn.addEventListener('click', () => {
    if (autoMode) stopAuto();
    else startAuto();
  });

  zukanBtn.addEventListener('click', () => zukanOverlay.toggle());
  settingsBtn.addEventListener('click', () => settingsOverlay.toggle());

  const updateMuteUI = () => {
    if (sfx.isMuted()) {
      muteBtn.textContent = '🔇';
      muteBtn.classList.add('muted');
    } else {
      muteBtn.textContent = '♪';
      muteBtn.classList.remove('muted');
    }
  };
  muteBtn.addEventListener('click', () => {
    sfx.init();
    sfx.toggleMute();
    updateMuteUI();
  });
  updateMuteUI();

  // === リール配列パネル（筐体右） ===
  const stripColumns = Array.from(
    document.querySelectorAll<HTMLElement>('#reel-strip-panel .strip-column'),
  );
  stripColumns.forEach((col, idx) => {
    const cellsEl = col.querySelector<HTMLElement>('.cells');
    if (!cellsEl) return;
    cellsEl.innerHTML = '';
    engines[idx].strip.cells.forEach((symbol) => {
      const cell = document.createElement('div');
      cell.className = 'strip-cell';
      cell.textContent = symbol;
      cell.style.color = symbolColorCss(symbol);
      cellsEl.appendChild(cell);
    });
  });

  const updateStripHighlight = () => {
    stripColumns.forEach((col, idx) => {
      const e = engines[idx];
      const isSpinning = e.state.get() === 'spinning';
      const total = e.strip.cells.length;
      const current = ((Math.round(e.position) % total) + total) % total;
      const cells = col.querySelectorAll<HTMLElement>('.strip-cell');
      cells.forEach((cell, ci) => {
        if (!isSpinning && ci === current) cell.classList.add('current');
        else cell.classList.remove('current');
      });
    });
  };

  // クイズ正解時、リール配列にターゲット文字を緑強調表示する
  const allYakusFlat = [
    ...yakuList.coreYaku,
    ...yakuList.premiumYaku,
    ...yakuList.bonusYaku,
  ];
  const updateStripTargetHighlight = () => {
    const targetYakuId = quizState.targetYakuId();
    const yaku = targetYakuId
      ? allYakusFlat.find((y) => y.id === targetYakuId)
      : null;
    stripColumns.forEach((col, idx) => {
      const targetSymbol = yaku?.symbols[idx] ?? null;
      const cells = col.querySelectorAll<HTMLElement>('.strip-cell');
      cells.forEach((cell) => {
        if (targetSymbol && cell.textContent === targetSymbol) {
          cell.classList.add('target');
        } else {
          cell.classList.remove('target');
        }
      });
    });
  };

  for (const engine of engines) {
    engine.state.subscribe(updateStripHighlight);
  }
  quizState.phase.subscribe(updateStripTargetHighlight);
  updateStripHighlight();
  updateStripTargetHighlight();

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
    if (key === 'm') {
      ev.preventDefault();
      sfx.init();
      sfx.toggleMute();
      updateMuteUI();
      return;
    }
    if (key === 'o') {
      ev.preventDefault();
      if (autoMode) stopAuto();
      else startAuto();
      return;
    }
    if (key === ',') {
      ev.preventDefault();
      settingsOverlay.toggle();
      return;
    }
  });

  updateButtons();
}

bootstrap().catch((err) => {
  console.error('bootstrap failed:', err);
});
