import {
  BlurFilter,
  Container,
  Graphics,
  Rectangle,
  Sprite,
  Text,
  Texture,
} from 'pixi.js';
import type { ReelEngine } from '../core/ReelEngine';
import type { SymbolTier } from './SymbolStyle';

/** ReelView 用の色解決関数（reel ごとに事前 bind した役色を返す） */
export type SymbolColorFn = (symbol: string) => number;
/** ReelView 用の強さ階層解決関数（reel ごとに事前 bind） */
export type SymbolTierFn = (symbol: string) => SymbolTier;
/**
 * ReelView 用の図柄テクスチャ解決関数（reel ごとに事前 bind）。
 * その章に図柄画像があれば Texture、無ければ null（→ 従来の色タイル＋文字にフォールバック）。
 */
export type SymbolTextureFn = (symbol: string) => Texture | null;

/**
 * 1コマの大きさ（2026-09-11 に 130x100 → 120x92）。
 *
 * 筐体が縦長すぎて（1:2.05）スマホの横幅が2割余っていたので、canvas を低くした。
 * **縦だけ縮めると文字が枠から溢れる**——グリフは `CELL_WIDTH / 絵の幅` で拡大して
 * いて、高さは比例で付いてくるだけなので、幅も一緒に縮める必要がある。
 * 130:100 と 120:92 で縦横比はほぼ同じ（1.300 / 1.304）。
 */
export const CELL_WIDTH = 120;
export const CELL_HEIGHT = 92;
export const VISIBLE_CELLS = 3;

/**
 * 役柄の強さ階層ごとのタイル見た目。
 * 「強い柄ほどデカい」を再現：premium が枠いっぱい、filler は小さく地味。
 * リール送り（1コマ=CELL_HEIGHT）は不変で、コマ枠内に描く柄の大きさだけ変える。
 */
interface TileStyle {
  /** タイルの左右余白（小さいほど大きいタイル） */
  padX: number;
  /** タイルの上下余白 */
  padY: number;
  /** 角丸半径 */
  radius: number;
  /** 外枠（黒）の太さ・濃さ */
  strokeWidth: number;
  strokeAlpha: number;
  /** 内側のアクセント縁（金/銀）。null なら描かない */
  innerFrame: number | null;
  /** 文字サイズ */
  fontSize: number;
}

const TILE_STYLES: Record<SymbolTier, TileStyle> = {
  // BIG：枠いっぱい＋金の内縁＋極太文字
  premium: { padX: 3, padY: 3, radius: 10, strokeWidth: 4, strokeAlpha: 0.85, innerFrame: 0xfff2a8, fontSize: 70 },
  // REG：やや大きめ＋銀の内縁
  bonus: { padX: 11, padY: 9, radius: 11, strokeWidth: 3.5, strokeAlpha: 0.8, innerFrame: 0xe8e8f0, fontSize: 60 },
  // コア：標準
  core: { padX: 19, padY: 16, radius: 12, strokeWidth: 2, strokeAlpha: 0.55, innerFrame: null, fontSize: 52 },
  // 脇役：小さく地味
  filler: { padX: 35, padY: 28, radius: 12, strokeWidth: 1.5, strokeAlpha: 0.45, innerFrame: null, fontSize: 36 },
};

const VIEW_HEIGHT = CELL_HEIGHT * VISIBLE_CELLS;
const PAYLINE_Y = CELL_HEIGHT * 1.5;
/**
 * 上下に見せる「隣の図柄」のチラ見せ量（px）。マスクを上下に REEL_PEEK 広げて、次に来る図柄／
 * 通り過ぎる図柄を覗かせる。中央3コマ＝判定対象（PAYLINE_Y・ペイライン）は不変。
 * リール領域の確保は main.ts 側（LIQUID_AREA_H）で行う。
 */
export const REEL_PEEK = CELL_HEIGHT * 0.1;
/**
 * 図柄（チラ見せ含む）と金枠の線の間に挟む黒余白（px）。枠(bg)を図柄表示範囲より FRAME_PAD
 * 分だけ外側に描くことで、図柄が枠線に接触して色が混じるのを防ぐ。
 */
export const FRAME_PAD = 6;
/**
 * マスク（見える領域）の上に確保する「不可視の助走バッファ」のピクセル数。
 * 文字はここから現れて、マスク上端へスクロールしていくので、
 * 「マスクの上端で唐突に文字が湧く」感じがなくなる。
 */
