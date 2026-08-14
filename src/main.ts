import { Application, FillGradient, Graphics } from 'pixi.js';
import { ReelEngine } from './core/ReelEngine';
import { ReelView, CELL_WIDTH, CELL_HEIGHT, VISIBLE_CELLS, REEL_PEEK, FRAME_PAD } from './render/ReelView';
import { loadSymbolArt } from './render/ReelArt';
import { RunTimer } from './ui/RunTimer';
import { SymbolColorResolver } from './render/SymbolStyle';
import { YakuJudge } from './core/YakuJudge';
import { RoundResolver } from './core/RoundResolver';
import {
  createRoundContext,
  type RoundContext,
  type RoundSource,
} from './core/RoundContext';
import { PayoutCalc } from './core/PayoutCalc';
import { CoinWallet } from './core/CoinWallet';
import {
  EffectScheduler,
  REEL_BASE_SPEED,
  type EffectType,
} from './productions/EffectScheduler';
import { BonusZone } from './productions/BonusZone';
import { BonusSession } from './productions/BonusSession';
import { applySetting, applySettingToEffects } from './productions/MachineSetting';
import { settingForMachine } from './productions/HallPolicy';
import { recordSpin as recordMachineSpin } from './productions/MachineData';
import { drawEndScreen } from './productions/SettingHint';
import { EffectEligibility } from './productions/EffectEligibility';
import { SfxEngine } from './audio/SfxEngine';
import { BgmEngine } from './audio/BgmEngine';
import { TenpaiDetector } from './productions/TenpaiDetector';
import { PlayStats } from './productions/PlayStats';
import { appendRunRecord, RUN_RULESET_VERSION } from './productions/RunHistory';
import { getMemberId, getMemberName } from './productions/Member';
import { NearMissDetector } from './productions/NearMissDetector';
import {
  InternalRoleLottery,
  type InternalRoleResult,
} from './productions/InternalRoleLottery';
import {
  flashScreen,
  spawnConfetti,
  shakeBody,
  showPremiumCutin,
  type CutinBackdrop,
  showMultiHitBadge,
  startBonusSparkle,
  stopBonusSparkle,
  spawnButtonRipple,
  showAimNotice,
  hideAimNotice,
  showShisaNotice,
  hideShisaNotice,
  setEffectHost,
  showDelay,
  showEntryCharge,
  showFreezeBanner,
  clearFreezeBanner,
  showRankUpBadge,
} from './ui/Effects';
import { JinSpeech, type JinSpeechEvent } from './ui/JinSpeech';
import { ChallengeTracker } from './productions/Challenges';
import { showMissionToast } from './ui/MissionToast';
import { SettingsOverlay } from './ui/SettingsOverlay';
import { JinState } from './productions/JinState';
import { JinView } from './render/JinView';
import { EffectVisual } from './render/EffectVisual';
import { QuizState } from './productions/QuizState';
import { QuizQuestionView } from './render/QuizQuestionView';
import { ZukanState } from './productions/ZukanState';
import { ZukanOverlay } from './ui/ZukanOverlay';
import { SlipResolver, type VisibleColumn } from './productions/SlipResolver';
import { StopTableLookup } from './core/StopTable';
import { StopController } from './core/StopController';
import { ReachEyes } from './core/ReachEyes';
import {
  extractGrid,
  getVisibleCell,
  getVisibleCellIndex,
  PAYLINES,
  primaryRowOf,
  type Vertical,
} from './core/Paylines';
import { PaylineIndicators } from './render/PaylineIndicators';
import {
  ReelConfigSchema,
  YakuListSchema,
  PayoutSchema,
  QuizListSchema,
  StopTableSchema,
  ReachEyeTableSchema,
  TuningSchema,
  type Yaku,
  type ShisaTier,
  type ShisaTierColor,
  type InternalRoleState,
} from './data/schemas';
import payoutDataRaw from '../data/payouts/default.json';
import tuningDataRaw from '../data/tuning/default.json';
import packageMeta from '../package.json';
import {
  CHAPTERS,
  getCurrentChapter,
  isSecretUnlocked,
  setSecretUnlocked,
} from './data/chapters';
import {
  chapterIdOfMachine,
  getCurrentMachine,
  isTrialMachine,
} from './data/machines';
import './style.css';

