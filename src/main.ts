import { Application, Assets, FillGradient, Graphics, Texture } from 'pixi.js';
import { ReelEngine } from './core/ReelEngine';
import { ReelView, CELL_WIDTH, CELL_HEIGHT, VISIBLE_CELLS } from './render/ReelView';
import { SymbolColorResolver } from './render/SymbolStyle';
import { YakuJudge } from './core/YakuJudge';
import { PayoutCalc } from './core/PayoutCalc';
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
import { BgmEngine } from './audio/BgmEngine';
import { TenpaiDetector, type TenpaiLine } from './productions/TenpaiDetector';
import { PlayStats } from './productions/PlayStats';
import { appendRunRecord } from './productions/RunHistory';
import { getMemberId, getMemberName } from './productions/Member';
import { NearMissDetector } from './productions/NearMissDetector';
import {
  flashScreen,
  spawnConfetti,
  shakeBody,
  showPremiumCutin,
  showMultiHitBadge,
  startBonusSparkle,
  stopBonusSparkle,
  spawnButtonRipple,
  showAimNotice,
  hideAimNotice,
  setEffectHost,
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
import {
  extractGrid,
  getVisibleCell,
  getVisibleCellIndex,
  PAYLINES,
  type Vertical,
} from './core/Paylines';
import { PaylineIndicators } from './render/PaylineIndicators';
import {
  ReelConfigSchema,
  YakuListSchema,
  PayoutSchema,
  QuizListSchema,
  type Yaku,
  type ReelStrip,
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
const CANVAS_H = 732;
// 液晶エリア（演出液晶＋マスコット領域）の高さ。
// 「演出液晶1.3 : リール0.9」の比率にするため、リール実体(CELL_HEIGHT*VISIBLE_CELLS=300=0.9相当)に対し
// 1.3/0.9倍 = 432 を割り当てる。CANVAS_H(732) = LIQUID_AREA_H(432) + リール領域(300)。
// 上部の空間にカットイン・演出を表示し、ジンはリール際（下部）に立たせる。
const LIQUID_AREA_H = 432;

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

export async function bootstrap() {
  const canvas = requireEl<HTMLCanvasElement>('game');

  const app = new Application();
  await app.init({
    canvas,
    width: CANVAS_W,
    height: CANVAS_H,
    backgroundColor: 0x080808,
    antialias: true,
    resolution: window.devicePixelRatio || 1,
    // autoDensity を true にすると Pixi が canvas.style.width/height を 600px に固定し、
    // CSS 側の width: 100% / height: 100% を上書きして cabinet 縮小に追随できなくなる。
    // false にしておき、buffer 解像度（高 DPR）だけ確保して表示サイズは CSS に任せる。
    autoDensity: false,
    preference: 'webgl',
  });

  const chapter = getCurrentChapter();
  const chapterId = getCurrentChapterId();

  // 章ごとのアート（public/art/）。画像が無い章はURLが404になり、カットインは画像なし（CSSのみ）。
  // ※ body の章背景パネルは一旦オフ（必要になったら has-chapter-bg を復活させる）。
  const ART_BASE = `${import.meta.env.BASE_URL}art/`;
  const chapterCutinUrl = `${ART_BASE}cutin_${chapterId}.webp`;

  const reelConfig = ReelConfigSchema.parse(chapter.reelData);
  const yakuList = YakuListSchema.parse(chapter.yakuData);
  const payout = PayoutSchema.parse(payoutDataRaw);
  const quizList = QuizListSchema.parse(chapter.quizData);
  // 役の id → 役オブジェクトの逆引き（AUTO のターゲット解決などで使う）
  const allYakusFlat = [
    ...yakuList.coreYaku,
    ...yakuList.premiumYaku,
    ...yakuList.bonusYaku,
    ...yakuList.cherryYaku,
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
  const bgm = new BgmEngine();
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
  // デバッグ section の表示可否（遊ぶ設定で確定・既定OFF）
  const debugVisible = localStorage.getItem('mojislot.debugVisible.v1') === '1';
  const settingsOverlay = new SettingsOverlay(
    wallet,
    payout.initialCoins,
    playStats,
    zukanState,
    challengeTracker,
    debugVisible,
  );
  // 滑り/引き込み（17_assist-and-slip.md）：演出時は最終リールで狙い役を最大4コマ引き込む
  // （resolveAssist）。引き込まない時は、予告役以外の premium/bonus 偶然揃いを蹴る
  // （resolveKick・全演出で作用、予告した BIG/RB は通す）。
  // 現在のスピンの effect 種別（AUTO がターゲット決定に使う）
  let currentEffect: EffectType = 'none';

  // 液晶エリアの土台。単色の黒板だと「空っぽの余白」に見えるので、
  // 紫星雲の極薄環境光（radialグラデ）で“画面が点いている”奥行きを出す（18_cabinet-design GLOW ZONE 1）。
  // 中央上やや＝ロイヤル寄りに灯し、周縁はvoidへ落として枠に馴染ませる。やり過ぎ＝AI感なので3段の控えめな階調のみ。
  const liquidGrad = new FillGradient({
    type: 'radial',
    center: { x: 0.5, y: 0.4 },
    innerRadius: 0,
    outerCenter: { x: 0.5, y: 0.4 },
    outerRadius: 0.78,
    colorStops: [
      { offset: 0, color: 0x2a1646 }, // ロイヤル寄りの灯り（中央）
      { offset: 0.55, color: 0x180d28 }, // オーベルジュの中間
      { offset: 1, color: 0x0a0612 }, // void へ沈む周縁
    ],
    textureSpace: 'local',
  });
  const liquidBg = new Graphics();
  liquidBg.rect(0, 0, CANVAS_W, LIQUID_AREA_H);
  liquidBg.fill(liquidGrad);
  app.stage.addChild(liquidBg);

  // 演出ビジュアル（液晶＋リール背景の色味、フラッシュ）
  const effectVisual = new EffectVisual({
    width: CANVAS_W,
    liquidHeight: LIQUID_AREA_H,
    totalHeight: CANVAS_H,
  });
  app.stage.addChild(effectVisual.bgLayer);

  // ジンはスマスロ風に「演出液晶の左下」に小さく配置する。
  // 中央〜上部の広い空間はカットイン・演出のために空けておく。
  const JIN_SCALE = 0.62;
  const JIN_X = 118; // 左寄せ（縮小後の半幅ぶん内側に置く）
  const JIN_FOOT_Y = LIQUID_AREA_H - 12; // 足元＝液晶下端付近（リール直上）

  // 液晶下端をうっすら明るく（ジンの足元に光を当てたような感じ）。左下のジンに合わせる。
  const liquidFloor = new Graphics();
  liquidFloor.ellipse(JIN_X, JIN_FOOT_Y, 96, 16);
  liquidFloor.fill({ color: 0xffd700, alpha: 0.09 });
  app.stage.addChild(liquidFloor);

  // ジン（マスコット）配置。container は原点中心描画なので、足元が JIN_FOOT_Y に来るよう
  // 中心を半身ぶん上げる（従来の中心-床=102px を scale 倍して算出）。
  const jinView = new JinView(jinState);
  jinView.container.scale.set(JIN_SCALE);
  jinView.container.x = JIN_X;
  jinView.container.y = JIN_FOOT_Y - 102 * JIN_SCALE;
  app.stage.addChild(jinView.container);

  // 液晶内の演出ホスト。全画面 DOM 演出（フラッシュ/紙吹雪/カットイン/キラキラ/HIT）を
  // ここに出して液晶外へはみ出させない（overflow:hidden）。
  const lcdFx = document.createElement('div');
  lcdFx.id = 'lcd-fx';
  requireEl('game-area').appendChild(lcdFx);
  setEffectHost(lcdFx);

  // ジンのセリフ吹き出し（DOM, 演出エリア内）。ジン本体の可視制御と同じ信号で抑制する。
  const jinSpeech = new JinSpeech(requireEl('game-area'));

  // クイズ中はジンを隠して、ここにクイズ文章を大きく出す
  const quizQuestionView = new QuizQuestionView(quizState, {
    width: CANVAS_W,
    height: LIQUID_AREA_H,
  });
  quizQuestionView.container.x = CANVAS_W / 2;
  quizQuestionView.container.y = LIQUID_AREA_H / 2;
  app.stage.addChild(quizQuestionView.container);

  // クイズ表示中はマスコットを隠す。同時にセリフ吹き出しも抑制し、問題文への被りを防ぐ。
  quizState.phase.subscribe((phase) => {
    const idle = phase === 'inactive';
    jinView.container.visible = idle;
    jinSpeech.setSuppressed(!idle);
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

  // 章ごとの図柄画像（あれば）。(reelIdx, symbol) -> URL / Texture を「色と同じ先勝ち順」で構築。
  // 画像が無い章は空のままで、ReelView は従来の色タイル＋文字にフォールバックする。
  // ART_VER: 図柄を作り直すたびに上げる（同名 webp のブラウザキャッシュ対策）。
  const CHAPTERS_WITH_SYMBOL_ART = new Set<string>([
    'hiragana_food',
    'katakana_animal',
    'yasai',
    'hiragana_verb',
    'security',
    'h_adult',
  ]);
  const ART_VER = '6';
  const symbolTileUrls = new Map<string, string>(); // 右パネル用（文字あり版の素URL）
  const symbolTextures = new Map<string, Texture>(); // 文字あり版（設定ON）
  const symbolTexturesPlain = new Map<string, Texture>(); // 文字なし版＝図柄のみ（既定）
  // リール絵柄スタイル（遊ぶ設定）：image=図柄画像 / plain=色タイル＋文字（旧スタイル）。
  // plain のときは画像を一切読み込まず、ReelView も右の配列表も色＋文字に落とす。
  const useArtImages = localStorage.getItem('mojislot.reelArt.v1') !== 'plain';
  if (useArtImages && CHAPTERS_WITH_SYMBOL_ART.has(chapterId)) {
    const orderedForArt = [
      ...yakuList.premiumYaku,
      ...yakuList.coreYaku,
      ...yakuList.cherryYaku,
      ...yakuList.bonusYaku,
    ];
    for (const y of orderedForArt) {
      if (y.noArt) continue; // 画像を持たない役（例：もも）は色＋文字で描く
      // チェリーは2文字（symbols.length=2）。存在する文字だけ対象にする
      for (let r = 0; r < y.symbols.length; r++) {
        const key = `${r}:${y.symbols[r]}`;
        if (!symbolTileUrls.has(key)) {
          symbolTileUrls.set(
            key,
            `${ART_BASE}symbols/${chapterId}/${y.id}_${r}.webp`,
          );
        }
      }
    }
    try {
      const glyphUrls = [...new Set(symbolTileUrls.values())];
      const plainUrls = glyphUrls.map((u) => u.replace(/\.webp$/, '_plain.webp'));
      // 一部記号のアートが欠けても全体を壊さない（allSettled）。
      // 欠けた記号はテクスチャ未設定＋URL削除で、その記号だけ色＋文字に落とす。
      await Promise.allSettled(
        [...glyphUrls, ...plainUrls].map((u) => Assets.load(`${u}?v=${ART_VER}`)),
      );
      for (const [key, url] of [...symbolTileUrls]) {
        const glyphTex = Assets.get(`${url}?v=${ART_VER}`) as Texture | undefined;
        const plainTex = Assets.get(
          `${url.replace(/\.webp$/, '_plain.webp')}?v=${ART_VER}`,
        ) as Texture | undefined;
        if (glyphTex && plainTex) {
          symbolTextures.set(key, glyphTex);
          symbolTexturesPlain.set(key, plainTex);
        } else {
          symbolTileUrls.delete(key); // アート欠落 → 右の配列表も色＋文字へ
        }
      }
    } catch (err) {
      console.warn('図柄画像の読み込みに失敗。色タイルにフォールバックします', err);
      symbolTextures.clear();
      symbolTexturesPlain.clear();
      symbolTileUrls.clear();
    }
  }
  // 文字あり版 / 文字なし版(_plain) の URL（右パネル用）
  const tileUrlWithVer = (reelIdx: number, symbol: string): string | null => {
    const u = symbolTileUrls.get(`${reelIdx}:${symbol}`);
    return u ? `${u}?v=${ART_VER}` : null;
  };
  const tilePlainUrlWithVer = (reelIdx: number, symbol: string): string | null => {
    const u = symbolTileUrls.get(`${reelIdx}:${symbol}`);
    return u ? `${u.replace(/\.webp$/, '_plain.webp')}?v=${ART_VER}` : null;
  };
  // 右パネルの図柄セル（文字ON/OFFで背景画像を差し替えるため保持）
  const stripGlyphCells: { el: HTMLElement; glyph: string; plain: string }[] = [];
  let reelGlyphsOn = localStorage.getItem('reelShowGlyphs') === '1';

  for (let i = 0; i < REEL_COUNT; i++) {
    const engine = new ReelEngine(reelConfig.reels[i]);
    const reelIdx = i;
    const view = new ReelView(
      engine,
      (symbol) => colorResolver.colorFor(reelIdx, symbol),
      (symbol) => colorResolver.tierFor(reelIdx, symbol),
      // 既定は文字なし版（図柄のみ）。設定ONで文字あり版に差し替え
      (symbol) => symbolTexturesPlain.get(`${reelIdx}:${symbol}`) ?? null,
      (symbol) => symbolTextures.get(`${reelIdx}:${symbol}`) ?? null,
    );
    view.container.x = startX + i * (CELL_WIDTH + REEL_GAP);
    view.container.y = reelY;
    app.stage.addChild(view.container);
    engines.push(engine);
    views.push(view);
  }

  // リール文字表示トグル（既定OFF＝図柄のみ／設定でON）。localStorage に永続化。
  // リール本体・右の「リール配列」パネルの両方を連動させる。
  const REEL_GLYPHS_KEY = 'reelShowGlyphs';
  const applyReelGlyphs = (show: boolean) => {
    reelGlyphsOn = show;
    localStorage.setItem(REEL_GLYPHS_KEY, show ? '1' : '0');
    for (const v of views) v.setShowGlyphs(show);
    for (const c of stripGlyphCells) {
      c.el.style.backgroundImage = `url("${show ? c.glyph : c.plain}")`;
    }
  };
  const initialReelGlyphs = reelGlyphsOn;
  applyReelGlyphs(initialReelGlyphs);
  settingsOverlay.setReelGlyphsControl(initialReelGlyphs, applyReelGlyphs);

  // ペイラインインジケーター（リール左脇外側に1セットのみ。左右ミラーは冗長なので片側へ）
  const reelHeight = CELL_HEIGHT * VISIBLE_CELLS;
  const indicatorOffsetY = reelY + (reelHeight - PaylineIndicators.TOTAL_HEIGHT) / 2;
  const indicatorPadX = 12;

  const leftIndicators = new PaylineIndicators();
  leftIndicators.container.x = startX - PaylineIndicators.WIDTH - indicatorPadX;
  leftIndicators.container.y = indicatorOffsetY;
  app.stage.addChild(leftIndicators.container);

  // フラッシュなどの前景エフェクトはリールの上に重ねる
  app.stage.addChild(effectVisual.fxLayer);

  app.ticker.add(() => {
    const now = performance.now();
    for (const engine of engines) engine.tick(now);
    for (const view of views) view.update(now);
    leftIndicators.update(now);
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
  const bonusStatusEl = requireEl('bonus-status');
  const cabinetEl = requireEl('cabinet');
  const muteBtn = requireEl<HTMLButtonElement>('mute-btn');
  const autoBtn = requireEl<HTMLButtonElement>('auto-btn');
  // AUTO の有無（遊ぶ設定 sessionStorage `mojislot.playSetup.v1` = {auto}・既定あり）。
  // 無効時はボタンを隠し、[O] ショートカットも効かせない。
  const autoAvailable = ((): boolean => {
    try {
      const raw = sessionStorage.getItem('mojislot.playSetup.v1');
      if (!raw) return true;
      return (JSON.parse(raw) as { auto?: unknown }).auto !== false;
    } catch {
      return true;
    }
  })();
  if (!autoAvailable) autoBtn.hidden = true;
  const settingsBtn = requireEl<HTMLButtonElement>('settings-btn');
  const streakStatusEl = requireEl('streak-status');
  const rescueStatusEl = requireEl('rescue-status');
  const bonusBannerEl = requireEl('bonus-banner');
  betTextEl.textContent = `Bet: ${calc.bet}`;
  const effectStatusEl = requireEl('effect-status');
  let betPlaced = false;
  let resultTimer: number | null = null;

  // 演出ターゲットを「リール枚数」に比例させるためのウェイト。
  // 役の各文字がそのリールに何枚あるかの平均 ＝ その役の出やすさ。
  // → ぶどう等の最頻役は演出で多く狙われ、7/バー等のレア役は稀になる。
  const reelSymbolCount = (reelIdx: number, symbol: string): number =>
    reelConfig.reels[reelIdx].cells.filter((c) => c === symbol).length;
  const yakuReelWeight = (yaku: { symbols: string[] }): number => {
    let sum = 0;
    for (let r = 0; r < yaku.symbols.length; r++) {
      sum += reelSymbolCount(r, yaku.symbols[r]);
    }
    return Math.max(1, sum / yaku.symbols.length);
  };
  const weightedPick = <T>(items: readonly T[], weight: (t: T) => number): T => {
    const ws = items.map(weight);
    const total = ws.reduce((a, b) => a + b, 0);
    let r = Math.random() * total;
    for (let i = 0; i < items.length; i++) {
      r -= ws[i];
      if (r <= 0) return items[i];
    }
    return items[items.length - 1];
  };

  // クイズは「答えの役のリール枚数」に比例して出題（最頻役のクイズが多く出る）
  const pickRandomQuiz = () =>
    weightedPick(quizList.quizzes, (q) => {
      const y = allYakusFlat.find((yy) => yy.id === q.answerYakuId);
      return y ? yakuReelWeight(y) : 1;
    });

  /**
   * aim 演出で狙っている役（applyEffect('aim') で設定、resetForNextSpin で null）。
   * applyEffect の closure 内で参照されるため、applyEffect 定義より前で宣言する必要がある。
   */
  let aimNoticeYaku: (typeof allYakusFlat)[number] | null = null;

  const applyEffect = (effect: EffectType) => {
    currentEffect = effect;
    const speed = REEL_SPEED_BY_EFFECT[effect];
    for (const engine of engines) engine.setSpeed(speed);
    effectVisual.apply(effect);

    effectStatusEl.classList.remove('shisa', 'quiz', 'aim');
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
    } else if (effect === 'aim') {
      effectStatusEl.textContent = '狙え！';
      effectStatusEl.classList.add('aim');
      jinState.set('shisa');
      // 狙う役をリール枚数に比例して抽選（最頻役が多く、7/バー/RBは稀）。
      // 3文字役のみ対象（2文字チェリーは aim UI 上 3リール表示にならないので除外）。
      const aimPool = [
        ...yakuList.coreYaku,
        ...yakuList.premiumYaku,
        ...yakuList.bonusYaku,
      ];
      const targetYaku = weightedPick(aimPool, yakuReelWeight);
      // AUTO がこの役を狙えるよう状態保持（setupAutoTarget が後で読む）
      aimNoticeYaku = targetYaku;
      showAimNotice({
        symbols: targetYaku.symbols,
        // 各文字を実リールのセル色に合わせる（左/中/右）
        colors: targetYaku.symbols.map((s, i) => colorResolver.cssFor(i, s)),
        yakuName: targetYaku.name,
        imageUrl: `${ART_BASE}aim_text.webp`,
        hasPremium: targetYaku.category === 'premium',
        // 現行 canvas 寸法に基づくリール座標比（旧ハードコードのズレを解消）
        reelCentersXFrac: [0, 1, 2].map(
          (i) => (startX + i * (CELL_WIDTH + REEL_GAP) + CELL_WIDTH / 2) / CANVAS_W,
        ),
        reelTopYFrac: LIQUID_AREA_H / CANVAS_H,
      });
      sfx.shisa(); // 既存の示唆 SE を流用
      jinSpeech.say('shisa');
    } else {
      aimNoticeYaku = null;
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
      coinEl.textContent = `MEDAL ${target}`;
      return;
    }
    const durMs = Math.min(900, 200 + Math.abs(diff) * 8);
    const startTime = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - startTime) / durMs);
      const eased = 1 - Math.pow(1 - t, 3);
      displayedCoin = Math.round(start + diff * eased);
      coinEl.textContent = `MEDAL ${displayedCoin}`;
      if (t < 1) {
        coinAnimRaf = requestAnimationFrame(step);
      } else {
        displayedCoin = target;
        coinAnimRaf = null;
      }
    };
    coinAnimRaf = requestAnimationFrame(step);
  };
  coinEl.textContent = `MEDAL ${displayedCoin}`;
  updateCoinWarning(displayedCoin);
  wallet.coins.subscribe(animateCoinTo);

  // サンド（ユニット）：持メダル表示＋メダル貸出（コイン補充）。設定から移設。
  const unitMedalEl = document.getElementById('unit-medal');
  if (unitMedalEl) {
    const setMedal = (n: number) => {
      unitMedalEl.textContent = String(n);
    };
    setMedal(wallet.coins.get());
    wallet.coins.subscribe(setMedal);
  }
  // メダル貸出＝投資（lend）。役の払い出し(win)とは別物＝差枚会計の「投資」側。
  for (const btn of document.querySelectorAll<HTMLButtonElement>(
    '#unit-panel .coin-add',
  )) {
    btn.addEventListener('click', () => {
      const n = Number(btn.dataset.amount ?? '0');
      if (n > 0) wallet.lend(n);
    });
  }

  // サンドの差枚/投資ライブ表示：差枚 = 現在の持メダル − この戦の投資累計。
  const unitInvestEl = document.getElementById('unit-invest');
  const unitSahmaiEl = document.getElementById('unit-sahmai');
  const renderSahmai = () => {
    if (unitInvestEl) unitInvestEl.textContent = String(wallet.investmentTotal.get());
    if (unitSahmaiEl) {
      const s = wallet.sahmai();
      unitSahmaiEl.textContent = `${s > 0 ? '+' : ''}${s}`;
      unitSahmaiEl.classList.toggle('plus', s > 0);
      unitSahmaiEl.classList.toggle('minus', s < 0);
    }
  };
  renderSahmai();
  wallet.coins.subscribe(renderSahmai);
  wallet.investmentTotal.subscribe(renderSahmai);

  // 戦専用カウンタ（RunRecord 用）。PlayStats は章混在の累計なので差分算出に使えず別持ちする。
  // recordSpin と challenge 報酬の確定フックで増分し、計数（count-btn）でスナップショット→0リセット。
  let runStartedAt = Date.now();
  let runSpinCount = 0;
  let runTotalBet = 0;
  let runTotalWin = 0;
  let runPremiumCount = 0;
  let runBonusCount = 0;

  // 計数＝この戦を締める：spinCount>0 なら1戦を RunHistory に確定記録し、持メダルを流す(0に)＋投資/戦カウンタをリセット。
  document.getElementById('count-btn')?.addEventListener('click', () => {
    // 計数=この戦の区切り。計測中なら自動停止（sahmai が0に戻り時速が誤って跳ねるのを防ぐ）。
    // ※ stopTimer は下方で定義（このハンドラはクリック時=bootstrap完了後に走るので参照は安全）
    stopTimer();
    const investment = wallet.investmentTotal.get();
    const payback = wallet.coins.get();
    // 空打ち（1回も回さず計数）は機械割が算出不能なので記録しない＝離脱は破棄に準ずる
    if (runSpinCount > 0) {
      appendRunRecord({
        runId: crypto.randomUUID(),
        memberId: getMemberId(),
        memberName: getMemberName(),
        chapterId,
        startedAt: runStartedAt,
        settledAt: Date.now(),
        investment,
        payback,
        sahmai: payback - investment,
        spinCount: runSpinCount,
        totalBet: runTotalBet,
        totalWin: runTotalWin,
        premiumCount: runPremiumCount,
        bonusCount: runBonusCount,
      });
    }
    wallet.reset(0);
    runStartedAt = Date.now();
    runSpinCount = 0;
    runTotalBet = 0;
    runTotalWin = 0;
    runPremiumCount = 0;
    runBonusCount = 0;
  });

  // === 時間計測：フリー(カウントアップ・手動停止)＋プリセット分数のカウントダウン(到達で自動停止)。
  //     開始時の差枚を基準に「分速(差枚/分)」を出す（時速は出さない） ===
  const timerEl = {
    box: document.querySelector<HTMLElement>('.unit-timer'),
    clock: document.getElementById('timer-elapsed'),
    min: document.getElementById('timer-min'),
    total: document.getElementById('timer-total'),
    toggle: document.getElementById('timer-toggle') as HTMLButtonElement | null,
    reset: document.getElementById('timer-reset'),
    presets: document.getElementById('timer-presets'),
  };
  let timerRunning = false;
  let timerStartMs = 0;
  let timerBaseSahmai = 0;
  let timerDurationMs = 0; // 0=フリー(カウントアップ)、>0=その時間でカウントダウン→自動停止
  let timerInterval: number | null = null;
  // 計測開始直後は差枚デルタが小さく分速が暴れるので、一定時間まで「—」
  const RATE_MIN_MS = 10_000;

  const fmtClock = (ms: number): string => {
    const total = Math.max(0, Math.floor(ms / 1000));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };
  const setRate = (el: HTMLElement | null, value: number | null, unit: string): void => {
    if (!el) return;
    if (value === null) {
      el.textContent = '—';
      el.classList.remove('plus', 'minus');
      return;
    }
    const rounded = Math.round(value);
    el.textContent = `${rounded > 0 ? '+' : ''}${rounded}${unit}`;
    el.classList.toggle('plus', rounded > 0);
    el.classList.toggle('minus', rounded < 0);
  };
  // 分速＝開始時からの差枚デルタ÷経過分。baseMs を渡すとその時間で割る（カウントダウン確定用）。
  const renderMinRate = (elapsedMs: number, baseMs?: number): void => {
    const delta = wallet.sahmai() - timerBaseSahmai;
    if (baseMs || elapsedMs >= RATE_MIN_MS) {
      setRate(timerEl.min, delta / ((baseMs ?? elapsedMs) / 60_000), '/分');
    } else {
      setRate(timerEl.min, null, '');
    }
  };
  // 区間差枚＝開始からの差枚デルタ（累計）。分速と違い値が暴れないので即時表示。
  const renderTotal = (): void => {
    setRate(timerEl.total, wallet.sahmai() - timerBaseSahmai, '枚');
  };
  const renderTimer = (): void => {
    if (!timerRunning) return;
    const elapsedMs = Date.now() - timerStartMs;
    if (timerDurationMs > 0) {
      const remaining = timerDurationMs - elapsedMs;
      if (remaining <= 0) {
        // セット時間に到達：00:00 固定＋その間の分速を確定して自動停止
        if (timerEl.clock) timerEl.clock.textContent = '00:00';
        renderMinRate(elapsedMs, timerDurationMs);
        renderTotal();
        stopTimer();
        return;
      }
      if (timerEl.clock) timerEl.clock.textContent = fmtClock(remaining); // 残り時間
    } else if (timerEl.clock) {
      timerEl.clock.textContent = fmtClock(elapsedMs); // 経過時間
    }
    renderMinRate(elapsedMs);
    renderTotal();
  };
  const startTimer = (): void => {
    timerRunning = true;
    timerStartMs = Date.now();
    timerBaseSahmai = wallet.sahmai();
    timerEl.box?.classList.add('running');
    if (timerEl.toggle) {
      timerEl.toggle.textContent = '計測停止';
      timerEl.toggle.classList.add('on');
    }
    if (timerEl.clock) {
      timerEl.clock.textContent = fmtClock(timerDurationMs); // カウントダウンはセット時間から
    }
    setRate(timerEl.min, null, '');
    setRate(timerEl.total, 0, '枚');
    timerInterval = window.setInterval(renderTimer, 1000);
  };
  const stopTimer = (): void => {
    // 停止＝その時点の表示（残り/経過・分速）を固定
    timerRunning = false;
    if (timerInterval !== null) {
      window.clearInterval(timerInterval);
      timerInterval = null;
    }
    timerEl.box?.classList.remove('running');
    if (timerEl.toggle) {
      timerEl.toggle.textContent = '計測開始';
      timerEl.toggle.classList.remove('on');
    }
  };
  // プリセット分数の選択（計測中は変更不可）。data-min="0"=フリー。
  timerEl.presets
    ?.querySelectorAll<HTMLButtonElement>('.timer-preset')
    .forEach((btn) => {
      btn.addEventListener('click', () => {
        if (timerRunning) return;
        timerDurationMs = Number(btn.dataset.min ?? '0') * 60_000;
        timerEl.presets
          ?.querySelectorAll('.timer-preset')
          .forEach((b) => b.classList.toggle('active', b === btn));
        if (timerEl.clock) timerEl.clock.textContent = fmtClock(timerDurationMs);
      });
    });
  timerEl.toggle?.addEventListener('click', () => {
    if (timerRunning) stopTimer();
    else startTimer();
  });
  timerEl.reset?.addEventListener('click', () => {
    stopTimer();
    timerStartMs = 0;
    if (timerEl.clock) timerEl.clock.textContent = fmtClock(timerDurationMs);
    setRate(timerEl.min, null, '');
    setRate(timerEl.total, null, '');
  });

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
      const mult = calc.streakMult(streak);
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
  const showBonusBanner = (kind: 'big' | 'reg' = 'big') => {
    const text = kind === 'reg' ? 'REGULAR!' : 'BIG BONUS!';
    bonusBannerEl.innerHTML = `<div class="bonus-banner-text${kind === 'reg' ? ' reg' : ''}">${text}</div>`;
    bonusBannerEl.hidden = false;
    window.setTimeout(() => {
      bonusBannerEl.hidden = true;
      bonusBannerEl.innerHTML = '';
    }, 1700);
  };

  // === デバッグアクション（設定モーダルから呼ばれる） ===
  settingsOverlay.setDebugActions({
    triggerBonus: () => {
      bonusZone.trigger('big');
      sfx.bonusEnter();
      // デバッグ：プレミアム役が無くても代表的な役名でカットインを試せる
      const premium = yakuList.premiumYaku[0];
      if (premium) {
        showPremiumCutin(premium.name, premium.symbols, chapterCutinUrl, 'big');
      }
      flashScreen({ color: '#ffd700', alpha: 0.85, durMs: 400 });
      spawnConfetti(100);
      shakeBody(600);
      window.setTimeout(() => {
        showBonusBanner('big');
        jinSpeech.say('premium');
      }, 1300);
    },
    triggerRegular: () => {
      // レギュラーボーナス（すし＋別字）を強制発動。シルバー基調・短め
      bonusZone.trigger('reg');
      sfx.bonusEnter();
      const reg = yakuList.bonusYaku[0];
      if (reg) {
        showPremiumCutin(reg.name, reg.symbols, chapterCutinUrl, 'reg');
      }
      flashScreen({ color: '#cdd6e0', alpha: 0.75, durMs: 360 });
      spawnConfetti(60);
      shakeBody(400);
      window.setTimeout(() => {
        showBonusBanner('reg');
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
    triggerCutin: () => {
      // 現在の章のプレミアム役＋章カットイン画像でカットインを確認
      const premium = yakuList.premiumYaku[0] ?? yakuList.coreYaku[0];
      if (premium) {
        showPremiumCutin(premium.name, premium.symbols, chapterCutinUrl);
        flashScreen({ color: '#ffd700', alpha: 0.7, durMs: 320 });
        sfx.winCore();
      }
    },
    triggerAim: () => {
      // 狙え！予告を強制発動（applyEffect('aim') が showAimNotice を呼ぶ）
      applyEffect('aim');
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
      const label = bonusZone.kind.get() === 'reg' ? 'REG' : 'BIG';
      bonusStatusEl.hidden = false;
      bonusStatusEl.textContent = `${label} 残り${remaining}`;
      cabinetEl.classList.add('bonus');
      startBonusSparkle();
      // BGM 起動済みならボーナス曲へ。未起動なら placeBet 時に再生される。
      bgm.play('bonus');
    } else {
      bonusStatusEl.hidden = true;
      bonusStatusEl.textContent = '';
      cabinetEl.classList.remove('bonus');
      stopBonusSparkle();
      bgm.play('normal');
    }
  };
  bonusZone.active.subscribe(updateBonusUI);
  bonusZone.remaining.subscribe(updateBonusUI);
  bonusZone.kind.subscribe(updateBonusUI);
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
    hideAimNotice();
    quizState.reset();
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

  // 各リールの直近押下の精度＆滑り量（役成立時にビタ集計するため）
  const lastPressErrorMs: number[] = Array(REEL_COUNT).fill(Infinity);
  const lastSlipCells: number[] = Array(REEL_COUNT).fill(0);

  const placeBet = () => {
    if (betBtn.disabled) return;
    sfx.init(); // user gesture でオーディオ起動
    // BGM も最初の BET で起動（自動再生制限の回避）。再生中ならスキップ。
    bgm.init();
    bgm.play(bonusZone.isActive() ? 'bonus' : 'normal');
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
    // 未回答クイズはタイムアウト扱い（targetYakuId が null になり引き込み対象なし）。
    // クイズ正解時は targetYakuId の役が最終リール引き込み対象になる（17_assist-and-slip.md）。
    // 正解/不正解SE は quizState.phase.subscribe で一括して鳴らす
    quizState.finalizeIfUnanswered();
    // レバー押下でクイズUIは確実に閉じる（リールが見えるように）
    quizOverlay.dismiss();
    for (const engine of engines) engine.spin();
    flashButton(leverBtn);
    spawnButtonRipple(leverBtn, '#ffd700');
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

  /**
   * 役が現在の演出の引き込み対象カテゴリに合致するか（17_assist-and-slip.md）。
   *  - aim   → aimNoticeYaku（予告した役そのもの）
   *  - quiz  → 正解した役（targetYakuId、不正解/未回答なら対象なし）
   *  - shisa → core / cherry
   *  - none  → 対象なし（引き込みしない）
   */
  const effectAllowsYaku = (yaku: Yaku): boolean => {
    if (currentEffect === 'aim') {
      return aimNoticeYaku !== null && yaku.id === aimNoticeYaku.id;
    }
    if (currentEffect === 'quiz') {
      return yaku.id === quizState.targetYakuId();
    }
    if (currentEffect === 'shisa') {
      return yaku.category === 'core' || yaku.category === 'cherry';
    }
    return false;
  };

  /**
   * 蹴りで除外する「予告した役」ID。aim/quiz が premium/bonus を予告した時、その役は
   * 蹴らずに通す（予告役を優先）。それ以外の演出/役では null＝全 premium/bonus を蹴る対象。
   */
  const currentTargetYakuId = (): string | null => {
    if (currentEffect === 'aim') return aimNoticeYaku?.id ?? null;
    if (currentEffect === 'quiz') return quizState.targetYakuId();
    return null;
  };

  /** 引き込み優先のカテゴリ序列（premium > bonus > core > cherry） */
  const CAT_RANK: Record<Yaku['category'], number> = {
    premium: 3,
    bonus: 2,
    core: 1,
    cherry: 0,
  };

  /** 「狙え！」時、第1・第2停止で狙い役を中段へ軽く引き込む最大コマ数（最終リールの4コマより控えめ）。 */
  const AIM_HINT_MAX_CELLS = 2;

  /**
   * テンパイ成立ライン群（5ライン）から、演出の対象役に合う最良の引き込みコマ数を返す。
   * 優先順位: カテゴリ（premium>bonus>core>cherry）→ 引き込みが近い → 中段ライン。
   * 対象なし・窓外なら 0（引き込みしない）。
   */
  const pickAssistSlip = (
    lines: readonly TenpaiLine[],
    finalIdx: number,
    strip: ReelStrip,
    basePos: number,
  ): number => {
    let bestSlip = 0;
    let bestScore = -1; // 大きいほど優先
    for (const l of lines) {
      if (!effectAllowsYaku(l.yaku)) continue;
      const slip = slipResolver.resolveAssist(
        strip,
        basePos,
        l.yaku.symbols[finalIdx],
        l.vertical,
      );
      if (slip === null) continue;
      // slip は 0..4（ASSIST_MAX_CELLS）。近いほど高スコア。
      const score =
        CAT_RANK[l.yaku.category] * 100 +
        (4 - slip) * 4 +
        (l.vertical === 'middle' ? 1 : 0);
      if (score > bestScore) {
        bestScore = score;
        bestSlip = slip;
      }
    }
    return bestSlip;
  };

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
    // 引き込み/蹴りの決定（設計: 17_assist-and-slip.md）。
    //  1) 最終リール（他2リール停止済み）で演出の狙い役が5ラインのどこかにテンパイ
    //     → そのラインへ引き込み（最大4コマ・カテゴリ優先）
    //  2) 引き込みが効かない時 → 予告役以外の premium/bonus 偶然揃いを蹴る
    //     （core/cherry は蹴らない／予告した BIG・RB は通す）
    let slipCells = 0;
    const assistTenpai = tenpaiDetector.detect(stoppedVisibles);
    if (assistTenpai && assistTenpai.missingReelIndex === idx) {
      slipCells = pickAssistSlip(assistTenpai.lines, idx, engine.strip, basePos);
    } else if (currentEffect === 'aim' && aimNoticeYaku) {
      // 「狙え！」時の第1・第2停止：狙い役の文字を中段へ軽く引き込む（最大 AIM_HINT_MAX_CELLS コマ）。
      // 最終リールの4コマ引き込みより控えめ。窓外（2コマ超）なら引き込まず自力ミス扱い＝目押しの妙味は残す。
      const hint = slipResolver.resolveAssist(
        engine.strip,
        basePos,
        aimNoticeYaku.symbols[idx],
        'middle',
        AIM_HINT_MAX_CELLS,
      );
      if (hint !== null) slipCells = hint;
    }
    if (slipCells === 0) {
      slipCells = slipResolver.resolveKick({
        reelIndex: idx,
        basePosition: basePos,
        strip: engine.strip,
        stoppedVisibles,
        exceptYakuId: currentTargetYakuId() ?? undefined,
      });
    }

    const result = engine.stop(timestamp, slipCells);
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
    // ビタ押し成功時のみ、強めの金色リップル。それ以外は控えめな赤
    spawnButtonRipple(
      stopBtns[idx],
      result.errorMs <= BITA_MS ? '#ffd700' : '#ff5566',
    );

    // 第2停止後：テンパイ検出（5ライン）→ 残ったリールの枠フラッシュ＆SE
    const visAfter: (VisibleColumn | null)[] = engines.map((e) => {
      if (e.state.get() !== 'stopped') return null;
      return {
        top: getVisibleCell(e, 'top'),
        middle: getVisibleCell(e, 'middle'),
        bottom: getVisibleCell(e, 'bottom'),
      };
    });
    if (visAfter.filter((v) => v !== null).length === 2) {
      const tenpai = tenpaiDetector.detect(visAfter);
      if (tenpai) {
        // 実機準拠：テンパイ時もリール速度は変えない。枠フラッシュ＆SEのみ。
        views[tenpai.missingReelIndex].startTenpaiFlash(tenpai.hasPremium);
        if (tenpai.hasPremium) sfx.tenpaiPremium();
        else sfx.tenpai();
        jinSpeech.say('tenpai');
      }
    }

    if (engines.every((e) => e.state.get() === 'stopped')) {
      // 全停止したので「狙え！」演出は閉じる（レバーオン示唆として出た場合）
      hideAimNotice();
      // 5ペイライン（横3+斜め2）で全件判定。同じ役が複数ライン揃いも合算。
      const grid = extractGrid(engines);
      const middleSymbols = grid[1] as [string, string, string]; // 既存UI互換用
      const { hits } = judge.judgeAll(grid);
      const willHit = hits.length > 0;
      const premiumHit = hits.find((h) => h.yaku.category === 'premium') ?? null;
      const isPremium = premiumHit !== null;
      // レギュラー役（すし＋別字）。プレミアムが無いときだけ REG 扱い
      const bonusHit = hits.find((h) => h.yaku.category === 'bonus') ?? null;
      const isRegular = !isPremium && bonusHit !== null;
      // 成立後の連チャン数で配当倍率を評価（3連達成スピンから恩恵が乗る）
      const streakAfter = willHit ? playStats.stats.get().streak + 1 : 0;
      const streakMult = calc.streakMult(streakAfter);
      let win = calc.calcMulti(hits, bonusZone.isActive(), streakMult);
      // 「狙え！」予告役が実際に成立 → その役ライン分に達成ボーナスを上乗せ。
      let aimBonus = 0;
      const aimYaku = currentEffect === 'aim' ? aimNoticeYaku : null;
      if (aimYaku) {
        const aimHits = hits.filter((h) => h.yaku.id === aimYaku.id);
        aimBonus = calc.aimBonus(aimHits, bonusZone.isActive(), streakMult);
        win += aimBonus;
      }
      if (win > 0) wallet.win(win);

      playStats.recordSpin({
        bet: calc.bet,
        win,
        hit: willHit,
        premium: isPremium,
        bonusTriggered: isPremium || isRegular,
      });

      // 戦専用カウンタも同じ確定点で増分（計数で RunRecord に確定する）
      runSpinCount += 1;
      runTotalBet += calc.bet;
      runTotalWin += win;
      if (isPremium) runPremiumCount += 1;
      if (isRegular) runBonusCount += 1;

      // ビタ押し集計：役成立時のみ、貢献したリールごとに
      //   1) 押下精度 ≤ BITA_MS
      //   2) 滑り（蹴り）も引き込みも無く自力停止（slipCells == 0）
      // の両方を満たす時に +1。最大 +3。引き込みで揃えた分はビタ非カウント。
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
            // ミッション報酬も払い出しの一種として戦の totalWin（機械割の分子）に含める
            runTotalWin += c.reward;
            showMissionToast(c);
            sfx.bita(); // 短いキラーン音を流用
          }, i * 350);
        });
      }, 1500);

      if (willHit) {
        // 成立ラインインジケーターを点灯
        for (const h of hits) {
          leftIndicators.highlight(h.paylineId);
        }
        const cls = isPremium || isRegular ? 'premium' : 'win';
        const bonusTag = bonusZone.isActive() ? ' ×BONUS' : '';
        const streakTag = streakMult > 1 ? ` ×${streakMult}連` : '';
        const lineTag = hits.length > 1 ? ` (${hits.length}ライン)` : '';
        const aimTag = aimBonus > 0 ? ` ★狙え的中+${aimBonus}` : '';
        // 役名は重複なしで「みかん×2 ＋ すしや」のように要約
        const yakuLabel = summarizeHits(hits);
        showResult(`${yakuLabel}！ +${win}${bonusTag}${streakTag}${lineTag}${aimTag}`, cls);
        jinState.set('cheer');
        // 図鑑には揃ったユニーク役を全部記録
        const recorded = new Set<string>();
        for (const h of hits) {
          if (recorded.has(h.yaku.id)) continue;
          recorded.add(h.yaku.id);
          zukanState.record(h.yaku.id);
        }
        // 全リール中央セルをハイライト（グロー演出）
        for (const v of views) v.highlightCenter(1400);

        // 揃った役の構成 3 文字を、その役色でタイル統一する。
        // 共有文字の静的色衝突を避けて「役の 3 文字が同色」を成立瞬間に実現。
        // 複数ライン同時 HIT 時: premium > core の順で優先（同セルは先に書いた色が残る）。
        {
          const VERTICALS: readonly Vertical[] = ['top', 'middle', 'bottom'];
          const perReelIdxs = new Map<number, number[]>();
          const perReelColor = new Map<number, number>();
          const sortedHits = [...hits].sort((a, b) =>
            a.yaku.category === 'premium' && b.yaku.category !== 'premium'
              ? -1
              : b.yaku.category === 'premium' && a.yaku.category !== 'premium'
                ? 1
                : 0,
          );
          for (const h of sortedHits) {
            const color = colorResolver.colorForYakuId(h.yaku.id);
            if (color === null) continue;
            const line = PAYLINES.find((p) => p.id === h.paylineId);
            if (!line) continue;
            for (const [row, col] of line.cells) {
              const idx = getVisibleCellIndex(engines[col], VERTICALS[row]);
              if (!perReelIdxs.has(col)) {
                perReelIdxs.set(col, []);
                perReelColor.set(col, color);
              }
              perReelIdxs.get(col)!.push(idx);
            }
          }
          for (const [col, idxs] of perReelIdxs) {
            views[col].highlightCells(idxs, perReelColor.get(col)!, 1400);
          }
        }
        // コイン獲得 +N フロート表示
        if (win > 0) showCoinFloat(win, isPremium);
        // 大配当はコインバースト（プレミアム=多め / レギュラー=中程度）
        if (isPremium) showCoinBurst(28);
        else if (isRegular) showCoinBurst(16);
        else if (win >= 50) showCoinBurst(12);
        else if (win >= 24) showCoinBurst(5);
        // 狙え的中は配当の大小に関わらず、達成感のコインバーストを別途出す
        if (aimBonus > 0) showCoinBurst(10);
        // プレミアム成立でビッグボーナス突入＋全画面演出
        if (isPremium && premiumHit) {
          bonusZone.trigger('big');
          sfx.bonusEnter();
          showPremiumCutin(premiumHit.yaku.name, premiumHit.yaku.symbols, chapterCutinUrl, 'big');
          flashScreen({ color: '#ffd700', alpha: 0.85, durMs: 400 });
          spawnConfetti(100);
          shakeBody(600);
          window.setTimeout(() => {
            showBonusBanner('big');
            jinSpeech.say('premium');
          }, 1300);
        } else if (isRegular && bonusHit) {
          // レギュラーボーナス（すし＋別字）突入。シルバー基調・控えめ
          bonusZone.trigger('reg');
          sfx.bonusEnter();
          showPremiumCutin(bonusHit.yaku.name, bonusHit.yaku.symbols, chapterCutinUrl, 'reg');
          flashScreen({ color: '#cdd6e0', alpha: 0.75, durMs: 360 });
          spawnConfetti(60);
          shakeBody(400);
          window.setTimeout(() => {
            showBonusBanner('reg');
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
  // aimNoticeYaku は applyEffect より前に宣言（applyEffect の closure 内で
  // 参照するため、TDZ 回避目的で上に移動した）。下の applyEffect 定義前を参照。
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
    } else if (currentEffect === 'aim') {
      // 「狙え！」演出: applyEffect 時に決定された役を AUTO の狙い役にも採用
      autoTargetYaku = aimNoticeYaku;
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
    if (!autoAvailable) return;
    if (autoMode) stopAuto();
    else startAuto();
  });

  zukanBtn.addEventListener('click', () => zukanOverlay.toggle());
  settingsBtn.addEventListener('click', () => settingsOverlay.toggle());

  // === リール配列パネルの開閉（≤ 900px ではオーバーレイで開く） ===
  const reelStripPanel = document.getElementById('reel-strip-panel');
  const reelStripBtn = document.getElementById('reel-strip-btn');
  const reelStripClose = reelStripPanel?.querySelector<HTMLButtonElement>('.strip-close');
  const toggleReelStrip = () => {
    if (!reelStripPanel) return;
    const isOpen = reelStripPanel.classList.toggle('open');
    if (reelStripBtn) reelStripBtn.classList.toggle('on', isOpen);
  };
  reelStripBtn?.addEventListener('click', toggleReelStrip);
  reelStripClose?.addEventListener('click', () => {
    reelStripPanel?.classList.remove('open');
    reelStripBtn?.classList.remove('on');
  });

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
    bgm.init(); // mute トグルを user gesture として BGM も起動
    sfx.toggleMute();
    bgm.setMuted(sfx.isMuted());
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
      const tileUrl = tileUrlWithVer(idx, symbol);
      const plainUrl = tilePlainUrlWithVer(idx, symbol);
      if (tileUrl && plainUrl) {
        // 図柄画像をそのまま縮小表示。文字ON/OFF で文字あり/なし版を差し替え。
        cell.classList.add('has-art');
        cell.style.backgroundImage = `url("${reelGlyphsOn ? tileUrl : plainUrl}")`;
        stripGlyphCells.push({ el: cell, glyph: tileUrl, plain: plainUrl });
      } else {
        // 画像が無い章：従来の役単位カラー＋白文字
        cell.textContent = symbol;
        cell.style.background = colorResolver.cssFor(idx, symbol);
        cell.style.color = '#fff';
      }
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
      bgm.init();
      sfx.toggleMute();
      bgm.setMuted(sfx.isMuted());
      updateMuteUI();
      return;
    }
    if (key === 'o') {
      ev.preventDefault();
      if (!autoAvailable) return;
      if (autoMode) stopAuto();
      else startAuto();
      return;
    }
    if (key === ',') {
      ev.preventDefault();
      settingsOverlay.toggle();
      return;
    }
    if (key === 'r') {
      ev.preventDefault();
      toggleReelStrip();
      return;
    }
  });

  updateButtons();
}