const PRE_BUFFER = CELL_HEIGHT;

/** 滑りコマ数バッジの大きさ。図柄を隠さないよう、枠下の黒余白に収まる高さにする。 */
const SLIP_BADGE_W = 72;
const SLIP_BADGE_H = 20;

/**
 * モーションブラー（回転中の縦方向の残像）。
 *
 * 実機のリールは物理的な回転なので目に残像が残り、速くても図柄の流れを追える。
 * Web（Pixi）は毎フレーム図柄をくっきり描くため残像が無く、実機速度（28コマ/秒）まで上げると
 * 図柄が飛び飛びに見えて逆にカクつく。そこで縦方向のブラーで残像を人工的に作る。
 * これが入って初めてリール速度を実機に近づけられる（[05](05_bita-oshi.md) の未実装メモ）。
 *
 * 強さは「1フレームで進むピクセル数」に比例させる（速いほど強く滲む）。
 * 60fps 想定で pxPerFrame = speed(コマ/秒) × CELL_HEIGHT ÷ 60。
 */
const MOTION_BLUR_K = 0.34;
/**
 * 実効のブラー係数。data/tuning の既定値を main.ts が流し込み、設定モーダルから変更できる
 * （体感で決める値なので、ビルドし直さずに比べられるようにしている）。0 でブラー無し。
 */
let motionBlurStrength = MOTION_BLUR_K;
export function setMotionBlurStrength(k: number): void {
  motionBlurStrength = Math.max(0, k);
}
/** これ未満の速度ではブラーをかけない（停止直前のチラつき防止） */
const MOTION_BLUR_MIN_SPEED = 2;
/** ブラーの品質。1 で十分（縦1方向・小さな矩形なので負荷は軽い） */
const MOTION_BLUR_QUALITY = 1;

/**
 * クイズ中、答えの文字**以外**のセルの不透明度。1 に近いほど答えがバレにくい。
 * 「答えを教える」のではなく「言われてみれば気づく」程度の強調に留める。
 */
const NON_TARGET_ALPHA = 0.8;

export class ReelView {
  readonly container: Container;
  /** 各セルのコンテナ（タイル背景＋文字を内包、上下方向にスクロール移動する） */
  private readonly cellContainers: Container[] = [];
  /** 各セルの背景タイル Graphics（色タイル時のみ・スプライト時は null） */
  private readonly cellTiles: (Graphics | null)[] = [];
  /** 各セルのドット文字スプライト（フォント描画へ落ちた時は null） */
  private readonly cellSprites: (Sprite | null)[] = [];
  /** 各スプライトの基準スケール（ハイライトのスケール演出から戻す用） */
  private readonly cellSpriteBaseScale: number[] = [];
  /** コマ番号を出すか（既定OFF）。目押しの検証と引き込みコマ数の確認に使う。 */
  private showCellIndices = false;
  private readonly cellIndexLabels: Text[] = [];
  /** ハイライト中にスプライトセルへ重ねる色枠グロー（解除時に除去） */
  private readonly cellGlows: (Graphics | null)[] = [];
  /** 各セルの本来の色（ハイライト解除時に戻す用） */
  private readonly cellOriginalColors: number[] = [];
  /** 各セルのタイル見た目（強さ階層ごと・再描画で形を保つ用） */
  private readonly cellStyles: TileStyle[] = [];
  /** 現在ハイライト中のセル indexes と解除タイマー */
  private highlightTimer: number | null = null;
  private highlightedIndexes: number[] = [];
  /** 各セルの記号文字（cellContainers と同じ index） */
  private cellSymbols: string[] = [];
  /** 回転中の縦モーションブラー（cellsContainer に適用・速度に比例して強くする） */
  private readonly motionBlur: BlurFilter;
  private readonly bg: Graphics;
  private readonly centerGlow: Graphics;
  private centerGlowAlpha = 0;
  private centerGlowStart = 0;
  private centerGlowDuration = 0;
  private tenpaiAnimMs = 0;
  private tenpaiPremium = false;
  /** 滑りコマ数の表示（停止済みリールのSTOPをもう一度押した時だけ出す） */
  private readonly slipBadge: Container;
  private readonly slipBadgeText: Text;
  /** 停止バウンス用：振動オフセット（px） */
  private bounceOffsetY = 0;
  private bounceStart = 0;
  private bounceActive = false;

