import { Application, Graphics } from 'pixi.js';
import { ReelEngine } from './core/ReelEngine';
import { ReelView, CELL_WIDTH, CELL_HEIGHT, VISIBLE_CELLS } from './render/ReelView';
import { SymbolColorResolver } from './render/SymbolStyle';
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
import {
  flashScreen,
  spawnConfetti,
  shakeBody,
  showPremiumCutin,
  showMultiHitBadge,
} from './ui/Effects';
import { JinSpeech } from './ui/JinSpeech';
import { ChallengeTracker } from './productions/Challenges';
import { showMissionToast } from './ui/MissionToast';
import { SettingsOverlay } from './ui/SettingsOverlay';
import { JinState } from './productions/JinState';
import { JinView } from './render/JinView';
import { EffectVisual } from './render/EffectVisual';
import { QuizState } from './productions/QuizState';
import { QuizOverlay } from './ui/QuizOverlay';
import { QuizQuestionView } from './render/QuizQuestionView';
import { ZukanState } from './productions/ZukanState';
import { ZukanOverlay } from './ui/ZukanOverlay';
import { SlipResolver, type VisibleColumn } from './productions/SlipResolver';
import { extractGrid, getVisibleCell, PAYLINES } from './core/Paylines';
import { PaylineIndicators } from './render/PaylineIndicators';
import {
  ReelConfigSchema,
  YakuListSchema,
  PayoutSchema,
  QuizListSchema,
} from './data/schemas';
import payoutDataRaw from '../data/payouts/default.json';
import {
  getCurrentChapter,
  getCurrentChapterId,
  isSecretUnlocked,
  setSecretUnlocked,
} from './data/chapters';
import './style.css';

const REEL_GAP = 16;
const REEL_COUNT = 3;
const CANVAS_W = 600;
const CANVAS_H = 600;
// 液晶エリア（マスコット領域）の高さ。
// CANVAS_H - LIQUID_AREA_H - (CELL_HEIGHT*VISIBLE_CELLS) = 上下余白の合計。
// 260 のとき、上下に20px ずつの余白でリールが収まる。
const LIQUID_AREA_H = 260;

/**
 * 複数ペイラインで揃った役の一覧を文字列要約。
 * 例: [みかん, みかん, すしや] → "みかん×2 ＋ すしや"
 */
