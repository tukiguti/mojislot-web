import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { SlipResolver, type VisibleColumn } from '../../src/productions/SlipResolver';
import { StopController, type StopRequest } from '../../src/core/StopController';
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
  StopTableSchema,
  STOP_TABLE_VERSION,
  SECOND_STOP_ORDERS,
  THIRD_STOP_FINALS,
  type StopTable,
  type Yaku,
  type YakuList,
} from '../../src/data/schemas';

/**
 * 停止テーブルの生成。
 *
 *   GEN=1 npx vitest run tests/tools/gen-stop-table.test.ts --testTimeout=1800000
 *
 * 現行の停止制御から `data/stops/<章>.json` を書き出す。第1停止は**生成後に手で書き換えてよい**
 * （第2・第3停止は第1停止の表を前提に焼くので、書き換えたら焼き直す）。
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

/**
 * その内部役の許可リスト。ボーナス中だけ**1枚役（こぼし先）**が加わる。
 * 当選役を引き込めなかった最終停止で拾いに行くための受け皿で、
 * ここが違うと同じ内部役でも制御が変わる（設計: 31章）。
 * ゲーム本体（main.ts の activeFlagYakuIds）と同じ規則。
 */
export function flagIdsFor(yakuList: YakuList, roleId: string, bonus: boolean): string[] {
  const base = flagYakusFor(yakuList, roleId).map((y) => y.id);
  if (!bonus || base.length === 0) return base;
  const singles = yakuList.singleYaku.map((s) => s.id);
  // 1枚役そのものが当選している時は足さない（既にグループ全体が入っている）
  return singles.some((s) => base.includes(s)) ? base : [...base, ...singles];
}

const visCol = (cells: readonly string[], pos: number): VisibleColumn => ({
  top: visibleAt(cells, pos, 'top'),
  middle: visibleAt(cells, pos, 'middle'),
  bottom: visibleAt(cells, pos, 'bottom'),
});

/**
 * 第2・第3停止の表を焼く制御。第1停止の表だけを持たせ、第2・第3停止は**探索**
 * （引き込み保証 → 引き込み → 蹴り、最終停止はリーチ目の寄せまで）で決めさせる。
 * 表とアルゴリズムが食い違わないよう、表の値はこの制御の答えをそのまま写す。
 * 表引きと探索の突き合わせ（tests/data/stop-table-equivalence）も同じものを使う。
 */
export function searchController(
  yakuList: YakuList,
  reels: readonly (readonly string[])[],
  resolver: SlipResolver,
  pullInCells: number,
  firstStop: Record<string, number[][]>,
  chapter: string,
): StopController {
  return new StopController({
    yakuList,
    slipResolver: resolver,
    tenpaiDetector: new TenpaiDetector(yakuList),
    stopTable: new StopTableLookup({
      dataVersion: STOP_TABLE_VERSION,
      mode: chapter,
      firstStop,
      slipPool: [],
    }),
    pullInCells,
    reels,
  });
}

/**
 * 第2停止の要求。`first` を `firstPos` に止めた状態から `reel` を `press` で押す。
 */
export function secondStopRequest(
  reels: readonly (readonly string[])[],
  first: number,
  firstPos: number,
  reel: number,
  press: number,
  flagYakuIds: readonly string[],
  flagKey: string,
): StopRequest {
  const vis: (VisibleColumn | null)[] = [null, null, null];
  const pos: (number | null)[] = [null, null, null];
  vis[first] = visCol(reels[first], firstPos);
  pos[first] = firstPos;
  return {
    reelIndex: reel,
    basePosition: press,
    strip: { id: `r${reel}`, cells: [...reels[reel]] },
    stoppedVisibles: vis,
    stoppedPositions: pos,
    flagYakuIds,
    flagKey,
  };
}

/**
 * 第3停止の要求。`reel` 以外の2本を `posA`（若い番号のリール）・`posB` に止めた状態から
 * `reel` を `press` で押す。どちらを先に止めたかは制御に効かない。
 */
export function thirdStopRequest(
  reels: readonly (readonly string[])[],
  reel: number,
  posA: number,
  posB: number,
  press: number,
  flagYakuIds: readonly string[],
  flagKey: string,
): StopRequest {
  const [a, b] = [0, 1, 2].filter((i) => i !== reel);
  const vis: (VisibleColumn | null)[] = [null, null, null];
  const pos: (number | null)[] = [null, null, null];
  vis[a] = visCol(reels[a], posA);
  vis[b] = visCol(reels[b], posB);
  pos[a] = posA;
  pos[b] = posB;
  return {
    reelIndex: reel,
    basePosition: press,
    strip: { id: `r${reel}`, cells: [...reels[reel]] },
    stoppedVisibles: vis,
    stoppedPositions: pos,
    flagYakuIds,
    flagKey,
  };
}

/**
 * 全押し順の第2・第3停止の表を焼く（通常時とボーナス中の4つ）。
 * 中身の文字列は `slipPool` に1つずつ置き、表は番号で指す（同じ表が多いため）。
 *
 * 添字は先に止めたリールの**停止位置**。**全21通り（第3停止は21×21通り）を埋める**——
 * ある押し順で実際に止まる位置だけを計算すると残りの欄が空のまま残り、別の押し方で
 * 同じ状態になった時にその空欄を引いてしまう（2026-10-02 に第3停止で実際に起きた）。
 */