  constructor(
    private readonly engine: ReelEngine,
    private readonly colorForSymbol: SymbolColorFn,
    private readonly tierForSymbol: SymbolTierFn = () => 'core',
    /** その文字のドット文字テクスチャ（無ければ null＝フォントで描く） */
    private readonly glyphForSymbol: SymbolTextureFn = () => null,
  ) {
    this.container = new Container();

    this.bg = new Graphics();
    this.redrawBg(0xffd700, 3);
    this.container.addChild(this.bg);

    // 中央セル（ペイライン上）のハイライトグロー
    this.centerGlow = new Graphics();
    this.centerGlow
      .rect(0, PAYLINE_Y - CELL_HEIGHT / 2, CELL_WIDTH, CELL_HEIGHT)
      .fill({ color: 0xffd700, alpha: 0.45 });
    this.centerGlow.alpha = 0;
    this.container.addChild(this.centerGlow);

    const cellsContainer = new Container();
    // 縦だけ滲ませる（横は 0）。強さは update() で速度に応じて毎フレーム更新。
    this.motionBlur = new BlurFilter({
      strengthX: 0,
      strengthY: 0,
      quality: MOTION_BLUR_QUALITY,
    });
    // フィルタとマスクを同じコンテナに付けると Pixi では効かないので、マスク用のラッパーを挟む。
    // ラッパー = 見える窓（マスク）／内側の cellsContainer = ブラー対象。
    // ブラーは窓の外へ滲むが、ラッパーのマスクで切り取られるのでリール枠を越えない。
    const maskWrapper = new Container();
    cellsContainer.filters = [this.motionBlur];
    // フィルタ適用範囲を「見える窓」に限定する（21コマ全長 2100px を毎フレーム描画しないため）。
    cellsContainer.filterArea = new Rectangle(
      0,
      -REEL_PEEK,
      CELL_WIDTH,
      VIEW_HEIGHT + REEL_PEEK * 2,
    );
    const mask = new Graphics();
    // 図柄は中央3コマ＋上下 REEL_PEEK（隣の図柄チラ見せ）まで表示。枠線とは FRAME_PAD 分離れる。
    mask.rect(0, -REEL_PEEK, CELL_WIDTH, VIEW_HEIGHT + REEL_PEEK * 2);
    mask.fill({ color: 0xffffff });
    this.container.addChild(mask);
    maskWrapper.mask = mask;
    maskWrapper.addChild(cellsContainer);

    this.cellSymbols = [...engine.strip.cells];
    /** 文字ごとの出現数。コマラベルの「ま2」の 2 を振るのに使う。 */
    const symbolSeen = new Map<string, number>();
    for (const symbol of engine.strip.cells) {
      // セル単位のコンテナ：背景タイル + 文字
      const cell = new Container();

      const tier = this.tierForSymbol(symbol);
      const style = TILE_STYLES[tier];
      const originalColor = this.colorForSymbol(symbol);
      // **地の四角は描かない。** 役色は文字そのものに乗せる（tint）。
      // 色タイルは色の面積が大きいぶん文字が背景の一部に見えてしまい、
      // 「文字を読んで押す」という遊びの主役が入れ替わる。
      this.cellTiles.push(null);

      const glyphTexture = this.glyphForSymbol(symbol);
      if (glyphTexture) {
        // 44x34 のドット文字をセル幅いっぱい（=3倍）に置く。液晶の背景・出題者・
        // バナーと同じ粒度になる。補間は読み込み側で nearest に落としてある
        const sprite = new Sprite(glyphTexture);
        sprite.anchor.set(0.5);
        const scale = CELL_WIDTH / glyphTexture.width;
        sprite.scale.set(scale);
        sprite.x = CELL_WIDTH / 2;
        sprite.y = 0;
        // 白の字面へ役色を掛ける＝**文字の中だけが色づく**。縁はほぼ黒のままなので
        // 暗いリール地の上でも輪郭が残る
        sprite.tint = originalColor;
        cell.addChild(sprite);
        this.cellSprites.push(sprite);
        this.cellSpriteBaseScale.push(scale);
      } else {
        // ドット文字が無い文字はフォントで描く。全章の全文字が揃っていることは
        // 監査テストが見ているので、本番でここへ落ちることは無い
        const text = new Text({
          text: symbol,
          style: {
            fill: 0xffffff,
            fontSize: style.fontSize,
            fontFamily:
              '"Hiragino Mincho ProN", "Yu Mincho", "MS PMincho", serif',
            fontWeight: '900',
            stroke: { color: 0x000000, width: 5, alpha: 0.85 },
          },
        });
        text.anchor.set(0.5);
        text.x = CELL_WIDTH / 2;
        text.y = 0;
        cell.addChild(text);
        this.cellSprites.push(null);
        this.cellSpriteBaseScale.push(0);
      }

      // コマの識別。「7 ま2」＝リール上の7番目のコマで、その文字としては2つ目。
      //
      // 通し番号（0..20）は押した位置と停止位置の差＝引き込みコマ数を数えるため。
      // 文字ごとの連番は「同じ ま でもどの ま か」を区別するため——同じ文字が
      // 複数コマあるので、通し番号だけだと配列表と突き合わせるのに一手間かかる。
      // 既定は非表示。ゲーム中は数字が視線を奪うので、必要な時だけ出す。
      const cellIndex = this.cellContainers.length;
      const nth = (symbolSeen.get(symbol) ?? 0) + 1;
      symbolSeen.set(symbol, nth);
      const indexLabel = new Text({
        text: `${cellIndex} ${symbol}${nth}`,
        style: {
          fill: 0xffe08a,
          fontSize: 11,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fontWeight: '700',
          stroke: { color: 0x000000, width: 4, alpha: 0.9 },
        },
      });
      indexLabel.anchor.set(0, 0.5);
      indexLabel.x = 5;
      indexLabel.y = -CELL_HEIGHT / 2 + 11;
      indexLabel.visible = this.showCellIndices;
      cell.addChild(indexLabel);
      this.cellIndexLabels.push(indexLabel);

      this.cellOriginalColors.push(originalColor);
      this.cellStyles.push(style);
      this.cellGlows.push(null);

      cellsContainer.addChild(cell);
      this.cellContainers.push(cell);
    }
    this.container.addChild(maskWrapper);

    // 滑りコマ数のバッジ。**枠の下端に跨がせる**。枠の外はチラ見せと枠余白で16pxしか
    // 無いので、そこへ収まる高さにして4pxだけ窓へ食い込ませる。窓の中央へ置くと
    // 下段の図柄が読めなくなる——下段は3本のラインが通るので、出目の確認と競合する。
    this.slipBadge = new Container();
    const badgeBg = new Graphics();
    badgeBg
      .roundRect(-SLIP_BADGE_W / 2, -SLIP_BADGE_H / 2, SLIP_BADGE_W, SLIP_BADGE_H, 6)
      .fill({ color: 0x0a0810, alpha: 0.88 })
      .stroke({ color: 0xffd700, width: 1.5, alpha: 0.7 });
    this.slipBadge.addChild(badgeBg);
    this.slipBadgeText = new Text({
      text: '',
      style: {
        fill: 0xffe08a,
        fontSize: 15,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontWeight: '700',
      },
    });
    this.slipBadgeText.anchor.set(0.5);
    this.slipBadge.addChild(this.slipBadgeText);
    this.slipBadge.x = CELL_WIDTH / 2;
    this.slipBadge.y = VIEW_HEIGHT + 6;
    this.slipBadge.visible = false;
    this.container.addChild(this.slipBadge);

    // ペイラインやセル区切り線はリール上に描画しない（外側インジケーターで示す）

    this.update();
  }

