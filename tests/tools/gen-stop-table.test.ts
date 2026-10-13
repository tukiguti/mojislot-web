import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { SlipResolver, type VisibleColumn } from '../../src/productions/SlipResolver';
import { StopController } from '../../src/core/StopController';
import { StopTableLookup } from '../../src/core/StopTable';
import { TenpaiDetector } from '../../src/productions/TenpaiDetector';
import { PullInGuard } from '../../src/core/PullInGuard';
import {
  PAYLINES,
  ROW_VERTICAL,
  primaryRowOf,
  visibleAt,
  type Vertical,
} from '../../src/core/Paylines';
import {
  YakuListSchema,
  ReelConfigSchema,
  TuningSchema,
  type Yaku,
  type YakuList,
} from '../../src/data/schemas';

/**
 * 停止テーブル（第1停止）の生成。
 *
 *   GEN=1 npx vitest run tests/tools/gen-stop-table.test.ts
 *
 * 現行の停止制御（当選役を pullInCells 以内で中段へ引き込む）から
 * `data/stops/<章>.json` を書き出す。**生成後は手で書き換えてよい**。
 * 第1停止ではどの役もロックし得ないため蹴りは発火せず、ここは完全に自由に
 * 設計できる（リーチ目・入り目の起点）。②ゼロ保証は第2・第3停止の蹴りが守り、
 * 監査テストが全押下位置で検証する。
 */

const RUN = process.env.GEN === '1';
const DIR = dirname(fileURLToPath(import.meta.url));
const DATA = resolve(DIR, '../../data');
const readJson = (p: string) => JSON.parse(readFileSync(p, 'utf-8'));

const CHAPTERS = [
  'hiragana_food',
  'hiragana_verb',
  'katakana_animal',
  'security',
  'yasai',
] as const;

/** 内部役ID → その役が出目に出してよい役（1枚役はグループ全体）。 */
export function flagYakusFor(yakuList: YakuList, flagKey: string): Yaku[] {
  if (flagKey === 'miss') return [];
  if (flagKey === 'single') return [...yakuList.singleYaku];
  const all = [
    ...yakuList.coreYaku,
    ...yakuList.cherryYaku,
    ...yakuList.bonusYaku,
    ...yakuList.premiumYaku,
    ...yakuList.chanceYaku,
  ];
  const role = yakuList.internalRoles.find((r) => r.id === flagKey);
  const id = role?.displayYakuId ?? flagKey;
  const y = all.find((v) => v.id === id);
  return y ? [y] : [];
}

/**
 * 各リールの「ボーナス役にしか使われない図柄」＝ボーナス専用図柄。
 * 非ボーナスフラグではこれを第1停止の中段に止めないことで、
 * 「中段にこの図柄＝ボーナス確定」という一発リーチ目が成立する（実機の中段告知と同じ）。
 */
export function bonusOnlySymbols(yakuList: YakuList, reel: number): Set<string> {
  const bonusSide = new Set(
    [...yakuList.bonusYaku, ...yakuList.premiumYaku]
      .map((y) => y.symbols[reel])
      .filter((v): v is string => v !== undefined),
  );
  for (const y of [
    ...yakuList.coreYaku,
    ...yakuList.cherryYaku,
    ...yakuList.singleYaku,
  ]) {
    const sym = y.symbols[reel];
    if (sym !== undefined) bonusSide.delete(sym);
  }
  return bonusSide;
}

/**
 * 第1停止（他リール未停止）のスベリコマ数を現行制御から計算する。
 *
 * **中段が第一候補で、上下段は中段に届かない時だけの逃げ道**。第1停止ではまだ
 * どのラインも確定していないので図柄が窓のどこかに入ればよく、上下段も使えば
 * 引き込み窓が5コマから7コマに広がる。
 *
 * ただし中段の優先を外すと、中段が特別な位置でなくなって**示唆の発展**（当選図柄が
 * 中段に来たら役を明かす）と**中段告知**（持ち越し中の一発リーチ目）が両方壊れる。
 * 実測で発展68%→38%、中段告知46.5%→14.1%まで落ちた。だから中段が届く限り中段。
 */
/**
 * 引き込み保証は `src/core/PullInGuard.ts`（停止制御の本体と同じ実装）を使う。
 * 以前はここにだけ書いてあり、表の無い押し順（順押し以外）では保証が効いていなかった。
 */