const REEL_GAP = 16;
const REEL_COUNT = 3;
// デバッグ等で明示指定できる演出。
type ForcedEffect = Exclude<EffectType, 'none'>;
const CANVAS_W = 600;
const CANVAS_H = 732;
// 液晶エリア（演出液晶＋マスコット領域）の高さ。
// リール領域 = CANVAS_H - LIQUID_AREA_H = 上下チラ見せ(REEL_PEEK*2) + 中央3コマ(300) + 枠余白(FRAME_PAD*2)。
// 隣の図柄を上下に覗かせる。図柄と金枠の線の間には FRAME_PAD の黒余白を挟む（被り防止）。
// 上部の空間にカットイン・演出を表示し、ジンはリール際（下部）に立たせる。
const LIQUID_AREA_H =
  CANVAS_H - (CELL_HEIGHT * VISIBLE_CELLS + REEL_PEEK * 2 + FRAME_PAD * 2);

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

  // 打つ台はホール（HallView）で確定済み。章は台から引くので両者がずれない。
  const machine = getCurrentMachine();
  const chapterId = chapterIdOfMachine(machine);
  const chapter = CHAPTERS.find((c) => c.id === chapterId) ?? getCurrentChapter();

  // 島ごとのアート（public/art/）。
  // ※ body の島背景パネルは一旦オフ（必要になったら has-chapter-bg を復活させる）。
  const ART_BASE = `${import.meta.env.BASE_URL}art/`;

  const reelConfig = ReelConfigSchema.parse(chapter.reelData);
  // 設定（1〜6）はその日その台で決まる。プレイヤーには見せず、
  // データと示唆演出から推測させる（設計: MachineSetting）。
  // **章ではなく台ごと**。同じ島の4台が同じ設定だと、台を選び分ける意味が消える。
  const machineSetting = settingForMachine(machine, new Date());
  const yakuList = applySetting(
    YakuListSchema.parse(chapter.yakuData),
    machineSetting,
  );
  const payout = PayoutSchema.parse(payoutDataRaw);
  const quizList = QuizListSchema.parse(chapter.quizData);
  // 停止テーブル（第1停止＝実機のリール制御表）。手編集可・無ければ既定制御へフォールバック。
  const stopTable = new StopTableLookup(StopTableSchema.parse(chapter.stopData));
  // リーチ目表（ボーナスフラグでしか出ない出目）。持ち越し中の察知に使う。
  const reachEyes = new ReachEyes(
    ReachEyeTableSchema.parse(chapter.reachData),
    yakuList,
  );
  // 演出レート・補助・フリーズ等の調整値（散在していた定数を集約）。data/tuning/default.json。
  const tuning = TuningSchema.parse(tuningDataRaw);
  /**
   * 設定を適用した演出レート。**設定差の主役はここ**（MachineSetting の NONE_MULTIPLIER）。
   * 高設定ほど無演出が減り、何を狙えばよいか分かるゲームが増える＝取りこぼしが減る。
   * ボーナス中は none が0なので差が出ない（引いた後の性能は設定で変えない）。
   */
  const effectRates = {
    default: applySettingToEffects(tuning.effectRates.default, machineSetting),
    rescue: applySettingToEffects(tuning.effectRates.rescue, machineSetting),
    bonus: tuning.effectRates.bonus,
  };
  // 役の id → 役オブジェクトの逆引き（AUTO のターゲット解決などで使う）
  const allYakusFlat = [
    ...yakuList.coreYaku,
    ...yakuList.premiumYaku,
    ...yakuList.bonusYaku,
    ...yakuList.cherryYaku,
  ];
  /** 内部役テーブル（停止テーブルのキー解決に使う）。 */
  const allRolesFlat = yakuList.internalRoles;

  const judge = new YakuJudge(yakuList);
  const calc = new PayoutCalc(payout);
  // 全停止時の「何が揃って何枚か」の確定。表示・音は含まない純粋な計算。
  const roundResolver = new RoundResolver({
    judge,
    calc,
    reachEyes,
    singlePayout: payout.baseMultiplier.single,
    bitaMultiplier: payout.bitaMultiplier,
  });
  const wallet = new CoinWallet(payout.initialCoins);
  const scheduler = new EffectScheduler(effectRates.default);
  const jinState = new JinState();
  const quizState = new QuizState();
  const slipResolver = new SlipResolver(yakuList, {
    assistMaxCells: tuning.assist.pullInCells,
  });
  const bonusZone = new BonusZone({
    spinsPerBonus: tuning.bonus.spinsPerBig,
    spinsPerReg: tuning.bonus.spinsPerReg,
    bonusEffectRates: effectRates.bonus,
  });
  // 突入〜消化しきりの区間管理（獲得集計・おかわり判定・締め）は BonusSession が持つ。
  const bonusSession = new BonusSession(bonusZone);
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
    {
      premium: payout.baseMultiplier.premium,
      bonus: payout.baseMultiplier.bonus,
      cherry: payout.baseMultiplier.cherry,
      spinsPerBig: tuning.bonus.spinsPerBig,
      spinsPerReg: tuning.bonus.spinsPerReg,
    },
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
    tuning.reelSpeed,
    tuning.motionBlurStrength,
  );
  // 設定で速度を変えたら、回転中のリールにも即反映する（体感を比べやすくする）
  settingsOverlay.setReelSpeedListener((speed) => {
    for (const e of engines) {
      if (e.state.get() === 'spinning' && !freezeActive) e.setSpeed(speed);
    }
  });
  // 滑り/引き込み（17_assist-and-slip.md）：演出時は最終リールで狙い役を最大4コマ引き込む
  // （resolveAssist）。引き込まない時は、予告役以外の premium/bonus 偶然揃いを蹴る
  // （resolveKick・全演出で作用、予告した BIG/RB は通す）。
  // 現在のスピンの effect 種別（AUTO がターゲット決定に使う）
  let currentEffect: EffectType = 'none';
  // レバーONで確定し、全停止まで保持する内部役と演出の正本。
  let currentRound: RoundContext | null = null;
  let roundNumber = 0;
  /** このスピンでリールを停止させた順（押し順役の判定に使う）。レバーONで空に戻す。 */
  let stopOrder: number[] = [];
  // 現在の示唆の期待度tier（青/黄/緑/赤/金）。applyEffect('shisa')で抽選、他演出ではnull。
  let currentShisaTier: ShisaTier | null = null;
  /** 示唆が「狙え！」へ発展済みか（1ゲーム1回だけ発展させる）。 */
  let shisaEscalated = false;
  /** このゲームで既にリーチ目告知を出したか（1ゲーム1回）。 */
  let reachEyeShown = false;

  // === フリーズ演出の状態 ===
  // freezeActive: シーケンス中は全ユーザー入力をブロックし、stopReel の引き込み/蹴りも無効化する。
  // pendingFreeze: デバッグボタンで「次のレバーでフリーズ」を予約するフラグ。
  let freezeActive = false;
  let pendingFreeze = false;
  /** 遅れの「間」の最中。まだどのリールも回っていないのでレバーとBETを塞ぐ。 */
  let spinPending = false;
  // レバーオン時のフリーズ抽選確率（通常時のみ）／倍速回転スピード。data/tuning で調整。
  const FREEZE_SPIN_SPEED = tuning.freeze.spinSpeed;

  /**
   * リール速度（コマ/秒）。data/tuning が既定で、設定モーダルから上書きできる（体感比較用）。
   * ReelView のモーションブラーはこの速度に比例して強くなる。
   * 速いほど 1コマの通過時間（1000/speed ms）が短く、目押しはシビアになる。
   */
  const REEL_SPEED_KEY = 'mojislot.reelSpeed.v1';
  const reelSpeed = (): number => {
    const saved = Number(localStorage.getItem(REEL_SPEED_KEY));
    return Number.isFinite(saved) && saved > 0 ? saved : (tuning.reelSpeed ?? REEL_BASE_SPEED);
  };

  // === 確定告知ランプの状態 ===
  // 点灯中（announcedBonus !== null）はボーナス確定。種別は内部確定だが UI 上は伏せる。
  // 点灯中は他演出を 'none' 固定、各リールは確定役の図柄へ強く引き込む（目押しで揃えに行く）。
  let announcedBonus: 'big' | 'reg' | null = null;
  // 確定告知ランプで狙う具体的な役。resolveStopSlip と AUTO(setupAutoTarget) で共用し、
  // 全リール（第1・第2・最終）を同じ役の図柄へ引き込む。確定ランプは種別を最終リールまで伏せる
  // 演出のため共通プレフィックスの [0] 役に固定（例: BIG=すしや / REG=すしず は左中「す・し」共通）。
  let announcedRole: Yaku | null = null;
  /**
   * こぼしたボーナスフラグの持ち越し（実機Aタイプ）。演出も告知も出ないので、
   * プレイヤーは**出目（リーチ目）**で察知して自力で揃えに行く。
   * 確定告知ランプ（announcedBonus）は「告知あり」の持ち越しで、こちらは無告知。
   */
  let heldBonusYaku: Yaku | null = null;
  /** 持ち越しが始まってからのゲーム数（リーチ目の演出判定に使う）。 */
  let heldBonusSpins = 0;

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

  // 確定告知ランプ（GOGOランプ風）。点灯=ボーナス確定・種別は伏せて「?」表示。
  const announceLampEl = document.createElement('div');
  announceLampEl.id = 'announce-lamp';
  announceLampEl.hidden = true;
  announceLampEl.innerHTML = `<div class="lamp-dome"></div><div class="lamp-text">確定</div><div class="lamp-kind">?</div>`;
  requireEl('game-area').appendChild(announceLampEl);

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
  // 3コマはリール領域の中央。上下に REEL_PEEK（チラ見せ）＋ FRAME_PAD（枠余白）分を残す。
  const reelY = LIQUID_AREA_H + REEL_PEEK + FRAME_PAD;

  // 役単位のカラー解決：同じ役の3文字（左/中/右）が同じ色になる
  const colorResolver = new SymbolColorResolver(yakuList);

  /**
   * カットインの背景。役が `cutinArt` を持っていればその一枚絵、無ければ役色から
   * 手続き生成する（放射グロー＋奥に沈めた役名）。
   *
   * 以前は「主役＝島の一枚絵、バー役＝専用絵」と**役の位置**で暗黙に決めていた。
   * これだと役を差し替えた時に絵だけ前の役のまま残る（いなり成立で握り寿司が出る）。
   * 役が自分の絵を名指しする形にすると、書かなかった役は自動で生成側へ落ちる。
   */
  const cutinBackdropFor = (yaku: Yaku): CutinBackdrop => ({
    accent: colorResolver.cssForYakuId(yaku.id),
    imageUrl: yaku.cutinArt ? `${ART_BASE}${yaku.cutinArt}` : undefined,
  });

  // 章ごとの図柄画像（あれば）を読み込む。画像が無い章・plain設定・読込失敗時は空マップが返り、
  // ReelView も右の配列表も従来の色タイル＋文字にフォールバックする（詳細は render/ReelArt.ts）。
  const {
    textures: symbolTextures,
    texturesPlain: symbolTexturesPlain,
    tileUrlWithVer,
    tilePlainUrlWithVer,
  } = await loadSymbolArt(chapterId, yakuList, ART_BASE);
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

  // コマ番号（0..20）の表示。デバッグ表示ONの時だけ出す。
  // 押した位置と停止位置の差＝引き込みコマ数を、画面上で数えられるようにする。
  for (const v of views) v.setShowCellIndices(debugVisible);

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
  let pendingDebugEffect: ForcedEffect | null = null;
  /** デバッグ：次のレバーで強制する内部役（ボーナスのおかわり確認用）。 */
  let pendingForcedRole: InternalRoleResult | null = null;
  /** デバッグ：次のレバーで遅れを強制する。抽選と条件を飛ばして見た目だけ確認する。 */
  let pendingForcedDelay = false;
  let autoMode = false;
  /** AUTOをOFFにした後、現在ゲームを全停止まで消化している最中か。 */
  let autoFinishing = false;

  const internalRoleLottery = new InternalRoleLottery(yakuList, Math.random);

  // 示唆の期待度tier色 → 画面tint(hex) / ジンの煽り台詞。
  const SHISA_TINT: Record<ShisaTierColor, number> = {
    blue: 0x66ccff,
    green: 0x4ade80,
    red: 0xff3b30,
    gold: 0xffcc33,
    rainbow: 0xff66cc,
  };
  const SHISA_SPEECH: Record<ShisaTierColor, JinSpeechEvent> = {
    blue: 'shisaWeak',
    green: 'shisaWeak',
    red: 'shisaBonus',
    gold: 'shisaPremium',
    rainbow: 'shisaPremium',
  };
  interface EffectOptions {
    targetYaku?: Yaku | null;
    shisaTier?: ShisaTier | null;
    /** 示唆で「この色なら当たりうる」役の一覧（吹き出しに並べて迷わせる）。 */
    shisaCandidates?: readonly Yaku[];
  }

  const applyEffect = (effect: EffectType, options: EffectOptions = {}) => {
    currentEffect = effect;
    for (const engine of engines) engine.setSpeed(reelSpeed());

    // 示唆tierも内部役に対応する候補からactivateRoundで確定済み。
    currentShisaTier = effect === 'shisa' ? (options.shisaTier ?? null) : null;
    effectVisual.apply(
      effect,
      currentShisaTier ? SHISA_TINT[currentShisaTier.color] : undefined,
    );

    effectStatusEl.classList.remove(
      'shisa',
      'quiz',
      'aim',
      'tier-blue',
      'tier-green',
      'tier-red',
      'tier-gold',
      'tier-rainbow',
    );
    if (effect === 'shisa' && currentShisaTier) {
      effectStatusEl.textContent = '示唆';
      effectStatusEl.classList.add('shisa', `tier-${currentShisaTier.color}`);
      jinState.set('shisa');
      sfx.shisa();
      jinSpeech.say(SHISA_SPEECH[currentShisaTier.color]);
      // 示唆はカテゴリしか示さない＝候補を全部並べて「どれかな…？」と迷わせる。
      // 第1・第2停止で内部役の図柄が中段に来たら escalateShisa() が「狙え！」へ発展させる。
      const cands = options.shisaCandidates ?? [];
      if (cands.length > 0) {
        showShisaNotice({
          color: currentShisaTier.color,
          candidates: cands.map((y) => ({
            name: y.name,
            symbols: y.symbols,
            colors: y.symbols.map((s, i) => colorResolver.cssFor(i, s)),
          })),
        });
      }
    } else if (effect === 'quiz') {
      effectStatusEl.textContent = 'クイズ';
      effectStatusEl.classList.add('quiz');
      jinState.set('quiz');
      // 回答操作なし方式：まず問題だけを出し、答えの役を引き込み対象にする（操作はaim相当）。
      // 答えと成立結果は全停止後に QuizState.resolve() で表示する。
      const quiz = options.targetYaku
        ? quizList.quizzes.find((q) => q.answerYakuId === options.targetYaku?.id)
        : null;
      if (quiz) quizState.reveal(quiz, yakuList);
      sfx.quiz();
    } else if (effect === 'aim') {
      effectStatusEl.textContent = '狙え！';
      effectStatusEl.classList.add('aim');
      jinState.set('shisa');
      // レバーONで決めた内部役をそのまま予告する。aimは候補選定時点で3文字役に限定済み。
      const targetYaku = options.targetYaku;
      if (!targetYaku) return;
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
        reelTopYFrac: reelY / CANVAS_H,
      });
      sfx.shisa(); // 既存の示唆 SE を流用
      jinSpeech.say('shisa');
    } else {
      effectStatusEl.textContent = '通常';
      jinState.set('idle');
    }
  };
  applyEffect('none');

  // 演出が本当の内部役を表せるかの判定と、示唆が示す候補役の逆算。
  const eligibility = new EffectEligibility({
    yakuList,
    quizzes: quizList.quizzes,
    shisaTiers: tuning.assist.shisaTiers,
    reelCount: REEL_COUNT,
  });

  const activeInternalRoleState = (): InternalRoleState => {
    if (bonusSession.spinActive) return 'bonus';
    if (playStats.stats.get().missStreak >= tuning.rescueMissThreshold) {
      return 'rescue';
    }
    return 'default';
  };

  /**
   * この1ゲームで遅れを出すか。**ハズレ（miss）と1枚役（single）では出さない**ので、
   * 遅れたら必ず何かが当たっている。率はボーナスへ寄せてあり「濃厚だが確定ではない」。
   *
   * **無演出のゲームでだけ出す。** 演出が出ているならボーナスかどうかは色や役名ですでに
   * 分かっている（赤・金・虹はすべてボーナスを指す）ので、遅れを重ねても情報が増えない。
   * むしろ青示唆（小役）に遅れが重なると「ボーナス濃厚」と「小役です」が同時に出て読みにくい。
   *
   * 通常の抽選（`source === 'lottery'`）でだけ出す。他の経路はどれも遅れの意味を壊す。
   * - **ボーナス中**: 毎ゲーム当選しているので「何かある」が情報にならない（none=0 なので
   *   そもそも無演出が無い）
   * - **持ち越し中**: 同じボーナス役を毎ゲーム引き直すため、遅れが数百ゲーム鳴り続ける。
   *   そもそも持ち越しは無告知でリーチ目から読む設計（[27章]）なので、告知したら台無し
   * - **確定告知ランプ点灯中**: すでにボーナスが分かっており足す情報が無い
   * - **フリーズ**: 別系統の強演出なので重ねない
   */
  const rollDelay = (round: RoundContext | null): boolean => {
    if (!round || round.source !== 'lottery') return false;
    if (round.effect !== 'none') return false;
    if (bonusZone.isActive()) return false;
    const role = round.internalRole;
    const rate = tuning.delay.rate;
    const p =
      role.kind === 'core'
        ? rate.core
        : role.kind === 'cherry'
          ? rate.cherry
          : role.kind === 'reg'
            ? rate.reg
            : role.kind === 'big'
              ? rate.big
              : 0; // miss / single
    return Math.random() < p;
  };

  const activateRound = (
    role: InternalRoleResult,
    effect: EffectType,
    source: RoundSource,
    reuseRoundNumber = false,
  ) => {
    const yaku = internalRoleLottery.yakuFor(role);
    const shisaTier =
      effect === 'shisa' && yaku ? eligibility.pickTier(yaku, Math.random) : null;
    const nextRoundNumber =
      reuseRoundNumber && currentRound ? currentRound.roundNumber : ++roundNumber;
    currentRound = createRoundContext({
      roundNumber: nextRoundNumber,
      internalRole: role,
      effect,
      source,
      bonusActive: bonusSession.spinActive,
    });
    if (debugVisible) {
      cabinetEl.dataset.internalRole = `${role.kind}:${role.yakuId ?? '-'}`;
    }
    shisaEscalated = false;
    reachEyeShown = false;
    applyEffect(effect, {
      targetYaku: yaku,
      shisaTier,
      shisaCandidates: shisaTier
        ? eligibility.candidatesFor(shisaTier, activeInternalRoleState())
        : undefined,
    });
  };

  const drawDebugRole = (effect: ForcedEffect): InternalRoleResult =>
    internalRoleLottery.draw(activeInternalRoleState(), {
      allowMiss: false,
      // デバッグ強制は「その演出で表現できる表示役を持つ内部役」だけに絞る（1枚役は除外）。
      roleFilter: (_role, yaku) =>
        yaku !== null && eligibility.canRepresent(effect, yaku),
    });

  const forceDebugEffect = (effect: ForcedEffect, label: string) => {
    const anySpinning = engines.some((engine) => engine.state.get() === 'spinning');
    if (!anySpinning) {
      pendingDebugEffect = effect;
      showResult(`${label}を次のレバーに予約`, 'win');
      return;
    }
    const role = drawDebugRole(effect);
    activateRound(role, effect, 'debug', true);
    if (autoMode) setupAutoTarget();
  };

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
  // recordSpin の確定フックで増分し、計数（count-btn）でスナップショット→0リセット。
  let runStartedAt = Date.now();
  let runSpinCount = 0;
  let runTotalBet = 0;
  let runTotalWin = 0;
  let runPremiumCount = 0;
  let runBonusCount = 0;
  // 演出率の材料。台のデータカウンターは日替わりで捨てるので、戦の記録として
  // 残すにはここで別に数える必要がある（母数は通常時のみ＝カウンターと同じ規則）。
  let runNormalSpins = 0;
  let runEffectSpins = 0;
  let runAutoUsed = false;
  let runReelSpeedMin = Infinity;
  let runReelSpeedMax = -Infinity;
  const recordRunSpeed = (speed: number) => {
    if (!Number.isFinite(speed) || speed <= 0) return;
    runReelSpeedMin = Math.min(runReelSpeedMin, speed);
    runReelSpeedMax = Math.max(runReelSpeedMax, speed);
  };

  // 計数＝この戦を締める：spinCount>0 なら1戦を RunHistory に確定記録し、持メダルを流す(0に)＋投資/戦カウンタをリセット。
  document.getElementById('count-btn')?.addEventListener('click', () => {
    // 計数=この戦の区切り。計測中なら自動停止（sahmai が0に戻り時速が誤って跳ねるのを防ぐ）。
    // ※ runTimer は下方で生成（このハンドラはクリック時=bootstrap完了後に走るので参照は安全）
    runTimer.stop();
    const investment = wallet.investmentTotal.get();
    const payback = wallet.coins.get();
    // 空打ち（1回も回さず計数）は機械割が算出不能なので記録しない＝離脱は破棄に準ずる
    if (runSpinCount > 0) {
      appendRunRecord({
        runId: crypto.randomUUID(),
        memberId: getMemberId(),
        memberName: getMemberName(),
        chapterId,
        machineId: machine.id,
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
        normalSpins: runNormalSpins,
        effectSpins: runEffectSpins,
        appVersion: packageMeta.version,
        buildId: __BUILD_ID__,
        rulesetVersion: RUN_RULESET_VERSION,
        reelSpeedMin: Number.isFinite(runReelSpeedMin) ? runReelSpeedMin : reelSpeed(),
        reelSpeedMax: Number.isFinite(runReelSpeedMax) ? runReelSpeedMax : reelSpeed(),
        autoUsed: runAutoUsed,
        missionsEnabled: challengeTracker.enabled.get(),
        debugEnabled: debugVisible,
        trialPlay: isTrialMachine(machine),
      });
    }
    wallet.reset(0);
    runStartedAt = Date.now();
    runSpinCount = 0;
    runTotalBet = 0;
    runTotalWin = 0;
    runPremiumCount = 0;
    runBonusCount = 0;
    runNormalSpins = 0;
    runEffectSpins = 0;
    runAutoUsed = false;
    runReelSpeedMin = Infinity;
    runReelSpeedMax = -Infinity;
  });

  // 戦の計測タイマー（サンド下部）。フリー=カウントアップ／プリセット分数=カウントダウン。
  // 詳細は ui/RunTimer.ts。計数(count-btn)で締める時に runTimer.stop() を呼ぶ。
  const runTimer = new RunTimer(wallet);

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
  // 連チャン昇格演出: オーラ4段の見た目用しきい値（配当の streakTiers とは独立のビジュアル）。
  // 段が上がった瞬間にランクアップ演出(フラッシュ＋紙吹雪＋SE)を出す。12連以上は最上段で表現。
  const STREAK_TIER_THRESHOLDS = [2, 5, 8, 12];
  const STREAK_TIER_CLASS = ['streak-aura', 'streak-aura-hot', 'streak-aura-fever', 'streak-aura-max'];
  const STREAK_TIER_COLOR = ['#ffd700', '#ff8a00', '#ff3366', '#c060ff'];
  const streakTierOf = (s: number) => STREAK_TIER_THRESHOLDS.filter((th) => s >= th).length; // 0..4
  let prevStreakTier = 0;
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
    const tier = streakTierOf(streak);
    cabinetEl.classList.remove(...STREAK_TIER_CLASS);
    if (tier >= 1) cabinetEl.classList.add(STREAK_TIER_CLASS[tier - 1]);
    // 昇格した瞬間（段が上がった時）にランクアップ演出
    if (tier > prevStreakTier && tier >= 1) {
      const color = STREAK_TIER_COLOR[tier - 1];
      flashScreen({ color, alpha: 0.45, durMs: 340 });
      spawnConfetti(18 + tier * 16);
      sfx.winMulti(Math.min(5, tier + 1));
      showRankUpBadge(streak, color);
    }
    prevStreakTier = tier;
  };
  playStats.stats.subscribe((s) => updateStreakUI(s.streak));
  updateStreakUI(playStats.stats.get().streak);

  // ハマり救済バッジ
  const updateRescueUI = (missStreak: number) => {
    if (missStreak >= tuning.rescueMissThreshold) {
      rescueStatusEl.hidden = false;
      rescueStatusEl.textContent = `救済 +${missStreak - tuning.rescueMissThreshold}`;
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

  /**
   * ボーナス突入の全画面演出（カットイン＋フラッシュ＋紙吹雪＋シェイク→バナー）。
   * 実突入（溜め経由）とデバッグ突入の両方から共通で呼ぶ（重複排除）。
   */
  const showBonusEntryFx = (yaku: Yaku, kind: 'big' | 'reg') => {
    sfx.bonusEnter();
    showPremiumCutin(yaku.name, yaku.symbols, cutinBackdropFor(yaku), kind);
    flashScreen({
      color: kind === 'reg' ? '#cdd6e0' : '#ffd700',
      alpha: kind === 'reg' ? 0.75 : 0.85,
      durMs: kind === 'reg' ? 360 : 400,
    });
    spawnConfetti(kind === 'reg' ? 60 : 100);
    shakeBody(kind === 'reg' ? 400 : 600);
    window.setTimeout(() => {
      showBonusBanner(kind);
      jinSpeech.say('premium');
    }, 1300);
  };

  // === デバッグアクション（設定モーダルから呼ばれる） ===
  settingsOverlay.setDebugActions({
    triggerBonus: () => {
      // デバッグ：代表的なプレミアム役名で BIG 突入演出を確認（溜めは省略・即演出）。
      // 実戦と同じく区間として開始するので、消化しきれば終了リザルトも出る。
      bonusSession.enter('big');
      const premium = yakuList.premiumYaku[0];
      if (premium) showBonusEntryFx(premium, 'big');
    },
    triggerRegular: () => {
      // デバッグ：レギュラーボーナス（すし＋別字）を強制発動（シルバー基調）
      bonusSession.enter('reg');
      const reg = yakuList.bonusYaku[0];
      if (reg) showBonusEntryFx(reg, 'reg');
    },
    triggerShisa: () => {
      forceDebugEffect('shisa', '示唆');
    },
    triggerQuiz: () => {
      // 停止中は次レバーへ予約し、回転中は内部役ごと現在ゲームへ差し替える。
      forceDebugEffect('quiz', 'クイズ');
    },
    triggerCutin: () => {
      // 現在の章のプレミアム役＋章カットイン画像でカットインを確認
      const premium = yakuList.premiumYaku[0] ?? yakuList.coreYaku[0];
      if (premium) {
        showPremiumCutin(premium.name, premium.symbols, cutinBackdropFor(premium));
        flashScreen({ color: '#ffd700', alpha: 0.7, durMs: 320 });
        sfx.winCore();
      }
    },
    triggerAim: () => {
      forceDebugEffect('aim', '狙え演出');
    },
    // 「次のレバーで◯◯」系は**予約するだけ**で、BET とレバーは打ち手が自分で入れる。
    // 以前は待機中なら自動で BET→レバーまで進めていたが、押した瞬間に回り出すので
    // レバーONの瞬間に起きること（遅れ・フリーズ）を見る前に通り過ぎてしまう。
    triggerNextBonusFlag: (kind: 'big' | 'reg') => {
      // 次のレバーでBIG/REGの内部役を強制する。ボーナス中に押せばおかわりの確認になる。
      // 素の抽選ではボーナス中のBIGが1/1981（BIG18Gで0.9%）で、まず引けないため。
      const yaku =
        kind === 'big' ? yakuList.premiumYaku[0] : yakuList.bonusYaku[0];
      if (!yaku) return;
      pendingForcedRole = internalRoleLottery.forYaku(yaku);
      showResult(`${yaku.name}フラグを次のレバーに予約`, 'win');
    },
    triggerNextDelay: () => {
      // 次のレバーで遅れを強制する。素の出現率は 1/214 かつ無演出のゲーム限定なので、
      // 見た目と長さの確認には引くのを待っていられない。
      pendingForcedDelay = true;
      showResult('遅れを次のレバーに予約', 'win');
    },
    triggerFreeze: () => {
      // 次のレバーでフリーズ発動を予約。
      pendingFreeze = true;
    },
    triggerAnnounceLamp: () => {
      // 確定告知ランプを即点灯（種別は内部抽選＝伏せ）。以降、目押しで揃えに行くと回収。
      if (!announcedBonus && !bonusZone.isActive() && !freezeActive) {
        announceBonus();
        const anySpinning = engines.some((engine) => engine.state.get() === 'spinning');
        if (anySpinning && announcedRole) {
          activateRound(
            internalRoleLottery.forYaku(announcedRole),
            'none',
            'announce',
            true,
          );
          if (autoMode) setupAutoTarget();
        }
      }
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
      // 区間中は BIG/REG を区別せず「ボーナス中」に統一（おかわりは同じ残り回数に合算され、
      // 種別を出すと BIG 中の RB おかわりで表示が揺れて紛らわしいため）。
      // BIG/REG の差は突入カットイン（金/銀）と終了リザルトで出す。
      bonusStatusEl.hidden = false;
      bonusStatusEl.textContent = `ボーナス中 残り${remaining}`;
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

    betBtn.disabled =
      anySpinning || spinPending || !wallet.canBet(calc.bet) || betPlaced;
    leverBtn.disabled = !betPlaced || anySpinning || allStopped || spinPending;
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

  // === ボーナス終了リザルト（獲得枚数＋ファンファーレ）===
  // 区間の集計そのものは BonusSession が持つ。ここは締めの演出だけ。
  const showBonusResult = (payout: number, kind: 'big' | 'reg') => {
    const label = kind === 'reg' ? 'REG BONUS' : 'BIG BONUS';
    // 終了画面で設定を示唆する（実機でいちばん定番の示唆手法）。
    // データは「引けたか」しか映さないので短時間だと運に埋もれる。
    // ここは別経路の情報で、1回のボーナスで一気に確度が上がることがある。
    const endScreen = drawEndScreen(machineSetting, Math.random);
    const hint = endScreen.label ? `　${endScreen.label}` : '';
    showResult(`${label} 終了  獲得 +${payout}枚${hint}`, 'premium');
    sfx.winMulti(kind === 'reg' ? 2 : 4); // 既存ファンファーレを締めに流用
    // 示唆が出た時だけ画面の色を変える＝「何か出た」と気づける
    const flashColor =
      endScreen.kind === 'max'
        ? '#b06bff'
        : endScreen.kind === 'high'
          ? '#ffd700'
          : endScreen.kind === 'even'
            ? '#6ee0d0'
            : // 奇数示唆は偶数と別色にする。同じ色だと「月が出た」までしか
              // 伝わらず、6が消えたのか残ったのかが読めない
              endScreen.kind === 'odd'
              ? '#f0a860'
              : kind === 'reg'
              ? '#cdd6e0'
              : '#ffd700';
    flashScreen({ color: flashColor, alpha: 0.6, durMs: 380 });
    spawnConfetti(kind === 'reg' ? 40 : 80);
    if (endScreen.kind !== 'normal') {
      // 示唆つきは余韻を足す。強いほど派手に。
      const extra = endScreen.kind === 'max' ? 90 : endScreen.kind === 'high' ? 50 : 30;
      window.setTimeout(() => spawnConfetti(extra), 260);
      shakeBody(endScreen.kind === 'max' ? 520 : 260);
    }
    jinSpeech.say('premium');
  };

  // ボーナス中の再当選（おかわり）= 残り回数に加算（上乗せ）。突入演出より軽い演出で伝える。
  const showBonusAdd = (spins: number, kind: 'big' | 'reg') => {
    showResult(`上乗せ！ +${spins}スピン`, 'premium');
    sfx.winMulti(3); // 既存ファンファーレを上乗せ用に流用
    flashScreen({ color: kind === 'reg' ? '#cdd6e0' : '#ffe680', alpha: 0.7, durMs: 320 });
    spawnConfetti(50);
    jinSpeech.say('premium');
  };

  const resetForNextSpin = () => {
    betPlaced = false;
    bonusSession.resetSpin();
    currentRound = null;
    if (debugVisible) delete cabinetEl.dataset.internalRole;
    for (const engine of engines) engine.reset();
    for (const v of views) v.stopTenpaiFlash();
    hideAimNotice();
    hideShisaNotice();
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

  // ビタ押し判定の閾値（ms）。data/tuning の bitaWindowMs で調整（既定12＝1コマ50msの約¼）。
  const BITA_MS = tuning.bitaWindowMs;

  // 各リールの直近押下の精度＆滑り量（役成立時にビタ集計するため）
  const lastPressErrorMs: number[] = Array(REEL_COUNT).fill(Infinity);
  const lastSlipCells: number[] = Array(REEL_COUNT).fill(0);

  const placeBet = () => {
    if (freezeActive) return;
    if (betBtn.disabled) return;
    // チェリー昇格の点灯待ちが残っていれば、次ゲームの役を決める前にここで点ける。
    // 待ちを跨がせると回転中に点いて「点いたのに揃わない」になる。
    if (cherryLampTimer !== null) fireCherryLamp();
    sfx.init(); // user gesture でオーディオ起動
    // BGM も最初の BET で起動（自動再生制限の回避）。再生中ならスキップ。
    bgm.init();
    bgm.play(bonusZone.isActive() ? 'bonus' : 'normal');
    if (!wallet.bet(calc.bet)) return;
    bonusSession.beginSpin();
    recordRunSpeed(reelSpeed());
    if (autoMode) runAutoUsed = true;
    betPlaced = true;
    resultEl.classList.remove('visible');
    flashButton(betBtn);
    sfx.bet();
    // BET 時のセリフは時々（25%）
    if (Math.random() < 0.25) jinSpeech.say('bet');
    // レバーON後の演出抽選に使うレートを、ボーナス > 救済 > 通常で準備する。
    if (announcedBonus) {
      scheduler.setRates({ none: 1, shisa: 0, quiz: 0, aim: 0 });
    } else if (bonusSession.spinActive) {
      scheduler.setRates(bonusZone.config.bonusEffectRates);
    } else if (playStats.stats.get().missStreak >= tuning.rescueMissThreshold) {
      scheduler.setRates(effectRates.rescue);
    } else {
      scheduler.setRates(effectRates.default);
    }
    updateButtons();
  };

  const pullLever = () => {
    if (freezeActive) return;
    if (leverBtn.disabled) return;
    if (!betPlaced) return;
    // レバーONを1ゲームの確定点とし、内部役→対応できる演出の順に決める。
    // フリーズ／確定ランプは通常抽選より優先し、強制役もRoundContextへ保存する。
    stopOrder = [];
    // フリーズはデバッグ強制の時だけ先取りする。通常は内部役テーブルの
    // 強レア役として引かれる（実機と同じ「フラグ連動」＝独立抽選ではない）。
    const forcedFreezeRole =
      pendingFreeze && !bonusZone.isActive()
        ? internalRoleLottery.freezeRole()
        : null;
    pendingFreeze = false;
    let doFreeze = forcedFreezeRole !== null;
    const shouldAnnounce =
      !doFreeze &&
      !bonusZone.isActive() &&
      !announcedBonus &&
      Math.random() < tuning.announceLamp.rate;

    if (forcedFreezeRole) {
      activateRound(forcedFreezeRole, 'none', 'freeze');
    } else if (announcedBonus && announcedRole) {
      activateRound(
        internalRoleLottery.forYaku(announcedRole),
        'none',
        'held-bonus',
      );
    } else if (shouldAnnounce) {
      announceBonus();
      if (announcedRole) {
        activateRound(
          internalRoleLottery.forYaku(announcedRole),
          'none',
          'announce',
        );
      }
    } else if (pendingForcedRole) {
      // デバッグ：内部役を直接指定する。演出は通常どおり抽選する（おかわりの見え方も確認したいため）。
      const forced = pendingForcedRole;
      pendingForcedRole = null;
      const forcedYaku = internalRoleLottery.yakuFor(forced);
      activateRound(
        forced,
        forcedYaku
          ? scheduler.rollAvailable(eligibility.eligibleEffects(forcedYaku))
          : 'none',
        'debug',
      );
    } else if (pendingDebugEffect) {
      const effect = pendingDebugEffect;
      pendingDebugEffect = null;
      activateRound(drawDebugRole(effect), effect, 'debug');
    } else if (heldBonusYaku) {
      // 持ち越し中：フラグは生きているが**演出は出ない**（実機Aタイプ）。
      // 小役は全部蹴られるので出目が普段と変わる＝それがリーチ目になる。
      heldBonusSpins++;
      activateRound(
        internalRoleLottery.forYaku(heldBonusYaku),
        'none',
        'held-bonus',
      );
    } else if (pendingForcedDelay) {
      // デバッグ：遅れの確認。**実際に遅れが出る条件をそのまま再現する**。
      // 遅れは「無演出」かつ「ハズレでも1枚役でもない」ゲームでしか出ないので、
      // 演出を none に固定し、miss と single を除いて内部役を引く。
      // ここを普通の抽選のままにすると、遅れと示唆が同時に出る＝**実際には起こらない
      // 組み合わせ**を見せることになる（かつおの示唆と遅れが重なって見えていた）。
      const role = internalRoleLottery.draw(activeInternalRoleState(), {
        allowMiss: false,
        roleFilter: (r) => r.kind !== 'single',
      });
      doFreeze = role.freeze;
      activateRound(role, 'none', doFreeze ? 'freeze' : 'lottery');
    } else {
      const role = internalRoleLottery.draw(activeInternalRoleState());
      const yaku = internalRoleLottery.yakuFor(role);
      // フリーズ役を引いた＝その場でBIG確定。演出は出さずフリーズシーケンスへ渡す。
      doFreeze = role.freeze;
      // miss / 1枚役（表示役なし）は none。それ以外は「表現できる演出＋無演出」から
      // レート抽選する。当たっているのに演出が出ない（＝狙えない）ゲームがここで生まれる。
      const effect: EffectType = doFreeze
        ? 'none'
        : yaku
          ? scheduler.rollAvailable(eligibility.eligibleEffects(yaku))
          : 'none';
      activateRound(role, effect, doFreeze ? 'freeze' : 'lottery');
    }

    // 遅れ：レバーを叩いてもリールが回り出さない「間」。ハズレでは出さないので
    // 「何かは当たっている」は必ず本当。ただし何かは言わないので狙える役は増えない。
    const forcedDelay = pendingForcedDelay;
    pendingForcedDelay = false;
    const delayMs =
      !doFreeze && (forcedDelay || rollDelay(currentRound)) ? tuning.delay.ms : 0;
    const startSpin = () => {
      spinPending = false;
      for (const engine of engines) engine.spin();
      if (autoMode) setupAutoTarget();
      updateButtons();
      if (doFreeze) runFreeze();
    };
    flashButton(leverBtn);
    spawnButtonRipple(leverBtn, '#ffd700');
    sfx.lever();
    if (delayMs > 0) {
      // 間の最中はまだどのリールも回っていない＝レバーが有効なままなので、
      // 二度押しで内部役を引き直せてしまう。フラグで塞ぐ。
      spinPending = true;
      showDelay(delayMs);
      updateButtons();
      window.setTimeout(startSpin, delayMs);
    } else {
      startSpin();
    }
  };

  /**
   * 突入直前の「溜め」演出を挟んでから本演出（カットイン等）を実行する。
   * showEntryCharge で中央に光を収束させ、CHARGE_MS 後に弾けてカットインへ橋渡しする。
   */
  const CHARGE_MS = tuning.entryChargeMs;
  const enterWithCharge = (variant: 'big' | 'reg', doEntry: () => void) => {
    showEntryCharge(variant, CHARGE_MS);
    sfx.charge();
    window.setTimeout(doEntry, CHARGE_MS);
  };

  /**
   * 押し順を守れている時だけ有効な「演出・引き込みの対象になる表示役」ID。
   * miss／1枚役フラグ／押し順ミス後は null。
   */
  const activeDisplayYakuId = (): string | null =>
    currentRound?.internalRole.yakuId ?? null;

  /** 1枚役グループのID一覧（singleYaku のどれが揃ってもよい）。 */
  const singleYakuIds = yakuList.singleYaku.map((y) => y.id);

  /**
   * この停止時点で「出目に出てよい役」のID群（払い出し・蹴り・引き込みガードの正）。
   * - miss: 空＝全役が蹴り対象
   * - 1枚役フラグ: singleYaku 全ID（通常時のみ。演出は出ないので偶然拾う役）
   * - 通常: 表示役の単数
   * - **ボーナス中**: 表示役＋singleYaku 全ID。1枚役をボーナス中だけ「こぼし先」にする
   *
   * ボーナス中の1枚役は内部役テーブルから抽選しない（bonus レート0）。代わりに、
   * 当選役を引き込めなかった時の受け皿として置く。**自分が外した結果としてだけ1枚**に
   * なるので、外した距離が枚数に出る（4コマ以内で拾えれば1枚・大きく外せば0枚）。
   * 通常時は従来どおり抽選で降ってくる役のままにしてある。
   *
   * 引き込みは当選役を優先する（StopController の CAT_RANK）。1枚役が近いという理由で
   * 本来取れる小役を取り逃がしては本末転倒なので、1枚役は常に最下位の受け皿にする。
   */
  const activeFlagYakuIds = (): string[] => {
    if (!currentRound) return [];
    const role = currentRound.internalRole;
    if (role.kind === 'miss') return [];
    if (role.kind === 'single') return singleYakuIds;
    if (!role.yakuId) return [];
    return bonusZone.isActive()
      ? [role.yakuId, ...singleYakuIds]
      : [role.yakuId];
  };

  const currentInternalYaku = (): Yaku | null => {
    const id = activeDisplayYakuId();
    return id ? (allYakusFlat.find((y) => y.id === id) ?? null) : null;
  };

  /** 現在の示唆がボーナス（赤/金）を示しているか。AUTO の狙い判定に使う。 */
  const shisaTargetsBonus = (): boolean =>
    currentEffect === 'shisa' &&
    currentShisaTier !== null &&
    currentShisaTier.targets.some(
      (slot) => slot === 'reg' || slot === 'big0' || slot === 'big1',
    );

  /**
   * 蹴りで除外する「予告した役」ID。aim/quiz が premium/bonus を予告した時、その役は
   * 蹴らずに通す（予告役を優先）。それ以外の演出/役では null＝全 premium/bonus を蹴る対象。
   */
  const currentTargetYakuId = (): string | null => {
    if (currentEffect === 'aim' || currentEffect === 'quiz') {
      return activeDisplayYakuId();
    }
    return null;
  };

  /** aim/quiz は第1・第2停止にも中段引き込みが効く（＝予告に従えば取れる）。 */
  const isAimLikeEffect = (): boolean =>
    currentEffect === 'aim' || currentEffect === 'quiz';

  /**
   * 当選役の引き込み窓（コマ）。**実機同様、演出では変わらない**。
   * 難易度はリール配列（図柄の間隔）が担う＝4コマ内に無ければ取りこぼす。
   */
  const PULL_IN_CELLS = tuning.assist.pullInCells;

  /**
   * 停止制御（実機のリール制御）。ロジックは StopController に集約してあり、
   * ゲーム本体・監査テスト・出玉シミュレーターが同じ実装を使う。
   * ここは「今どの役が出目に出てよいか」をゲーム状態から組み立てて渡すだけ。
   */
  const stopController = new StopController({
    yakuList,
    slipResolver,
    tenpaiDetector,
    stopTable,
    pullInCells: PULL_IN_CELLS,
  });

  const resolveStopSlip = (
    idx: number,
    engine: ReelEngine,
    basePos: number,
    stoppedVisibles: (VisibleColumn | null)[],
  ): number => {
    // 確定告知ランプ点灯中はその確定役、それ以外は内部役（1枚役はグループ）。
    const lamp = announcedBonus && announcedRole ? announcedRole : null;
    const flagYakuIds = lamp ? [lamp.id] : activeFlagYakuIds();
    const flagKey = lamp
      ? (allRolesFlat.find((r) => r.displayYakuId === lamp.id)?.id ?? null)
      : (currentRound?.internalRole.roleId ?? null);
    return stopController.resolveSlip({
      reelIndex: idx,
      basePosition: basePos,
      strip: engine.strip,
      stoppedVisibles,
      flagYakuIds,
      flagKey,
      freeze: freezeActive,
    });
  };

  const stopReel = (idx: number, timestamp: number) => {
    if (idx < 0 || idx >= REEL_COUNT) return;
    const engine = engines[idx];
    if (engine.state.get() !== 'spinning') return;
    // フリーズ演出の一時的な60コマ/秒ではなく、プレイヤーが選んだ通常速度を記録する。
    recordRunSpeed(reelSpeed());
    // 押し順役の判定はこの停止を含めて確定させるため、引き込み解決の前に順を記録する。
    stopOrder.push(idx);

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
    // 引き込み/蹴りの決定は resolveStopSlip に集約（設計: 17_assist-and-slip.md）。
    const slipCells = resolveStopSlip(idx, engine, basePos, stoppedVisibles);

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

    // 1確（いっかく）＝第1停止だけでボーナスが確定する出目。中段にボーナス専用図柄が
    // 止まった形がこれにあたる。実機の用語では「リーチ目」は全リール停止後の出目の総称で、
    // その一種として1確・2確がある。ここは1確。
    //
    // **第1停止だけ**が対象。「非ボーナスフラグではこの図柄を中段に止めない」規則は
    // 停止テーブル（第1停止）でしか担保しておらず、第2・第3停止はアルゴリズム任せで
    // 普通に中段へ来てしまうため（実測で誤告知14〜21%）。第1停止の誤告知は20万G×4腕で0件。
    //
    // **無演出のゲームでだけ知らせる。** 演出が出ているならボーナスかどうかは色や役名で
    // すでに分かっている（赤・金・虹はすべてボーナスを指す）ので、そこへ重ねても
    // 情報が増えず邪魔になるだけ。ボーナス中は none=0 で必ず演出が出るため、ここは通らない。
    //
    // 文字は出さない。実機でも出ないし、そもそも出目を読む遊びを文字で潰すことになる。
    const isFirstStop = stopOrder.length === 1;
    if (
      isFirstStop &&
      !reachEyeShown &&
      currentEffect === 'none' &&
      reachEyes.isBonusOnlyOnPrimary(
        idx,
        getVisibleCell(engine, primaryRowOf(idx)),
      )
    ) {
      reachEyeShown = true;
      views[idx].startTenpaiFlash(true);
      sfx.tenpaiPremium();
      jinSpeech.say('premium');
    }

    // 示唆 →「狙え！」への発展。
    // 内部役の図柄がこの停止で**窓のどこかに**来た＝候補が1役に絞れたので、吹き出しを差し替える。
    // 「本当に当たっている役」でしか発展しないので、ガセにはならない。
    //
    // 以前は中段に来た時だけだった。示唆は色しか出さず候補から当てずっぽうで選ぶので、
    // 発展しないと腕に関係なくほぼ落とす（実測98%）。発展が候補を1役へ絞る唯一の出口なので、
    // 条件を可視3コマへ緩めて発展率を上げてある（実測 69%→82%）。
    if (
      currentEffect === 'shisa' &&
      !shisaEscalated &&
      engines.some((e) => e.state.get() === 'spinning')
    ) {
      const target = currentInternalYaku();
      const sym = target?.symbols[idx];
      const shown =
        sym !== undefined &&
        (['top', 'middle', 'bottom'] as const).some(
          (v) => getVisibleCell(engine, v) === sym,
        );
      if (target && shown) {
        shisaEscalated = true;
        hideShisaNotice();
        showAimNotice({
          symbols: target.symbols,
          colors: target.symbols.map((s, i) => colorResolver.cssFor(i, s)),
          yakuName: target.name,
          imageUrl: `${ART_BASE}aim_text.webp`,
          hasPremium: target.category === 'premium',
          reelCentersXFrac: [0, 1, 2].map(
            (i) => (startX + i * (CELL_WIDTH + REEL_GAP) + CELL_WIDTH / 2) / CANVAS_W,
          ),
          reelTopYFrac: reelY / CANVAS_H,
          // 停止済みリールには矢印を出さない（残りのリールだけを指す）。
          arrowReels: engines.map((e) => e.state.get() === 'spinning'),
        });
        sfx.shisa();
        jinSpeech.say('shisa');
      }
    }

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
      hideShisaNotice();
      // 出目から成立ラインと払い出しを確定させる（表示はしない純粋な計算）。
      const grid = extractGrid(engines);
      const middleSymbols = grid[1] as [string, string, string]; // 既存UI互換用
      const outcome = roundResolver.resolve({
        grid,
        flagYakuIds: activeFlagYakuIds(),
        bonusActive: bonusSession.spinActive,
        streakBefore: playStats.stats.get().streak,
        noticeYakuId: currentTargetYakuId(),
        slipCells: lastSlipCells,
      });
      const { hits, willHit, premiumHit, bonusHit, isPremium, isRegular } =
        outcome;
      const { streakAfter, streakMult, noticeBonus, win, reachKind } = outcome;
      const quizTargetYakuId =
        currentEffect === 'quiz' ? quizState.targetYakuId() : null;
      // 確定告知ランプ点灯中にボーナス（BIG/REG）が揃ったら回収完了＝消灯。
      if (announcedBonus && (isPremium || isRegular)) clearAnnounceLamp();
      // ボーナスフラグの持ち越し（実機Aタイプ）。
      // 揃えば解除、こぼせば次ゲーム以降も保持し続ける（無告知＝リーチ目で察知する）。
      // 確定告知ランプは告知ありの別経路なので、そちらが点灯中は二重に持たない。
      if (isPremium || isRegular) {
        heldBonusYaku = null;
        heldBonusSpins = 0;
      } else if (!announcedBonus && !bonusZone.isActive()) {
        const flagged = currentInternalYaku();
        if (
          flagged &&
          (flagged.category === 'premium' || flagged.category === 'bonus')
        ) {
          heldBonusYaku = flagged;
        }
      }
      if (reachKind && heldBonusYaku) {
        // 全リール停止後の出目が**リーチ目**（ボーナス成立時にしか出ない並び）だった。
        // 枠を光らせて「今の出目はただのハズレじゃない」とだけ伝える。種別（REG/BIG）は
        // 伏せたまま＝出目を読める人だけが分かる。**文字は出さない**。
        // 読ませる遊びなので、答えを書いてしまうと成立しない。
        for (const v of views) v.startTenpaiFlash(reachKind !== 'reg');
        sfx.tenpaiPremium();
        jinSpeech.say('tenpai');
      }
      // チェリー昇格。チェリーが**実際に揃った**時だけ抽選し、当たれば確定告知ランプを
      // 点灯＝次ゲーム以降ボーナス確定。成立表示の余韻を残してから点灯させ、
      // 「チェリーが呼んだ」と読める間を作る。
      //
      // **実機の重複当選とは機構が違う**ので重複とは呼ばない。実機は内部抽選の時点で
      // チェリーとボーナスに同時当選しており、チェリーをこぼしてもボーナスの権利は残る。
      // こちらは成立**後**の抽選なので、こぼすと抽選そのものが起きない。
      // これは意図的で、1枚役やボーナス中のこぼしと同じく**こぼしに代償がある**設計に
      // 揃えてある（腕が効く方向）。名前だけを実装に合わせた。
      if (
        outcome.cherryHit &&
        !announcedBonus &&
        !bonusZone.isActive() &&
        !freezeActive &&
        Math.random() < tuning.cherryBonus.rate
      ) {
        cherryLampTimer = window.setTimeout(fireCherryLamp, tuning.cherryBonus.delayMs);
      }
      if (quizTargetYakuId) {
        const quizMatched = hits.some((h) => h.yaku.id === quizTargetYakuId);
        quizState.resolve(quizMatched);
        playStats.recordQuiz(quizMatched);
        if (quizMatched) sfx.quizCorrect();
        else sfx.quizWrong();
      }
      if (win > 0) wallet.win(win);

      playStats.recordSpin({
        bet: calc.bet,
        win,
        hit: willHit,
        premium: isPremium,
        bonusTriggered: isPremium || isRegular,
      });
      // 台のデータカウンター（設定推測の材料）。ハマりはボーナスで0に戻る。
      // キーは台ID。章で数えると同じ島の4台のデータが混ざる。
      // 演出率は設定を読める唯一の数字なので、通常時だけを母数にして数える。
      // 台のカウンターと戦の記録で母数の規則がずれないよう、判定はここで1度だけ。
      const inBonusSpin = bonusZone.isActive();
      const effectShown = currentEffect !== 'none';
      recordMachineSpin(machine.id, new Date(), {
        bet: calc.bet,
        win,
        bonus: isPremium ? 'big' : isRegular ? 'reg' : null,
        inBonus: inBonusSpin,
        effect: effectShown,
      });

      // 戦専用カウンタも同じ確定点で増分（計数で RunRecord に確定する）
      runSpinCount += 1;
      runTotalBet += calc.bet;
      runTotalWin += win;
      if (isPremium) runPremiumCount += 1;
      if (isRegular) runBonusCount += 1;
      if (!inBonusSpin) {
        runNormalSpins += 1;
        if (effectShown) runEffectSpins += 1;
      }

      // ビタ押し：役に必要なリールを1本残らず自力で止めた時だけ1カウント
      // （判定は RoundResolver）。押下精度 ±BITA_MS は出目に影響しないので、
      // 押し味のSE・波紋にだけ使い、スコアには関与させない。
      if (outcome.bitaPerfect) zukanState.recordBita();

      // ミッションは達成状況だけを永続化し、結果表示と重ならないよう通知を遅らせる。
      // コインや戦の totalWin には加算しない。
      const newlyAchieved = challengeTracker.evaluate({
        stats: playStats.stats.get(),
        bitaCount: zukanState.bitaCount.get(),
        zukanCounts: zukanState.counts.get(),
        yakuList,
      });
      newlyAchieved.forEach((c, i) => {
        window.setTimeout(() => {
          showMissionToast(c);
          sfx.bita(); // 短いキラーン音を流用
        }, 1500 + i * 350);
      });

      if (willHit) {
        // 成立ラインインジケーターを点灯
        for (const h of hits) {
          leftIndicators.highlight(h.paylineId);
        }
        const cls = isPremium || isRegular ? 'premium' : 'win';
        const bonusTag = bonusSession.spinActive ? ' ×BONUS' : '';
        const streakTag = streakMult > 1 ? ` ${streakAfter}連 ×${streakMult}` : '';
        const lineTag = hits.length > 1 ? ` (${hits.length}ライン)` : '';
        const noticeLabel = currentEffect === 'quiz' ? 'クイズ的中' : '狙え的中';
        const noticeTag = noticeBonus > 0 ? ` ★${noticeLabel}+${noticeBonus}` : '';
        // ビタ押し＝ゲームに一切助けられず揃えた。上乗せ額と一緒に明示する。
        const bitaTag =
          outcome.bitaBonus > 0 ? ` ⚡ビタ押し+${outcome.bitaBonus}` : '';
        // 役名は重複なしで「みかん×2 ＋ すしや」のように要約
        const yakuLabel = summarizeHits(hits);
        showResult(
          `${yakuLabel}！ +${win}${bonusTag}${streakTag}${lineTag}${noticeTag}${bitaTag}`,
          cls,
        );
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
        // 予告役的中（狙え／クイズ正解）は配当の大小に関わらず、達成感のコインバーストを別途出す
        if (noticeBonus > 0) showCoinBurst(10);
        // ビタ押し成立は配当の大小に関わらず祝う（技術が報われた瞬間）
        if (outcome.bitaBonus > 0) {
          showCoinBurst(12);
          sfx.bita();
        }
        // プレミアム成立でビッグボーナス突入＋全画面演出
        if (isPremium && premiumHit) {
          const entry = bonusSession.enter('big');
          if (entry.isAddition) {
            // おかわり（ボーナス中の再当選）: 突入演出は出さず軽い上乗せ演出
            showBonusAdd(entry.spinsAdded, 'big');
          } else {
            // 新規突入: 「溜め」→ 突入演出（カットイン/フラッシュ/紙吹雪/バナー）
            enterWithCharge('big', () => showBonusEntryFx(premiumHit.yaku, 'big'));
          }
        } else if (isRegular && bonusHit) {
          // レギュラーボーナス（すし＋別字）突入。シルバー基調・控えめ
          const entry = bonusSession.enter('reg');
          if (entry.isAddition) {
            showBonusAdd(entry.spinsAdded, 'reg');
          } else {
            // 新規突入: 「溜め」（シルバー）→ 突入演出
            enterWithCharge('reg', () => showBonusEntryFx(bonusHit.yaku, 'reg'));
          }
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
        if (!quizTargetYakuId) sfx.miss();
      }

      // 残数消費・獲得集計・終了判定はまとめて BonusSession に任せる。
      // このゲームの演出・配当・上乗せ判定がすべて終わってから呼ぶ（順序が意味を持つ）。
      const runEnd = bonusSession.settle(win);
      if (runEnd) {
        window.setTimeout(() => showBonusResult(runEnd.payout, runEnd.kind), 900);
      }

      window.setTimeout(resetForNextSpin, 1200);
    }
  };

  // === フリーズ演出シーケンス ===
  /**
   * 指定リールを「現在位置から順方向で最も近い7（主役図柄）」へ強制停止する。
   * freezeActive 中は stopReel の引き込み/蹴りが無効化されるため basePos にそのままスナップ。
   */
  const forceStopOn7 = (idx: number) => {
    const headline = yakuList.premiumYaku[0];
    if (!headline) return;
    const sym = headline.symbols[idx];
    const engine = engines[idx];
    if (engine.state.get() !== 'spinning') return;
    const cells = engine.strip.cells;
    const total = cells.length;
    const pos = engine.position;
    // 順方向で最も近い該当図柄の位置を探す（回転して止まる自然さ）
    let bestK = -1;
    let bestDist = Infinity;
    for (let i = 0; i < total; i++) {
      if (cells[i] !== sym) continue;
      const dist = (((i - pos) % total) + total) % total;
      if (dist < bestDist) {
        bestDist = dist;
        bestK = i;
      }
    }
    if (bestK < 0) bestK = 0;
    engine.position = bestK;
    views[idx].startTenpaiFlash(true);
    sfx.tenpaiPremium();
    stopReel(idx, performance.now());
  };

  /**
   * フリーズ演出: フリーズ発生 → 倍速回転 → 1リール目から順に7を強制停止 →
   * 最終リール停止で全停止判定が走り、7揃いBIGとして突入（溜め＋カットイン）。
   * シーケンス中は freezeActive=true で全入力をブロックする。
   */
  const runFreeze = () => {
    freezeActive = true;
    // 競合演出を一括クリア（クイズ出題/狙え予告/示唆ティント等が FREEZE 表示と重ならないように）。
    // applyEffect('none') で引き込み無効化＋effectVisualティント/ステータス/ジンをリセット、
    // quizState.reset() で液晶のクイズ出題(QuizQuestionView)を消す。
    applyEffect('none');
    quizState.reset();
    hideAimNotice();
    hideShisaNotice();
    updateButtons();
    sfx.freeze();
    showFreezeBanner();
    flashScreen({ color: '#cfe4ff', alpha: 0.9, durMs: 220 });
    // 1) フリーズ発生: 一瞬リールを停止（速度0）
    for (const e of engines) e.setSpeed(0);
    window.setTimeout(() => {
      // 2) 倍速回転
      for (const e of engines) e.setSpeed(FREEZE_SPIN_SPEED);
      sfx.lever();
      // 3) 1リール目から順に7を強制停止
      window.setTimeout(() => forceStopOn7(0), 700);
      window.setTimeout(() => forceStopOn7(1), 1300);
      window.setTimeout(() => {
        forceStopOn7(2); // 最終 → 全停止判定 → 7揃いBIG突入
        freezeActive = false;
        clearFreezeBanner();
        updateButtons();
      }, 1900);
    }, 650);
  };

  // === 確定告知ランプ ===
  /** ランプ点灯（ボーナス確定）。種別を内部確定（伏せる）し、UI を点灯。 */
  const announceBonus = (bigRatio = tuning.announceLamp.bigRatio) => {
    announcedBonus = Math.random() < bigRatio ? 'big' : 'reg';
    // 狙う役を固定（[0]＝確定ランプ用の共通プレフィックス役）。全リールがこの1役へ引き込まれて確実に揃い、
    // 最終リールで種別(BIG/REG)が判明する＝祈りの瞬間の演出を保つ。
    announcedRole =
      (announcedBonus === 'big' ? yakuList.premiumYaku[0] : yakuList.bonusYaku[0]) ?? null;
    announceLampEl.hidden = false;
    requestAnimationFrame(() => announceLampEl.classList.add('lit'));
    sfx.lamp();
    flashScreen({ color: '#fff3a0', alpha: 0.8, durMs: 280 });
    jinSpeech.say('premium');
  };
  /**
   * チェリー昇格の点灯待ち。全停止直後ではなく少し置いてから点けることで、
   * チェリー成立の表示を見せてから「チェリーが呼んだ」と読める間を作る。
   *
   * ただし**その間はプレイヤーを待たせない**。全停止後はすぐBETできるので、
   * 待たせる作りにすると次ゲームの回転中にランプが点く。そのゲームの内部役は
   * 普通に抽選されたもの（ボーナスではない）なので、**点いたのに揃わない**という
   * 見え方になる。BETした時点で先に点けて、そのゲームからボーナス役を強制する。
   */
  let cherryLampTimer: number | null = null;
  const fireCherryLamp = () => {
    if (cherryLampTimer !== null) {
      window.clearTimeout(cherryLampTimer);
      cherryLampTimer = null;
    }
    // 待っている間に他経路で点灯／ボーナス突入していたら何もしない。
    if (announcedBonus || bonusZone.isActive()) return;
    // 文字は出さない。ランプの点灯・SE・フラッシュで十分に分かる（1確・リーチ目と同じ扱い）。
    announceBonus(tuning.cherryBonus.bigRatio);
  };

  /** ランプ消灯（ボーナス回収後）。 */
  const clearAnnounceLamp = () => {
    announcedBonus = null;
    announcedRole = null;
    announceLampEl.classList.remove('lit');
    announceLampEl.hidden = true;
  };

  betBtn.addEventListener('click', placeBet);
  leverBtn.addEventListener('click', pullLever);
  stopBtns.forEach((btn) => {
    const idx = Number(btn.dataset.reel ?? -1);
    btn.addEventListener('pointerdown', (ev) => {
      if (freezeActive) return;
      stopReel(idx, ev.timeStamp);
    });
  });

  // === オートスピン ===
  // 状態を見て BET → LEVER → STOP×3 を進める。
  // レバーON後、演出が示す内部役を狙って停止する。
  // 通常時は適当タイミングで停止（揃わなくて普通）。
  let autoTimer: number | null = null;
  // AUTO が狙う具体役。レバー直後に内部役から決定 → resetForNextSpin で null
  let autoTargetYaku: (typeof allYakusFlat)[number] | null = null;
  // 停止スケジュール済みのリール（重複スケジュール防止）
  const aimPending = new Set<number>();

  const clearAutoTimer = () => {
    if (autoTimer !== null) {
      window.clearTimeout(autoTimer);
      autoTimer = null;
    }
  };

  /** レバー直後にコールして、演出が表す内部役をAUTOの狙い役にする。 */
  /** AUTO がリールを止める順番。本作は**順押し前提**（左→中→右）。 */
  const autoStopSequence = (): number[] => [0, 1, 2];

  const setupAutoTarget = () => {
    if (announcedBonus && announcedRole) {
      // 確定告知ランプ点灯中（演出は none 固定）：固定した確定役を AUTO でも全リール狙う。
      autoTargetYaku = announcedRole;
    } else if (currentEffect !== 'none') {
      autoTargetYaku = currentInternalYaku();
    } else {
      autoTargetYaku = null;
    }
  };

  /** AUTO が予告役を狙うとき、target を中段の手前何コマで止めて残りを引き込みに
   *  委ねるかのマージン（引き込み上限 PULL_IN_CELLS に合わせる）。 */
  const AUTO_AIM_MARGIN = PULL_IN_CELLS;

  /**
   * AUTO の狙い停止：target symbol が中段付近に来たら stopReel を呼ぶ。
   * aim/quiz では手前 AUTO_AIM_MARGIN コマで止め、最後の寄せは stopReel の引き込みに
   * 任せる。setTimeout 遅延で target を「行き過ぎ」て順方向の引き込みが届かなくなる事故を
   * 防ぎ、確実に揃える。引き込みの無い演出(shisa 等)では従来どおり正確な位置を狙う。
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

    // 当選役は第1・第2にも中段引き込み(最大 PULL_IN_CELLS)が効くので、
    // 狙い役の手前 AUTO_AIM_MARGIN コマで止め、残りの寄せを引き込みに委ねる。
    // 引き込みの無い演出(shisa 等)は手前で止めると逆に揃わないため MARGIN=0。
    // aim/quiz と赤/金示唆は第1・第2にも中段引き込みが効くので手前マージンを取る。
    const aimMargin =
      isAimLikeEffect() || shisaTargetsBonus() || announcedBonus
        ? AUTO_AIM_MARGIN
        : 0;
    const stopDist = Math.max(0, bestDist - aimMargin);
    const msToWait = (stopDist / speed) * 1000;
    aimPending.add(reelIdx);
    window.setTimeout(() => {
      aimPending.delete(reelIdx);
      if (!autoMode) return;
      if (freezeActive) return;
      if (engine.state.get() === 'spinning') {
        stopReel(reelIdx, performance.now());
      }
    }, msToWait);
  };

  const stepAuto = () => {
    if (!autoMode && !autoFinishing) return;
    // フリーズ演出中はAUTOの操作を止め、ループだけ維持して終了後に再開する
    if (freezeActive) {
      autoTimer = window.setTimeout(stepAuto, 350);
      return;
    }
    if (autoMode && !wallet.canBet(calc.bet) && !betPlaced) {
      stopAuto();
      return;
    }

    const states = engines.map((e) => e.state.get());
    const anySpinning = states.includes('spinning');
    const allIdle = states.every((s) => s === 'idle');

    // OFFにした後の消化中：残ったリールを止めるだけ。新しいゲームは始めない。
    if (autoFinishing) {
      if (!anySpinning) {
        finishAuto();
        return;
      }
      const nextIdx = autoStopSequence().find((r) => states[r] === 'spinning');
      if (nextIdx !== undefined && !aimPending.has(nextIdx)) {
        if (autoTargetYaku) scheduleAimedStop(nextIdx);
        else stopReel(nextIdx, performance.now());
      }
      autoTimer = window.setTimeout(stepAuto, 350);
      return;
    }

    if (!betPlaced && allIdle) {
      placeBet();
    } else if (betPlaced && allIdle) {
      pullLever();
    } else if (anySpinning) {
      // 押し順（デフォルト順押し／押し順役はナビ順）に沿って次の1リールを止める。aim 待ち中はスキップ。
      const nextIdx = autoStopSequence().find((r) => states[r] === 'spinning');
      if (nextIdx !== undefined && !aimPending.has(nextIdx)) {
        if (autoTargetYaku) {
          scheduleAimedStop(nextIdx);
        } else {
          stopReel(nextIdx, performance.now());
        }
      }
    }

    autoTimer = window.setTimeout(stepAuto, 350);
  };

  const startAuto = () => {
    autoMode = true;
    autoFinishing = false;
    autoBtn.classList.remove('finishing');
    // AUTOを途中から有効にした戦も、手動記録とは区別する。
    runAutoUsed = true;
    autoBtn.textContent = 'AUTO ON';
    autoBtn.classList.add('on');
    sfx.init();
    stepAuto();
  };

  /**
   * AUTOを止める。回転中なら**現在のゲームだけは全停止まで消化**してから終了する。
   * 途中で切ると回りっぱなしのリールが残り、手で止めるまで結果が確定しないため。
   * 消化中にもう一度押せばAUTOへ復帰する。
   */
  const stopAuto = () => {
    autoMode = false;
    const spinning = engines.some((e) => e.state.get() === 'spinning');
    if (spinning) {
      autoFinishing = true;
      autoBtn.textContent = 'AUTO 消化中';
      autoBtn.classList.remove('on');
      autoBtn.classList.add('finishing');
      clearAutoTimer();
      autoTimer = window.setTimeout(stepAuto, 350);
      return;
    }
    finishAuto();
  };

  /** 消化しきった（または最初から回っていなかった）ので完全に終了する。 */
  const finishAuto = () => {
    autoFinishing = false;
    autoBtn.textContent = 'AUTO';
    autoBtn.classList.remove('on', 'finishing');
    clearAutoTimer();
  };

  autoBtn.addEventListener('click', () => {
    if (!autoAvailable) return;
    // 消化中にもう一度押したらAUTOへ復帰する（誤操作の取り消し）。
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

  /**
   * クイズ中、答えの役の文字をリール上でうっすら強調する（他セルを少しだけ落とす）。
   * 右のリール配列パネルでの緑ハイライトは「答えと出現位置」まで教えてしまうので行わない。
   */
  const updateQuizTargetEmphasis = () => {
    const targetYakuId = quizState.targetYakuId();
    const yaku = targetYakuId
      ? allYakusFlat.find((y) => y.id === targetYakuId)
      : null;
    views.forEach((view, idx) => view.setTargetSymbol(yaku?.symbols[idx] ?? null));
  };

  for (const engine of engines) {
    engine.state.subscribe(updateStripHighlight);
  }
  quizState.phase.subscribe(updateQuizTargetEmphasis);
  updateStripHighlight();
  updateQuizTargetEmphasis();

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

    // クイズは回答操作なし方式のためキー回答は廃止（答えは全停止後に提示）。

    // フリーズ演出中はゲーム操作キーを全てブロック
    if (freezeActive) {
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