  update(nowMs?: number): void {
    const pos = this.engine.position;
    const total = this.engine.strip.cells.length;
    const totalHeight = total * CELL_HEIGHT;

    // 文字の循環範囲を [-PRE_BUFFER, -PRE_BUFFER + totalHeight) にずらす。
    // マスク（0..VIEW_HEIGHT）の手前 PRE_BUFFER 分は不可視バッファになり、
    // 文字はそこから降りてきてマスクに入る → 「上から流れてきた」感が出る。
    // ペイライン位置・中央セル判定は従来通り（PAYLINE_Y は変えない）。
    // 停止バウンスの計算
    if (this.bounceActive) {
      const t = nowMs ?? performance.now();
      const elapsed = t - this.bounceStart;
      const durMs = 220;
      if (elapsed >= durMs) {
        this.bounceActive = false;
        this.bounceOffsetY = 0;
      } else {
        const k = elapsed / durMs;
        // 減衰しながら振動：sin(2π * 2) で 2サイクル
        this.bounceOffsetY = Math.sin(k * Math.PI * 4) * 9 * (1 - k);
      }
    }

    for (let i = 0; i < total; i++) {
      let y = (pos - i) * CELL_HEIGHT + PAYLINE_Y + PRE_BUFFER;
      y = ((y % totalHeight) + totalHeight) % totalHeight;
      this.cellContainers[i].y = y - PRE_BUFFER + this.bounceOffsetY;
    }

    // モーションブラー：回転中だけ、速度（1フレームの移動px）に比例して縦に滲ませる。
    // 停止した瞬間に 0 へ戻るので、出目はくっきり読める（目押しの答え合わせを妨げない）。
    const spinning = this.engine.state.get() === 'spinning';
    const speed = spinning ? this.engine.currentSpeed : 0;
    const strengthY =
      speed >= MOTION_BLUR_MIN_SPEED
        ? ((speed * CELL_HEIGHT) / 60) * motionBlurStrength
        : 0;
    if (this.motionBlur.strengthY !== strengthY) {
      this.motionBlur.strengthY = strengthY;
      // strength=0 のままフィルタを通すと無駄なテクスチャ確保が走るので、止まったら外す
      this.motionBlur.enabled = strengthY > 0;
    }

    // テンパイ枠の脈動
    if (this.tenpaiAnimMs > 0) {
      const t = nowMs ?? performance.now();
      const pulse = (Math.sin(t / 120) + 1) / 2; // 0..1
      const baseColor = this.tenpaiPremium ? 0xff3366 : 0xffff00;
      const width = 3 + pulse * 3;
      this.redrawBg(baseColor, width);
    }

    // 中央ハイライトのフェードアウト
    if (this.centerGlowAlpha > 0) {
      const t = nowMs ?? performance.now();
      const elapsed = t - this.centerGlowStart;
      if (elapsed >= this.centerGlowDuration) {
        this.centerGlowAlpha = 0;
      } else {
        const k = 1 - elapsed / this.centerGlowDuration;
        // 脈動 + フェード
        const pulse = 0.5 + 0.5 * Math.sin(t / 80);
        this.centerGlowAlpha = 0.55 * k * pulse;
      }
      this.centerGlow.alpha = this.centerGlowAlpha;
    }
  }

