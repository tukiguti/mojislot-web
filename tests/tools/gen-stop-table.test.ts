import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { SlipResolver, type VisibleColumn } from '../../src/productions/SlipResolver';
import { StopController } from '../../src/core/StopController';
import { StopTableLookup } from '../../src/core/StopTable';
import { TenpaiDetector } from '../../src/productions/TenpaiDetector';
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
 * 引き込み保証（`feasible` / `robust`）。**[lol-slot] の `ReelControl` と同じ判定**を、
 * 停止テーブルを焼く時に回す。
 *
 * 実機の制御は「成立した役の図柄が4コマ以内にあれば必ず有効ラインへ引き込む」ことを
 * 求められる。各リールで「その時点で成立する最小のスベリ」を選ぶだけだと、
 * **先に止めたリールの位置しだいで、残りをどう止めても成立しなくなる**。
 * 実測で、正しく狙ったのに揃わない組み合わせが69件あり、**その全部が
 * スベリの選び方しだいで揃えられた**（配列の問題ではなかった）。
 *
 *   feasible … 未停止のリールに「どこかの位置」を置けば成立するか
 *   robust   … 未停止のリールを**どこで押されても**成立させ続けられるか
 *
 * robust は再帰。止めた先でも保証が続くかを確かめる。純粋関数なのでキャッシュできる。
 */