export function computeFirstStopSlip(
  resolver: SlipResolver,
  targets: readonly Yaku[],
  cells: readonly string[],
  reel: number,
  press: number,
  pullInCells: number,
): number {
  if (targets.length === 0) return 0; // ハズレ：第1停止では蹴りが効かない＝押した位置で止まる
  const stopped: (VisibleColumn | null)[] = [null, null, null];
  const ctx = {
    reelIndex: reel,
    basePosition: press,
    strip: { id: `r${reel}`, cells: [...cells] },
    stoppedVisibles: stopped,
    exceptYakuIds: targets.map((y) => y.id),
  };
  const pick = (verticals: readonly Vertical[]): number | null => {
    let best: number | null = null;
    for (const y of targets) {
      const sym = y.symbols[reel];
      if (sym === undefined) continue;
      for (const vertical of verticals) {
        const slip = resolver.resolveAssist(ctx, sym, vertical, pullInCells);
        if (slip !== null && (best === null || slip < best)) best = slip;
      }
    }
    return best;
  };
  // **押下位置ごとに狙う段を振り分ける。**
  //
  // 全段を通して最小のスベリを取ると、必ず上段になる。可視は 上段=pos+1 /
  // 中段=pos / 下段=pos-1 で、引き込みは前方向にしか効かないので、**上段が
  // 一番少ないスベリで届く**ためである。実測でライン別の成立は上段33.7%に対し
  // 下段5.9%、押下位置21通りのうち下段に止まるのは2〜4通りしかなかった。
  // 5ラインあるように見えて実質1本になる。
  //
  // 実機の停止テーブルは「最小」ではなく押下位置ごとに設計者が決めた値なので、
  // ここも同じように振り分ける。**上段と下段を交互**にするのは、どちらも
  // 2本のライン（上段＋右下がり／下段＋右上がり）に乗るため。中段は中段ライン
  // 1本にしか乗らず、そこへ寄せると後続リールの逃げ道が減って取りこぼしが増える
  // （中段優先を試した時に持ち越しが593G→892Gへ延びた）。だから中段は最後。
  // **ぴったり押せていたら滑らせない。** 図柄が既に窓に見えているなら滑り0で止める。
  // 滑り0＝引き込み無しで自力停止なのでビタ押しの上乗せが付く（[21] payout の
  // bitaMultiplier）。ここで段の振り分けを優先すると、ぴったり押しても1コマ滑って
  // ビタが原理的に成立しなくなる（統合テストが検出した）。
  // 副産物として、p=k-1/k/k+1 がそれぞれ上段/中段/下段の滑り0になるので、
  // **どの段にも必ず届く押下位置が1つずつ残る**。
  for (const y of targets) {
    const sym = y.symbols[reel];
    if (sym === undefined) continue;
    const n = cells.length;
    const win = [
      cells[(press + 1) % n],
      cells[press % n],
      cells[((press - 1) % n + n) % n],
    ];
    if (win.includes(sym)) return 0;
  }

  // 先頭に置いた段がその押下位置を総取りする（3段はそれぞれ5通りの押下位置から
  // 届き、範囲が重なっているため）。だから**先頭に何を置くかの配分**がそのまま
  // ライン別の出やすさになる。中段は4回に1回だけ先頭にする——中段ライン1本しか
  // 使えず、多くすると後続リールの逃げ道が減って出玉が落ちるため。
  const ORDERS: readonly (readonly Vertical[])[] = [
    ['top', 'bottom', 'middle'],
    ['bottom', 'top', 'middle'],
    ['middle', 'top', 'bottom'],
    ['bottom', 'top', 'middle'],
  ];
  const order = ORDERS[press % ORDERS.length];


  for (const vertical of order) {
    const slip = pick([vertical]);
    if (slip !== null) return slip;
  }
  return 0;
}

/**
 * 第1停止テーブル（内部役 × リール × 押下位置 → 滑り）を作る。
 * 停止テーブルの生成と配列の探索（optimize-reels）の**両方がこれを使う**——別々に
 * 書くと、探索が測った制御と実際に焼かれる制御が食い違う（第2・第3停止で実際に起きた）。
 */