function summarizeHits(
  hits: readonly { yaku: { name: string } }[],
): string {
  const counts = new Map<string, number>();
  for (const h of hits) {
    counts.set(h.yaku.name, (counts.get(h.yaku.name) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([name, n]) => (n > 1 ? `${name}×${n}` : name))
    .join(' ＋ ');
}

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
  // 役の id → 役オブジェクトの逆引き（AUTO のターゲット解決などで使う）
  const allYakusFlat = [
    ...yakuList.coreYaku,
    ...yakuList.premiumYaku,
    ...yakuList.bonusYaku,
  ];

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
  // 滑りは常に1モード（noise:50%確率で最大2コマ蹴り）。
  // 示唆/クイズ時の特別補助は廃止（演出のみ残す）。
  // 現在のスピンの effect 種別（AUTO がターゲット決定に使う）
  let currentEffect: EffectType = 'none';

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

  // 役単位のカラー解決：同じ役の3文字（左/中/右）が同じ色になる
  const colorResolver = new SymbolColorResolver(yakuList);

  for (let i = 0; i < REEL_COUNT; i++) {
    const engine = new ReelEngine(reelConfig.reels[i]);
    const reelIdx = i;
    const view = new ReelView(engine, (symbol) =>
      colorResolver.colorFor(reelIdx, symbol),
    );
    view.container.x = startX + i * (CELL_WIDTH + REEL_GAP);
    view.container.y = reelY;
    app.stage.addChild(view.container);
    engines.push(engine);
    views.push(view);
  }

  // ペイラインインジケーター（リール両脇外側に配置・ジャグラー風）
  const reelHeight = CELL_HEIGHT * VISIBLE_CELLS;
  const indicatorOffsetY = reelY + (reelHeight - PaylineIndicators.TOTAL_HEIGHT) / 2;
  const indicatorPadX = 12;

  const leftIndicators = new PaylineIndicators();
  leftIndicators.container.x = startX - PaylineIndicators.WIDTH - indicatorPadX;
  leftIndicators.container.y = indicatorOffsetY;
  app.stage.addChild(leftIndicators.container);

  const rightIndicators = new PaylineIndicators();
  rightIndicators.container.x = startX + totalWidth + indicatorPadX;
  rightIndicators.container.y = indicatorOffsetY;
  app.stage.addChild(rightIndicators.container);

  // フラッシュなどの前景エフェクトはリールの上に重ねる
  app.stage.addChild(effectVisual.fxLayer);

  app.ticker.add(() => {
    const now = performance.now();
    for (const engine of engines) engine.tick(now);
    for (const view of views) view.update(now);
    leftIndicators.update(now);
    rightIndicators.update(now);
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
    currentEffect = effect;
    const speed = REEL_SPEED_BY_EFFECT[effect];
    for (const engine of engines) engine.setSpeed(speed);
    effectVisual.apply(effect);

    effectStatusEl.classList.remove('shisa', 'quiz');
    if (effect === 'shisa') {
      effectStatusEl.textContent = '示唆';
      effectStatusEl.classList.add('shisa');
      jinState.set('shisa');
      sfx.shisa();
      jinSpeech.say('shisa');
    } else if (effect === 'quiz') {
      effectStatusEl.textContent = 'クイズ';
      effectStatusEl.classList.add('quiz');
      jinState.set('quiz');
      quizState.start(pickRandomQuiz(), yakuList);
      sfx.quiz();
    } else {
      effectStatusEl.textContent = '通常';
      jinState.set('idle');
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

  // === 隠し章解除：Coin 表示を 20 回クリックで unlock ===
  let secretClickCount = 0;
  let secretClickTimer: number | null = null;
  coinEl.style.cursor = 'pointer';
  coinEl.addEventListener('click', () => {
    if (isSecretUnlocked()) return;
    secretClickCount++;
    if (secretClickTimer !== null) window.clearTimeout(secretClickTimer);
    // 3秒押下されないとカウンタリセット
    secretClickTimer = window.setTimeout(() => {
      secretClickCount = 0;
    }, 3000);

    // 10/15回で揺れヒント、20回で解除
    if (secretClickCount === 10) {
      coinEl.style.transform = 'scale(1.05)';
      window.setTimeout(() => (coinEl.style.transform = ''), 150);
    } else if (secretClickCount === 15) {
      coinEl.style.transform = 'scale(1.1) rotate(-2deg)';
      window.setTimeout(() => (coinEl.style.transform = ''), 200);
    } else if (secretClickCount >= 20) {
      secretClickCount = 0;
      setSecretUnlocked(true);
      sfx.bonusEnter();
      showSecretToast('🔓 隠し章「オトナの章」が解除されました！\n設定（⚙）から選択できます');
    }
  });

  function showSecretToast(text: string): void {
    const el = document.createElement('div');
    el.className = 'secret-toast';
    el.textContent = text;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    window.setTimeout(() => el.classList.remove('show'), 3500);
    window.setTimeout(() => el.remove(), 4000);
  }

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
    // AUTO の狙い状態もクリア
    autoTargetYaku = null;
    aimPending.clear();
    // 押下精度の記録もクリア
    lastPressErrorMs.fill(Infinity);
    lastSlipCells.fill(0);
    updateButtons();
  };

  const flashButton = (btn: HTMLButtonElement) => {
    btn.classList.add('flash');
    window.setTimeout(() => btn.classList.remove('flash'), 100);
  };

  // ビタ押し判定の閾値（ms）— 1コマ50ms（速度20）の1/4で12msに厳格化
  const BITA_MS = 12;
  const NEAR_MS = 22;

  // 各リールの直近押下の精度＆滑り量（役成立時にビタ集計するため）
  const lastPressErrorMs: number[] = Array(REEL_COUNT).fill(Infinity);
  const lastSlipCells: number[] = Array(REEL_COUNT).fill(0);

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
    // 未回答クイズはタイムアウト扱い。
    // 滑り補助は廃止したので、クイズ正解しても挙動は変わらない（演出のみ）。
    // 正解/不正解SE は quizState.phase.subscribe で一括して鳴らす
    quizState.finalizeIfUnanswered();
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

    // 滑り（引き込み）を解決：停止済みリールの可視3セルを SlipResolver に渡す
    const total = engine.strip.cells.length;
    const basePos = (((Math.round(engine.position) % total) + total) % total);
    const stoppedVisibles: (VisibleColumn | null)[] = engines.map((e) => {
      if (e.state.get() !== 'stopped') return null;
      return {
        top: getVisibleCell(e, 'top'),
        middle: getVisibleCell(e, 'middle'),
        bottom: getVisibleCell(e, 'bottom'),
      };
    });
    // 滑り（noise 蹴り）は通常時のみ発生。示唆/クイズ時はプレイヤー（or AUTO）
    // が狙った位置に素直に止まるようスキップする
    const slipCells =
      currentEffect === 'none'
        ? slipResolver.resolve({
            reelIndex: idx,
            basePosition: basePos,
            strip: engine.strip,
            stoppedVisibles,
          })
        : 0;

    const result = engine.stop(timestamp, slipCells);
    showBitaBadge(idx, result.errorMs);
    // 押下の精度情報を保存（役成立時の bita 集計で参照）
    lastPressErrorMs[idx] = result.errorMs;
    lastSlipCells[idx] = slipCells;
    if (result.errorMs <= BITA_MS) {
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
        // 実機準拠：テンパイ時もリール速度は変えない。枠フラッシュ＆SEのみ。
        views[tenpai.missingReelIndex].startTenpaiFlash(tenpai.hasPremium);
        if (tenpai.hasPremium) sfx.tenpaiPremium();
        else sfx.tenpai();
        jinSpeech.say('tenpai');
      }
    }

    if (engines.every((e) => e.state.get() === 'stopped')) {
      // 5ペイライン（横3+斜め2）で全件判定。同じ役が複数ライン揃いも合算。
      const grid = extractGrid(engines);
      const middleSymbols = grid[1] as [string, string, string]; // 既存UI互換用
      const { hits } = judge.judgeAll(grid);
      const willHit = hits.length > 0;
      const premiumHit = hits.find((h) => h.yaku.category === 'premium') ?? null;
      const isPremium = premiumHit !== null;
      // 成立後の連チャン数で配当倍率を評価（3連達成スピンから恩恵が乗る）
      const streakAfter = willHit ? playStats.stats.get().streak + 1 : 0;
      const streakMult = streakMultiplier(streakAfter);
      const win = calc.calcMulti(hits, bonusZone.isActive(), streakMult);
      if (win > 0) wallet.win(win);

      playStats.recordSpin({
        bet: calc.bet,
        win,
        hit: willHit,
        premium: isPremium,
        bonusTriggered: isPremium,
      });

      // ビタ押し集計：役成立時のみ、貢献したリールごとに
      //   1) 押下精度 ≤ BITA_MS
      //   2) 滑り（noise 蹴り）に蹴られていない（slipCells == 0）
      // の両方を満たす時に +1。最大 +3。
      if (willHit) {
        const contributingReels = new Set<number>();
        for (const h of hits) {
          const line = PAYLINES.find((p) => p.id === h.paylineId);
          if (!line) continue;
          for (const [, col] of line.cells) contributingReels.add(col);
        }
        for (const r of contributingReels) {
          if (lastPressErrorMs[r] <= BITA_MS && lastSlipCells[r] === 0) {
            zukanState.recordBita();
          }
        }
      }

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

      if (willHit) {
        // 成立ラインインジケーターを点灯
        for (const h of hits) {
          leftIndicators.highlight(h.paylineId);
          rightIndicators.highlight(h.paylineId);
        }
        const cls = isPremium ? 'premium' : 'win';
        const bonusTag = bonusZone.isActive() ? ' ×BONUS' : '';
        const streakTag = streakMult > 1 ? ` ×${streakMult}連` : '';
        const lineTag = hits.length > 1 ? ` (${hits.length}ライン)` : '';
        // 役名は重複なしで「みかん×2 ＋ すしや」のように要約
        const yakuLabel = summarizeHits(hits);
        showResult(`${yakuLabel}！ +${win}${bonusTag}${streakTag}${lineTag}`, cls);
        jinState.set('cheer');
        // 図鑑には揃ったユニーク役を全部記録
        const recorded = new Set<string>();
        for (const h of hits) {
          if (recorded.has(h.yaku.id)) continue;
          recorded.add(h.yaku.id);
          zukanState.record(h.yaku.id);
        }
        // 全リール中央セルをハイライト
        for (const v of views) v.highlightCenter(1400);
        // コイン獲得 +N フロート表示
        if (win > 0) showCoinFloat(win, isPremium);
        // 大配当はコインバースト（プレミアム=多め）
        if (isPremium) showCoinBurst(28);
        else if (win >= 50) showCoinBurst(12);
        else if (win >= 24) showCoinBurst(5);
        // プレミアム成立でボーナス突入＋全画面演出
        if (isPremium && premiumHit) {
          bonusZone.trigger();
          sfx.bonusEnter();
          showPremiumCutin(premiumHit.yaku.name, premiumHit.yaku.symbols);
          flashScreen({ color: '#ffd700', alpha: 0.85, durMs: 400 });
          spawnConfetti(100);
          shakeBody(600);
          window.setTimeout(() => {
            showBonusBanner();
            jinSpeech.say('premium');
          }, 1300);
        } else if (hits.length >= 2) {
          // 多重ライン HIT: 専用ファンファーレ + バッジ + フラッシュ
          sfx.winMulti(hits.length);
          showMultiHitBadge(hits.length);
          const flashColor =
            hits.length >= 4 ? '#ff66aa' : hits.length === 3 ? '#ffaa44' : '#ffd700';
          flashScreen({ color: flashColor, alpha: 0.55, durMs: 350 });
          if (hits.length >= 3) {
            spawnConfetti(40);
            shakeBody(280);
          }
          jinSpeech.say('win');
        } else {
          sfx.winCore();
          jinSpeech.say('win');
        }
      } else {
        // ハズレ・ニアミス時は結果テキストを出さない（演出のみ）
        // ニアミスはマスコットのセリフだけで示唆
        const positions = engines.map((e) => {
          const t = e.strip.cells.length;
          return ((Math.round(e.position) % t) + t) % t;
        });
        const nearMisses = nearMissDetector.detect(
          middleSymbols,
          engines.map((e) => e.strip),
          positions,
        );
        if (nearMisses.length > 0) jinSpeech.say('near');
        else jinSpeech.say('miss');
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
  // 状態を見て BET → LEVER → STOP×3 を進める。
  // 示唆/クイズ時はターゲット役を決めて狙い停止（揃いやすくなる）。
  // 通常時は適当タイミングで停止（揃わなくて普通）。
  let autoMode = false;
  let autoTimer: number | null = null;
  // 示唆/クイズ時に AUTO が狙う役。BET 直後に決定 → resetForNextSpin で null
  let autoTargetYaku: (typeof allYakusFlat)[number] | null = null;
  // 停止スケジュール済みのリール（重複スケジュール防止）
  const aimPending = new Set<number>();

  const clearAutoTimer = () => {
    if (autoTimer !== null) {
      window.clearTimeout(autoTimer);
      autoTimer = null;
    }
  };

  /** BET 直後にコールして、effect 種別に応じた狙い役を確定する */
  const setupAutoTarget = () => {
    if (currentEffect === 'quiz') {
      // クイズは必ず正解を選ぶ → targetYakuId が確定
      const q = quizState.current.get();
      if (q && quizState.phase.get() === 'asking') {
        quizState.answer(q.correctIndex);
      }
      const tid = quizState.targetYakuId();
      autoTargetYaku = tid
        ? allYakusFlat.find((y) => y.id === tid) ?? null
        : null;
    } else if (currentEffect === 'shisa') {
      // 示唆はコア役からランダム1つを目標に
      autoTargetYaku =
        yakuList.coreYaku[
          Math.floor(Math.random() * yakuList.coreYaku.length)
        ] ?? null;
    } else {
      autoTargetYaku = null;
    }
  };

  /**
   * AUTO の狙い停止：target symbol が中央に来るまで待ってから stopReel を呼ぶ。
   * 滑り（noise 50%蹴り）は通常通り走るので、最終的に揃うかは 50% 程度。
   */
  const scheduleAimedStop = (reelIdx: number) => {
    if (!autoTargetYaku) return;
    if (aimPending.has(reelIdx)) return;
    const engine = engines[reelIdx];
    if (engine.state.get() !== 'spinning') return;

    const cells = engine.strip.cells;
    const total = cells.length;
    const pos = engine.position;
    const targetSymbol = autoTargetYaku.symbols[reelIdx];
    const speed = engine.currentSpeed;

    // 順方向で次に target symbol が来る距離（コマ単位）
    let bestDist = Infinity;
    for (let i = 0; i < total; i++) {
      if (cells[i] !== targetSymbol) continue;
      const dist = (((i - pos) % total) + total) % total;
      if (dist < bestDist) bestDist = dist;
    }
    if (bestDist === Infinity || speed <= 0) {
      stopReel(reelIdx, performance.now());
      return;
    }

    const msToWait = (bestDist / speed) * 1000;
    aimPending.add(reelIdx);
    window.setTimeout(() => {
      aimPending.delete(reelIdx);
      if (!autoMode) return;
      if (engine.state.get() === 'spinning') {
        stopReel(reelIdx, performance.now());
      }
    }, msToWait);
  };

  const stepAuto = () => {
    if (!autoMode) return;
    if (!wallet.canBet(calc.bet) && !betPlaced) {
      stopAuto();
      return;
    }

    const states = engines.map((e) => e.state.get());
    const anySpinning = states.includes('spinning');
    const allIdle = states.every((s) => s === 'idle');

    if (!betPlaced && allIdle) {
      placeBet();
      // BET 後すぐに狙い役を確定（クイズなら正解も済ます）
      setupAutoTarget();
    } else if (betPlaced && allIdle) {
      pullLever();
    } else if (anySpinning) {
      // 1リールずつ処理。aim 待ち中はスキップ
      for (let idx = 0; idx < REEL_COUNT; idx++) {
        if (states[idx] !== 'spinning') continue;
        if (aimPending.has(idx)) break;
        if (autoTargetYaku) {
          scheduleAimedStop(idx);
        } else {
          stopReel(idx, performance.now());
        }
        break;
      }
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
    // リールは「上から下へ流れる」＝ 視覚的にトップにある cell index が大きい。
    // パネルもそれに合わせて、index 降順で上から下に並べる（reverse）。
    // 元 index は data-index に保持し、ハイライト処理で参照する。
    const cells = engines[idx].strip.cells;
    for (let i = cells.length - 1; i >= 0; i--) {
      const symbol = cells[i];
      const cell = document.createElement('div');
      cell.className = 'strip-cell';
      cell.textContent = symbol;
      // タイル背景＋白文字に統一（リール本体と同じ役単位カラー）
      cell.style.background = colorResolver.cssFor(idx, symbol);
      cell.style.color = '#fff';
      cell.dataset.index = String(i);
      cellsEl.appendChild(cell);
    }
  });

  const updateStripHighlight = () => {
    stripColumns.forEach((col, idx) => {
      const e = engines[idx];
      const isSpinning = e.state.get() === 'spinning';
      const total = e.strip.cells.length;
      const current = ((Math.round(e.position) % total) + total) % total;
      const cells = col.querySelectorAll<HTMLElement>('.strip-cell');
      cells.forEach((cell) => {
        const stripIdx = Number(cell.dataset.index ?? -1);
        if (!isSpinning && stripIdx === current) cell.classList.add('current');
        else cell.classList.remove('current');
      });
    });
  };

  // クイズ正解時、リール配列にターゲット文字を緑強調表示する
  const updateStripTargetHighlight = () => {
    const targetYakuId = quizState.targetYakuId();
    const yaku = targetYakuId
      ? allYakusFlat.find((y) => y.id === targetYakuId)
      : null;
    stripColumns.forEach((col, idx) => {
      const targetSymbol = yaku?.symbols[idx] ?? null;
      // 右パネル：該当文字にクラス付与
      const cells = col.querySelectorAll<HTMLElement>('.strip-cell');
      cells.forEach((cell) => {
        if (targetSymbol && cell.textContent === targetSymbol) {
          cell.classList.add('target');
        } else {
          cell.classList.remove('target');
        }
      });
      // リール本体：該当文字以外を薄くフェード
      views[idx].setTargetSymbol(targetSymbol);
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
  // コイン残量が変化したら BET ボタンの有効/無効を再評価
  // （+追加 / リセット / コイン不足 → 補充 など全ケース対応）
  wallet.coins.subscribe(() => updateButtons());

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
