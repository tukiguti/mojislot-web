import { Application, FillGradient, Graphics } from 'pixi.js';
import { ReelEngine } from './core/ReelEngine';
import { ReelView, CELL_WIDTH, CELL_HEIGHT, VISIBLE_CELLS, REEL_PEEK, FRAME_PAD } from './render/ReelView';
import { loadGlyphArt } from './render/ReelArt';
import { RunTimer } from './ui/RunTimer';
import { SymbolColorResolver } from './render/SymbolStyle';
import { YakuJudge } from './core/YakuJudge';
import { RoundResolver, requiredReels } from './core/RoundResolver';
import {
  createRoundContext,
  type RoundContext,
  type RoundSource,
} from './core/RoundContext';
import { PayoutCalc } from './core/PayoutCalc';
import { CoinWallet } from './core/CoinWallet';
import {
  KeyBindings,
  eventKey,
  keyLabel,
  type Action,
} from './productions/KeyBindings';
import {
  EffectScheduler,
  REEL_BASE_SPEED,
  type EffectType,
} from './productions/EffectScheduler';
import { BonusZone } from './productions/BonusZone';
import { BonusSession } from './productions/BonusSession';
import {
  applySetting,
  applySettingToEffects,
  stepBonusMultiplier,
} from './productions/MachineSetting';
import { REMIX, applyRemixBoost } from './productions/RemixBoost';
import { QuizStats } from './productions/QuizStats';
import { TIER_COLOR_NAME, a11y } from './productions/Accessibility';
import {
  EFFECT_STATUS,
  EFFECT_STATUS_CLASSES,
  SHISA_TINT,
  STREAK_TIERS,
  STREAK_TIER_CLASSES,
  endScreenFlashColor,
  streakTierOf,
} from './productions/EffectPresentation';
import { settingForMachine } from './productions/HallPolicy';
import {
  readMachineDay,
  recordSpin as recordMachineSpin,
} from './productions/MachineData';
import { DataLamp } from './ui/DataLamp';
import { recordEffects } from './productions/EffectStats';
import { EffectTable } from './ui/EffectTable';
import { drawEndScreen } from './productions/SettingHint';
import { drawCabinetLamp } from './productions/CabinetLamp';
import { drawSignLamp, isSignLampMilestone, type SignLampLevel } from './productions/SignLamp';
import { EffectEligibility } from './productions/EffectEligibility';
import {
  STEP_LEVEL,
  isStepTrigger,
  pickChainLength,
  pickStepBonus,
  pickStepColor,
  stepCapFor,
  stepLevelAfterStop,
  type StepColor,
} from './productions/StepUp';
import { rollOmen, type OmenKind, type OmenPlan } from './productions/Omen';
import { EffectDirector } from './productions/EffectProcedures';
import { SfxEngine } from './audio/SfxEngine';
import { BgmEngine } from './audio/BgmEngine';
import { TenpaiDetector } from './productions/TenpaiDetector';
import { PlayStats } from './productions/PlayStats';
import {
  appendRunRecord,
  clearRunDraft,
  RUN_RULESET_VERSION,
  saveRunDraft,
  type RunRecord,
} from './productions/RunHistory';
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
  showCoinBurst,
  showCoinFloat,
  showSecretToast,
  showPremiumCutin,
  type CutinBackdrop,
  showMultiHitBadge,
  startBonusSparkle,
  stopBonusSparkle,
  spawnButtonRipple,
  setEffectA11y,
  showAimNotice,
  hideAimNotice,
  hideAimReel,
  showShisaNotice,
  hideShisaNotice,
  setEffectHost,
  showDelay,
  showEntryCharge,
  showFreezeBanner,
  setBlackoutHost,
  showBlackout,
  setBlackoutLevel,
  clearBlackout,
  setStepFx,
  setStepNext,
  clearFreezeBanner,
  showRankUpBadge,
} from './ui/Effects';
import { SpeechBubble } from './ui/SpeechBubble';
import { ChallengeTracker } from './productions/Challenges';
import { showMissionToast } from './ui/MissionToast';
import { SettingsOverlay, REEL_SPEED_KEY, clampReelSpeed } from './ui/SettingsOverlay';
import { QUIZMASTER_SCALE, QuizmasterView } from './render/QuizmasterView';
import { LcdBackground } from './render/LcdBackground';
import { pickLine, quizmasterFor, type Quizmaster } from './data/quizmasters';
import { VoiceEngine } from './audio/VoiceEngine';
import { sampleBank } from './audio/SampleBank';
import { EffectVisual } from './render/EffectVisual';
import { QuizState } from './productions/QuizState';
import { QuizQuestionView } from './render/QuizQuestionView';
import { REMIX_ZUKAN_SCOPE, ZukanState } from './productions/ZukanState';
import { ZukanOverlay } from './ui/ZukanOverlay';
import { SlipResolver, type VisibleColumn } from './productions/SlipResolver';
import { StopTableLookup } from './core/StopTable';
import { StopController } from './core/StopController';
import { aimAnchors } from './core/PullInGuard';
import {
  extractGrid,
  getVisibleCell,
  getVisibleCellIndex,
  PAYLINES,
  type Vertical,
} from './core/Paylines';
import {
  ReelConfigSchema,
  YakuListSchema,
  PayoutSchema,
  QuizListSchema,
  StopTableSchema,
  TuningSchema,
  type Yaku,
  type YakuList,
  type ShisaTier,
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
  islandOfMachine,
  isRemixMachine,
  isTrialMachine,
  nextRemixStage,
  REMIX_ISLAND_ID,
} from './data/machines';
import './style.css';
// 筐体 v3 の輪郭と質感。
import './cabinet-v3.css';
// 島の題材の素材（看板の絵・本体・枠・操作部・下パネル）。v3 の既定より後に読む。
import './cabinet-islands.css';

/**
 * リール3本の間隔。**額（クローム）が左右に 9px ずつ張り出す**ので、16px だと
 * 隣の額とくっついて3つの窓が1つの横長の窓に見える。実機は窓が分かれている。
 */
const REEL_GAP = 26;
const REEL_COUNT = 3;
// デバッグ等で明示指定できる演出。
type ForcedEffect = Exclude<EffectType, 'none'>;
/** ステージチェンジの確率（1ゲームあたり）。情景3種を10ゲームに1度ほど入れ替える。 */
const STAGE_CHANGE_RATE = 1 / 10;
const CANVAS_W = 600;
/**
 * 演出領域の高さ。**DOM演出（カットイン・フラッシュ・バナー）が重なる範囲**で、
 * リール窓の上端までを指す。以前は「canvas からリール帯を引いた残り」という
 * 引き算で出していたが、canvas の高さを決める側に回ったので直接持つ。
 *
 * 400 → 300（2026-09-11）。筐体が 1:2.05 と縦長すぎてスマホの横幅が2割余っていた。
 * canvas を低くするぶんは**リールと演出領域から半分ずつ**出している（セルは
 * 100→92）。リールの実寸は筐体が広がるぶんで相殺され、画面上はほぼ変わらない。
 */
const LIQUID_AREA_H = 300;
/** リール窓の額が枠の外へ張り出す幅（`bezel` の描画と対）。 */
const REEL_BEZEL_OUT = 10;
/** 窓の下に残す画面。ここが 0 だと額の下半分が画面外へ出る。 */
const REEL_BOTTOM_GAP = 14;
/** リール帯の高さ＝中央3コマ＋上下チラ見せ＋枠余白。 */
const REEL_BLOCK_H =
  CELL_HEIGHT * VISIBLE_CELLS + REEL_PEEK * 2 + FRAME_PAD * 2;
const CANVAS_H = Math.round(
  LIQUID_AREA_H + REEL_BEZEL_OUT * 2 + REEL_BLOCK_H + REEL_BOTTOM_GAP,
);

/**
 * 液晶の高さの比を CSS へ渡す。DOM演出（カットイン・フラッシュ・BONUSバナー）は
 * この比で液晶に重なる。
 *
 * CSS 側にも同じ値を書いていたが、**リールのチラ見せと枠余白が入って液晶が縮んだ時に
 * CSS だけ取り残され**、DOM演出が液晶の下端を32pxはみ出してリールに被っていた。
 * ここから流し込めば、`LIQUID_AREA_H` を動かすだけで両方が揃う。
 */
document.documentElement.style.setProperty(
  '--lcd-ratio',
  String(LIQUID_AREA_H / CANVAS_H),
);

/**
 * canvas の縦横比を CSS へ渡す。**筐体の高さはこれで決まる**
 * （筐体 = 幅 × (この比 + 段の係数の和)）。
 *
 * CSS に 1.22 と直書きしていたので、canvas を低くした時に3箇所を手で直す必要が
 * あった。ここから流し込めば、`CANVAS_H` を動かすだけで筐体の形が追随する。
 */
document.documentElement.style.setProperty(
  '--game-aspect',
  String(CANVAS_H / CANVAS_W),
);

/**
 * リール3本の中心が筐体幅のどこに来るかを CSS へ渡す。
 *
 * ストップボタンを**リールの真下**へ置くのに使う。押す指とリールの位置が
 * 対応していないとビタ押しは狙えないのに、以前は3つとも中央寄せだった。
 * リールの寸法は Pixi 側の定数で決まるので、CSS に同じ数を書くと必ずずれる
 * （`--lcd-ratio` で一度やった失敗）。ここから流し込む。
 */
{
  const totalW = CELL_WIDTH * REEL_COUNT + REEL_GAP * (REEL_COUNT - 1);
  const startX = (CANVAS_W - totalW) / 2;
  for (let i = 0; i < REEL_COUNT; i++) {
    const cx = startX + i * (CELL_WIDTH + REEL_GAP) + CELL_WIDTH / 2;
    document.documentElement.style.setProperty(
      `--reel-cx-${i}`,
      String(cx / CANVAS_W),
    );
  }
  /**
   * リール左右の余白と、窓の上端・下端。差枚と払出の計器を**リールの左下・右下**、
   * 残りゲーム数とコンボを**左上・右上**へ置くのに使う（2026-09-23）。
   * 余白は額（REEL_BEZEL_OUT）の外側で測る。
   */
  const root = document.documentElement.style;
  root.setProperty('--reel-gutter', String((startX - REEL_BEZEL_OUT) / CANVAS_W));
  root.setProperty('--reel-top', String(LIQUID_AREA_H / CANVAS_H));
  root.setProperty(
    '--reel-bottom',
    String((LIQUID_AREA_H + REEL_BEZEL_OUT * 2 + REEL_BLOCK_H) / CANVAS_H),
  );
}

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

/**
 * 揃え損ねるとコンボが切れる役（小役・チェリー・目印揃い）のID。2026-10-12 から、
 * コンボはハズレでは切れず、揃えられる役を取りこぼした時だけ切れる（RoundResolver）。
 */