  /**
   * クイズの答えの文字を「うっすら」強調する。target 以外のセルを NON_TARGET_ALPHA まで落とすだけ。
   * 以前は 0.25 まで暗く落としていたが、それでは答えが一目で分かってしまい、
   * 「どれかな」と自分で考えて狙うというクイズの主旨が消える（答えの提示ではなく、気づきの補助）。
   * null を渡すと通常表示に戻る。
   */
  setTargetSymbol(symbol: string | null): void {
    for (let i = 0; i < this.cellContainers.length; i++) {
      const isTarget = symbol === null || this.cellSymbols[i] === symbol;
      this.cellContainers[i].alpha = isTarget ? 1 : NON_TARGET_ALPHA;
    }
  }

  /** 中央セル（ペイライン上）を一定時間グローさせる（役成立時） */
  highlightCenter(durMs = 1200): void {
    this.centerGlowStart = performance.now();
    this.centerGlowDuration = durMs;
    this.centerGlowAlpha = 0.55;
    this.centerGlow.alpha = this.centerGlowAlpha;
  }

  /**
  /**
   * コマ番号の表示を切り替える。
   * 押下位置と停止位置の差＝引き込みコマ数を目で数えられるようにするためのもの。
   */
  setShowCellIndices(show: boolean): void {
    this.showCellIndices = show;
    for (const label of this.cellIndexLabels) label.visible = show;
  }