export function buildLaterStopTables(
  yakuList: YakuList,
  reels: readonly (readonly string[])[],
  controller: StopController,
): Pick<
  StopTable,
  'slipPool' | 'secondStop' | 'thirdStop' | 'bonusSecondStop' | 'bonusThirdStop'
> {
  const n = reels[0].length;
  const slipPool: string[] = [];
  const poolIndex = new Map<string, number>();
  const intern = (packed: string): number => {
    let i = poolIndex.get(packed);
    if (i === undefined) {
      i = slipPool.length;
      slipPool.push(packed);
      poolIndex.set(packed, i);
    }
    return i;
  };
  const buildSecond = (bonus: boolean) => {
    const out: Record<string, Record<string, number>> = {};
    for (const key of SECOND_STOP_ORDERS) {
      const first = Number(key[0]);
      const reel = Number(key[1]);
      const byRole: Record<string, number> = {};
      for (const role of yakuList.internalRoles) {
        const flagIds = flagIdsFor(yakuList, role.id, bonus);
        let s = '';
        for (let p0 = 0; p0 < n; p0++) {
          for (let press = 0; press < n; press++) {
            s += controller.resolveSlip(
              secondStopRequest(reels, first, p0, reel, press, flagIds, role.id),
            );
          }
        }
        byRole[role.id] = intern(s);
      }
      out[key] = byRole;
    }
    return out as NonNullable<StopTable['secondStop']>;
  };
  const buildThird = (bonus: boolean) => {
    const out: Record<string, Record<string, number>> = {};
    for (const key of THIRD_STOP_FINALS) {
      const reel = Number(key);
      const byRole: Record<string, number> = {};
      for (const role of yakuList.internalRoles) {
        const flagIds = flagIdsFor(yakuList, role.id, bonus);
        const parts: string[] = [];
        for (let pa = 0; pa < n; pa++) {
          for (let pb = 0; pb < n; pb++) {
            let s = '';
            for (let press = 0; press < n; press++) {
              s += controller.resolveSlip(
                thirdStopRequest(reels, reel, pa, pb, press, flagIds, role.id),
              );
            }
            parts.push(s);
          }
        }
        byRole[role.id] = intern(parts.join(''));
      }
      out[key] = byRole;
    }
    return out as NonNullable<StopTable['thirdStop']>;
  };
  const secondStop = buildSecond(false);
  const thirdStop = buildThird(false);
  const bonusSecondStop = buildSecond(true);
  const bonusThirdStop = buildThird(true);
  return { slipPool, secondStop, thirdStop, bonusSecondStop, bonusThirdStop };
}

/** `CHAPTER=寿司のID` で1島だけ焼く（島ごとに別プロセスで並べて回せる）。 */
const ONLY = process.env.CHAPTER;

describe.skipIf(!RUN)('停止テーブル生成', () => {
  it('全章の停止テーブル（第1停止＋全押し順の第2・第3停止）を data/stops へ書き出す', () => {
    const tuning = TuningSchema.parse(readJson(`${DATA}/tuning/default.json`));
    mkdirSync(`${DATA}/stops`, { recursive: true });
    for (const chapter of CHAPTERS) {
      if (ONLY && chapter !== ONLY) continue;
      const yakuList = YakuListSchema.parse(readJson(`${DATA}/yaku/${chapter}.json`));
      const reelCfg = ReelConfigSchema.parse(readJson(`${DATA}/reels/${chapter}.json`));
      const reels = reelCfg.reels.map((r) => r.cells);
      const resolver = new SlipResolver(yakuList, {
        assistMaxCells: tuning.assist.pullInCells,
      });

      const firstStop = buildFirstStopTable(yakuList, reels, resolver, tuning.assist.pullInCells);
      // 第2・第3停止は制御そのものを通す（引き込み保証も、最終停止のリーチ目の寄せも
      // StopController の中で効く）。リーチ目の寄せは表を引いた値に重ねても同じ値を返す
      // （冪等）ので、実行時に表の値へもう一度かかっても変わらない。
      const controller = searchController(
        yakuList, reels, resolver, tuning.assist.pullInCells, firstStop, chapter,
      );
      const later = buildLaterStopTables(yakuList, reels, controller);

      const out = {
        dataVersion: STOP_TABLE_VERSION,
        mode: chapter,
        firstStop,
        secondStop: later.secondStop,
        thirdStop: later.thirdStop,
        bonusSecondStop: later.bonusSecondStop,
        bonusThirdStop: later.bonusThirdStop,
        slipPool: later.slipPool,
      };
      // 第1停止は手で読み書きする表なので配列のまま。第2・第3停止はプールの番号。
      // 手で読むものではないので、全体をコンパクトに書き出す。
      writeFileSync(
        `${DATA}/stops/${chapter}.json`,
        `${JSON.stringify(out)}\n`,
        'utf-8',
      );
      const parsed = StopTableSchema.parse(out);
      expect(Object.keys(parsed.firstStop).length).toBe(yakuList.internalRoles.length);
    }
  });
});