function comboYakuIdsOf(list: YakuList): Set<string> {
  return new Set([...list.coreYaku, ...list.cherryYaku, ...list.chanceYaku].map((y) => y.id));
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
  let chapterId = chapterIdOfMachine(machine);
  let chapter = CHAPTERS.find((c) => c.id === chapterId) ?? getCurrentChapter();

  // 島ごとのアート（public/art/）。
  // ※ body の島背景パネルは一旦オフ（必要になったら has-chapter-bg を復活させる）。
  const ART_BASE = `${import.meta.env.BASE_URL}art/`;

  let reelConfig = ReelConfigSchema.parse(chapter.reelData);
  // 設定（1〜6）はその日その台で決まる。プレイヤーには見せず、
  // データと示唆演出から推測させる（設計: MachineSetting）。
  // **章ではなく台ごと**。同じ島の4台が同じ設定だと、台を選び分ける意味が消える。
  const machineSetting = settingForMachine(machine, new Date());
  /**
   * データランプ。筐体の上の表示器で、**その台の今日**を出す。
   * 1戦の区切り（計数）ではリセットされない——日替わりのデータだから。
   */
  const dataLamp = new DataLamp(requireEl('datalamp'), machine.number);
  dataLamp.update(readMachineDay(machine.id, new Date()));
  /**
   * 演出データの表（ドックの「データ」で開くシート）。自分が引いた実績から
   * 期待度が立ち上がっていくのを見せる。仕様書の数字は出さない。
   */
  const effectTable = new EffectTable(requireEl('effect-table'));
  /**
   * タイトルパネル（筐体最上部の板）に島名を出す。実機のここは機種名で、
   * ホールの台選びで見えていた板と同じもの。試打台だけは島がまとめ役なので
   * 章名（打っている配列）の方が手掛かりになる。
   */
  {
    const island = islandOfMachine(machine);
    const titleEl = document.getElementById('machine-title');
    if (titleEl) {
      titleEl.textContent = island.trial ? chapter.name : island.name;
      // 字数で文字の大きさを決める（cabinet-v3.css）。「セキュリティ」のような長い島名が
      // 両脇の小物に食い込まないよう、空けてある真ん中の幅に収める。
      titleEl.style.setProperty('--title-len', String(titleEl.textContent.length));
    }
    // 看板の絵と筐体の素材は島ごと（cabinet-islands.css が data-island で当てる）。決め方はホールの
    // ミニ筐体と同じ：リミックス台はリミックス、試打台は章、それ以外は島。
    const cab = document.getElementById('cabinet');
    if (cab) {
      cab.dataset.island = isRemixMachine(machine)
        ? REMIX_ISLAND_ID
        : island.trial
          ? chapterId
          : island.id;
    }
  }
  /**
   * リミックス島はボーナスごとに島が入れ替わる（＝配列を覚え直す）。その見返りに
   * ボーナスを強くする。**この島かどうかは打っている間ずっと変わらない**ので、
   * ステージが切り替わっても上乗せは効き続ける（設計: 32章）。
   */
  const remix = isRemixMachine(machine);
  /** 役リストへ設定とリミックス上乗せを適用する。ステージ切替でも同じ手順を通す。 */
  const buildYakuList = (raw: unknown): YakuList => {
    const base = applySetting(YakuListSchema.parse(raw), machineSetting);
    return remix ? applyRemixBoost(base) : base;
  };
  let yakuList = buildYakuList(chapter.yakuData);
  const payout = PayoutSchema.parse(payoutDataRaw);
  let quizList = QuizListSchema.parse(chapter.quizData);
  // 停止テーブル（第1停止＝実機のリール制御表）。手編集可・無ければ既定制御へフォールバック。
  let stopTable = new StopTableLookup(StopTableSchema.parse(chapter.stopData));
  // 演出レート・補助・フリーズ等の調整値（散在していた定数を集約）。data/tuning/default.json。
  const tuning = TuningSchema.parse(tuningDataRaw);
  /** 1ゲームの間合い（結果を読ませる間・レバーのウェイト）。 */
  const pace = tuning.pace;
  /** ボーナスのゲーム数。リミックス島だけ長い（覚え直しの見返り）。 */
  const bonusSpins = remix
    ? { big: REMIX.spinsPerBig, reg: REMIX.spinsPerReg }
    : { big: tuning.bonus.spinsPerBig, reg: tuning.bonus.spinsPerReg };
  /** おかわりで足すゲーム数。突入より薄く、そのぶん何度も乗る。 */
  const okawariSpins = {
    big: tuning.bonus.okawariSpinsBig,
    reg: tuning.bonus.okawariSpinsReg,
  };
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
    // 目印揃い。AUTO が目印揃いのフラグで目印を狙うのに要る
    ...yakuList.chanceYaku,
  ];
  /** 内部役テーブル（停止テーブルのキー解決に使う）。 */
  let allRolesFlat = yakuList.internalRoles;

  let judge = new YakuJudge(yakuList);
  const calc = new PayoutCalc(payout);
  // 全停止時の「何が揃って何枚か」の確定。表示・音は含まない純粋な計算。
  let roundResolver = new RoundResolver({
    judge,
    calc,
    comboYakuIds: comboYakuIdsOf(yakuList),
    singlePayout: payout.baseMultiplier.single,
    bitaMultiplier: payout.bitaMultiplier,
  });
  const wallet = new CoinWallet(payout.initialCoins);
  const scheduler = new EffectScheduler(effectRates.default);
  const quizState = new QuizState();
  /** 直前のクイズがニアミス（1コマずれ）だったか。出題者の不正解台詞を差し替えるのに使う。 */
  let quizNearMiss = false;
  let slipResolver = new SlipResolver(yakuList, {
    assistMaxCells: tuning.assist.pullInCells,
  });
  const bonusZone = new BonusZone({
    spinsPerBonus: bonusSpins.big,
    spinsPerReg: bonusSpins.reg,
    okawariSpinsBig: okawariSpins.big,
    okawariSpinsReg: okawariSpins.reg,
    bonusEffectRates: effectRates.bonus,
  });
  // 突入〜消化しきりの区間管理（獲得集計・おかわり判定・締め）は BonusSession が持つ。
  const bonusSession = new BonusSession(bonusZone);
  const sfx = new SfxEngine();
  const bgm = new BgmEngine();
  let tenpaiDetector = new TenpaiDetector(yakuList);
  let nearMissDetector = new NearMissDetector(yakuList);
  const playStats = new PlayStats();
  // リミックス台の記録は島の図鑑と別勘定にする（設計: 31章 §4）。
  const zukanScope = remix ? REMIX_ZUKAN_SCOPE : undefined;
  let zukanState = new ZukanState(yakuList, chapterId, zukanScope);
  // クイズの成績は**章ごとに1つ**。図鑑と違ってリミックス台でも分けない——
  // 図鑑を分けたのは「集める」目標を別に立てるためで、こちらは苦手を潰すための
  // 記録なので、打った場所で分断すると用を成さない。
  let quizStats = new QuizStats(chapterId);
  const challengeTracker = new ChallengeTracker();
  let zukanOverlay = new ZukanOverlay(
    zukanState,
    yakuList,
    playStats,
    challengeTracker,
    quizStats,
    quizList.quizzes,
    {
      premium: payout.baseMultiplier.premium,
      bonus: payout.baseMultiplier.bonus,
      cherry: payout.baseMultiplier.cherry,
      spinsPerBig: bonusSpins.big,
      spinsPerReg: bonusSpins.reg,
    },
  );
  // デバッグ section の表示可否（遊ぶ設定で確定・既定OFF）
  const debugVisible = localStorage.getItem('mojislot.debugVisible.v1') === '1';
  const keyBindings = new KeyBindings();
  const settingsOverlay = new SettingsOverlay(
    wallet,
    payout.initialCoins,
    playStats,
    // ステージ切替で作り直されるので、実体ではなく取り出し方を渡す。
    () => zukanState,
    () => quizStats,
    challengeTracker,
    debugVisible,
    keyBindings,
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
  /** 示唆が外れたことを既に伝えたか（1ゲーム1回だけ）。 */
  let shisaMissShown = false;

  // === フリーズ演出の状態 ===
  // freezeActive: シーケンス中は全ユーザー入力をブロックし、stopReel の引き込み/蹴りも無効化する。
  // pendingFreeze: デバッグボタンで「次のレバーでフリーズ」を予約するフラグ。
  let freezeActive = false;
  let pendingFreeze = false;
  /**
   * このボーナスがフリーズを抜けて来たか。**突入ファンファーレを長いほうへ差し替える**
   * ためだけに持つ（showBonusEntryFx で消費する）。
   */
  let freezeGrand = false;
  /** 前回レバーONの時刻。ウェイト音を鳴らすかの判定に使う。 */
  let lastLeverAt = 0;
  /** デバッグ：次のレバーで強制するステップアップの終了色。 */
  let pendingStepColor: StepColor | null = null;
  /**
   * 停止ボタンを受け付けるようになる時刻。レバーONからの待ちで、
   * 実機の「定速になるまで止められない」に相当する（[31] §11）。
   */
  let stopLockUntil = 0;
  /** 遅れの「間」の最中。まだどのリールも回っていないのでレバーとBETを塞ぐ。 */
  let spinPending = false;
  /**
   * リミックス島のステージ切替の待ち（告知の1.5秒＋図柄の読み込み）。
   *
   * この間に次のゲームが始まると、レバーONで決めた内部役と回っている配列が
   * 食い違って出目が壊れる（クイズの問題だけ前ステージのものが出る、など）。
   * 実機でいう「ボーナス終了処理中はレバーを受け付けない」に相当する短い間で、
   * BET とレバーをここで止める。AUTO も同じ経路を通るので合わせて止まる。
   */
  let stageSwapping = false;
  // レバーオン時のフリーズ抽選確率（通常時のみ）／倍速回転スピード。data/tuning で調整。
  const FREEZE_SPIN_SPEED = tuning.freeze.spinSpeed;
  /**
   * フリーズ演出の進行。**音（audio/sfx/freeze.m4a・9.44秒）の構造に合わせてある**——
   * 素材は消灯・溜め・着弾が一本に繋がっていて、途中で切ると上昇が宙に浮く。
   * 数値は波形の解析値そのもの：0.0秒で高域が急降下（消灯）、4.6秒からスペクトルが
   * 3.1kHz→8.2kHz へ単調上昇（溜め）、9.1秒で急落＋音量ピーク（着弾）。
   */
  const FREEZE_SWELL_AT_MS = 4600;
  const FREEZE_RELEASE_AT_MS = 9100;
  /** 溜めの間に暗転をここまで緩める。明けきらない程度に留めて、着弾の落差を残す。 */
  const FREEZE_SWELL_BRIGHTNESS = 0.42;
  /** 実機のウェイト（前ゲームから4.1秒）。速く回している時だけ鳴る。 */
  const LEVER_WAIT_MS = 4100;

  /**
   * リール速度（コマ/秒）。data/tuning が既定で、設定モーダルから上書きできる（体感比較用）。
   * ReelView のモーションブラーはこの速度に比例して強くなる。
   * 速いほど 1コマの通過時間（1000/speed ms）が短く、目押しはシビアになる。
   */
  const reelSpeed = (): number =>
    clampReelSpeed(
      Number(localStorage.getItem(REEL_SPEED_KEY)),
      tuning.reelSpeed ?? REEL_BASE_SPEED,
    );

  // === 確定告知ランプの状態 ===
  // 点灯中（announcedBonus !== null）はボーナス確定。種別は内部確定だが UI 上は伏せる。
  // 点灯中は他演出を 'none' 固定、各リールは確定役の図柄へ強く引き込む（目押しで揃えに行く）。
  let announcedBonus: 'big' | 'reg' | null = null;
  // 確定告知ランプで狙う具体的な役。resolveStopSlip と AUTO(setupAutoTarget) で共用し、
  // 全リール（第1・第2・最終）を同じ役の図柄へ引き込む。確定ランプは種別を最終リールまで伏せる
  // 演出のため共通プレフィックスの [0] 役に固定（例: BIG=すしや / REG=すしず は左中「す・し」共通）。
  let announcedRole: Yaku | null = null;
  /**
   * こぼしたボーナスフラグの持ち越し（実機Aタイプ）。こぼした時点で確定ランプが点く
   * （演出の出ていたゲームは抽選）。目印揃いの内部役のボーナスもここへ入る。
   * 確定告知ランプ（announcedBonus）が点いた後はそちらで揃えに行く。
   */
  let heldBonusYaku: Yaku | null = null;
  /**
   * チャンス目のあと、次ゲーム（持ち越し中のボーナス）で出す演出。狙え・クイズのどちらか。
   * 持ち越し中は普段は演出を出さない（none）が、チャンス目から進んだ時だけ出す。
   */
  let chanceFollow: 'aim' | 'quiz' | null = null;
  /**
   * ボーナスの無いチャンス目のあと、次ゲームで出す**外れの**狙え・クイズ（2026-10-13）。
   * 内部役は普段どおり引き、狙え・クイズの対象だけを BIG にする。BIG のフラグは無いので揃わない。
   */
  let fakeFollow: 'aim' | 'quiz' | null = null;
  /** 持ち越しが始まってからのゲーム数。 */
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

  /**
   * 液晶の背景（島の情景・ドット絵）。グラデーションの上へ重ねる。
   * 情景を描いた島だけ出る（未着手の島は従来どおりグラデーションのまま）。
   */
  const lcdBg = new LcdBackground({
    artBase: ART_BASE,
    // 島ID → [情景の数, 1情景あたりのコマ数]（`tools/gen_lcd_bg.py` の SCENES と揃える）。
    // ここに無い島は背景なしで動く（従来どおりグラデーションのまま）。
    scenes: {
      hiragana_food: [8, 12],
      katakana_animal: [8, 12],
      hiragana_verb: [8, 12],
      yasai: [8, 12],
      security: [8, 12],
    },
  });
  app.stage.addChild(lcdBg.container);
  void lcdBg.setChapter(chapterId);

  // 演出ビジュアル（液晶＋リール背景の色味、フラッシュ）
  const effectVisual = new EffectVisual({
    width: CANVAS_W,
    liquidHeight: LIQUID_AREA_H,
    totalHeight: CANVAS_H,
  });
  app.stage.addChild(effectVisual.bgLayer);

  // クイズの出題者は実機のサブ液晶の作法に倣い「液晶の左下」に置く。
  // 中央〜上部はカットイン・演出のために空けておく。
  // 絵は 48×56 のドット絵を3倍した 144×168（QUIZMASTER_SCALE）。
  const MASTER_W = 48 * QUIZMASTER_SCALE;
  const MASTER_H = 56 * QUIZMASTER_SCALE;
  const MASTER_X = 16 + MASTER_W / 2;
  const MASTER_Y = LIQUID_AREA_H - 10 - MASTER_H / 2;
  // 吹き出しは出題者の**枠の上**に出す（style.css の .speech-bubble）。枠は絵の外に
  // 6px 張り出すので、その上端と左端・中心を canvas 比で渡す。
  {
    const root = document.documentElement.style;
    root.setProperty('--master-top', String((MASTER_Y - MASTER_H / 2 - 6) / CANVAS_H));
    root.setProperty('--master-left', String((MASTER_X - MASTER_W / 2 - 6) / CANVAS_W));
    root.setProperty('--master-cx', String(MASTER_X / CANVAS_W));
  }

  const quizmasterView = new QuizmasterView({
    artBase: ART_BASE,
    x: MASTER_X,
    y: MASTER_Y,
  });
  app.stage.addChild(quizmasterView.container);
  void quizmasterView.setChapter(chapterId);

  // 出題者のボイス。島ごとに別人なので、現在の島のぶんだけ先読みする。
  const voice = new VoiceEngine(`${import.meta.env.BASE_URL}audio/`);
  // SE と BGM もボイスと同じ根を使う。
  sampleBank.setBase(`${import.meta.env.BASE_URL}audio/`);
  /** その出題者が持つ全台詞のファイル名（`ask_0` 等）。先読みに渡す。 */
  const voiceClipsOf = (master: Quizmaster): string[] =>
    Object.entries(master.lines).flatMap(([scene, lines]) =>
      lines.map((_, i) => `${scene}_${i}`),
    );
  const loadVoices = () => {
    const master = quizmasterFor(chapterId);
    if (master) voice.preload(chapterId, voiceClipsOf(master));
  };
  loadVoices();

  // 液晶内の演出ホスト。全画面 DOM 演出（フラッシュ/紙吹雪/カットイン/キラキラ/HIT）を
  // ここに出して液晶外へはみ出させない（overflow:hidden）。
  const lcdFx = document.createElement('div');
  lcdFx.id = 'lcd-fx';
  requireEl('game-area').appendChild(lcdFx);
  setEffectHost(lcdFx);
  // ブラックアウトだけは液晶の外まで落とす（リールも操作部も一緒に沈める）。
  setBlackoutHost(requireEl('cabinet'));

  // 見やすさの設定のうち、CSSでは止めきれないもの（紙吹雪やコインの生成）を
  // 演出側へ流し込む。設定は開いたまま切り替えられるので購読しておく。
  const pushEffectA11y = () => {
    const s = a11y.get();
    setEffectA11y({ reduceMotion: s.reduceMotion, dim: s.dim });
    // 背景は**消さずに止める**。消すと空白を埋めるという目的そのものが失われる
    lcdBg.setPaused(s.reduceMotion);
  };
  pushEffectA11y();
  a11y.settings.subscribe(pushEffectA11y);

  /**
   * 消音中の視覚通知。音でしか出ていない手応え（ビタ・テンパイ）を液晶の下辺に短く出す。
   * **消音していて、かつ設定がONの時だけ**。音が鳴っているなら二重になるので出さない。
   */
  const soundCueEl = document.createElement('div');
  soundCueEl.className = 'sound-cue';
  lcdFx.appendChild(soundCueEl);
  let soundCueTimer: number | null = null;
  const showSoundCue = (text: string, kind?: 'bita') => {
    if (!a11y.get().soundCue || !sfx.isMuted()) return;
    if (soundCueTimer !== null) window.clearTimeout(soundCueTimer);
    soundCueEl.className = kind ? `sound-cue ${kind}` : 'sound-cue';
    soundCueEl.textContent = text;
    requestAnimationFrame(() => soundCueEl.classList.add('show'));
    soundCueTimer = window.setTimeout(() => {
      soundCueEl.classList.remove('show');
      soundCueTimer = null;
    }, 700);
  };

  // 確定告知ランプ（GOGOランプ風）。点灯=ボーナス確定・種別は伏せて「?」表示。
  const announceLampEl = document.createElement('div');
  announceLampEl.id = 'announce-lamp';
  announceLampEl.hidden = true;
  announceLampEl.innerHTML = `<div class="lamp-dome"></div><div class="lamp-text">確定</div><div class="lamp-kind">?</div>`;
  requireEl('game-area').appendChild(announceLampEl);

  // 出題者の吹き出し（DOM, 演出エリア内）。出題者が出ている間しか使わない。
  const speech = new SpeechBubble(requireEl('game-area'));

  // クイズ文章。出題者を左下に置くので、問題文は右へ寄せて被りを避ける。
  const quizQuestionView = new QuizQuestionView(quizState, {
    width: CANVAS_W,
    height: LIQUID_AREA_H,
    insetLeft: MASTER_W + 16,
  });
  quizQuestionView.container.x = CANVAS_W / 2;
  quizQuestionView.container.y = LIQUID_AREA_H / 2;
  app.stage.addChild(quizQuestionView.container);

  /**
   * 出題者の出入りはクイズの局面ひとつで決まる。
   *  - shown（出題〜停止中）: 出題の顔＋出題の台詞
   *  - resolved（全停止後）: 的中なら正解の顔、外れなら不正解の顔
   *  - inactive: 引っ込む
   *
   * 呼び出し側に散らさず1箇所に寄せてある。ジンの頃は台詞を各分岐から呼んでいて、
   * 示唆の色を作り直した時に**呼び忘れた台詞が5つ残った**（[33] §5）。
   */
  quizState.phase.subscribe((phase) => {
    const master = quizmasterFor(chapterId);
    if (phase === 'inactive' || !master) {
      quizmasterView.hide();
      speech.hide();
      return;
    }
    const face =
      phase === 'shown' ? 'ask' : quizState.matched.get() ? 'correct' : 'wrong';
    quizmasterView.show(face);
    // 絵は3表情のまま、ニアミスは台詞だけで差をつける。
    const line = face === 'wrong' && quizNearMiss ? 'near' : face;
    if (!quizmasterView.isVisible()) return;
    // 字幕とボイスは**同じ添字**で引く（別々に選ぶと違う台詞が鳴る）。
    const { text, index } = pickLine(master, line);
    speech.show(text);
    voice.play(line, index);
  });

  /**
   * リールエリアの土台。
   *
   * **以前は全幅を黒で塗っていた**ので、リール3本の左右に幅の広い黒帯が残り、
   * 液晶とリールが上下に割れた2つの箱に見えていた。実機（カルミナ系の筐体）は
   * **液晶が前面の大半を占め、その上にリール窓が小さく浮いている**。
   *
   * そこで液晶と同じ土台をここまで伸ばし、**リール3本ぶんだけを不透明な窓**として
   * 開ける。黒帯だった場所が画面の続きになり、リールは窓に嵌まって見える。
   * 窓の中を不透明に保つのは読みやすさのため——背景が透けると出目が読めない。
   */
  const reelBg = new Graphics();
  reelBg.rect(0, LIQUID_AREA_H, CANVAS_W, CANVAS_H - LIQUID_AREA_H);
  reelBg.fill(liquidGrad);
  app.stage.addChild(reelBg);

  const engines: ReelEngine[] = [];
  const views: ReelView[] = [];

  const totalWidth = CELL_WIDTH * REEL_COUNT + REEL_GAP * (REEL_COUNT - 1);
  const startX = (app.screen.width - totalWidth) / 2;
  /**
   * リールの縦位置。窓の額の上端が演出領域の下端にちょうど接する。
   * 額（`REEL_BEZEL_OUT`）と枠余白（`FRAME_PAD`）とチラ見せ（`REEL_PEEK`）を
   * 順に足した位置が、中央3コマの先頭。
   */
  const reelY = LIQUID_AREA_H + REEL_BEZEL_OUT + FRAME_PAD + REEL_PEEK;


  // 役単位のカラー解決：同じ役の3文字（左/中/右）が同じ色になる
  let colorResolver = new SymbolColorResolver(yakuList);

  /**
   * カットインの背景。役が `cutinArt` を持っていればその一枚絵、無ければ役色から
   * 手続き生成する（放射グロー＋奥に沈めた役名）。
   *
   * 以前は「主役＝島の一枚絵、バー役＝専用絵」と**役の位置**で暗黙に決めていた。
   * これだと役を差し替えた時に絵だけ前の役のまま残る（いなり成立で握り寿司が出る）。
   * 役が自分の絵を名指しする形にすると、書かなかった役は自動で生成側へ落ちる。
   */
  const cutinBackdropFor = (
    yaku: Yaku,
    variant: 'big' | 'reg' = 'big',
  ): CutinBackdrop => ({
    accent: colorResolver.cssForYakuId(yaku.id),
    imageUrl: yaku.cutinArt ? `${ART_BASE}${yaku.cutinArt}` : undefined,
    // 3文字は**リールのドット文字をそのまま借りる**。役ごとの一枚絵を持たせると
    // 役を差し替えた時に絵だけ前の役のまま残るが、リールの文字なら配列に追随する。
    // 色もリールのまま出るので、REGは赤・赤・青（BAR対応が青）になる。
    symbolArt: yaku.symbols.map((sym, reel) => glyphUrlFor(reel, sym)),
    symbolColors: yaku.symbols.map((sym, reel) => colorResolver.cssFor(reel, sym)),
    labelArt: `${ART_BASE}ui/${variant === 'reg' ? 'cutin_regular' : 'cutin_premium'}.png`,
  });

  // 章ごとのドット文字を読み込む。読めなかった文字だけフォント描画へ落ちる
  // （詳細は render/ReelArt.ts）。ステージ切替（リミックス島）で作り直すので let。
  const reelSymbols = () => reelConfig.reels.map((r) => r.cells);
  let { textures: glyphTextures, glosses: glyphGlosses, urlFor: glyphUrlFor } = await loadGlyphArt(
    chapterId,
    reelSymbols(),
    ART_BASE,
  );
  /**
   * 右パネル「リール配列」の中身を作る。実体は下（パネルのDOMが揃ってから）で代入する。
   * ステージ切替でリールが入れ替わったら呼び直す。
   */
  let renderReelStrips: () => void = () => {};
  /** 役の色で染めない図柄（目印とハズレ図柄。色は絵に焼き込んである）。 */
  const isUncolored = (symbol: string): boolean =>
    symbol === reelConfig.landmark || (reelConfig.blanks?.includes(symbol) ?? false);

  for (let i = 0; i < REEL_COUNT; i++) {
    const engine = new ReelEngine(reelConfig.reels[i]);
    const reelIdx = i;
    const view = new ReelView(
      engine,
      // 目印とハズレ図柄は色を焼き込んであるので役の色で染めない（白＝そのまま）
      (symbol) =>
        isUncolored(symbol) ? 0xffffff : colorResolver.colorFor(reelIdx, symbol),
      (symbol) => colorResolver.tierFor(reelIdx, symbol),
      (symbol) => glyphTextures.get(`${reelIdx}:${symbol}`) ?? null,
      (symbol) => glyphGlosses.get(`${reelIdx}:${symbol}`) ?? null,
    );
    view.container.x = startX + i * (CELL_WIDTH + REEL_GAP);
    view.container.y = reelY;
    app.stage.addChild(view.container);
    engines.push(engine);
    views.push(view);
  }

  // コマ番号（0..20）の表示。デバッグ表示ONの時だけ出す。
  // 押した位置と停止位置の差＝引き込みコマ数を、画面上で数えられるようにする。
  for (const v of views) v.setShowCellIndices(debugVisible);

  // リール窓の金属の額（灰の枠）は外した（2026-10-16）。白い地のリールをそのまま液晶の穴に
  // 嵌めた見え方にする。テンパイの光る縁は ReelView 側にある。

  // 成立ラインのインジケーター（リール左脇の5本線）は廃止した（2026-09-23）。
  // 空いたリール左右の下には差枚と払出の計器を置く（#reel-meters・DOM）。
  // 揃った場所はセルの役色タイルとハイライトで既に分かるので、線で重ねて言わない。

  // フラッシュなどの前景エフェクトはリールの上に重ねる
  app.stage.addChild(effectVisual.fxLayer);

  app.ticker.add(() => {
    const now = performance.now();
    for (const engine of engines) engine.tick(now);
    for (const view of views) view.update(now);
    lcdBg.update(now);
    effectVisual.update();
  });

  // === UI 配線 ===

  const coinEl = requireEl('coin-display');
  const betTextEl = requireEl('bet-text');
  const leverBtn = requireEl<HTMLButtonElement>('lever-btn');
  const betBtn = requireEl<HTMLButtonElement>('bet-btn');
  /** MAXBET とレバーが載る台。台のどこを押しても操作が進むようにする。 */
  const deckWell = document.querySelector<HTMLElement>('.deck-well');
  const stopBtns = Array.from(
    document.querySelectorAll<HTMLButtonElement>('.stop-btn'),
  );
  /** 筐体ランプ（操作部左右のスピーカーグリル）。狭画面ではCSSで隠れる。 */
  const cabinetLampEls = Array.from(
    document.querySelectorAll<HTMLElement>('.cabinet-lamp'),
  );
  const resultEl = requireEl('result-display');
  const zukanBtn = requireEl<HTMLButtonElement>('zukan-btn');
  const sideRemainingEl = requireEl('side-remaining');
  const sideRemainingValueEl = requireEl('side-remaining-value');
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
  const sideComboEl = requireEl('side-combo');
  const sideComboValueEl = requireEl('side-combo-value');
  const sideComboMultEl = requireEl('side-combo-mult');
  const sideComboNextEl = requireEl('side-combo-next');
  /** 数が増えた瞬間に一度だけ弾ませる（上乗せ・コンボ継続が目に入るように）。 */
  const bump = (el: HTMLElement) => {
    el.classList.remove('bump');
    void el.offsetWidth;
    el.classList.add('bump');
  };
  const rescueStatusEl = requireEl('rescue-status');
  const stageStatusEl = requireEl('stage-status');
  /**
   * リミックス島の現在ステージを演出液晶の左上に常時出す。
   *
   * 切替の告知はボーナス終了画面で一度流れるだけなので、見逃すと
   * 「配列が変わったのに何へ変わったか分からない」状態になる。ここが最後の手掛かり。
   * リミックス島以外では出さない（章が変わらないので情報量がゼロ）。
   *
   * @param changed 切り替わった直後か。true の時だけ光らせる。
   */
  const updateStageStatus = (changed = false): void => {
    if (!remix) {
      stageStatusEl.hidden = true;
      return;
    }
    stageStatusEl.hidden = false;
    stageStatusEl.textContent = `ステージ ${chapter.name}`;
    stageStatusEl.classList.remove('changed');
    if (changed) {
      // クラスを外した直後に付け直してもアニメは再生されない。
      // レイアウトを読んで強制的に再フローさせる（定番の再生し直し）。
      void stageStatusEl.offsetWidth;
      stageStatusEl.classList.add('changed');
    }
  };
  updateStageStatus();
  const bonusBannerEl = requireEl('bonus-banner');
  betTextEl.textContent = `BET ${calc.bet}`;
  /**
   * 払出＝このゲームで出た枚数。実機はリール直下の7セグに出る。
   * ベットで 0 に戻し、揃った時にその枚数を出す。**前のゲームの数字が残ると
   * 「今いくら出たか」が読めない**ので、次のベットで必ず消す。
   */
  const payoutEl = requireEl('payout-display');
  const setPayout = (n: number): void => {
    payoutEl.textContent = String(n);
    payoutEl.classList.toggle('plus', n > 0);
  };
  setPayout(0);
  /** BETランプ。メダルが入っているかを示す（実機の 3BET ランプ）。 */
  const setBetLamp = (on: boolean): void => {
    betTextEl.classList.toggle('on', on);
  };
  const effectStatusEl = requireEl('effect-status');
  let betPlaced = false;
  /**
   * この1ゲームで出た演出の控え。全停止で `EffectStats` へ流して空に戻す。
   * **同じ演出が2回出ても1回**として数えたいので Set で持つ。
   */
  const spinMarks = new Set<string>();
  /**
   * この1ゲームでデバッグの強制を使ったか。使った回は帳簿へ入れない——
   * 狙って出せる演出を混ぜると期待度が壊れる。
   */
  let spinDebugForced = false;
  const markEffect = (key: string): void => {
    spinMarks.add(key);
  };
  /**
   * 前ゲームで終わったステップアップの帳簿のキー（終了色と連続演出の長さ）。
   * **予告したゲーム＝このゲームの結果で採点する**ので持ち越す。
   *
   * ステップアップはレバーで光り、停止ごとに色が進み、決まった色が指すのは
   * **次ゲーム**がボーナスかどうか。出たゲームの結果で数えると別の話になる。
   * 〔2026-10-14〕以前はレバーで控えて同じゲームの全停止で採点しており、
   * 予告していないゲーム（契機の小役のゲーム）の結果を数えていた。
   */
  let pendingStepKeys: string[] = [];
  /** その持ち越しがデバッグの強制だったか。強制した回は帳簿へ入れない。 */
  let pendingStepForced = false;
  /**
   * このゲームでステップアップが走ったか。**演出率の母数に入れる**ために持つ。
   * `currentEffect` は none のままなので、これが無いと「画面いっぱいに色が出た
   * ゲーム」が無演出として数えられる（演出率は設定を読める唯一の数字なので、
   * 見えたものと数字がずれると読めなくなる）。
   */
  let stepRan = false;
  let resultTimer: number | null = null;
  let pendingDebugEffect: ForcedEffect | null = null;
  /** デバッグ：次のレバーで強制する内部役（ボーナスのおかわり確認用）。 */
  let pendingForcedRole: InternalRoleResult | null = null;
  /** デバッグ：予約した内部役で出す演出（目印揃いの予約では狙えを出して AUTO に目印を狙わせる）。 */
  let pendingForcedEffect: EffectType | null = null;
  /** デバッグ：次のレバーで遅れを強制する。抽選と条件を飛ばして見た目だけ確認する。 */
  let pendingForcedDelay = false;
  let autoMode = false;
  /** AUTOをOFFにした後、現在ゲームを全停止まで消化している最中か。 */
  let autoFinishing = false;

  let internalRoleLottery = new InternalRoleLottery(yakuList, Math.random);

  /**
   * 演出が指している役。普段は内部役の表示役だが、矛盾（小役を指す）とチャンス目のあとの
   * 外れの狙え・クイズでは差し替わる。AUTO と示唆の発展はこれを狙う（打ち手と同じものを見る）。
   */
  let effectTargetYaku: Yaku | null = null;

  interface EffectOptions {
    targetYaku?: Yaku | null;
    shisaTier?: ShisaTier | null;
    /** 示唆で「この色なら当たりうる」役の一覧（吹き出しに並べて迷わせる）。 */
    shisaCandidates?: readonly Yaku[];
  }

  /**
   * ステップアップ演出の段を出す（0＝消す）。契機役のゲームでだけ動く。
   * このゲームのことは何も言わず、**終了色（最後のゲームの第3停止）が次ゲームの予告**。
   * 手続きは `productions/StepUp.ts`、率は `tuning.stepUp`。
   */
  const setStep = (step: number) => setStepFx(step);

  /**
   * 走っているステップアップ。連続演出では複数ゲームにまたがって持ち越す。
   * `game` は今何ゲーム目か（1始まり）、`length` は何ゲーム続くか。
   */
  interface StepRun {
    color: StepColor;
    length: number;
    game: number;
    /** デバッグの予約で出したか。強制した回は帳簿へ入れない。 */
    forced: boolean;
    /** 今の段。続いたゲームはここから始める。 */
    level: number;
  }
  let stepRun: StepRun | null = null;
  /** デバッグ：次のステップアップの連続演出の長さ（null＝抽選どおり）。 */
  let pendingStepChain: 1 | 2 | 3 | null = null;
  /** デバッグ：次のレバーで出す予兆。内部役は BIG に予約する。 */
  let pendingForcedOmen: OmenKind | null = null;

  /**
   * 演出の手続きの進行役。レバー・停止・全停止・片付けの段取りを、手続きごとに
   * 1か所へ登録する（`productions/EffectProcedures.ts`）。ボーナス中に出してよいかは
   * 手続きの性質で決まっていて、進行役が `never` の手続きをボーナス中に始めさせない。
   */
  const director = new EffectDirector();

  director.register<StepRun>('stepUp', {
    // 1ゲーム目は青から、続いたゲームは前のゲームで止まった段から始める
    onLever: (run) => setStep(run.level),
    onStop: (run, stopNo) => {
      // 押した位置や出目では変わらない——チェリーを落としても予告は生きる
      const next = stepLevelAfterStop(run.level, stopNo, stepCapFor(run.game, run.length, run.color));
      if (next <= run.level) return;
      run.level = next;
      setStep(next);
      sfx.stepUp(next);
    },
    // 続くなら「つづく」を出す。最後のゲームで終了色が出るまで色は決まらない
    onAllStop: (run) => setStepNext(run.game < run.length),
    // 終了色は次のレバーまで残す。予告している当のゲームが始まるまで見えていないと、
    // 何を待っているのか分からなくなる。続くゲームではレバーでもう一度始める
    onEnd: () => {
      setStepNext(false);
      setStep(0);
    },
  });

  /**
   * 無音（予兆）。レバー音を鳴らさず、全停止まで BGM を絞る。
   * 消音中は音の変化に気づけないので、音の手応えを画面に出す設定では文字で出す。
   */
  director.register<OmenPlan>('omenSilence', {
    onLever: () => {
      bgm.setDucked(true);
      showSoundCue('無音');
    },
    onAllStop: () => bgm.setDucked(false),
    onEnd: () => bgm.setDucked(false),
  });

  /**
   * バックライト消灯（予兆）。レバー・第1停止・第2停止のどこかで3リールの
   * バックライトが落ち、結果の表示を片付けるまで戻らない。図柄は読める暗さに留める
   * （出目を読ませないのは目押しのゲームとして筋が悪い）。
   */
  const setBacklight = (on: boolean) => {
    for (const v of views) v.setBacklight(on);
  };
  director.register<OmenPlan>('omenBacklight', {
    onLever: (plan) => {
      if (plan.at === 0) setBacklight(false);
    },
    onStop: (plan, stopNo) => {
      if (plan.at === stopNo) setBacklight(false);
    },
    onResultClear: () => setBacklight(true),
    onEnd: () => setBacklight(true),
  });

  const applyEffect = (effect: EffectType, options: EffectOptions = {}) => {
    currentEffect = effect;
    if (effect === 'none') effectTargetYaku = null;
    for (const engine of engines) engine.setSpeed(reelSpeed());

    // 示唆tierも内部役に対応する候補からactivateRoundで確定済み。
    currentShisaTier = effect === 'shisa' ? (options.shisaTier ?? null) : null;
    effectVisual.apply(
      effect,
      currentShisaTier ? SHISA_TINT[currentShisaTier.color] : undefined,
    );

    // ラベルとクラスは対応表から引く（EffectPresentation）。
    // 分岐ごとに書いていた頃は、色や演出を足すたびに揃えて直す必要があった。
    const view = EFFECT_STATUS[effect];
    effectStatusEl.classList.remove(...EFFECT_STATUS_CLASSES);
    effectStatusEl.textContent = view.label;
    if (view.statusClass) effectStatusEl.classList.add(view.statusClass);

    if (effect === 'shisa' && currentShisaTier) {
      effectStatusEl.classList.add(`tier-${currentShisaTier.color}`);
      // 色に頼らない設定では色名を添える。示唆は**色がそのまま候補の範囲**なので、
      // 色が読めないと「示唆が出た」までしか伝わらない。
      if (a11y.get().colorSafe) {
        const name = TIER_COLOR_NAME[currentShisaTier.color];
        if (name) effectStatusEl.textContent = `${view.label}・${name}`;
      }
      sfx.shisa();
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
      // 回答操作なし方式：まず問題だけを出し、答えの役を引き込み対象にする（操作はaim相当）。
      // 答えと成立結果は全停止後に QuizState.resolve() で表示する。
      const quiz = options.targetYaku
        ? quizList.quizzes.find((q) => q.answerYakuId === options.targetYaku?.id)
        : null;
      if (quiz) quizState.reveal(quiz, yakuList);
      sfx.quiz();
    } else if (effect === 'aim') {
      // レバーONで決めた内部役をそのまま予告する。aimは候補選定時点で3文字役に限定済み。
      const targetYaku = options.targetYaku;
      if (!targetYaku) return;
      showAimNotice({
        symbols: targetYaku.symbols,
        // 各文字を実リールのセル色に合わせる（左/中/右）
        colors: targetYaku.symbols.map((s, i) => colorResolver.cssFor(i, s)),
        yakuName: aimNameOf(targetYaku),
        imageUrl: `${ART_BASE}ui/aim.png`,
        hasPremium: targetYaku.category === 'premium',
        // 現行 canvas 寸法に基づくリール座標比（旧ハードコードのズレを解消）
        reelCentersXFrac: [0, 1, 2].map(
          (i) => (startX + i * (CELL_WIDTH + REEL_GAP) + CELL_WIDTH / 2) / CANVAS_W,
        ),
        reelTopYFrac: reelY / CANVAS_H,
      });
      sfx.shisa(); // 既存の示唆 SE を流用
    }
  };
  applyEffect('none');

  // 演出が本当の内部役を表せるかの判定と、示唆が示す候補役の逆算。
  let eligibility = new EffectEligibility({
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

  /**
   * ビタチャンス（2026-10-02）。ボーナス中のレバーONで抽選し、出たゲームは目印を
   * ぴったり押したリールが滑らない（StopController の bitaMark）。3つ揃えば上乗せ。
   * 1回のボーナスで乗る回数には上限がある（腕のいい人ほど揃うので、無いと終わらない）。
   */
  let bitaChance = false;
  let bitaThisBonus = 0;
  const landmarkNow = (): string | null => reelConfig.landmark ?? null;
  /**
   * 狙えに出す役名。目印揃いの役は「目印揃い」とだけ出す。リーチ目・チャンス目は
   * 止まった出目を読んで分かるもので、狙うものではない（中段かどうかで意味が変わるので、
   * 名前を出すとボーナスの有無まで言ってしまう）。
   */
  const aimNameOf = (yaku: Yaku): string =>
    yaku.category === 'chance' ? '目印揃い' : yaku.name;

  const activateRound = (
    role: InternalRoleResult,
    effect: EffectType,
    source: RoundSource,
    /** 狙え・クイズの対象を内部役の表示役から差し替える（チャンス目のあとの外れの形）。 */
    targetOverride: Yaku | null = null,
  ) => {
    const mark = landmarkNow();
    bitaChance =
      bonusSession.spinActive &&
      mark !== null &&
      source === 'lottery' &&
      bitaThisBonus < tuning.bonus.bitaMaxPerBonus &&
      Math.random() < tuning.bonus.bitaChanceRate;
    // ビタチャンスのゲームは他の演出を出さない。目印と役の両方は狙えないので、
    // どちらを狙うかを打ち手に選ばせる（演出が役を教えていると選択にならない）。
    if (bitaChance) effect = 'none';
    const yaku = internalRoleLottery.yakuFor(role);
    // 回転中の差し替えを廃したので、レバーONごとに必ず新しい番号になる
    // （以前はデバッグの即時差し替えだけが同じ番号を使い回していた）。
    currentRound = createRoundContext({
      roundNumber: ++roundNumber,
      internalRole: role,
      effect,
      source,
      bonusActive: bonusSession.spinActive,
    });
    if (debugVisible) {
      cabinetEl.dataset.internalRole = `${role.kind}:${role.yakuId ?? '-'}`;
    }
    shisaEscalated = false;
    shisaMissShown = false;
    // 矛盾 5.1：通常時のボーナスのゲームで出す演出（狙え・示唆・クイズ）の一部は、
    // 小役を指す。小役のフラグは無いので、言われたとおりに押しても揃わない。
    // テンパイさせれば最後のリールでずれて止まる＝リーチ目（StopController.reachEye）
    const decoyPool =
      effect !== 'none' &&
      yaku !== null &&
      (yaku.category === 'premium' || yaku.category === 'bonus') &&
      !bonusSession.spinActive &&
      Math.random() < tuning.contradiction.decoyRate
        ? yakuList.coreYaku.filter((y) => eligibility.canRepresent(effect, y))
        : [];
    const decoy = decoyPool[Math.floor(Math.random() * decoyPool.length)] ?? null;
    const shown = decoy ?? targetOverride ?? yaku;
    effectTargetYaku = effect === 'none' ? null : shown;
    const shisaTier =
      effect === 'shisa' && shown ? eligibility.pickTier(shown, Math.random) : null;
    applyEffect(effect, {
      targetYaku: shown,
      shisaTier,
      shisaCandidates: shisaTier
        ? eligibility.candidatesFor(shisaTier, activeInternalRoleState())
        : undefined,
    });
    if (bitaChance && mark !== null) {
      showAimNotice({
        symbols: [mark, mark, mark],
        colors: ['#ffd84a', '#ffd84a', '#ffd84a'],
        yakuName: `ビタチャンス！ 目印「${mark}」`,
        imageUrl: `${ART_BASE}ui/aim.png`,
        hasPremium: true,
        reelCentersXFrac: [0, 1, 2].map(
          (i) => (startX + i * (CELL_WIDTH + REEL_GAP) + CELL_WIDTH / 2) / CANVAS_W,
        ),
        reelTopYFrac: reelY / CANVAS_H,
        arrowReels: [true, true, true],
      });
      sfx.shisa();
    }
  };

  /**
   * 次ゲームの先読み。**ステップアップの終了色を決めるためだけ**に、
   * 通常抽選と同じ手順で1ゲーム先の役と演出を引いておく。
   *
   * 抽選の順序が1ゲーム早まるだけなので**出玉は変わらない**。使われずに
   * 捨てられることもあるが（ボーナス突入・デバッグ予約・持ち越しが挟まった時）、
   * 独立抽選なので捨てても分布は動かない。捨てられた分は予告が外れる側に回る。
   */
  interface PreRoll {
    role: InternalRoleResult;
    effect: EffectType;
  }
  let preRoll: PreRoll | null = null;
  /**
   * ステップアップを経由しない普通のゲーム。**BIG と REG は落とす**——
   * ボーナスはステップアップ経由でしか出さないので、ここで引くと二重になる。
   */
  const rollNormalGame = (): PreRoll => {
    const role = withoutBonus(internalRoleLottery.draw(activeInternalRoleState()));
    const yaku = internalRoleLottery.yakuFor(role);
    // miss / 1枚役（表示役なし）は none。それ以外は「表現できる演出＋無演出」から
    // レート抽選する。当たっているのに演出が出ない（＝狙えない）ゲームがここで生まれる。
    const effect: EffectType = role.freeze
      ? 'none'
      : yaku
        ? scheduler.rollAvailable(eligibility.eligibleEffects(yaku))
        : 'none';
    return { role, effect };
  };

  /**
   * ステップアップの終了色を決める。**次ゲームで狙える形になるか**で見る。
   *
   * 「狙え」と「クイズ」は図柄を名指しする演出で、出れば取りこぼしがほぼ無い。
   * 示唆は色しか出ないので候補が絞れず、ここでは予告の対象に含めない——
   * 「金が出たのにBIGを落とした」が普通に起きると予告が信用されなくなる。
   *
   * どの色にもガセを混ぜる。確定にすると、赤や金が出た瞬間にそのゲームを打つ
   * 意味が「消化」に変わる（[spec] 出たら意味があるが出なくても否定にならない）。
   */
  /**
   * ステップアップの色と、次ゲームの中身。手続きと根拠は `productions/StepUp.ts`、
   * 率は `tuning.stepUp`（sim も同じものを読む）。
   */
  const stepCfg = tuning.stepUp;

  /**
   * 通常抽選から BIG と REG を落とす（フリーズ役は残す）。
   * 落とした分は miss へ回す——`roleFilter` で除くと確率が全役へ再配分されて
   * 小役が増え、出玉が動く。
   */
  const missRole = internalRoleLottery.forRoleId('miss');
  const withoutBonus = (role: InternalRoleResult): InternalRoleResult => {
    // **ボーナス中は落とさない。** ここで落とすとおかわり（ボーナス中の再当選）が
    // 消える。上乗せが出玉の主役なので、消すとBIG平均が半分以下になる。
    if (bonusSession.spinActive) return role;
    if (role.freeze) return role;
    if (role.kind !== 'big' && role.kind !== 'reg') return role;
    return missRole ?? role;
  };

  /** 色から次ゲームを作る。 */
  const buildPreRoll = (color: StepColor): PreRoll => {
    // 設定差はここに乗る（演出の出方は変えず、繋がる率だけを動かす）。
    const bonus = pickStepBonus(stepCfg, color, stepBonusMultiplier(machineSetting), Math.random);
    if (bonus) {
      const bigs = yakuList.premiumYaku;
      const yaku =
        bonus === 'big'
          ? (bigs[Math.random() < 0.5 ? 0 : 1] ?? bigs[0])
          : yakuList.bonusYaku[0];
      if (yaku) {
        // **ボーナスの告知は従来どおり。** ここで演出を必ず出すと、無演出で引く
        // ボーナスが無くなって持ち越しが起きず、リーチ目と確定ランプが死ぬ。
        return {
          role: internalRoleLottery.forYaku(yaku),
          effect: scheduler.rollAvailable(eligibility.eligibleEffects(yaku)),
        };
      }
    }
    // ボーナスでない場合は**必ず演出を出す**。緑や赤が出たのに何も起きずに
    // 終わると、色を見た意味がなくなる（先告知）。
    const role = internalRoleLottery.draw(activeInternalRoleState(), {
      allowMiss: false,
      roleFilter: (r, y) =>
        r.kind !== 'big' && r.kind !== 'reg' && !r.freeze && y !== null,
    });
    const yaku = internalRoleLottery.yakuFor(role);
    return {
      role,
      effect: yaku ? scheduler.rollForced(eligibility.eligibleEffects(yaku)) : 'none',
    };
  };

  /**
   * ステップアップの契機になる内部役か（チェリーと払い出しの大きい小役）。
   * ここに入るのは `stepUp.entryRate` の割合だけ——全部で入れるとボーナスが14倍になる。
   */
  const stepTrigger = (role: InternalRoleResult): boolean =>
    isStepTrigger(role.kind, internalRoleLottery.yakuFor(role)?.payout ?? 0, stepCfg);

  const drawDebugRole = (effect: ForcedEffect): InternalRoleResult =>
    internalRoleLottery.draw(activeInternalRoleState(), {
      allowMiss: false,
      // デバッグ強制は「その演出で表現できる表示役を持つ内部役」だけに絞る（1枚役は除外）。
      roleFilter: (_role, yaku) =>
        yaku !== null && eligibility.canRepresent(effect, yaku),
    });

  /**
   * デバッグ：演出を強制する。**必ず次のレバーへの予約**にする。
   *
   * 以前は回転中に押すと現在のゲームを差し替えていたが、レバーONを1ゲームの確定点と
   * する作りと食い違う。すでに止めたリールがある状態で内部役だけ挿げ替わるので、
   * 引き込みの前提が崩れて出目が壊れる。他の強制（フラグ・遅れ・フリーズ）は
   * すべて予約なので、ここだけ即時なのも一貫していなかった。
   *
   * 確定告知ランプ点灯中とフリーズ中は受け付けない。どちらも進行が固定されていて
   * 演出は none のまま回るので、無理に差し込むと**実際には起こらない組み合わせ**を
   * 見せることになる（遅れのデバッグで同じ判断をしている）。
   */
  const forceDebugEffect = (effect: ForcedEffect, label: string) => {
    if (freezeActive) {
      showResult('フリーズ中は予約できません', 'none');
      return;
    }
    if (announcedBonus) {
      showResult('確定ランプ点灯中は演出が出ません', 'none');
      return;
    }
    // 予約済みの上へ重ねた時は、黙って消さずに差し替えたことを伝える。
    const replaced = pendingDebugEffect !== null && pendingDebugEffect !== effect;
    pendingDebugEffect = effect;
    showResult(
      replaced ? `${label}へ差し替え（次のレバー）` : `${label}を次のレバーに予約`,
      'win',
    );
  };

  /**
   * 差枚の符号を色で見せる。
   *
   * **残量の警告はもう無い**——借りない方式にしたので、残高で打てなくなることがない。
   * 以前は15枚以下で赤、50枚以下で黄にして「そろそろ入れろ」を伝えていた。
   */
  const updateCoinWarning = (n: number) => {
    coinEl.classList.toggle('minus', n < 0);
    coinEl.classList.toggle('plus', n > 0);
  };

  /**
   * 差枚の表示。0 から下へ進むので符号を付けないと減っているのが読めない。
   * ラベル（「差枚」）はリール脇の計器の `.rm-label` が持つので、ここは数字だけ。
   */
  const coinLabel = (n: number): string => `${n > 0 ? '+' : ''}${n}`;

  // コイン表示をなめらかにカウントアップ
  let displayedCoin = wallet.coins.get();
  let coinAnimRaf: number | null = null;
  const animateCoinTo = (target: number) => {
    updateCoinWarning(target);
    if (coinAnimRaf !== null) cancelAnimationFrame(coinAnimRaf);
    const start = displayedCoin;
    const diff = target - start;
    if (diff === 0) {
      coinEl.textContent = coinLabel(target);
      return;
    }
    const durMs = Math.min(900, 200 + Math.abs(diff) * 8);
    const startTime = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - startTime) / durMs);
      const eased = 1 - Math.pow(1 - t, 3);
      displayedCoin = Math.round(start + diff * eased);
      coinEl.textContent = coinLabel(displayedCoin);
      if (t < 1) {
        coinAnimRaf = requestAnimationFrame(step);
      } else {
        displayedCoin = target;
        coinAnimRaf = null;
      }
    };
    coinAnimRaf = requestAnimationFrame(step);
  };
  coinEl.textContent = coinLabel(displayedCoin);
  updateCoinWarning(displayedCoin);
  wallet.coins.subscribe(animateCoinTo);

  // サンド（ユニット）：持メダル表示＋メダル貸出（コイン補充）。設定から移設。
  const unitMedalEl = document.getElementById('unit-medal');
  if (unitMedalEl) {
    const setMedal = (n: number) => {
      // 借りないので 0 から下へ進む。符号を付けないと「減っている」が読めない。
      unitMedalEl.textContent = `${n > 0 ? '+' : ''}${n}`;
      unitMedalEl.classList.toggle('plus', n > 0);
      unitMedalEl.classList.toggle('minus', n < 0);
    };
    setMedal(wallet.coins.get());
    wallet.coins.subscribe(setMedal);
  }
  // 差枚は coins そのもの（借りないので持メダルと差枚が一致する）。投資はベット総額。
  const unitInvestEl = document.getElementById('unit-invest');
  const unitPaybackEl = document.getElementById('unit-payback');
  const renderSahmai = () => {
    if (unitInvestEl) unitInvestEl.textContent = String(wallet.investmentTotal.get());
    if (unitPaybackEl) unitPaybackEl.textContent = String(wallet.paybackTotal.get());
  };
  renderSahmai();
  wallet.coins.subscribe(renderSahmai);
  wallet.investmentTotal.subscribe(renderSahmai);
  wallet.paybackTotal.subscribe(renderSahmai);

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

  // 戦の記録を組む。計数と、計数せず閉じた戦の控え（RunDraft）で同じ形にする。
  // runId は戦の開始時に振る。控えから自動確定された戦と計数が重なっても二重に積まれない。
  let runId = crypto.randomUUID();
  const buildRunRecord = (settledAt: number): RunRecord => {
    const investment = wallet.investmentTotal.get();
    const payback = wallet.paybackTotal.get();
    return {
      runId,
      memberId: getMemberId(),
      memberName: getMemberName(),
      chapterId,
      machineId: machine.id,
      startedAt: runStartedAt,
      settledAt,
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
    };
  };
  // 計数せずタブを閉じても戦を失わないよう、変わるたびに控えを書く（次の起動で確定する）。
  const persistRunDraft = (): void => {
    if (runSpinCount > 0) saveRunDraft(buildRunRecord(Date.now()));
  };
  wallet.investmentTotal.subscribe(persistRunDraft);
  wallet.paybackTotal.subscribe(persistRunDraft);

  // 計数＝この戦を締める：spinCount>0 なら1戦を RunHistory に確定記録し、差枚と戦カウンタをリセット。
  //
  // 呼び口は**操作部の右端の1つだけ**。以前はドックにも同じ動作のボタンがあり、
  // しかも名前が「精算」と「計数」で違っていた。実機では精算＝クレジットを戻す、
  // 計数＝メダルを流す、で別物なので、同じ動作に2つの名前を付けるのは紛らわしい。
  // ここがやるのはメダルを流す方なので「計数」に統一した。
  const settleRun = (): void => {
    // 計数=この戦の区切り。計測中なら自動停止（sahmai が0に戻り時速が誤って跳ねるのを防ぐ）。
    // ※ runTimer は下方で生成（このハンドラはクリック時=bootstrap完了後に走るので参照は安全）
    runTimer.stop();
    sfx.count();
    // 次に通常へ戻る時から別の曲になる。今かかっている音は変えない——
    // 締めた直後に切り替わると、計数の余韻が途切れる。
    bgm.reshuffle();
    // 空打ち（1回も回さず計数）は機械割が算出不能なので記録しない＝離脱は破棄に準ずる
    if (runSpinCount > 0) appendRunRecord(buildRunRecord(Date.now()));
    runId = crypto.randomUUID();
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
    // 戦カウンタを0へ戻してから財布を戻す（戻す通知で控えを書き直さない）
    clearRunDraft();
    wallet.reset(0);
  };
  /**
   * メニュー（ドックの「メニュー」）。**遊技中に触らないもの**をまとめる。
   * 計数・消音・ホールへ戻る。オートは遊技中に切り替えるのでドックへ直接置いた。
   */
  {
    const overlay = document.getElementById('menu-overlay');
    const openBtn = document.getElementById('dock-menu');
    const closeMenu = (): void => {
      if (!overlay) return;
      overlay.hidden = true;
      openBtn?.classList.remove('on');
    };
    openBtn?.addEventListener('click', () => {
      if (!overlay) return;
      const open = overlay.hidden === true;
      overlay.hidden = !open;
      openBtn.classList.toggle('on', open);
    });
    overlay?.querySelector('.menu-close')?.addEventListener('click', closeMenu);
    // 背景を押しても閉じる。開いたまま打てると、次のゲームでシートが邪魔になる。
    overlay?.addEventListener('click', (ev) => {
      if (ev.target === overlay) closeMenu();
    });
    // 中の操作を選んだら閉じる。押した結果が見えないと、効いたのか分からない。
    for (const item of overlay?.querySelectorAll('.menu-item') ?? []) {
      item.addEventListener('click', closeMenu);
    }
  }

  document.getElementById('settle-btn')?.addEventListener('click', settleRun);

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

  /** コイン表示の横に「+N」を出す。 */
  const showCoinFloatAt = (amount: number, premium: boolean) =>
    showCoinFloat(coinEl, amount, premium);
  /** 筐体の中心からコインを撒く。 */
  const showCoinBurstAt = (count: number) => showCoinBurst(cabinetEl, count);

  // 章名をヘッダー（演出ステータス上）に出すため、effectStatus の title に
  // 章説明を入れておく（ホバーで確認）
  effectStatusEl.title = `${chapter.name}：${chapter.description}`;

  // 連チャン表示（倍率も併記）＋ cabinet の連チャンオーラ
  // 連チャン昇格演出。段の定義は EffectPresentation.STREAK_TIERS。
  let prevStreakTier = 0;
  let prevStreak = 0;
  /**
   * リール右上の「コンボ」。ボーナス中は常に、通常時は2連から出す。
   * 倍率と「あと◯で×◯」を添えて、次に何を目指して止めるかが読めるようにする。
   */
  const updateComboSide = () => {
    const streak = playStats.stats.get().streak;
    const show = bonusZone.active.get() || streak >= 2;
    sideComboEl.hidden = !show;
    if (!show) return;
    sideComboValueEl.textContent = String(streak);
    const mult = calc.streakMult(streak);
    sideComboMultEl.textContent = mult > 1 ? `×${mult}` : '';
    const next = calc.nextStreakTier(streak);
    sideComboNextEl.textContent = next ? `あと${next.minStreak - streak}で×${next.mult}` : '最大';
  };
  const updateStreakUI = (streak: number) => {
    updateComboSide();
    if (streak > prevStreak && !sideComboEl.hidden) bump(sideComboValueEl);
    prevStreak = streak;
    const tier = streakTierOf(streak);
    cabinetEl.classList.remove(...STREAK_TIER_CLASSES);
    if (tier >= 1) cabinetEl.classList.add(STREAK_TIERS[tier - 1].className);
    // 昇格した瞬間（段が上がった時）にランクアップ演出
    if (tier > prevStreakTier && tier >= 1) {
      const color = STREAK_TIERS[tier - 1].color;
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
    // 文字はドット絵の一枚絵。液晶の中（背景・出題者）と同じ粒度に揃えるため、
    // Webフォント＋グラデーションのCSS描画から差し替えた（生成: tools/gen_banner.py）
    const src = kind === 'reg' ? 'ui/regular.png' : 'ui/big_bonus.png';
    bonusBannerEl.innerHTML =
      `<img class="bonus-banner-img${kind === 'reg' ? ' reg' : ''}" alt="" src="${ART_BASE}${src}">`;
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
    // 前回の設定示唆はここで役目を終える。この区間の答えは終了時に出し直す
    setCabinetLamp(null);
    // フリーズを抜けた7揃いだけ長いほうのファンファーレになる＝格の違いが音で出る。
    const grand = freezeGrand;
    freezeGrand = false;
    sfx.bonusEnter(kind, grand);
    showPremiumCutin(yaku.name, yaku.symbols, cutinBackdropFor(yaku, kind), kind);
    flashScreen({
      color: kind === 'reg' ? '#cdd6e0' : '#ffd700',
      alpha: kind === 'reg' ? 0.75 : 0.85,
      durMs: kind === 'reg' ? 360 : 400,
    });
    spawnConfetti(kind === 'reg' ? 60 : 100);
    shakeBody(kind === 'reg' ? 400 : 600);
    window.setTimeout(() => {
      showBonusBanner(kind);
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
    triggerNextChanceRole: (kind: 'chance-bonus' | 'chance') => {
      // 次のレバーで目印揃いの内部役を強制する。BIG1 を伴う形で確かめる
      const big = yakuList.premiumYaku[0]?.id;
      const roleId = kind === 'chance' ? 'chance' : `chance_${big}`;
      const role = internalRoleLottery.forRoleId(roleId);
      if (!role) return;
      pendingForcedRole = role;
      // 狙えも出す。AUTO は演出の出たゲームでしか狙わないので、これで目印を狙って揃える
      pendingForcedEffect = 'aim';
      showResult(`${roleId} を「目印揃いを狙え」付きで次のレバーに予約`, 'win');
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
      //
      // **回っている最中のゲームは差し替えない。** すでに止めたリールがある状態で
      // 内部役だけ挿げ替えると引き込みの前提が崩れて出目が壊れる。点灯だけしておけば、
      // 次のレバーから `announcedBonus` の分岐が毎ゲーム確定役を回すので回収できる。
      if (!announcedBonus && !bonusZone.isActive() && !freezeActive) {
        announceBonus();
        const anySpinning = engines.some((engine) => engine.state.get() === 'spinning');
        if (anySpinning) showResult('点灯。次のレバーから回収できます', 'win');
      }
    },
    triggerWinTest: () => {
      // 役成立SE＋中央ハイライト＋コインフロート＋紙吹雪少々
      sfx.winCore();
      for (const v of views) v.highlightCenter(1400);
      showCoinFloatAt(24, false);
      showCoinBurstAt(5);
    },
    triggerTenpaiSe: () => {
      sfx.tenpaiPremium();
      // どれか1リールに枠フラッシュ
      views[2].startTenpaiFlash(false);
      window.setTimeout(() => views[2].stopTenpaiFlash(), 2500);
    },
    triggerNextStepUp: (color: StepColor, chain?: 1 | 2 | 3) => {
      // 素の出現率はチャンス役の 5.5%、しかも色は 青45/緑35/赤18/金2 なので金は待てない。
      // 連続演出は赤でも3ゲーム続くのが 1/7 なので、長さも指定できるようにする。
      pendingStepColor = color;
      pendingStepChain = chain ?? null;
      const name = { blue: '青', green: '緑', red: '赤', gold: '金' }[color];
      const len = chain && chain > 1 ? `・${chain}ゲーム連続` : '';
      showResult(`ステップアップ（${name}${len}）を次のレバーに予約`, 'win');
    },
    triggerNextOmen: (kind: OmenKind) => {
      const big = yakuList.premiumYaku[0];
      if (!big) return;
      pendingForcedRole = internalRoleLottery.forYaku(big);
      pendingForcedEffect = 'none';
      pendingForcedOmen = kind;
      showResult(`予兆（${kind === 'silence' ? '無音' : 'バックライト消灯'}）を次のレバーに予約`, 'win');
    },
    triggerCabinetLamp: () => {
      // 設定示唆のランプ。素はボーナス終了時にしか点かないので単体で見られるようにする。
      setCabinetLamp(drawCabinetLamp(machineSetting, Math.random).color);
    },
    triggerSignLamp: (level: SignLampLevel) => {
      // 看板のランプ。素はコンボが節目（5・10…）に届いた時にしか光らない。
      showSignLamp(level);
    },
    triggerBonusResult: () => {
      // 終了画面の示唆はボーナスを抜けないと見られない。中身は本番と同じ抽選を回す。
      showBonusResult(200, 'big');
    },
    triggerPayoutSound: () => {
      // 15枚＝5発。枚数が音の長さになっているかを聴く。
      sfx.payout(15);
      showCoinFloatAt(15, false);
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
      // リール左上の「残り」は BIG/REG を区別しない（おかわりは同じ残り回数に合算され、
      // 種別を出すと BIG 中の RB おかわりで表示が揺れて紛らわしいため）。
      // BIG/REG の差は突入カットイン（金/銀）と終了リザルトで出す。
      // 残りが増えた＝上乗せ。数字を弾ませて、カットインを見逃しても分かるようにする。
      if (!sideRemainingEl.hidden && remaining > Number(sideRemainingValueEl.textContent)) {
        bump(sideRemainingValueEl);
      }
      sideRemainingEl.hidden = false;
      sideRemainingValueEl.textContent = String(remaining);
      cabinetEl.classList.add('bonus');
      startBonusSparkle();
      // BGM 起動済みならボーナス曲へ。未起動なら placeBet 時に再生される。
      // **BIG と REG で別の曲**＝鳴った瞬間にどちらを引いたか分かる。
      bgm.play(bonusZone.kind.get() ?? 'big');
    } else {
      sideRemainingEl.hidden = true;
      cabinetEl.classList.remove('bonus');
      stopBonusSparkle();
      bgm.play('normal');
    }
    updateComboSide();
  };
  bonusZone.active.subscribe(updateBonusUI);
  // 新しいボーナスに入ったら、ビタ揃いの回数（上限つき）を数え直す。
  // Observable は同じ値でも通知する（おかわりで true が再送される）ので、切り替わりだけ見る。
  let wasBonus = bonusZone.active.get();
  bonusZone.active.subscribe((on) => {
    if (on && !wasBonus) bitaThisBonus = 0;
    wasBonus = on;
  });
  bonusZone.remaining.subscribe(updateBonusUI);
  bonusZone.kind.subscribe(updateBonusUI);
  updateBonusUI();

  const updateButtons = () => {
    const allStopped = engines.every((e) => e.state.get() === 'stopped');
    const allIdle = engines.every((e) => e.state.get() === 'idle');
    const anySpinning = engines.some((e) => e.state.get() === 'spinning');

    betBtn.disabled =
      anySpinning ||
      spinPending ||
      stageSwapping ||
      !wallet.canBet(calc.bet) ||
      betPlaced;
    leverBtn.disabled =
      !betPlaced || anySpinning || allStopped || spinPending || stageSwapping;
    // 停止ボタンは**待ちが明けるまで受け付けない**（実機の「定速になるまで
    // 止められない」に相当）。ここが「リールウェイト」として体感される部分。
    const locked = performance.now() < stopLockUntil;
    stopBtns.forEach((btn, i) => {
      // 停止後も押せるままにする——**もう一度押すと滑りコマ数が出る**ため。
      // 押せる意味が違うので、見た目は checkable クラスで分ける（CSS）。
      const st = engines[i].state.get();
      const check = slipCheckable(i);
      btn.disabled = locked || (st !== 'spinning' && !check);
      btn.classList.toggle('checkable', st !== 'spinning' && check);
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

  /**
   * 筐体ランプの点灯／消灯。
   *
   * 終了画面の一言とは**軸が違う**示唆で、色の強さ＝高設定期待度だけを返す
   * （productions/CabinetLamp.ts）。
   *
   * **次のボーナスに入るまで点けたままにする。** 終了画面の文字は数秒で消えるが、
   * 示唆が効くのは「粘るか降りるか」を決める通常時のあいだ——そこで消えていては
   * 経路を増やした意味がない。台を見れば分かる状態で残す。
   * 次の終了時に引き直すので、点いている色は常に**直近のボーナスのもの**。
   */
  /**
   * 看板のランプを光らせる（コンボの節目の設定示唆・productions/SignLamp.ts）。
   * 色で意味が決まり、光り方でも見分けられる（cabinet-v3.css）。しばらく光って消える。
   */
  const signLampsEl = document.querySelector<HTMLElement>('.sign-lamps');
  let signLampTimer: number | null = null;
  const showSignLamp = (level: SignLampLevel) => {
    if (!signLampsEl || level === 'off') return;
    if (signLampTimer !== null) window.clearTimeout(signLampTimer);
    // 同じ段が続いた時もアニメーションを頭から流し直す
    delete signLampsEl.dataset.level;
    void signLampsEl.offsetWidth;
    signLampsEl.dataset.level = level;
    signLampTimer = window.setTimeout(() => {
      delete signLampsEl.dataset.level;
      signLampTimer = null;
    }, 2600);
  };
  const setCabinetLamp = (color: string | null) => {
    for (const el of cabinetLampEls) {
      if (color === null || color === 'off') delete el.dataset.lamp;
      else el.dataset.lamp = color;
    }
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
    // 筐体ランプは**終了画面と同時**。ただし別抽選・別の軸（期待度のみ）なので、
    // 終了画面が通常でもランプだけ点くことがある。
    setCabinetLamp(drawCabinetLamp(machineSetting, Math.random).color);
    // リミックス島はここでステージが入れ替わる。**次の島を先に知らせる**——
    // 黙って変えると「配列を覚え直す準備」ができず、ただ理不尽になる。
    const nextStage = isRemixMachine(machine)
      ? nextRemixStage(chapterId)
      : null;
    const nextName = nextStage
      ? (CHAPTERS.find((c) => c.id === nextStage)?.name ?? nextStage)
      : null;
    showResult(
      `${label} 終了  獲得 +${payout}枚${hint}` +
        (nextName ? `　▶ 次は「${nextName}」` : ''),
      'premium',
    );
    sfx.winPremium(); // 区間の締め＝いちばん長いクリア音
    // 示唆が出た時だけ画面の色を変える＝「何か出た」と気づける（色は EffectPresentation）。
    flashScreen({ color: endScreenFlashColor(endScreen.kind, kind), alpha: 0.6, durMs: 380 });
    spawnConfetti(kind === 'reg' ? 40 : 80);
    if (endScreen.kind !== 'normal') {
      // 示唆つきは余韻を足す。強いほど派手に。
      const extra = endScreen.kind === 'max' ? 90 : endScreen.kind === 'high' ? 50 : 30;
      window.setTimeout(() => spawnConfetti(extra), 260);
      shakeBody(endScreen.kind === 'max' ? 520 : 260);
    }

    // 告知を読ませてから入れ替える。リールは全停止しているので差し替えて安全。
    // **告知を出す時点で入力を止める**——1.5秒の間に次のゲームが始まると、
    // レバーONで決めた内部役と入れ替わった配列が食い違って出目が壊れる。
    if (nextStage) {
      stageSwapping = true;
      updateButtons();
      window.setTimeout(() => {
        void swapStage(nextStage)
          .then(() => {
            renderReelStrips();
            showResult(`ステージ「${nextName}」`, 'premium');
          })
          .finally(() => {
            stageSwapping = false;
            updateButtons();
          });
      }, 1500);
    }
  };

  // ボーナス中の再当選（おかわり）= 残り回数に加算（上乗せ）。突入演出より軽い演出で伝える。
  const showBonusAdd = (spins: number, kind: 'big' | 'reg') => {
    showResult(`上乗せ！ +${spins}スピン`, 'premium');
    sfx.winMulti(3); // 既存ファンファーレを上乗せ用に流用
    flashScreen({ color: kind === 'reg' ? '#cdd6e0' : '#ffe680', alpha: 0.7, durMs: 320 });
    spawnConfetti(50);
  };

  const resetForNextSpin = () => {
    betPlaced = false;
    setBetLamp(false);
    spinMarks.clear();
    spinDebugForced = false;
    stepRan = false;
    bonusSession.resetSpin();
    currentRound = null;
    if (debugVisible) delete cabinetEl.dataset.internalRole;
    for (const engine of engines) engine.reset();
    // AUTO の狙い状態もクリア
    autoTargetYaku = null;
    aimPending.clear();
    lastSlipCells.fill(0);
    updateButtons();
  };

  /**
   * 結果の表示の後片付け（テンパイの点滅・狙え・示唆・クイズの答え）。2026-10-12 から
   * 全停止したらすぐ BET を受け付けるので、片付けだけを読む時間（pace.resultMs）の後に回す。
   * その前に次の BET が押されたら、BET の時点で片付ける。
   */
  let clearResultTimer: number | null = null;
  const clearResultView = () => {
    if (clearResultTimer !== null) {
      window.clearTimeout(clearResultTimer);
      clearResultTimer = null;
    }
    for (const v of views) v.stopTenpaiFlash();
    hideAimNotice();
    hideShisaNotice();
    quizState.reset();
    applyEffect('none');
    director.resultClear();
  };

  const flashButton = (btn: HTMLButtonElement) => {
    btn.classList.add('flash');
    window.setTimeout(() => btn.classList.remove('flash'), 100);
  };

  // 各リールの直近の滑り量（役成立時にビタを判定するため。滑り0＝自力で止めた）
  const lastSlipCells: number[] = Array(REEL_COUNT).fill(0);
  /**
   * 確認表示に出す滑り量。`lastSlipCells` とは**寿命が違う**ので別に持つ。
   *
   * 全停止の直後に `resetForNextSpin` が走り、リールは idle へ戻る（2026-10-12 から待ちなし）。
   * だが停止位置はそのまま残るので、出目はまだ画面に出ている——「惜しかった」に
   * 気づくのはむしろこの後なので、**次のレバーまで**確認できるようにする。
   */
  const checkSlipCells: (number | null)[] = Array(REEL_COUNT).fill(null);

  /**
   * 停止済みリールのSTOPをもう一度押した時に、滑りコマ数を出す／消す。
   *
   * ニアミス（1コマずれ）を検出してはいるが、出口がクイズの不正解台詞しか無かった。
   * クイズが出るのは3ゲームに1度なので、残りのゲームでは「惜しかった」が伝わらない。
   * 目押しのゲームで惜しさが伝わらないのは損が大きい。
   *
   * **押した本人が確かめに行く**形にしてある。常時出すと、押した位置を覚えなくても
   * 数字を見れば済むようになり、目押しを覚える動機が消えるため。
   */
  const toggleSlipBadge = (idx: number) => {
    if (idx < 0 || idx >= REEL_COUNT) return;
    const cells = checkSlipCells[idx];
    if (cells === null) return;
    const view = views[idx];
    view.setSlipBadge(view.isSlipBadgeVisible() ? null : cells);
  };

  /** そのリールを確認できるか。回転中は当然できない。 */
  const slipCheckable = (idx: number): boolean =>
    checkSlipCells[idx] !== null && engines[idx]?.state.get() !== 'spinning';

  const placeBet = () => {
    if (freezeActive) return;
    if (stageSwapping) return;
    if (betBtn.disabled) return;
    // チェリー昇格の点灯待ちが残っていれば、次ゲームの役を決める前にここで点ける。
    // 待ちを跨がせると回転中に点いて「点いたのに揃わない」になる。
    if (cherryLampTimer !== null) fireCherryLamp();
    sfx.init(); // user gesture でオーディオ起動
    // BGM も最初の BET で起動（自動再生制限の回避）。再生中ならスキップ。
    bgm.init();
    bgm.play(bonusZone.isActive() ? (bonusZone.kind.get() ?? 'big') : 'normal');
    if (!wallet.bet(calc.bet)) return;
    // 前ゲームの結果の表示が残っていれば、ここで片付ける（新しいゲームの演出と重ねない）
    if (clearResultTimer !== null) clearResultView();
    bonusSession.beginSpin();
    recordRunSpeed(reelSpeed());
    if (autoMode) runAutoUsed = true;
    betPlaced = true;
    setBetLamp(true);
    setPayout(0);
    resultEl.classList.remove('visible');
    flashButton(betBtn);
    sfx.bet();
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
    if (stageSwapping) return;
    if (leverBtn.disabled) return;
    if (!betPlaced) return;

    // 「次ゲームのレバーで点く」プレミア。前ゲームでこぼした時に予約されている。
    // レバーの瞬間に合わせて点けるので、点いた時点でBIG確定と分かる。
    if (lampOnNextLever) {
      lampOnNextLever = false;
      lightHeldLamp();
    }

    /**
     * ステージチェンジ。**内部役とも結果とも無関係に**抽選するので、
     * 変わったことから当たりは読めない。リールが回り出す瞬間に切り替えると、
     * 目がリールへ移っている間に済むので唐突に見えない。
     */
    if (Math.random() < STAGE_CHANGE_RATE) lcdBg.changeScene();

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

    // 前ゲームの手続き（ステップアップ・予兆）をここで畳む。**この位置でないといけない**
    // ——startSpin の中で消していた時は、レバーONで点けた段をそのまま自分で
    // 消していた（startSpin は下で呼ばれるので、点灯より後になる）。
    director.beginSpin();

    // 連続演出の途中か。続くゲームでは先読み（予告するゲームの中身）を取り出さずに残す。
    // 最後のゲームを終えた走りは、ここで役目を終える（このゲームが予告の対象）。
    const stepContinuing = stepRun !== null && stepRun.game < stepRun.length;
    if (!stepContinuing) stepRun = null;

    // 先読みはここで取り出す。**通常抽選のブランチ以外に入れば捨てられる**——
    // ボーナス突入やデバッグ予約が挟まった時に古い先読みを使うと、
    // 予告した内容と実際の内部役が食い違う。
    const pre = stepContinuing ? null : preRoll;
    if (!stepContinuing) preRoll = null;
    /** 連続演出を続けたか。通常抽選のブランチ以外に入ったら、走りごと捨てる。 */
    let stepContinued = false;
    // 外れの狙え・クイズは直後の1ゲームだけ（通常抽選のブランチで使う）。ここで取り出して消す
    const fakeFollowNow = fakeFollow;
    fakeFollow = null;

    if (forcedFreezeRole) {
      activateRound(forcedFreezeRole, 'none', 'freeze');
    } else if (pendingDebugEffect) {
      // デバッグの予約は**確定ランプ・持ち越しより先に消費する**。後ろに置くと、
      // ランプ点灯中や持ち越し中に押した予約が何ゲームも積み残されたまま、
      // 忘れた頃に発火する（押した本人には上書きされたように見える）。
      const effect = pendingDebugEffect;
      pendingDebugEffect = null;
      spinDebugForced = true;
      activateRound(drawDebugRole(effect), effect, 'debug');
    } else if (announcedBonus && announcedRole) {
      activateRound(
        internalRoleLottery.forYaku(announcedRole),
        'none',
        'held-bonus',
      );
    } else if (shouldAnnounce) {
      if (Math.random() < tuning.announceLamp.leverShare) {
        // 先告知：レバーONでランプを点け、点灯中は確定役を回す。
        announceBonus();
        if (announcedRole) {
          activateRound(
            internalRoleLottery.forYaku(announcedRole),
            'none',
            'announce',
          );
        }
      } else {
        // 後告知（2026-10-14）：このゲームを演出なしのボーナスのゲームにするだけ。
        // こぼせば全停止後の取りこぼしの処理が確定ランプを点ける（第3停止の後）。
        const silent =
          (Math.random() < tuning.announceLamp.bigRatio
            ? yakuList.premiumYaku[0]
            : yakuList.bonusYaku[0]) ?? null;
        if (silent) {
          activateRound(internalRoleLottery.forYaku(silent), 'none', 'announce');
        }
      }
    } else if (pendingForcedRole) {
      // デバッグ：内部役を直接指定する。演出は通常どおり抽選する（おかわりの見え方も確認したいため）。
      const forced = pendingForcedRole;
      const forcedEffect = pendingForcedEffect;
      pendingForcedRole = null;
      pendingForcedEffect = null;
      spinDebugForced = true;
      const forcedYaku = internalRoleLottery.yakuFor(forced);
      activateRound(
        forced,
        forcedEffect ??
          (forcedYaku
            ? scheduler.rollAvailable(eligibility.eligibleEffects(forcedYaku))
            : 'none'),
        'debug',
      );
    } else if (heldBonusYaku) {
      // 持ち越し中：フラグは生きているが**演出は出ない**（実機Aタイプ）。
      heldBonusSpins++;
      // チャンス目から進んだ次ゲームだけは狙え・クイズを出す（2026-10-12）
      const follow = chanceFollow;
      chanceFollow = null;
      activateRound(
        internalRoleLottery.forYaku(heldBonusYaku),
        follow ?? 'none',
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
    } else if (stepContinuing && stepRun && !bonusSession.spinActive) {
      // 連続演出の途中のゲーム。予告するゲームはまだ先なので、普段どおり引く
      // （BIG/REG は落ちる）。**演出は出さない**——ステップアップは画面全体を塗るので、
      // 示唆と重ねると2つの色が同時に出る（ステップアップは単独で出す）。
      const role = rollNormalGame().role;
      doFreeze = role.freeze;
      activateRound(role, 'none', doFreeze ? 'freeze' : 'lottery');
      if (!doFreeze) {
        stepRun.game++;
        stepContinued = true;
        stepRan = true;
        director.start('stepUp', stepRun, { bonusActive: bonusSession.spinActive });
      }
    } else {
      // 前ゲームでステップアップが終わっていれば、その時に決めた役と演出をここで使う。
      // 無ければ普段どおり引く（ただし BIG と REG は落とす——それはステップアップ
      // 経由でしか出さない）。
      const rolled = pre ?? rollNormalGame();
      const role = rolled.role;
      // フリーズ役を引いた＝その場でBIG確定。演出は出さずフリーズシーケンスへ渡す。
      doFreeze = role.freeze;

      // **チェリーと払い出しの大きい小役から、一部がステップアップへ入る。**
      // 実機の「チャンス役から前兆」と同じ形。
      //
      // ボーナス中は出さない。次ゲームもボーナス中で、そこでは毎ゲーム演出が
      // 出る（none=0）ので予告するものが無い。
      // デバッグ予約は契機役かどうかを問わない（狙って出せないと確認にならない）。
      //
      // **入るかどうかを演出より先に決める。** 入るならこのゲームの演出は出さない
      // ——ステップアップは画面全体を色で塗り、示唆も画面全体を色で塗るので、
      // 重ねると**2つの色が同時に出て、どちらが何の話か読めなくなる**。しかも
      // 示唆はこのゲーム、ステップアップは次ゲームの話で、軸まで違う。
      // 遅れで一度やった判断と同じ（無演出のゲームでしか出さない）。
      //
      // **入る条件そのものは変えていない。** ここを絞るとステップアップが減り、
      // BIG/REG はステップアップ経由でしか出ないので出玉ごと動いてしまう。
      const forcedStep = pendingStepColor;
      pendingStepColor = null;
      const forcedChain = pendingStepChain;
      pendingStepChain = null;
      const startStep =
        !doFreeze &&
        !bonusSession.spinActive &&
        (forcedStep !== null ||
          (stepTrigger(role) && Math.random() < stepCfg.entryRate));

      // チャンス目（ボーナスなし）のあとの外れの狙え・クイズ。対象は BIG に差し替える。
      // 予告したゲーム（先読み）には重ねない——予告した中身を上書きしてしまう
      const fake =
        !doFreeze && !startStep && !bonusSession.spinActive && !pre ? fakeFollowNow : null;
      const fakeTarget = fake ? (yakuList.premiumYaku[0] ?? null) : null;
      const effect: EffectType = doFreeze || startStep ? 'none' : (fake ?? rolled.effect);
      activateRound(role, effect, doFreeze ? 'freeze' : 'lottery', fakeTarget);

      if (startStep) {
        const color = forcedStep ?? pickStepColor(stepCfg, Math.random);
        if (forcedStep !== null) spinDebugForced = true;
        stepRan = true;
        stepRun = {
          color,
          length: forcedChain ?? pickChainLength(stepCfg, color, Math.random),
          game: 1,
          forced: forcedStep !== null,
          level: STEP_LEVEL.blue,
        };
        preRoll = buildPreRoll(color);
        director.start('stepUp', stepRun, { bonusActive: bonusSession.spinActive });
      }
    }

    // 連続演出の途中で別のブランチ（ボーナス・確定ランプ・持ち越し・デバッグ予約・
    // フリーズ）に入ったら、走りと先読みを捨てる。予告した相手が消えている
    if (stepContinuing && !stepContinued) {
      stepRun = null;
      preRoll = null;
    }

    // 遅れ：レバーを叩いてもリールが回り出さない「間」。ハズレでは出さないので
    // 「何かは当たっている」は必ず本当。ただし何かは言わないので狙える役は増えない。
    const forcedDelay = pendingForcedDelay;
    pendingForcedDelay = false;
    const delayMs =
      !doFreeze && (forcedDelay || rollDelay(currentRound)) ? tuning.delay.ms : 0;
    if (delayMs > 0) markEffect('delay');
    if (forcedDelay) spinDebugForced = true;
    if (doFreeze) markEffect('freeze');

    // 予兆（無音・バックライト消灯）。ボーナスのフラグがある無演出のゲームでだけ出る
    // （productions/Omen.ts）。デバッグの予約は BIG を予約したゲームで必ず出す。
    const forcedOmen = pendingForcedOmen;
    pendingForcedOmen = null;
    const round = currentRound;
    const omen: OmenPlan | null =
      forcedOmen !== null
        ? { kind: forcedOmen, at: Math.floor(Math.random() * 3) as 0 | 1 | 2 }
        : round && !doFreeze
          ? rollOmen(
              tuning.omen,
              {
                roleKind: round.internalRole.kind,
                freeze: round.internalRole.freeze,
                carryYakuId: round.internalRole.carryYakuId,
                fromLottery: round.source === 'lottery',
                effectShown: currentEffect !== 'none' || stepRan,
                bonusActive: bonusSession.spinActive,
              },
              Math.random,
            )
          : null;
    if (omen) {
      const id = omen.kind === 'silence' ? 'omenSilence' : 'omenBacklight';
      if (director.start(id, omen, { bonusActive: bonusSession.spinActive })) {
        markEffect(`omen-${omen.kind}`);
      }
    }
    const silent = director.isActive('omenSilence');
    const startSpin = () => {
      spinPending = false;
      // 滑りの確認は前ゲームの出目とセット。回り出したら消す
      checkSlipCells.fill(null);
      for (const v of views) v.setSlipBadge(null);
      const spunAt = performance.now();
      // 加速はリールごとに少しずつ変える。揃って回り出すと機械に見えない。
      engines.forEach((engine, i) =>
        engine.spin(pace.spinUpMs[i % pace.spinUpMs.length], spunAt),
      );
      // 停止を受け付けるまでの待ち。**加速し切っていないリールは物理的に
      // 止められない**ので、待ちは加速時間より短くできない（大きい方を採る）。
      const lockMs = Math.max(...pace.spinUpMs, pace.stopLockMs);
      stopLockUntil = spunAt + lockMs;
      window.setTimeout(updateButtons, lockMs + 32);
      if (autoMode) setupAutoTarget();
      updateButtons();
      if (doFreeze) runFreeze();
    };
    flashButton(leverBtn);
    spawnButtonRipple(leverBtn, '#ffd700');
    // 無音の予兆ではレバー音もウェイト音も鳴らさない（鳴るはずの音が鳴らないのが合図）
    if (!silent) sfx.lever();
    // 実機のウェイト。**前ゲームから間が空いていない時だけ**鳴る＝急いでいる合図。
    const leverAt = performance.now();
    if (!silent && lastLeverAt > 0 && leverAt - lastLeverAt < LEVER_WAIT_MS) sfx.wait();
    lastLeverAt = leverAt;
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
  let stopController = new StopController({
    yakuList,
    slipResolver,
    tenpaiDetector,
    stopTable,
    pullInCells: PULL_IN_CELLS,
    reels: reelConfig.reels.map((r) => r.cells),
  });

  /**
   * ステージ（＝島）を差し替える。**リミックス島専用**。
   *
   * リール配列・役・停止テーブル・リーチ目・クイズ・図柄・図鑑が丸ごと入れ替わるので、
   * それらに依存するオブジェクトを作り直す。ページをリロードしても同じことはできるが、
   * それだと戦の記録（投資・回転数）が切れるので動的に差し替える。
   *
   * 依存する変数は `let` にしてある。クロージャは変数そのものを参照するので、
   * ここで再代入すれば数百ある参照箇所を書き換えずに新しい実体へ切り替わる。
   *
   * **リールが回っている間は呼ばない**（停止制御の途中で配列が変わると出目が壊れる）。
   */
  const swapStage = async (nextChapterId: string): Promise<void> => {
    chapterId = nextChapterId;
    chapter = CHAPTERS.find((c) => c.id === chapterId) ?? chapter;

    // --- データ層 ---
    reelConfig = ReelConfigSchema.parse(chapter.reelData);
    // 設定とリミックス上乗せは初回起動と同じ手順を通す（片方だけ抜けると静かにずれる）。
    yakuList = buildYakuList(chapter.yakuData);
    quizList = QuizListSchema.parse(chapter.quizData);
    stopTable = new StopTableLookup(StopTableSchema.parse(chapter.stopData));
    allRolesFlat = yakuList.internalRoles;

    // --- ロジック層（yakuList に依存するもの）---
    judge = new YakuJudge(yakuList);
    slipResolver = new SlipResolver(yakuList, {
      assistMaxCells: tuning.assist.pullInCells,
    });
    tenpaiDetector = new TenpaiDetector(yakuList);
    nearMissDetector = new NearMissDetector(yakuList);
    colorResolver = new SymbolColorResolver(yakuList);
    internalRoleLottery = new InternalRoleLottery(yakuList, Math.random);
    roundResolver = new RoundResolver({
      judge,
      calc,
      comboYakuIds: comboYakuIdsOf(yakuList),
      singlePayout: payout.baseMultiplier.single,
      bitaMultiplier: payout.bitaMultiplier,
    });
    eligibility = new EffectEligibility({
      yakuList,
      quizzes: quizList.quizzes,
      shisaTiers: tuning.assist.shisaTiers,
      reelCount: REEL_COUNT,
    });
    stopController = new StopController({
      yakuList,
      slipResolver,
      tenpaiDetector,
      stopTable,
      pullInCells: PULL_IN_CELLS,
      reels: reelConfig.reels.map((r) => r.cells),
    });

    // --- 図鑑（島ごとの記録なので作り直す。innerHTML で組むので旧DOMとリスナは消える）---
    zukanState = new ZukanState(yakuList, chapterId, zukanScope);
    quizStats = new QuizStats(chapterId);
    zukanOverlay = new ZukanOverlay(
      zukanState,
      yakuList,
      playStats,
      challengeTracker,
      quizStats,
      quizList.quizzes,
      {
        premium: payout.baseMultiplier.premium,
        bonus: payout.baseMultiplier.bonus,
        cherry: payout.baseMultiplier.cherry,
        spinsPerBig: bonusSpins.big,
        spinsPerReg: bonusSpins.reg,
      },
    );

    // --- 描画層（図柄と出題者は非同期ロード）---
    // 出題者は島ごとに別人なので、台が替われば絵も替わる（[14] §2）。
    await quizmasterView.setChapter(chapterId);
    await lcdBg.setChapter(chapterId);
    loadVoices();
    const art = await loadGlyphArt(chapterId, reelSymbols(), ART_BASE);
    glyphTextures = art.textures;
    glyphGlosses = art.glosses;
    glyphUrlFor = art.urlFor;
    for (const v of views) {
      app.stage.removeChild(v.container);
      v.container.destroy({ children: true });
    }
    engines.length = 0;
    views.length = 0;
    for (let i = 0; i < REEL_COUNT; i++) {
      const engine = new ReelEngine(reelConfig.reels[i]);
      const reelIdx = i;
      const view = new ReelView(
        engine,
        // 目印とハズレ図柄は色を焼き込んであるので役の色で染めない（白＝そのまま）
      (symbol) =>
        isUncolored(symbol) ? 0xffffff : colorResolver.colorFor(reelIdx, symbol),
        (symbol) => colorResolver.tierFor(reelIdx, symbol),
        (symbol) => art.textures.get(`${reelIdx}:${symbol}`) ?? null,
        (symbol) => art.glosses.get(`${reelIdx}:${symbol}`) ?? null,
      );
      view.container.x = startX + i * (CELL_WIDTH + REEL_GAP);
      view.container.y = reelY;
      app.stage.addChild(view.container);
      view.setShowCellIndices(debugVisible);
      engines.push(engine);
      views.push(view);
    }

    // 左上のステージ表示を新しい章名へ。ここは切替直後なので光らせる。
    updateStageStatus(true);
    // 章説明のツールチップも差し替える（章が変わったのに旧説明が残るのを防ぐ）。
    effectStatusEl.title = `${chapter.name}：${chapter.description}`;
  };

  /** このゲームの最後の停止の直前の出目（リーチ目の判定用）。最後の停止のたびに上書きする。 */
  let reachCheck: { before: (VisibleColumn | null)[]; reelIndex: number } | null = null;

  const resolveStopSlip = (
    idx: number,
    engine: ReelEngine,
    basePos: number,
    stoppedVisibles: (VisibleColumn | null)[],
    stoppedPositions: (number | null)[],
  ): number => {
    // 確定告知ランプ点灯中はその確定役、それ以外は内部役（1枚役はグループ）。
    const lamp = announcedBonus && announcedRole ? announcedRole : null;
    const flagYakuIds = lamp ? [lamp.id] : activeFlagYakuIds();
    const flagKey = lamp
      ? (allRolesFlat.find((r) => r.displayYakuId === lamp.id)?.id ?? null)
      : (currentRound?.internalRole.roleId ?? null);
    const role = currentRound?.internalRole ?? null;
    return stopController.resolveSlip({
      reelIndex: idx,
      basePosition: basePos,
      strip: engine.strip,
      stoppedVisibles,
      stoppedPositions,
      flagYakuIds,
      flagKey,
      freeze: freezeActive,
      bitaMark: bitaChance ? landmarkNow() : null,
      // 矛盾 5.3：ボーナスの再当選がある回は、ぴったり押しても目印を滑らせる
      bitaRefuse: bitaChance && (role?.kind === 'big' || role?.kind === 'reg'),
    });
  };

  const stopReel = (idx: number, timestamp: number) => {
    if (idx < 0 || idx >= REEL_COUNT) return;
    const engine = engines[idx];
    if (engine.state.get() !== 'spinning') return;
    // 待ちが明ける前は受け付けない。AUTO はボタンを介さずここへ来るので、ここでも塞ぐ。
    if (performance.now() < stopLockUntil) return;
    // フリーズ演出の一時的な60コマ/秒ではなく、プレイヤーが選んだ通常速度を記録する。
    recordRunSpeed(reelSpeed());
    // 押し順役の判定はこの停止を含めて確定させるため、引き込み解決の前に順を記録する。
    stopOrder.push(idx);

    // 滑り（引き込み）を解決：停止済みリールの可視3セルを SlipResolver に渡す。
    // 押下位置は「今押したら滑り0で止まるコマ」（前へしか進まない）。
    const basePos = engine.pressPosition();
    const stoppedVisibles: (VisibleColumn | null)[] = engines.map((e) => {
      if (e.state.get() !== 'stopped') return null;
      return {
        top: getVisibleCell(e, 'top'),
        middle: getVisibleCell(e, 'middle'),
        bottom: getVisibleCell(e, 'bottom'),
      };
    });
    // 停止位置も渡す。第2停止のテーブルを引くのに要る（可視3セルからは逆引きできない）。
    const stoppedPositions: (number | null)[] = engines.map((e) =>
      e.state.get() === 'stopped' ? Math.round(e.position) : null,
    );
    // 最後のリールを止める前の2リール。全停止後にリーチ目の形かを見るのに要る
    if (stoppedVisibles.filter((v) => v !== null).length === 2) {
      reachCheck = { before: stoppedVisibles, reelIndex: idx };
    }
    // 引き込み/蹴りの決定は resolveStopSlip に集約（設計: 17_assist-and-slip.md）。
    const slipCells = resolveStopSlip(
      idx,
      engine,
      basePos,
      stoppedVisibles,
      stoppedPositions,
    );

    const stopped = engine.stop(timestamp, slipCells, performance.now());
    lastSlipCells[idx] = slipCells;
    checkSlipCells[idx] = slipCells;
    // 止めた瞬間には「ビタ」を鳴らさない（2026-10-02）。以前は「どれかのコマの中心から
    // ±12ms 以内か」で鳴らしていたが、1コマは50msなので**でたらめに押しても48%で鳴った**。
    // 配当の付くビタ（役に必要なリールを滑り0で止めた）とも別物だった。ビタは
    // 全リールが止まって役が決まってから、配当と一緒に知らせる（下の結果表示）。
    sfx.stop();
    views[idx].triggerStopBounce();
    // 押したリールの狙えガイドは消す。止めた後も文字と矢印が浮いていると、
    // まだ狙うものが残っているように見える（2026-09-14）。
    hideAimReel(idx);
    // 停止に連動する手続き（ステップアップの段・バックライト消灯）。
    director.stop(stopOrder.length, idx);
    flashButton(stopBtns[idx]);
    spawnButtonRipple(stopBtns[idx], '#ff5566');

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
    // 〔2026-08-30〕**1確は演出として出さない。** 停止形そのものは停止テーブルに
    // 残っていて、「妙な位置にボーナス図柄が止まった」と気づいた人が狙える。
    // ただしフラッシュもSEもランプも出さない——何度も打った人が自分で気づくものに留める。
    // 取りこぼした事実は下の持ち越しで確定ランプが伝えるので、二重に知らせる必要も無い。

    // 示唆 →「狙え！」への発展。
    // 内部役の図柄がこの停止で**窓のどこかに**来た＝候補が1役に絞れたので、吹き出しを差し替える。
    // 「本当に当たっている役」でしか発展しないので、ガセにはならない。
    //
    // 以前は中段に来た時だけだった。示唆は色しか出さず候補から当てずっぽうで選ぶので、
    // 発展しないと腕に関係なくほぼ落とす（実測98%）。発展が候補を1役へ絞る唯一の出口なので、
    // 条件を可視3コマへ緩めて発展率を上げてある（実測 69%→82%）。
    //
    // 〔2026-10-14〕**「ハズレ」を出した後は発展させない。** 以前は第1停止で外れて
    // ハズレを出した後も判定が続き、第2停止の窓にたまたまその役の2文字目が見えると
    // 「狙え！」に変わっていた。1リール目で外れた役はもう揃わない。
    if (
      currentEffect === 'shisa' &&
      !shisaEscalated &&
      !shisaMissShown &&
      engines.some((e) => e.state.get() === 'spinning')
    ) {
      const target = effectTargetYaku ?? currentInternalYaku();
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
          yakuName: aimNameOf(target),
          imageUrl: `${ART_BASE}ui/aim.png`,
          hasPremium: target.category === 'premium',
          reelCentersXFrac: [0, 1, 2].map(
            (i) => (startX + i * (CELL_WIDTH + REEL_GAP) + CELL_WIDTH / 2) / CANVAS_W,
          ),
          reelTopYFrac: reelY / CANVAS_H,
          // 停止済みリールには矢印を出さない（残りのリールだけを指す）。
          arrowReels: engines.map((e) => e.state.get() === 'spinning'),
        });
        sfx.shisa();
      } else if (!shisaMissShown) {
        // **発展しなかった＝ハズレ一確**（2026-09-22）。
        //
        // 有効ラインは窓の3コマから作るので、止めたリールの窓に内部役の文字が
        // 無いなら、その役はもう揃えられない。示唆は「候補のどれかが当たって
        // いる」しか言っていないが、**発展こそが候補を1役へ絞る唯一の出口**
        // なので、発展しなかった時点で候補は全部外れたことになる。
        //
        // 候補を出したまま最後まで回させるより、その場で伝える。残りの停止で
        // 1枚役が揃えば全停止時に「1枚役 +1」で上書きされる（1枚役は役では
        // なく取りこぼしの受け皿なので、ハズレと言った後に出ても矛盾しない）。
        shisaMissShown = true;
        hideShisaNotice();
        showResult('ハズレ', 'none');
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
        // **通常のテンパイは無音**。第2停止で偶然揃うだけのことが多く、演出が
        // 何も出ていないゲームでも鳴ってしまう。枠フラッシュだけで足りる。
        // ボーナス役のテンパイは別で、鳴らす価値のある情報がある。
        views[tenpai.missingReelIndex].startTenpaiFlash(tenpai.hasPremium);
        if (tenpai.hasPremium) sfx.tenpaiPremium();
        showSoundCue('テンパイ');
      }
    }

    // 全停止の判定は**最後のリールが滑り切ってから**。出目は押した瞬間に決まっているが、
    // 払い出しや結果の表示が、まだ滑っているリールより先に出ると順序が逆に見える。
    if (engines.every((e) => e.state.get() === 'stopped')) {
      window.setTimeout(finishRound, stopped.slideMs);
    }
  };

  /** 全リールが止まった後の判定と表示。stopReel から、最後の滑りが終わってから呼ぶ。 */
  const finishRound = (): void => {
    {
      // 全停止したので「狙え！」演出は閉じる（レバーオン示唆として出た場合）
      hideAimNotice();
      hideShisaNotice();
      // 全停止に連動する手続き（無音を解く・連続演出の「つづく」）
      director.allStop();

      // 出目から成立ラインと払い出しを確定させる（表示はしない純粋な計算）。
      const grid = extractGrid(engines);
      const middleSymbols = grid[1] as [string, string, string]; // 既存UI互換用
      const outcome = roundResolver.resolve({
        grid,
        flagYakuIds: activeFlagYakuIds(),
        bonusActive: bonusSession.spinActive,
        streakBefore: playStats.stats.get().streak,
        slipCells: lastSlipCells,
      });
      const { hits, willHit, premiumHit, bonusHit, isPremium, isRegular } =
        outcome;
      const { streakAfter, streakMult, win } = outcome;
      // コンボが節目（5・10・15…）に届いた瞬間に、看板のランプで設定を示唆する。
      if (willHit && isSignLampMilestone(streakAfter)) {
        showSignLamp(drawSignLamp(machineSetting, Math.random));
      }
      const quizTargetYakuId =
        currentEffect === 'quiz' ? quizState.targetYakuId() : null;
      // 問題IDは resolve で消えるので、判定の前に控える。
      const quizId = currentEffect === 'quiz' ? (quizState.current.get()?.id ?? null) : null;
      // 確定告知ランプ点灯中にボーナス（BIG/REG）が揃ったら回収完了＝消灯。
      if (announcedBonus && (isPremium || isRegular)) clearAnnounceLamp();
      else if (announcedBonus && !bonusZone.isActive()) {
        // **点いているのに揃わなかった。** 規定回数こぼしたら当選役を明かす。
        //
        // 目押しができる人は2回も見れば「引き込めているのに揃わない＝別の役だ」と
        // 判別できる。できない人は「自分が外したのか、内部が別のBIGなのか」が
        // 切り分けられず、延々と外し続ける。そこだけを救う。
        announcedMisses += 1;
        if (announcedMisses >= tuning.announceLamp.revealAfterMisses && announcedRole) {
          const kindEl = announceLampEl.querySelector<HTMLElement>('.lamp-kind');
          if (kindEl) kindEl.textContent = announcedRole.name;
        }
      }
      // ボーナスフラグの持ち越し（実機Aタイプ）。
      // 揃えば解除、こぼせば次ゲーム以降も保持し続ける。
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
          // 〔2026-09-09〕**演出の有無によらず持ち越す。** 実機のAタイプは
          // ボーナスフラグが消えない——揃うまで持ち続ける。以前は演出の出ていた
          // ゲームでこぼしたら権利ごと消していた（技術介入を出玉へ出すため）が、
          // 機械の振る舞いとして無理があった。
          heldBonusYaku = flagged;
          // 〔2026-08-30〕**こぼした時点で確定ランプを点ける**（第3停止の少し後）。
          // ボーナスフラグがあったのに揃わなかった＝取りこぼしたという事実は、
          // その場で分かってよい。以前は無告知のまま持ち越し、リーチ目を読める人だけが
          // 察知する形だったが、読めない人はフラグを抱えたまま延々と気づかなかった
          // （初心者の持ち越しが1900ゲーム続いていた）。
          //
          // ただし**演出が出ていたゲームは抽選**（既定50%）。「何を狙えばいいか」は
          // もう教えてあるので、そこへランプを重ねると告知が二重になる。
          const announce =
            currentEffect === 'none' ||
            Math.random() < tuning.announceLamp.missAnnounceWithEffect;
          if (announce) fireMissLamp(flagged.category === 'premium');
        }
      }
      // 目印揃い（チャンス目・2026-10-12）。目印揃いの内部役でボーナスを
      // 伴っていれば、目印を揃えられたかどうかによらず、そのボーナスを持ち越す。
      //  - チャンス目（5ラインのどれか）＝確定ランプ・次ゲームの狙え・次ゲームのクイズのどれか
      //  - 揃えられなかった＝取りこぼしと同じく確定ランプで知らせる
      //
      // リーチ目（小役のずれ・2026-10-13）。形は停止制御が作る（StopController.reachEye）。
      //  - ボーナスのフラグがあって形が出た＝リーチ目。リール枠を白く光らせる
      //  - ボーナスが無いのに形が出た＝目押しのずれでたまたま同じ形になった。演出が出ていた
      //    ゲームでは、リーチ目と見分けられるよう「失敗」と出す。演出の無いゲームでは何も言わない
      const reachShape =
        hits.length === 0 &&
        reachCheck !== null &&
        stopController.isReachShape(
          reachCheck.before,
          reachCheck.reelIndex,
          {
            top: getVisibleCell(engines[reachCheck.reelIndex], 'top'),
            middle: getVisibleCell(engines[reachCheck.reelIndex], 'middle'),
            bottom: getVisibleCell(engines[reachCheck.reelIndex], 'bottom'),
          },
          activeFlagYakuIds(),
        );
      const bonusFlagged =
        Boolean(announcedBonus) ||
        heldBonusYaku !== null ||
        Boolean(currentRound?.internalRole.carryYakuId) ||
        (() => {
          const y = currentInternalYaku();
          return y !== null && (y.category === 'premium' || y.category === 'bonus');
        })();
      const reachEyeHit = reachShape && bonusFlagged;
      const reachMiss = reachShape && !bonusFlagged && currentEffect !== 'none';
      if (reachEyeHit) {
        for (const v of views) v.startReachFlash();
        flashScreen({ color: '#ffffff', alpha: 0.5, durMs: 220 });
        sfx.tenpaiPremium();
      }
      const carryId = currentRound?.internalRole.carryYakuId ?? null;
      const carryYaku = carryId
        ? ([...yakuList.premiumYaku, ...yakuList.bonusYaku].find((y) => y.id === carryId) ?? null)
        : null;
      if (outcome.chanceEye) {
        // 目印が揃った手触り。ボーナスの有無はここでは言わない
        for (const v of views) v.startTenpaiFlash(false);
        sfx.tenpaiPremium();
      }
      if (
        outcome.chanceEye &&
        !carryYaku &&
        !announcedBonus &&
        !heldBonusYaku &&
        !bonusZone.isActive() &&
        Math.random() < tuning.chanceEye.fakeFollowRate
      ) {
        // ボーナスの無いチャンス目でも、一部は次ゲームで狙え・クイズへ進んで外れる
        const big = yakuList.premiumYaku[0];
        const canQuiz = big ? eligibility.eligibleEffects(big).includes('quiz') : false;
        fakeFollow = canQuiz && Math.random() < 0.5 ? 'quiz' : 'aim';
      }
      if (carryYaku && !announcedBonus && !bonusZone.isActive()) {
        heldBonusYaku = carryYaku;
        const isBig = carryYaku.category === 'premium';
        if (outcome.chanceEye) {
          const follow = pickChanceFollow(carryYaku);
          if (follow === 'lamp') fireMissLamp(isBig);
          else chanceFollow = follow;
        } else {
          fireMissLamp(isBig);
        }
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
        // 「1コマずれていれば揃っていた」を出題者の台詞に載せる。**resolve より先に**
        // 出しておく（resolve が吹き出しを出すので、後から立てても間に合わない）。
        quizNearMiss =
          !quizMatched &&
          nearMissDetector.detect(
            middleSymbols,
            engines.map((e) => e.strip),
            engines.map((e) => {
              const total = e.strip.cells.length;
              return ((Math.round(e.position) % total) + total) % total;
            }),
          ).length > 0;
        quizState.resolve(quizMatched);
        playStats.recordQuiz(quizMatched);
        if (quizId) quizStats.record(quizId, quizMatched);
        if (quizMatched) sfx.quizCorrect();
        else sfx.quizWrong();
      }
      setPayout(win);
      if (win > 0) {
        wallet.win(win);
        // 3枚で1発。枚数が音の長さになるので、数字を読まなくても大きさが分かる。
        sfx.payout(win);
      }

      playStats.recordSpin({
        bet: calc.bet,
        win,
        hit: willHit,
        premium: isPremium,
        bonusTriggered: isPremium || isRegular,
        streak: streakAfter,
      });
      // 台のデータカウンター（設定推測の材料）。ハマりはボーナスで0に戻る。
      // キーは台ID。章で数えると同じ島の4台のデータが混ざる。
      // 演出率は設定を読める唯一の数字なので、通常時だけを母数にして数える。
      // 台のカウンターと戦の記録で母数の規則がずれないよう、判定はここで1度だけ。
      const inBonusSpin = bonusZone.isActive();
      // ステップアップは currentEffect に乗らないが、画面いっぱいに色が出る
      // ＝打ち手には「演出が出た」ゲーム。演出率の母数はその見え方に合わせる。
      const effectShown = currentEffect !== 'none' || stepRan;
      // 演出の帳簿。**通常時だけ**を母数にする（ボーナス中は必ず何か出るので、
      // 混ぜると率が動く）。デバッグで強制した回は数えない。
      //
      // ステップアップは前ゲームから持ち越して**このゲームの結果**で採点する。
      // あれが指しているのは次ゲームだから。ボーナス中に着地したら捨てる
      // （予告した相手がボーナス消化になっていて、当たり外れを問えない）。
      const carriedStep = pendingStepKeys;
      const carriedForced = pendingStepForced;
      pendingStepKeys = [];
      pendingStepForced = false;
      // このゲームで連続演出の最後のゲームを終えたなら、終了色と長さを次ゲームへ渡す
      if (stepRan && stepRun && stepRun.game >= stepRun.length) {
        pendingStepKeys = [
          `step-${stepRun.color}`,
          ...(stepRun.length >= 2 ? ['chain-2'] : []),
          ...(stepRun.length >= 3 ? ['chain-3'] : []),
        ];
        pendingStepForced = stepRun.forced;
      }

      if (!inBonusSpin) {
        const keys: string[] = [];
        if (!spinDebugForced) {
          // 示唆・クイズ・狙え！はレバーONで決まっているので、ここで拾って足す。
          if (currentEffect === 'shisa' && currentShisaTier) {
            markEffect(`shisa-${currentShisaTier.color}`);
          } else if (currentEffect === 'quiz' || currentEffect === 'aim') {
            markEffect(currentEffect);
          }
          keys.push(...spinMarks);
        }
        if (!carriedForced) keys.push(...carriedStep);
        if (keys.length > 0) {
          effectTable.update(recordEffects(keys, isPremium || isRegular));
        }
      }

      dataLamp.update(
        recordMachineSpin(machine.id, new Date(), {
          bet: calc.bet,
          win,
          bonus: isPremium ? 'big' : isRegular ? 'reg' : null,
          inBonus: inBonusSpin,
          effect: effectShown,
        }),
      );

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
      // （判定は RoundResolver）。**ビタはこの1つの意味だけ**で、音もここで鳴らす。
      if (outcome.bitaPerfect) {
        zukanState.recordBita();
        sfx.bita();
        showSoundCue('ビタ', 'bita');
        // 役に使ったリールのストップを金の二重の輪で光らせる（色に頼らない設定でも分かる形）
        for (const r of requiredReels(hits)) spawnButtonRipple(stopBtns[r], '#ffd700', 'bita');
      }

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
        const cls = isPremium || isRegular ? 'premium' : 'win';
        const bonusTag = bonusSession.spinActive ? ' ×BONUS' : '';
        const streakTag = streakMult > 1 ? ` ${streakAfter}連 ×${streakMult}` : '';
        const lineTag = hits.length > 1 ? ` (${hits.length}ライン)` : '';
        // **「★クイズ的中」は出さない**（2026-09-13）。予告した役が揃った時点で
        // 的中しているので、役名と一緒に書くと同じことを二度言うことになる。
        // ビタ押し＝ゲームに一切助けられず揃えた。上乗せ額と一緒に明示する。
        const bitaTag =
          outcome.bitaBonus > 0 ? ` ⚡ビタ押し+${outcome.bitaBonus}` : '';
        // 役名は重複なしで「みかん×2 ＋ すしや」のように要約
        const yakuLabel = summarizeHits(hits);
        showResult(
          `${yakuLabel}！ +${win}${bonusTag}${streakTag}${lineTag}${bitaTag}`,
          cls,
        );
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
        if (win > 0) showCoinFloatAt(win, isPremium);
        // 大配当はコインバースト（プレミアム=多め / レギュラー=中程度）
        if (isPremium) showCoinBurstAt(28);
        else if (isRegular) showCoinBurstAt(16);
        else if (win >= 50) showCoinBurstAt(12);
        else if (win >= 24) showCoinBurstAt(5);
        // 予告役的中（狙え／クイズ正解）でコインは撒かない——**配当が増えていない**
        // ので、撒くと出玉が付いたように読めてしまう。的中は結果表示の★で伝える。
        // ビタ押し成立は配当の大小に関わらず祝う（技術が報われた瞬間）
        if (outcome.bitaBonus > 0) {
          showCoinBurstAt(12);
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
        } else {
          sfx.winCore();
        }
      } else {
        // **外したことも結果として出す**（2026-09-22）。以前は音だけで文字を出して
        // いなかったが、揃った時だけ文字が出ると「何も起きなかったゲーム」と
        // 「外したゲーム」の区別が付かない。示唆の候補やクイズの問題はこの時点で
        // 消えているので、画面には何も残らなくなる。
        //
        // クイズの時は不正解の台詞が出題者から出るので、そちらに任せる（二重に
        // 言わない）。1枚役は払い出しがあるので枚数を添える。
        if (reachMiss) {
          sfx.miss();
          showResult('失敗', 'none');
        } else if (!quizTargetYakuId) {
          sfx.miss();
          showResult(win > 0 ? `1枚役 +${win}` : 'ハズレ', 'none');
        }
      }

      // ビタ揃い：3リールとも目印を中段に、**滑り0で**止めた（チャンス中だけ有効）。
      // 役の結果より後に出す——上乗せの方がこのゲームの主役なので、表示を上書きしてよい。
      if (bitaChance) {
        const mark = landmarkNow();
        const lined = engines.every(
          (e, r) => lastSlipCells[r] === 0 && getVisibleCell(e, 'middle') === mark,
        );
        if (lined) {
          bitaThisBonus++;
          bonusZone.extend(tuning.bonus.bitaAddSpins);
          showResult(`ビタ揃い！ 上乗せ +${tuning.bonus.bitaAddSpins}G`, 'premium');
          sfx.winMulti(4);
          flashScreen({ color: '#ffd84a', alpha: 0.7, durMs: 320 });
          spawnConfetti(60);
        }
        bitaChance = false;
      }

      // 残数消費・獲得集計・終了判定はまとめて BonusSession に任せる。
      // このゲームの演出・配当・上乗せ判定がすべて終わってから呼ぶ（順序が意味を持つ）。
      const runEnd = bonusSession.settle(win);
      if (runEnd) {
        window.setTimeout(() => showBonusResult(runEnd.payout, runEnd.kind), 900);
      }

      /**
       * 全停止から次のBETを受け付けるまでの間。**読むものの量で決める**。
       * 以前は一律1200msで、何も起きていないゲームでも必ず1.2秒待たされていた。
       * クイズは答えと的中を読む必要があるので長く、ハズレは読むものが無いので短い。
       */
      const resultMs = runEnd
        ? pace.resultMs.bonusEnd
        : quizTargetYakuId
          ? pace.resultMs.quiz
          : win > 0
            ? pace.resultMs.win
            : pace.resultMs.none;
      // 〔2026-10-12〕BET までのウェイトは無くす（ユーザー指定）。ボタンはすぐ戻し、
      // 表示の片付けだけを読む時間の後に回す。ボーナス終了だけはリザルトへ繋ぐ間を残す
      if (runEnd) {
        window.setTimeout(() => {
          resetForNextSpin();
          clearResultView();
        }, resultMs);
      } else {
        resetForNextSpin();
        clearResultTimer = window.setTimeout(clearResultView, resultMs);
      }
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
    // 1) 全部落とす。**ここでは何も鳴らさないし出さない。**
    //    実機のフリーズは派手に始まるのではなく、ランプが消えてリールが止まり
    //    無音になる。この「何も起きない間」があるから復帰が効く。
    //    以前はここでいきなりSE＋バナー＋青フラッシュを出していて、
    //    フリーズ（＝進行が止まること）が演出として伝わっていなかった。
    for (const e of engines) e.setSpeed(0);
    bgm.stop();
    showBlackout();
    freezeGrand = true;
    // **音が演出の親**。消灯と同時に鳴らし始め、以降のタイミングは全部この音に合わせる。
    sfx.freeze();
    // 溜めに入ったら暗転を少しずつ緩める。真っ暗のまま9秒待たせると、
    // 何が起きているか分からないただの停止画面になる。
    window.setTimeout(
      () => setBlackoutLevel(FREEZE_SWELL_BRIGHTNESS, FREEZE_RELEASE_AT_MS - FREEZE_SWELL_AT_MS),
      FREEZE_SWELL_AT_MS,
    );
    window.setTimeout(() => {
      // 2) 明けた瞬間に爆発させる。暗転の解除・バナー・SE・フラッシュ・倍速回転を
      //    同じフレームに揃える（ずらすと「明るくなってから何か始まる」になる）。
      clearBlackout();
      showFreezeBanner();
      flashScreen({ color: '#cfe4ff', alpha: 0.9, durMs: 220 });
      for (const e of engines) e.setSpeed(FREEZE_SPIN_SPEED);
      // 3) 1リール目から順に7を強制停止
      window.setTimeout(() => forceStopOn7(0), 700);
      window.setTimeout(() => forceStopOn7(1), 1300);
      window.setTimeout(() => {
        forceStopOn7(2); // 最終 → 全停止判定 → 7揃いBIG突入
        freezeActive = false;
        clearFreezeBanner();
        updateButtons();
      }, 1900);
    }, FREEZE_RELEASE_AT_MS);
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
  };
  /**
   * **持ち越し中のボーナスで確定告知ランプを点ける**（取りこぼし・チャンス目）。
   * **種別は抽選し直さない**——すでに立っているフラグをそのまま確定させる
   * （抽選し直すと、点いた種別と持ち越し中の役が食い違う）。
   */
  const lightHeldLamp = () => {
    if (announcedBonus || bonusZone.isActive()) return;
    const held = heldBonusYaku ?? currentInternalYaku();
    if (!held || (held.category !== 'premium' && held.category !== 'bonus')) return;
    announcedBonus = held.category === 'premium' ? 'big' : 'reg';
    announcedRole = held;
    markEffect('lamp');
    announceLampEl.hidden = false;
    requestAnimationFrame(() => announceLampEl.classList.add('lit'));
    sfx.lamp();
    flashScreen({ color: '#fff3a0', alpha: 0.8, durMs: 280 });
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

  /**
   * 取りこぼしの確定ランプ。**第3リールが止まりきってから**点ける。
   *
   * 判定した瞬間に点けると、第3リールの停止バウンドと払い出しの表示に重なって
   * 「何で点いたのか」が読み取れない。少し置いて、出目を見てから点く順にする。
   *
   * **点き方そのものが情報になる。** BIGを持っている時だけプレミアの点き方を抽選し、
   * 即点灯・遅れ・次ゲームのレバーのどれかが出ればBIG確定になる（ジャグラーのランプと
   * 同じ考え方）。REGは必ず通常の間で点くので、通常＝どちらもあり得る。
   *
   * 通常の間が420ms（何も起きないゲームの間合い）より短いのは、これより長いと
   * 次ゲームの回転中に点くことがあり、そのゲームの内部役は関係ないので
   * 「点いたのに揃わない」と読めてしまうため。**次レバーのプレミアだけは例外**で、
   * わざとレバーの瞬間に合わせて点ける。
   */
  /**
   * チャンス目のあとの進み先（確定ランプ・次ゲームの狙え・次ゲームのクイズ）を重みで選ぶ。
   * その役で出せない演出（クイズの問題が無い等）は候補から外す。
   */
  const pickChanceFollow = (yaku: Yaku): 'lamp' | 'aim' | 'quiz' => {
    const w = tuning.chanceEye.follow;
    const ok = eligibility.eligibleEffects(yaku);
    const cands: ['lamp' | 'aim' | 'quiz', number][] = [
      ['lamp', w.lamp],
      ['aim', ok.includes('aim') ? w.aim : 0],
      ['quiz', ok.includes('quiz') ? w.quiz : 0],
    ];
    const total = cands.reduce((a, [, x]) => a + x, 0);
    let r = Math.random() * total;
    for (const [k, x] of cands) if ((r -= x) < 0) return k;
    return 'lamp';
  };
  let missLampTimer: number | null = null;
  /** 次ゲームのレバーで点ける予約（プレミアの点き方）。 */
  let lampOnNextLever = false;
  /** 確定ランプ点灯中に取りこぼした回数（規定回数で当選役を明かす）。 */
  let announcedMisses = 0;
  const fireMissLamp = (isBig: boolean) => {
    if (missLampTimer !== null) window.clearTimeout(missLampTimer);
    const cfg = tuning.announceLamp;
    let delay = cfg.missDelayMs;
    if (isBig) {
      const r = Math.random();
      const p = cfg.premium;
      if (r < p.instant) delay = 0;
      else if (r < p.instant + p.late) delay = cfg.lateDelayMs;
      else if (r < p.instant + p.late + p.nextLever) {
        lampOnNextLever = true;
        return;
      }
    }
    if (delay <= 0) {
      lightHeldLamp();
      return;
    }
    missLampTimer = window.setTimeout(() => {
      missLampTimer = null;
      lightHeldLamp();
    }, delay);
  };

  /** ランプ消灯（ボーナス回収後）。 */
  const clearAnnounceLamp = () => {
    if (missLampTimer !== null) {
      window.clearTimeout(missLampTimer);
      missLampTimer = null;
    }
    lampOnNextLever = false;
    announcedMisses = 0;
    const kindEl = announceLampEl.querySelector<HTMLElement>('.lamp-kind');
    if (kindEl) kindEl.textContent = '?';
    announcedBonus = null;
    announcedRole = null;
    announceLampEl.classList.remove('lit');
    announceLampEl.hidden = true;
  };

  betBtn.addEventListener('click', placeBet);
  leverBtn.addEventListener('click', pullLever);
  /**
   * デッキ（MAXBET とレバーが載る台）は、**どこを押しても今できる方が起きる**。
   *
   * スマホで「MAXBET とレバーがちょっとだけ押しにくい」という報告（2026-09-12）。
   * 390px 幅だと MAXBET は 47x20px しかなく、狙って押す必要があった。判定を
   * 広げる（CSS の ::before）だけでは板と板の間に隙間が残るので、台そのものを
   * 受け皿にする。**取り違えは起こらない**——ベット前はレバーが無効、ベット後は
   * BET が無効で、常にどちらか一方しか効かない。
   *
   * ボタン自身の click はここへ来ても無視する（委譲すると二重に走る）。
   */
  deckWell?.addEventListener('click', (ev) => {
    if (ev.target !== deckWell) return;
    if (!betBtn.disabled) placeBet();
    else if (!leverBtn.disabled) pullLever();
  });
  stopBtns.forEach((btn) => {
    const idx = Number(btn.dataset.reel ?? -1);
    btn.addEventListener('pointerdown', (ev) => {
      if (freezeActive) return;
      if (engines[idx]?.state.get() !== 'spinning') {
        toggleSlipBadge(idx);
        return;
      }
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
    // ビタチャンス（演出は none 固定）：目印揃いの役を狙い役にして、目印をぴったり中段で押す
    // （scheduleAimedStop）。演出が無いので、これが無いと AUTO は適当に押していた（2026-10-19）
    const bitaYaku = bitaChance && landmarkNow() !== null ? yakuList.chanceYaku[0] : undefined;
    if (bitaYaku) {
      autoTargetYaku = bitaYaku;
    } else if (announcedBonus && announcedRole) {
      // 確定告知ランプ点灯中（演出は none 固定）：固定した確定役を AUTO でも全リール狙う。
      autoTargetYaku = announcedRole;
    } else if (currentEffect !== 'none') {
      autoTargetYaku = effectTargetYaku ?? currentInternalYaku();
    } else {
      autoTargetYaku = null;
    }
  };

  /** AUTO が予告役を狙うとき、target を中段の手前何コマで止めて残りを引き込みに
   *  委ねるかのマージン。 */
  // 〔2026-10-13〕4（引き込みの上限ちょうど）から2へ。上限ちょうどだと押すタイミングが
  // 少し遅れただけで届かず、目印揃いなどを取りこぼしていた。狙い所は4コマ手前〜下段の
  // どこでも揃う（tests/audit/aim-groups・2026-10-16）が、ボーナス役は役の図柄を2コマ手前で
  // 狙った時だけを保証している（tests/audit/aim-guarantee）ので、2のままにする
  const AUTO_AIM_MARGIN = Math.min(2, PULL_IN_CELLS);

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

    // 狙うコマ：目印のある島の小役・チェリー・目印揃いは**狙い所**（BIG1・BIG2・目印。
    // 2026-10-16）。配列が保証しているのは狙い所を狙った押し方で、役の図柄そのものを
    // 狙うと押し順によってまれに取りこぼす。ボーナス役と目印の無い島は役の図柄を狙う。
    // ビタチャンスは目印のコマそのもの。滑り0で中段に止めた時だけ揃いになる
    const mark = bitaChance ? landmarkNow() : null;
    const anchor = mark
      ? undefined
      : aimAnchors(yakuList, engines.map((e) => e.strip.cells)).get(autoTargetYaku.id);
    const aimCells = mark
      ? cells.flatMap((c, i) => (c === mark ? [i] : []))
      : anchor
        ? anchor.at[reelIdx]
        : cells.flatMap((c, i) => (c === targetSymbol ? [i] : []));
    // 順方向で次に狙うコマが来る距離（コマ単位）
    let bestDist = Infinity;
    for (const i of aimCells) {
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
    // ビタは押下位置（位置の切り上げ）が目印になる1コマ幅の真ん中を狙う。タイマーの
    // 遅れが半コマ未満なら滑り0で目印が中段に止まる
    const stopDist = mark ? Math.max(0, bestDist - 0.5) : Math.max(0, bestDist - aimMargin);
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
  const reelStripBtn = document.getElementById('dock-reels');
  const reelStripClose = reelStripPanel?.querySelector<HTMLButtonElement>('.strip-close');
  const unitPanelEl = document.getElementById('unit-panel');
  const dockUnitBtn = document.getElementById('dock-unit');

  /**
   * シートは1枚だけ開く。**縦長では両方とも画面下から出る**ので、重ねると
   * 後ろの内容が読めなくなる。開く側が相手を閉じる。
   */
  const closeSheets = (except?: Element | null): void => {
    if (reelStripPanel && reelStripPanel !== except) {
      reelStripPanel.classList.remove('open');
      reelStripBtn?.classList.remove('on');
    }
    if (unitPanelEl && unitPanelEl !== except) {
      unitPanelEl.classList.remove('open');
      dockUnitBtn?.classList.remove('on');
    }
  };

  const toggleReelStrip = () => {
    if (!reelStripPanel) return;
    closeSheets(reelStripPanel);
    const isOpen = reelStripPanel.classList.toggle('open');
    if (reelStripBtn) reelStripBtn.classList.toggle('on', isOpen);
  };
  reelStripBtn?.addEventListener('click', toggleReelStrip);
  reelStripClose?.addEventListener('click', () => {
    reelStripPanel?.classList.remove('open');
    reelStripBtn?.classList.remove('on');
  });

  /**
   * 画面下のドック。**開いて読むものはここに集める**——遊技中に触るのは
   * レバーと停止とベットだけで、配列やデータは手を止めて見るものだから、
   * 筐体のヘッダーではなく画面の縁に置く。参考にしたスロットアプリと同じ位置。
   *
   * 開閉の判定は既にある要素へ委譲する（ここで持つと2箇所に同じ状態ができる）。
   */
  dockUnitBtn?.addEventListener('click', () => {
    if (!unitPanelEl) return;
    closeSheets(unitPanelEl);
    const isOpen = unitPanelEl.classList.toggle('open');
    dockUnitBtn.classList.toggle('on', isOpen);
  });
  document
    .getElementById('dock-zukan')
    ?.addEventListener('click', () => zukanBtn.click());
  document
    .getElementById('dock-settings')
    ?.addEventListener('click', () => settingsBtn.click());

  /**
   * 消音の表示。**アイコンと見出しだけを書き換える**——ボタンごと textContent で
   * 上書きしていたので、メニューへ移した時に説明文まで消えていた。
   */
  const updateMuteUI = () => {
    const muted = sfx.isMuted();
    const icon = muteBtn.querySelector('.menu-icon');
    const label = muteBtn.querySelector('.menu-text b');
    if (icon) icon.textContent = muted ? '🔇' : '♪';
    if (label) label.textContent = muted ? '消音を解除' : '消音';
    muteBtn.classList.toggle('muted', muted);
  };
  muteBtn.addEventListener('click', () => {
    sfx.init();
    bgm.init(); // mute トグルを user gesture として BGM も起動
    sfx.toggleMute();
    bgm.setMuted(sfx.isMuted());
    voice.setMuted(sfx.isMuted());
    updateMuteUI();
  });
  updateMuteUI();

  // === リール配列パネル（筐体右） ===
  const stripColumns = Array.from(
    document.querySelectorAll<HTMLElement>('#reel-strip-panel .strip-column'),
  );
  // 実体を上で宣言した変数へ入れる。ステージ切替（リミックス島）で呼び直すため。
  renderReelStrips = () => {
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
        // 役単位の色の上にドット文字を重ねる。リール本体と同じ見た目にする。
        // **background の一括指定は使わない**——インラインで一括指定すると
        // スタイルシート側の background-repeat / size / position まで初期値へ戻り、
        // ドット文字が敷き詰められる（実際に踏んだ）
        cell.style.backgroundColor =
          symbol === reelConfig.landmark
            ? '#2a1a08'
            : reelConfig.blanks?.includes(symbol)
              ? '#5a5a62'
              : colorResolver.cssFor(idx, symbol);
        const glyphUrl = glyphUrlFor(idx, symbol);
        if (glyphUrl) {
          cell.classList.add('has-art');
          cell.style.backgroundImage = `url("${glyphUrl}")`;
        } else {
          cell.textContent = symbol;
          cell.style.color = '#fff';
        }
        cell.dataset.index = String(i);
        cellsEl.appendChild(cell);
      }
    });
  };
  renderReelStrips();

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
  /** 操作の中身。キーからも画面のボタンからも同じものを呼ぶ。 */
  const runAction = (action: Action, timeStamp: number): void => {
    switch (action) {
      case 'bet':
        placeBet();
        return;
      case 'lever':
        pullLever();
        return;
      case 'stop0':
      case 'stop1':
      case 'stop2': {
        const idx = Number(action.slice(4));
        // 停止済みのリールをもう一度押すと滑りコマ数が出る（押せる意味が違う）。
        if (engines[idx]?.state.get() !== 'spinning') toggleSlipBadge(idx);
        else stopReel(idx, timeStamp);
        return;
      }
      case 'auto':
        if (!autoAvailable) return;
        if (autoMode) stopAuto();
        else startAuto();
        return;
      case 'mute':
        sfx.init();
        bgm.init();
        sfx.toggleMute();
        bgm.setMuted(sfx.isMuted());
        voice.setMuted(sfx.isMuted());
        updateMuteUI();
        return;
      case 'zukan':
        zukanOverlay.toggle();
        return;
      case 'settings':
        settingsOverlay.toggle();
        return;
      case 'reelStrip':
        toggleReelStrip();
        return;
    }
  };

  window.addEventListener('keydown', (ev) => {
    if (ev.repeat) return;
    if (
      ev.target instanceof HTMLInputElement ||
      ev.target instanceof HTMLTextAreaElement
    ) {
      return;
    }

    // 割り当ての変更中はゲームを動かさない（押したキーを拾う側が受け取る）。
    if (settingsOverlay.isCapturingKey()) return;

    // フリーズ演出中はゲーム操作キーを全てブロック
    if (freezeActive) {
      ev.preventDefault();
      return;
    }

    const actions = keyBindings.actionsFor(eventKey(ev));
    if (actions.length === 0) return;
    ev.preventDefault();
    // ベットとレバーは同じキーを共有できる（既定はどちらもスペース）。
    // **どちらを実行するかは状態で決まる**——ベット前ならベット、ベット後ならレバー。
    // 押せる方は必ず1つしかないので、1回押すたびに1つ進む。
    const action =
      actions.includes('bet') && actions.includes('lever')
        ? betPlaced
          ? 'lever'
          : 'bet'
        : actions[0];
    runAction(action, ev.timeStamp);
  });

  /**
   * データの上の「操作方法」を今の割り当てで書き直す。**直書きの案内は嘘になる**——
   * 割り当てを変えられるようにした以上、A・S・D と出したままにはできない。
   */
  const renderControlsGuide = (): void => {
    const el = document.getElementById('controls-guide');
    if (!el) return;
    const k = (a: Action): string => {
      const key = keyBindings.get(a);
      return key ? keyLabel(key) : '—';
    };
    const rows: [string, string][] = [];
    // 同じキーなら1行にまとめる。2行に分けると別々のキーに見える。
    const bet = keyBindings.get('bet');
    if (bet && bet === keyBindings.get('lever')) {
      rows.push([`${k('bet')}`, '1回目でベット、2回目でレバー']);
    } else {
      rows.push([k('bet'), 'ベット'], [k('lever'), 'レバー']);
    }
    rows.push(
      [`${k('stop0')} ${k('stop1')} ${k('stop2')}`, '左・中・右のリールを止める'],
      ['もう一度', '止めたリールを押すと滑ったコマ数'],
    );
    if (autoAvailable) rows.push([k('auto'), 'オート']);
    rows.push(
      [k('reelStrip'), 'リール配列'],
      [k('zukan'), '図鑑'],
      [k('mute'), '消音'],
      [k('settings'), '設定（キーの割り当ても変えられる）'],
    );
    el.replaceChildren(
      ...rows.flatMap(([key, what]) => {
        const dt = document.createElement('dt');
        dt.textContent = key;
        const dd = document.createElement('dd');
        dd.textContent = what;
        return [dt, dd];
      }),
    );
    const note = document.createElement('dd');
    note.className = 'cg-note';
    note.textContent = '画面のボタンをクリック・タップしても同じ操作ができます';
    el.appendChild(note);
  };
  renderControlsGuide();
  // 割り当てが変わったら呼び直す。**開閉のタイミングに賭けない**——設定を閉じた時に
  // 更新する形にしていたが、閉じ方が複数あって取りこぼした（×ボタン・Esc・背景）。
  settingsOverlay.setKeyBindingListener(renderControlsGuide);

  updateButtons();
}