  /**
   * 滑りコマ数を出す／消す（null で消す）。
   *
   * ニアミス（1コマずれ）の検出器はあるのに、出口がクイズの不正解台詞だけだった。
   * クイズが出るのは3ゲームに1度なので、残りでは「惜しかった」が伝わらない。
   * 目押しのゲームで惜しさが伝わらないのは損が大きいので、**押した本人が
   * 確かめられる**手段として置く（実機によくある確認手段と同じ）。
   *
   * 0コマは金色。**ビタ押しとは別物**（ビタは押下タイミングの精度、ここは
   * 引き込みの量）なので「ビタ」とは書かない。
   */
  setSlipBadge(cells: number | null): void {
    if (cells === null) {
      this.slipBadge.visible = false;
      return;
    }
    this.slipBadgeText.text = `滑り ${cells}`;
    this.slipBadgeText.style.fill = cells === 0 ? 0xffd700 : 0xffe08a;
    this.slipBadge.visible = true;
  }

  /** 滑りコマ数が出ているか（トグルの判定用） */
  isSlipBadgeVisible(): boolean {
    return this.slipBadge.visible;
  }

  /** STOP 押下後の停止バウンス（軽い縦振動） */
  triggerStopBounce(): void {
    this.bounceStart = performance.now();
    this.bounceActive = true;
  }

  /** テンパイ枠フラッシュを開始（残ったリール用） */
  startTenpaiFlash(premium: boolean): void {
    this.tenpaiAnimMs = 1; // フラグ立て
    this.tenpaiPremium = premium;
  }

  /** テンパイ枠フラッシュを終了して通常枠に戻す */
  stopTenpaiFlash(): void {
    this.tenpaiAnimMs = 0;
    this.redrawBg(0xffd700, 3);
  }

  private redrawBg(strokeColor: number, strokeWidth: number): void {
    this.bg.clear();
    // 枠（黒背景＋金枠）は図柄表示範囲(上下チラ見せ ±REEL_PEEK)より FRAME_PAD 分さらに外側へ描く。
    // これで図柄（チラ見せ含む）と金枠の線の間に黒余白ができ、色が混じらない。
    this.bg.rect(
      0,
      -REEL_PEEK - FRAME_PAD,
      CELL_WIDTH,
      VIEW_HEIGHT + REEL_PEEK * 2 + FRAME_PAD * 2,
    );
    this.bg.fill({ color: 0x000000 });
    this.bg.stroke({ width: strokeWidth, color: strokeColor });
  }

  /**
   * 指定セル（リール内の周回 index）のタイルを役色で塗り替え、durMs 後に元に戻す。
   * 役成立時に、3 リールにまたがる構成文字をまとめて同色化するための公開 API。
   *
   * 共有文字（複数役で使われる文字）はタイル静的色が衝突するが、
   * これを使えば成立した瞬間だけは「揃った役の 3 文字」が同色で見える。
   */
  highlightCells(cellIndexes: readonly number[], color: number, durMs = 1400): void {
    this.clearHighlight();
    this.highlightedIndexes = [...cellIndexes];
    for (const i of cellIndexes) {
      if (i < 0 || i >= this.cellContainers.length) continue;
      const sprite = this.cellSprites[i];
      if (sprite) {
        // 図柄スプライト：役色の枠グローを重ね、軽く拡大して「揃った」を強調
        const glow = new Graphics();
        glow
          .roundRect(6, -CELL_HEIGHT / 2 + 6, CELL_WIDTH - 12, CELL_HEIGHT - 12, 12)
          .stroke({ width: 5, color, alpha: 0.95 });
        this.cellContainers[i].addChild(glow);
        this.cellGlows[i] = glow;
        sprite.scale.set(this.cellSpriteBaseScale[i] * 1.07);
      }
    }
    this.highlightTimer = window.setTimeout(() => {
      this.clearHighlight();
    }, durMs);
  }

  /** ハイライト中のタイルを元の色に戻す（タイマー強制終了込み） */
  clearHighlight(): void {
    if (this.highlightTimer !== null) {
      window.clearTimeout(this.highlightTimer);
      this.highlightTimer = null;
    }
    for (const i of this.highlightedIndexes) {
      if (i < 0 || i >= this.cellContainers.length) continue;
      const glow = this.cellGlows[i];
      if (glow) {
        glow.destroy();
        this.cellGlows[i] = null;
      }
      const sprite = this.cellSprites[i];
      if (sprite) {
        sprite.scale.set(this.cellSpriteBaseScale[i]);
      }
    }
    this.highlightedIndexes = [];
  }
}