export function buildFirstStopTable(
  yakuList: YakuList,
  reels: readonly (readonly string[])[],
  resolver: SlipResolver,
  pullInCells: number,
): Record<string, number[][]> {

  const guard = new PullInGuard(yakuList, reels, pullInCells);
  /** 段の振り分け順（押下位置ごと）。同じ保証度なら先頭の段を採る。 */
  const ORDERS_G: readonly (readonly Vertical[])[] = [
    ['top', 'bottom', 'middle'],
    ['bottom', 'top', 'middle'],
    ['middle', 'top', 'bottom'],
    ['bottom', 'top', 'middle'],
  ];
  const rowOfSlip = (reel: number, press: number, slip: number, sym: string | undefined): Vertical | null => {
    if (sym === undefined) return null;
    const pos = (press + slip) % reels[reel].length;
    for (const v of ROW_VERTICAL) if (visibleAt(reels[reel], pos, v) === sym) return v;
    return null;
  };

  const firstStop: Record<string, number[][]> = {};
  for (const role of yakuList.internalRoles) {
    const targets = flagYakusFor(yakuList, role.id);
    firstStop[role.id] = [0, 1, 2].map((reel) => {
      const cells = reels[reel];
      const n = cells.length;
      return Array.from({ length: n }, (_, press) => {
        // 引き込み保証を最優先し、同じ保証度なら段の振り分け順で選ぶ。
        const order = ORDERS_G[press % ORDERS_G.length];
        const sym0 = targets[0]?.symbols[reel];
        const prefer = (s: number): number => {
          const r = rowOfSlip(reel, press, s, sym0);
          const i = r === null ? order.length : order.indexOf(r);
          return i < 0 ? order.length : i;
        };
        const stops0: (number | null)[] = [null, null, null];
        const guarded =
          targets.length > 0 ? guard.chooseSlip(targets, stops0, reel, press, prefer) : null;
        const slip =
          guarded ??
          computeFirstStopSlip(
            resolver, targets, cells, reel, press, pullInCells,
          );
        // 旧リーチ目（ボーナスの時にしか出ない停止形）の寄せと蹴りは外した（2026-10-12）。
        // リーチ目は目印揃いの役になり、出目はその内部役の引き込みと、ほかのフラグの
        // 蹴り（目印揃いは許可外の役として保証の判定で避けられる）だけで決まる。
        return slip;
      });
    });
  }
  return firstStop;
}