function makeGuard(
  reels: readonly (readonly string[])[],
  pullInCells: number,
) {
  const n = reels[0].length;
  /** 狙ったとみなす押下位置の幅（図柄の手前何コマまで）。AUTO は手前2コマで押す。 */
  const AIM_SPAN = pullInCells;
  const rowsAt = (reel: number, pos: number): string[] => [
    visibleAt(reels[reel], pos, 'top'),
    visibleAt(reels[reel], pos, 'middle'),
    visibleAt(reels[reel], pos, 'bottom'),
  ];
  /** 3リールとも止まった状態で、狙いの役が5ラインのどれかで成立しているか。 */
  const matches = (targets: readonly Yaku[], stops: readonly number[]): boolean => {
    const w = [rowsAt(0, stops[0]), rowsAt(1, stops[1]), rowsAt(2, stops[2])];
    return targets.some((y) =>
      PAYLINES.some((L) =>
        y.symbols.every((sym, r) => sym === undefined || w[r][L.cells[r][0]] === sym),
      ),
    );
  };
  const key = (targets: readonly Yaku[], stops: readonly (number | null)[]) =>
    `${targets.map((y) => y.id).join('+')}|${stops.join(',')}`;
  const feasCache = new Map<string, boolean>();
  const robustCache = new Map<string, boolean>();

  const feasible = (targets: readonly Yaku[], stops: readonly (number | null)[]): boolean => {
    const k = key(targets, stops);
    const hit = feasCache.get(k);
    if (hit !== undefined) return hit;
    const work = [...stops];
    const rest = [0, 1, 2].filter((i) => work[i] === null);
    const search = (idx: number): boolean => {
      if (idx >= rest.length) return matches(targets, work as number[]);
      const r = rest[idx];
      for (let c = 0; c < n; c++) {
        work[r] = c;
        if (search(idx + 1)) {
          work[r] = null;
          return true;
        }
      }
      work[r] = null;
      return false;
    };
    const ok = search(0);
    feasCache.set(k, ok);
    return ok;
  };

  const robust = (targets: readonly Yaku[], stops: readonly (number | null)[]): boolean => {
    const k = key(targets, stops);
    const hit = robustCache.get(k);
    if (hit !== undefined) return hit;
    robustCache.set(k, true); // 再訪よけ
    let ok = true;
    outer: for (let r = 0; r < 3; r++) {
      if (stops[r] !== null) continue;
      for (let press = 0; press < n; press++) {
        let reachable = false;
        for (let slip = 0; slip <= pullInCells && !reachable; slip++) {
          const next = [...stops];
          next[r] = (press + slip) % n;
          if (feasible(targets, next) && robust(targets, next)) reachable = true;
        }
        if (!reachable) {
          ok = false;
          break outer;
        }
      }
    }
    if (stops.every((v) => v !== null)) ok = matches(targets, stops as number[]);
    robustCache.set(k, ok);
    return ok;
  };

  /**
   * **狙った押下位置に限った保証**。`robust` は「どこで押されても」を求めるので
   * 配列によっては成立せず、そこで素の `feasible` へ落ちると貪欲に戻ってしまう。
   *
   * プレイヤーは図柄を狙って押すので、**その図柄が引き込める押下位置**だけを
   * 見れば十分。ここを保証すれば「正しく狙ったのに揃わない」は消える。
   */
  const aimedCache = new Map<string, boolean>();
  const robustAimed = (
    targets: readonly Yaku[],
    stops: readonly (number | null)[],
  ): boolean => {
    const k = key(targets, stops);
    const hit = aimedCache.get(k);
    if (hit !== undefined) return hit;
    aimedCache.set(k, true);
    let ok = true;
    outer: for (let r = 0; r < 3; r++) {
      if (stops[r] !== null) continue;
      const syms = new Set(
        targets.map((y) => y.symbols[r]).filter((s): s is string => s !== undefined),
      );
      if (syms.size === 0) continue; // チェリーの第3リールなど、狙う図柄が無い
      for (let press = 0; press < n; press++) {
        // **狙った押し方の範囲**だけを見る。図柄に届くだけの端の位置（滑りを使い切って
        // 1つの段にしか置けない場所）まで保証しようとすると、どの停止位置を選んでも
        // 成立せず、素の feasible へ落ちて貪欲に戻る。実測でそうなった。
        // 手前3コマ以内で押した時＝実際の打ち方（ゲーム本体のAUTOは手前2コマ）。
        const canAim = Array.from({ length: AIM_SPAN + 1 }, (_, s) => (press + s) % n).some(
          (pos) => rowsAt(r, pos).some((c) => syms.has(c)),
        );
        if (!canAim) continue;
        let good = false;
        for (let slip = 0; slip <= pullInCells && !good; slip++) {
          const next = [...stops];
          next[r] = (press + slip) % n;
          if (feasible(targets, next) && robustAimed(targets, next)) good = true;
        }
        if (!good) {
          ok = false;
          break outer;
        }
      }
    }
    if (stops.every((v) => v !== null)) ok = matches(targets, stops as number[]);
    aimedCache.set(k, ok);
    return ok;
  };

  /**
   * そのリールを press から止める時のスベリを選ぶ。
   * ① 引き込み保証（feasible かつ robust）を満たす候補
   * ② 狙った押下位置に限った保証（robustAimed）を満たす候補
   * ③ 保証はできないが成立させうる候補
   * を、`prefer` が返す優先順位（段の振り分けなど）で並べて先頭を採る。
   */
  const chooseSlip = (
    targets: readonly Yaku[],
    stops: readonly (number | null)[],
    reel: number,
    press: number,
    prefer: (slip: number) => number,
  ): number | null => {
    const cands = Array.from({ length: pullInCells + 1 }, (_, s) => s).sort(
      (a, b) => prefer(a) - prefer(b) || a - b,
    );
    for (const pass of [0, 1, 2]) {
      for (const s of cands) {
        const next = [...stops];
        next[reel] = (press + s) % n;
        if (!feasible(targets, next)) continue;
        if (pass === 0 && !robust(targets, next)) continue;
        if (pass === 1 && !robustAimed(targets, next)) continue;
        return s;
      }
    }
    return null;
  };

  return { chooseSlip, feasible, robust };
}

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

      /** その位置で止めたときの窓（上中下）を1つの文字列にしたもの。 */
      const colKey = (cells: readonly string[], pos: number): string =>
        `${visibleAt(cells, pos, 'top')}${visibleAt(cells, pos, 'middle')}${visibleAt(cells, pos, 'bottom')}`;

      /**
       * **リーチ目にする形**：中段にボーナス専用図柄が来た停止。
       *
       * 実機のリーチ目は「フラグ無しでは制御上あり得ない出目」だが、**あり得ない状態は
       * 制御が作る**。ハズレの第1停止は押した位置で止まるので、放っておけばどの形も
       * ハズレで出てしまい、1リールで確定する出目は原理的に生まれない（実際に全滅した）。
       *
       * そこで実機と同じく **非ボーナス側にこの形を避けさせ（蹴り）、ボーナス側は
       * 引き込めなかった時にここへ寄せる**。行ではなく「中段の図柄」で定義するので
       * 主ラインには依存しない。
       */
      // REACH_SCOPE=window で「窓のどこかに専用図柄」を確定目とみなす。中段限定だと
      // ボーナス図柄を中段へ寄せる必要があり、第1リールの中段は5本中1本（中段ライン）
      // にしか乗らないぶん揃える経路を削ってしまう。
      const isReachCol = (reel: number, pos: number): boolean =>
        bonusOnlySymbols(yakuList, reel).has(visibleAt(cells0(reel), pos, 'middle'));
      const cells0 = (reel: number): readonly string[] => reels[reel];

      const guard = makeGuard(reels, tuning.assist.pullInCells);
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
        const isBonusFlag = role.kind === 'reg' || role.kind === 'big';
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
                resolver, targets, cells, reel, press, tuning.assist.pullInCells,
              );
            if (!isBonusFlag) {
              // 非ボーナス：リーチ目の形を**避ける**（蹴り）。これが無いと
              // 「ボーナスの時にしか出ない」が成立せず、告知が嘘になる。
              for (let d = 0; d <= tuning.assist.pullInCells; d++) {
                const cand = (slip + d) % (tuning.assist.pullInCells + 1);
                if (!isReachCol(reel, (press + cand) % n)) return cand;
              }
              return slip; // 窓内すべて該当（配列的にあり得ないが保険）
            }
            // ボーナス側の優先順位:
            //   ① 図柄を**中段**へ引き込む → 揃えに行きつつ、それ自体が確定目になる
            //   ② 窓のどこかへ引き込む     → 揃えに行く
            //   ③ 引き込めない            → リーチ目の形へ寄せる（下の分岐）
            // ①を先に見るのが要。②で済ませると図柄が上下段に散り、確定目が出る機会を
            // みすみす捨てることになる（実測で告知が5.6%までしか戻らなかった）。
            const symOf = (y: (typeof targets)[number]) => y.symbols[reel];
            const at = (p: number, v: 'top' | 'middle' | 'bottom') => visibleAt(cells, p, v);
            // 図柄を**中段へ寄せる**優先は入れない。第1リールの中段は5本中1本
            // （中段ライン）にしか乗らないので、揃える経路を削る。実測で持ち越しが
            // 593G→892G と1.5倍に延び、機械割も 126.8%→125.9% に落ちた。
            const pos = (press + slip) % n;
            const pulledIn = targets.some((y) => {
              const sym = symOf(y);
              return (
                sym !== undefined &&
                (['top', 'middle', 'bottom'] as const).some((v) => at(pos, v) === sym)
              );
            });
            if (pulledIn) return slip;
            // **引き込めなかった＝取りこぼし。ここでリーチ目を出す。**
            // 実機のリーチ目は「フラグが立っているのにボーナス図柄を引き込めなかった時」
            // に出る制御の副産物なので、この局面でだけ非ボーナスに無い停止形へ寄せる。
            for (let d = 0; d <= tuning.assist.pullInCells; d++) {
              const cand = (slip + d) % (tuning.assist.pullInCells + 1);
              if (isReachCol(reel, (press + cand) % n)) return cand;
            }
            return slip; // 窓内にリーチ目の形が無い＝この押下位置では出せない
          });
        });
      }
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
      });
      const visCol = (cells: readonly string[], pos: number): VisibleColumn => ({
        top: visibleAt(cells, pos, 'top'),
        middle: visibleAt(cells, pos, 'middle'),
        bottom: visibleAt(cells, pos, 'bottom'),
      });

      // --- リーチ目への寄せは入れない ---
      // 「ボーナスが揃わない時に残りのリールをリーチ目へ寄せる」制御を作って測ったが、
      // ほぼ無効だった（初心者 31.0%→31.9%、他の腕は変化なし）。理由は構造的で、
      // 寄せられるのは**払い出しが何も無い出目**だけなのに、0枚の出目はハズレでも
      // 出せる（ハズレの制御は押した位置で止まる）ためリーチ目になり得ない。
      // 実際に出ているリーチ目は逆で、**小役が揃っているのにボーナスでしか出ない形**。
      // これは制御が自然に作るので、寄せる必要が無い。
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
          for (let press0 = 0; press0 < n; press0++) {
            const pos0 = (press0 + firstStop[role.id][0][press0]) % n;
            const left = visCol(reels[0], pos0);
            for (let press1 = 0; press1 < n; press1++) {
              const tg = flagYakusFor(yakuList, role.id).filter((y) => flagIds.includes(y.id));
              const g2 =
                tg.length > 0
                  ? guard.chooseSlip(tg, [pos0, null, null], 1, press1, () => 0)
                  : null;
              byFirstPos[pos0][press1] =
                g2 ??
                controller.resolveSlip({
                  reelIndex: 1,
                  basePosition: press1,
                  strip: { id: 'r1', cells: reels[1] },
                  stoppedVisibles: [left, null, null],
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
      // 添字は第1・第2の**停止位置**。到達しない位置の枠は 0 のまま残る（引かれない）。
      const buildThird = (
        bonus: boolean,
        second: Record<string, number[][]>,
      ): Record<string, number[][][]> => {
        const out: Record<string, number[][][]> = {};
        for (const role of yakuList.internalRoles) {
          const flagIds = flagIdsFor(role.id, bonus);
          const table: number[][][] = Array.from({ length: n }, () =>
            Array.from({ length: n }, () => new Array<number>(n).fill(0)),
          );
          for (let press0 = 0; press0 < n; press0++) {
            const pos0 = (press0 + firstStop[role.id][0][press0]) % n;
            const left = visCol(reels[0], pos0);
            for (let press1 = 0; press1 < n; press1++) {
              const pos1 = (press1 + second[role.id][pos0][press1]) % n;
              const mid = visCol(reels[1], pos1);
              for (let press2 = 0; press2 < n; press2++) {
                const tg3 = flagYakusFor(yakuList, role.id).filter((y) => flagIds.includes(y.id));
                const g3 =
                  tg3.length > 0
                    ? guard.chooseSlip(tg3, [pos0, pos1, null], 2, press2, () => 0)
                    : null;
                table[pos0][pos1][press2] =
                  g3 ??
                  controller.resolveSlip({
                    reelIndex: 2,
                    basePosition: press2,
                    strip: { id: 'r2', cells: reels[2] },
                    stoppedVisibles: [left, mid, null],
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
      const thirdStop = buildThird(false, secondStop);
      const bonusThirdStop = buildThird(true, bonusSecondStop);

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