describe.skipIf(!RUN)('停止テーブル生成', () => {
  it('全章の第1停止テーブルを data/stops へ書き出す', () => {
    const tuning = TuningSchema.parse(readJson(`${DATA}/tuning/default.json`));
    mkdirSync(`${DATA}/stops`, { recursive: true });
    for (const chapter of CHAPTERS) {
      const yakuList = YakuListSchema.parse(readJson(`${DATA}/yaku/${chapter}.json`));
      const reelCfg = ReelConfigSchema.parse(readJson(`${DATA}/reels/${chapter}.json`));
      const reels = reelCfg.reels.map((r) => r.cells);
      const resolver = new SlipResolver(yakuList, {
        assistMaxCells: tuning.assist.pullInCells,
      });

      const firstStop = buildFirstStopTable(yakuList, reels, resolver, tuning.assist.pullInCells);
      // --- 第2停止（順押し）---
      // 第1停止テーブルで左を止めた状態から、中リールの各押下位置で制御を実行して
      // 結果を記録する。**制御そのものを通す**ので、表とアルゴリズムが食い違わない。
      const n = reels[0].length;
      const controller = new StopController({
        yakuList,
        slipResolver: resolver,
        tenpaiDetector: new TenpaiDetector(yakuList),
        stopTable: new StopTableLookup({ mode: chapter, firstStop }),
        pullInCells: tuning.assist.pullInCells,
        reels,
      });
      const visCol = (cells: readonly string[], pos: number): VisibleColumn => ({
        top: visibleAt(cells, pos, 'top'),
        middle: visibleAt(cells, pos, 'middle'),
        bottom: visibleAt(cells, pos, 'bottom'),
      });

      /**
       * その内部役の許可リスト。ボーナス中だけ**1枚役（こぼし先）**が加わる。
       * 当選役を引き込めなかった最終停止で拾いに行くための受け皿で、
       * ここが違うと同じ内部役でも制御が変わる（設計: 31章）。
       */
      const flagIdsFor = (roleId: string, bonus: boolean): string[] => {
        const base = flagYakusFor(yakuList, roleId).map((y) => y.id);
        if (!bonus || base.length === 0) return base;
        const singles = yakuList.singleYaku.map((s) => s.id);
        // 1枚役そのものが当選している時は足さない（既にグループ全体が入っている）
        return singles.some((s) => base.includes(s))
          ? base
          : [...base, ...singles];
      };

      const buildSecond = (bonus: boolean): Record<string, number[][]> => {
        const out: Record<string, number[][]> = {};
        for (const role of yakuList.internalRoles) {
          const flagIds = flagIdsFor(role.id, bonus);
          // 添字は「第1停止の**停止位置**」。押下位置ではない点に注意。
          const byFirstPos: number[][] = Array.from({ length: n }, () =>
            new Array<number>(n).fill(0),
          );
          // **第1停止の停止位置は全21通りを埋める**。順押しで実際に止まる位置だけを
          // 計算すると残りの欄が0（滑りなし）のまま残り、別の押し順で同じ状態に
          // なった時にその空欄を引いてしまう（第3停止で実際に起きた）。
          for (let pos0 = 0; pos0 < n; pos0++) {
            const left = visCol(reels[0], pos0);
            for (let press1 = 0; press1 < n; press1++) {
              // 制御そのものを通す（引き込み保証も StopController の中で効く）。
              byFirstPos[pos0][press1] = controller.resolveSlip({
                reelIndex: 1,
                basePosition: press1,
                strip: { id: 'r1', cells: reels[1] },
                stoppedVisibles: [left, null, null],
                stoppedPositions: [pos0, null, null],
                flagYakuIds: flagIds,
                flagKey: role.id,
              });
            }
          }
          out[role.id] = byFirstPos;
        }
        return out;
      };
      const secondStop = buildSecond(false);
      const bonusSecondStop = buildSecond(true);

      // --- 第3停止（順押し）---
      // 左・中を止めた状態から右リールの各押下位置で制御を実行する。
      // 添字は第1・第2の**停止位置**。**全 21×21 の組を埋める**——左と中が止まっていれば
      // 押し順に関係なくこの表を引くので（中→左→右でも引く）、順押しで到達する組だけを
      // 計算すると空欄の0（滑りなし）を引いて②が出た（2026-10-02）。
      const buildThird = (
        bonus: boolean,
      ): Record<string, number[][][]> => {
        const out: Record<string, number[][][]> = {};
        for (const role of yakuList.internalRoles) {
          const flagIds = flagIdsFor(role.id, bonus);
          const table: number[][][] = Array.from({ length: n }, () =>
            Array.from({ length: n }, () => new Array<number>(n).fill(0)),
          );
          for (let pos0 = 0; pos0 < n; pos0++) {
            const left = visCol(reels[0], pos0);
            for (let pos1 = 0; pos1 < n; pos1++) {
              const mid = visCol(reels[1], pos1);
              for (let press2 = 0; press2 < n; press2++) {
                table[pos0][pos1][press2] = controller.resolveSlip({
                  reelIndex: 2,
                  basePosition: press2,
                  strip: { id: 'r2', cells: reels[2] },
                  stoppedVisibles: [left, mid, null],
                  stoppedPositions: [pos0, pos1, null],
                  flagYakuIds: flagIds,
                  flagKey: role.id,
                });
              }
            }
          }
          out[role.id] = table;
        }
        return out;
      };
      const thirdStop = buildThird(false);
      const bonusThirdStop = buildThird(true);

      const out = {
        mode: chapter,
        firstStop,
        secondStop,
        thirdStop,
        bonusSecondStop,
        bonusThirdStop,
      };
      // 第3停止だけで 11役 × 21³ ＝ 約10万エントリある。インデントを付けると
      // 1.5MB/島まで膨らむので、ここはコンパクトに書き出す（手で読むものではない）。
      writeFileSync(
        `${DATA}/stops/${chapter}.json`,
        `${JSON.stringify(out)}\n`,
        'utf-8',
      );
      expect(Object.keys(firstStop).length).toBe(yakuList.internalRoles.length);
      expect(Object.keys(secondStop).length).toBe(yakuList.internalRoles.length);
    }
  });
});
