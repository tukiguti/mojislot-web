import { describe, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { SlipResolver, type VisibleColumn } from '../../src/productions/SlipResolver';
import { YakuJudge } from '../../src/core/YakuJudge';
import { StopController } from '../../src/core/StopController';
import { StopTableLookup } from '../../src/core/StopTable';
import { TenpaiDetector } from '../../src/productions/TenpaiDetector';
import {
  YakuListSchema,
  ReelConfigSchema,
  TuningSchema,
  StopTableSchema,
  type YakuList,
} from '../../src/data/schemas';
import {
  PRIMARY_PAYLINE,
  primaryRowOf,
  visibleAt,
  type Grid3x3,
  type Vertical,
} from '../../src/core/Paylines';
import { buildFirstStopTable } from './gen-stop-table.test';

/**
 * リール配列の再最適化（②＝「揃って見えるのに0枚」をゼロにする）。
 *
 *   OPT=1 npx vitest run tests/tools/optimize-reels.test.ts --disable-console-intercept
 *   OPT=1 OPT_CHAPTERS=security OPT_ITER=800 npx vitest run ...
 *
 * 役を差し替えると、文字の重なり方が変わって②が復活する（[26] の焼きなましは
 * その時の役セットに対する解でしかない）。ここはその再探索を**リポジトリに残す**ためのもの。
 * 前回はスクリプトが残っておらず、役を変えるたびに手法から書き直す羽目になった。
 *
 * 目的関数 = ②の件数（主）＋ 横3ライン同時テンパイの件数＋同じ図柄の3連続
 * （どちらもハード制約・②と同じ重み）＋ 図柄の最大間隔（副・引き込み到達性）。
 * 近傍 = 同一リール内のスワップのみ（枚数は PLAN_BY_PAYOUT で固定）。
 * 制約 = 引き込みで届かない押下位置の上限（役の格で決まる。MAX_UNREACHABLE）。
 */

const RUN = process.env.OPT === '1';
const DIR = dirname(fileURLToPath(import.meta.url));
const DATA = resolve(DIR, '../../data');
const readJson = (p: string) => JSON.parse(readFileSync(p, 'utf-8'));

const CHAPTERS = (
  process.env.OPT_CHAPTERS ?? 'hiragana_food,katakana_animal,security,yasai'
).split(',');
const MAX_ITER = Number(process.env.OPT_ITER ?? 600);
const PULL_IN = 4;
const N = 21;

/**
 * 島ごとの目印（2026-10-02）。各リールの `LANDMARK_AT` に置き、どの役にも属さない。
 * 島の漢字1字を金の札にした図柄で、狙う時の目安とボーナス中のビタ役を兼ねる。
 */
const LANDMARKS: Record<string, string> = {
  hiragana_food: '寿',
  katakana_animal: '獣',
  hiragana_verb: '動',
  yasai: '菜',
  security: '鍵',
};
/** 目印を置く番号。21コマを7コマずつ3つに区切る。 */
const LANDMARK_AT = [0, 7, 14];
/**
 * 目印の**真下**の番号。番号の大きいコマが上から降りてくるので、真下は1つ手前。
 * ここにボーナス図柄を固定する——「目印を枠上に狙えば、ボーナス図柄が中段に来る」
 * （実機の「赤7を枠上に狙え」と同じ覚え方）。
 */
const UNDER_LANDMARK = LANDMARK_AT.map((i) => (i - 1 + N) % N);
/**
 * `OPT_MODE=reach` で「②＝0 を保ったまま**狙いやすさ**を上げる」モードになる。
 *
 * 既定モードは②をゼロにした時点で打ち切る。5ラインなら他のラインへ逃げられるので
 * それで足りていたが、1ライン化すると逃げ場が無く、有効ライン上に役の文字が
 * 来るかどうかが取りこぼしに直結する。そこを配列側で最適化するためのモード。
 */
const REACH_MODE = process.env.OPT_MODE === 'reach';
/**
 * `OPT_MODE=feasible`：**ハード制約の違反の合計だけ**を減らす段階（2026-10-02）。
 *
 * reach モードは違反に10万倍の重みを掛けるので、実質「下り坂しか受け入れない」探索になり、
 * 目印で固定コマが増えた配列では違反が残ったまま動けなくなった（1,500回で一度も
 * 改善を記録しなかった）。違反の件数そのものを目的にして普通の温度で焼き、
 * 0 になった配列を書き出す。到達率の磨き込みはその後に reach で行う。
 */
const FEASIBLE_MODE = process.env.OPT_MODE === 'feasible';
/**
 * 到達率を測るときの押下位置の間引き幅。21³ を毎イテレーション回すと重いので、
 * 焼きなまし中は 3 コマおき（7³＝343通り）で方向づけだけする。
 * 最終確認は `OPT_REACH_STEP=1` で全数を回して確かめる。
 */
const REACH_STEP = Number(process.env.OPT_REACH_STEP ?? 3);
/**
 * ②評価を間引く設定。**既定は間引かない（全数・全押し順）。**
 *
 * 速くするために押し順を順押しだけに絞り、押下位置を2コマおきにして試したが、
 * **②を見逃す**。実測で「間引き評価では②＝0、全数検証では②＝227件」となり、
 * しかも227件は**すべて逆押し由来**だった。押し順を削ると②が逆押しに逃げるので、
 * ここは削れない。
 *
 * 環境変数は実験用に残してあるが、使うと②を見逃す。使った場合でも
 * 書き出し前の全数検証で止まるので、壊れた配列が採用されることはない。
 */
const SCAN_STEP = Number(process.env.OPT_LEAK_STEP ?? 1);


const STOP_ORDERS: readonly (readonly number[])[] = [
  [0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0],
];

/** ②評価で試す停止順。既定は全6通り（`OPT_LEAK_ORDERS=first` で順押しのみ＝実験用）。 */
const SCAN_ORDERS: readonly (readonly number[])[] =
  process.env.OPT_LEAK_ORDERS === 'first' ? [[0, 1, 2]] : STOP_ORDERS;

function visCol(cells: readonly string[], pos: number): VisibleColumn {
  return {
    top: cells[(pos + 1) % N],
    middle: cells[pos],
    bottom: cells[((pos - 1) % N + N) % N],
  };
}

/** 配列から第1停止テーブルを組む（gen-stop-table と**同じ関数**）。 */
function buildStopTable(yakuList: YakuList, reels: string[][], resolver: SlipResolver) {
  return { mode: 'opt', firstStop: buildFirstStopTable(yakuList, reels, resolver, PULL_IN) };
}

/** その配列に対する停止制御一式（②の計測と到達率の計測で共有する）。 */
function makeController(
  yakuList: YakuList,
  reels: string[][],
  resolver: SlipResolver,
): StopController {
  return new StopController({
    yakuList,
    slipResolver: resolver,
    tenpaiDetector: new TenpaiDetector(yakuList),
    stopTable: new StopTableLookup(
      StopTableSchema.parse(buildStopTable(yakuList, reels, resolver)),
    ),
    pullInCells: PULL_IN,
    reels,
  });
}

/** press[] で3リールを順に止めた結果の出目。 */
function playPress(
  controller: StopController,
  reels: string[][],
  press: readonly number[],
  flagIds: readonly string[],
  flagKey: string,
  order: readonly number[] = [0, 1, 2],
): Grid3x3 {
  const stopped: (VisibleColumn | null)[] = [null, null, null];
  // ゲーム本体と同じく停止位置も渡す（引き込み保証が効く経路を測る）
  const pos: (number | null)[] = [null, null, null];
  for (const idx of order) {
    const slip = controller.resolveSlip({
      reelIndex: idx,
      basePosition: press[idx],
      strip: { id: `r${idx}`, cells: reels[idx] },
      stoppedVisibles: stopped,
      stoppedPositions: pos,
      flagYakuIds: flagIds,
      flagKey,
    });
    pos[idx] = (press[idx] + slip) % N;
    stopped[idx] = visCol(reels[idx], pos[idx] as number);
  }
  const s = stopped as VisibleColumn[];
  return [
    [s[0].top, s[1].top, s[2].top],
    [s[0].middle, s[1].middle, s[2].middle],
    [s[0].bottom, s[1].bottom, s[2].bottom],
  ];
}

/**
 * ②の件数。cutoff を超えた時点で打ち切る（焼きなましの棄却は早い方が速い）。
 *
 * **打ち切りは②が出る配列でしか効かない。** ②＝0を保っている間は最後まで
 * 回りきるので、②が出にくい島ほど1イテレーションが重くなる（セキュリティ島は
 * 他島の20倍＝1回64秒だった）。焼きなまし中は `orders` を順押しのみ・`step` を
 * 2以上にして間引き、方向づけだけする。**最終確認は必ず全数・全押し順で回すこと。**
 *
 * @param orders 試す停止順（既定は全6通り）
 * @param step   押下位置の間引き幅（既定は1＝全数）
 */
function countLeaks(
  yakuList: YakuList,
  reels: string[][],
  resolver: SlipResolver,
  judge: YakuJudge,
  cutoff = Infinity,
  controller = makeController(yakuList, reels, resolver),
  orders: readonly (readonly number[])[] = STOP_ORDERS,
  step = 1,
): number {
  const flags: { label: string; ids: string[] }[] = [
    { label: 'miss', ids: [] },
    ...[
      ...yakuList.coreYaku,
      ...yakuList.cherryYaku,
      ...yakuList.bonusYaku,
      ...yakuList.premiumYaku,
    ].map((y) => ({ label: y.id, ids: [y.id] })),
    { label: 'single', ids: yakuList.singleYaku.map((y) => y.id) },
  ];

  let leaks = 0;
  for (const flag of flags) {
    const idSet = new Set(flag.ids);
    for (const order of orders) {
      for (let p0 = 0; p0 < N; p0 += step) {
        for (let p1 = 0; p1 < N; p1 += step) {
          for (let p2 = 0; p2 < N; p2 += step) {
            const press = [p0, p1, p2];
            const stopped: (VisibleColumn | null)[] = [null, null, null];
            const pos: (number | null)[] = [null, null, null];
            for (const idx of order) {
              const slip = controller.resolveSlip({
                reelIndex: idx,
                basePosition: press[idx],
                strip: { id: `r${idx}`, cells: reels[idx] },
                stoppedVisibles: stopped,
                stoppedPositions: pos,
                flagYakuIds: flag.ids,
                flagKey: flag.label,
              });
              pos[idx] = (press[idx] + slip) % N;
              stopped[idx] = visCol(reels[idx], pos[idx] as number);
            }
            const s = stopped as VisibleColumn[];
            const grid: Grid3x3 = [
              [s[0].top, s[1].top, s[2].top],
              [s[0].middle, s[1].middle, s[2].middle],
              [s[0].bottom, s[1].bottom, s[2].bottom],
            ];
            if (judge.judgeAll(grid).hits.some((h) => !idSet.has(h.yaku.id))) {
              leaks++;
              if (leaks > cutoff) return leaks;
            }
          }
        }
      }
    }
  }
  return leaks;
}

/**
 * 各役が**実際に揃う**押下位置の割合（0..1）。
 *
 * 「図柄がその行に届くか」だけを見ると足りない。届く位置でも、そこで非当選役が
 * ロックすると引き込みが拒否されて蹴りに落ちるからで、その分は取りこぼしになる。
 * だから停止制御を実際に通して出目を作り、役が成立したかで数える。
 *
 * 図柄の届き方はリールが円環である以上**主ラインの行に依存しない**（上段を見ようと
 * 下段を見ようと「4コマ以内に来る押下位置の割合」は同じ）。主ラインごとに差が出るのは
 * この蹴り込みの部分だけなので、ここを測らないと焼きなましが主ラインを区別できない。
 *
 * 焼きなまし中は押下位置を `step` コマおきに間引く（21³ を毎回回すと重すぎる）。
 */
function reachableRates(
  yakuList: YakuList,
  reels: string[][],
  controller: StopController,
  judge: YakuJudge,
  step: number,
  /**
   * ボーナス中として測る。許可リストに1枚役（こぼし先）が加わるので、当選役の
   * 引き込みが1枚役に横取りされないかまで含めて評価できる。ボーナス中は純増が
   * 通常時の10倍以上あり出玉の主戦場なので、ここを見ないと目的関数が実態とずれる。
   */
  asBonus = false,
): number[] {
  const yakus = [
    ...yakuList.coreYaku,
    ...yakuList.cherryYaku,
    ...yakuList.bonusYaku,
    ...yakuList.premiumYaku,
  ];
  const rates = yakus.map((y) => {
    const role = yakuList.internalRoles.find(
      (r) => r.displayYakuId === y.id && !r.freeze,
    );
    const flagKey = role?.id ?? y.id;
    // ボーナス中は1枚役が「こぼし先」として許可リストに加わる（設計: 31章）。
    const flagIds = asBonus
      ? [y.id, ...yakuList.singleYaku.map((s) => s.id)]
      : [y.id];
    let hit = 0;
    let tried = 0;
    for (let p0 = 0; p0 < N; p0 += step) {
      for (let p1 = 0; p1 < N; p1 += step) {
        for (let p2 = 0; p2 < N; p2 += step) {
          tried++;
          const grid = playPress(controller, reels, [p0, p1, p2], flagIds, flagKey);
          if (judge.judgeAll(grid).hits.some((h) => h.yaku.id === y.id)) hit++;
        }
      }
    }
    return tried > 0 ? hit / tried : 0;
  });

  // 1枚役は**グループのどれかが揃えばよい**ので、個別ではなくまとめて測る。
  // ハズレを統合した結果、当選率43%と単独で最大の役になった。ここを評価から
  // 外していたせいで到達率が 55%→29% まで落ち、こぼしの受け皿が機能しなくなった。
  const singleIds = new Set(yakuList.singleYaku.map((s) => s.id));
  let sHit = 0;
  let sTried = 0;
  if (singleIds.size > 0) {
    const ids = [...singleIds];
    for (let p0 = 0; p0 < N; p0 += step) {
      for (let p1 = 0; p1 < N; p1 += step) {
        for (let p2 = 0; p2 < N; p2 += step) {
          sTried++;
          const grid = playPress(controller, reels, [p0, p1, p2], ids, 'single');
          if (judge.judgeAll(grid).hits.some((h) => singleIds.has(h.yaku.id))) sHit++;
        }
      }
    }
  }
  return [...rates, sTried > 0 ? sHit / sTried : 1];
}

/**
 * 各役の当選率（通常時）。到達率の重みに使う。
 * 末尾は1枚役グループぶん（`reachableRates` の返り値と並びを合わせる）。
 */
function yakuWeights(yakuList: YakuList, yakus: readonly Yaku[]): number[] {
  const each = yakus.map((y) =>
    yakuList.internalRoles
      .filter((r) => r.displayYakuId === y.id)
      .reduce((a, r) => a + (r.rate?.default ?? 0), 0),
  );
  const single = yakuList.internalRoles
    .filter((r) => r.kind === 'single')
    .reduce((a, r) => a + (r.rate?.default ?? 0), 0);
  return [...each, single];
}

/**
 * 到達率からスコアを作る（**大きいほど良い**）。
 *
 * **当選率で重み付けする。** 等価に扱うと、出現率0.09%のBIGを伸ばして16.8%の
 * 小役を犠牲にする、という最適化が起きる。実際それで下段主ラインの配列が
 * 「無重みスコアは互角なのに機械割が2割低い」状態になった（頻出小役 31%→26%・
 * 稀なBIG 52%→64%）。小役4種で全体の約50%を占めるので、ここが出玉を決める。
 *
 * 最小値も少し見る。全部を重み任せにすると、稀な役が極端に狙えないまま放置され、
 * 「当たったのに揃わない」という体験が残る（28章の「どの役も同じくらい狙いやすい」）。
 */
function reachScore(
  rates: readonly number[],
  weights: readonly number[],
): number {
  const total = weights.reduce((a, b) => a + b, 0);
  const weighted =
    total > 0
      ? rates.reduce((a, r, i) => a + r * weights[i], 0) / total
      : rates.reduce((a, b) => a + b, 0) / rates.length;
  return weighted + 0.5 * Math.min(...rates);
}

/**
 * **図柄の偏り**（間隔の最大−最小の合計）。0 なら等間隔。
 *
 * 枚数が少ないこと自体は構わない——目押しのゲームなので、届かない押下位置が
 * あるのは仕様。**まずいのは位置が近いこと**で、同じ枚数でも固まっていると
 * 狙える範囲が広がらず、押下位置によっては1つの段にしか置けなくなる。
 * そうなると5ラインのどれも埋まらず「正しく狙ったのに揃わない」が生まれる。
 * 実測で「お」が21コマ中2枚（位置10と15）に固まっていて、これが起きていた。
 */
function spreadPenalty(reels: string[][], pools: string[][]): number {
  let total = 0;
  for (let i = 0; i < 3; i++) {
    for (const c of pools[i]) {
      const pos: number[] = [];
      reels[i].forEach((v, k) => {
        if (v === c) pos.push(k);
      });
      if (pos.length < 2) continue;
      const gaps = pos.map((p, k) => (pos[(k + 1) % pos.length] - p + N) % N);
      total += Math.max(...gaps) - Math.min(...gaps);
    }
  }
  return total;
}

/** 図柄の最大間隔の合計（小さいほど引き込みが届きやすい）。 */
function gapPenalty(reels: string[][], pools: string[][]): number {
  let total = 0;
  for (let i = 0; i < 3; i++) {
    for (const c of pools[i]) {
      const pos: number[] = [];
      reels[i].forEach((v, k) => {
        if (v === c) pos.push(k);
      });
      let worst = 0;
      for (let k = 0; k < pos.length; k++) {
        worst = Math.max(worst, (pos[(k + 1) % pos.length] - pos[k] + N) % N);
      }
      total += worst;
    }
  }
  return total;
}

/**
 * 同一図柄が3コマ以上続く箇所の数。**0 がハード制約**。
 *
 * 3コマ窓が丸ごと同じ文字になると、そこだけ固まって見えるだけでなく、その図柄の
 * 引き込みが1箇所に集中して**他の押下位置から届かなくなる**。spreadPenalty は
 * 間隔の最大−最小しか見ないので、`[5,5,1,1,4,1,4]` のように3連続を含む並びでも
 * ペナルティが 4 にしかならず素通りしていた。寿司島の左「か」が21コマ中7枚・
 * 位置11-13で3連続になっていて、3コマ窓が全部「か」になる位置が実際にあった
 * （全5島15リールでここだけ）。
 *
 * 2連続までは許す。21コマに6〜8枚入る図柄があるので、完全に散らすと他の制約と
 * competing して解が見つからない。見た目に出るのは3連続から。
 */
function runPenalty(reels: string[][]): number {
  let total = 0;
  for (const r of reels) {
    for (let p = 0; p < N; p++) {
      if (r[p] === r[(p + 1) % N] && r[p] === r[(p + 2) % N]) total++;
    }
  }
  return total;
}

/**
 * 横3ライン同時テンパイの件数（第1×第2リールの全停止位置 21×21 のうち、
 * 上段・中段・下段が**同時に**テンパイする位置の数）。**0 がハード制約**。
 *
 * 第1・第2リールで役の並び順が揃っていると、ある停止位置で3行が一斉にテンパイして
 * 見た目が不自然になり、どのラインが生きているかを読む余地も消える（2本同時は残す）。
 * ②（揃って見えるのに0枚）と同じで、出玉にもテストにも出ないまま静かに壊れるので、
 * 焼きなましの目的関数でも②と同じ重みのハード制約として扱う。
 * 監査は tests/audit/horizontal-tenpai.test.ts。
 */
function countTripleTenpai(yakuList: YakuList, reels: string[][]): number {
  // 3文字役の「左＋中」の先頭2文字＝第3リール待ちのテンパイ形。
  // 2文字役（チェリー）は左中だけで既に成立していてテンパイではないので数えない。
  const prefixes = new Set(
    [...yakuList.coreYaku, ...yakuList.premiumYaku, ...yakuList.bonusYaku]
      .filter((y) => y.symbols.length >= 3)
      .map((y) => `${y.symbols[0]} ${y.symbols[1]}`),
  );
  const rows: Vertical[] = ['top', 'middle', 'bottom'];
  let triples = 0;
  for (let p0 = 0; p0 < N; p0++) {
    for (let p1 = 0; p1 < N; p1++) {
      const a = visCol(reels[0], p0);
      const b = visCol(reels[1], p1);
      if (rows.every((r) => prefixes.has(`${a[r]} ${b[r]}`))) triples++;
    }
  }
  return triples;
}

/**
 * 図柄の枚数を配当の格で決め打ちする。**枚数が固定なら焼きなましは並び順だけを探せばよく、
 * 狙った形へ寄せやすい。**近傍もスワップだけになる（置換をやめる）。
 *
 * 実機（ジャグラー）の配分に倣う——ぶどう(8枚役)は左8枚でどこで押しても揃い、
 * ベル(14枚)とピエロ(10枚)は左1枚で事実上取れない。**枠は21コマしかないので、
 * どこかを確実にすればどこかがこぼれる。** 低配当ほど毎ゲーム引くので厚く、高配当ほど薄い。
 *
 * ボーナスは実機の7（左2・中1・右1枚）と同じく薄くてよい。目押しで狙う役なので
 * 引き込みを当てにしていない。チェリーも実機どおりこぼす側。
 */
const PLAN_BY_PAYOUT: Record<number, number> = { 3: 5, 4: 4, 5: 3, 7: 3 };
const PLAN_CHERRY = 2;
const PLAN_BONUS = 2;

/**
 * そのリールの枚数計画。左と中はちょうど21枚で埋まり、**第3リールだけ2枚余る**
 * （小役以外の図柄が1種少ないため）。余りはボーナス図柄へ回す——第3リールは
 * BIG と REG の取り違えが起きる場所で、厚いほど「滑ってREG」が成立しやすい。
 */
function planCounts(yakuList: YakuList, reel: number, size = N): Map<string, number> {
  const plan = new Map<string, number>();
  const bump = (sym: string | undefined, n: number) => {
    if (sym === undefined) return;
    plan.set(sym, Math.max(plan.get(sym) ?? 0, n));
  };
  for (const y of yakuList.coreYaku) bump(y.symbols[reel], PLAN_BY_PAYOUT[y.payout ?? 7] ?? 3);
  for (const y of yakuList.cherryYaku) bump(y.symbols[reel], PLAN_CHERRY);
  const bonusSyms: string[] = [];
  for (const y of [...yakuList.premiumYaku, ...yakuList.bonusYaku]) {
    const c = y.symbols[reel];
    if (c === undefined) continue;
    bump(c, PLAN_BONUS);
    if (!bonusSyms.includes(c)) bonusSyms.push(c);
  }
  for (const y of yakuList.singleYaku) bump(y.symbols[reel], 1);
  // 目印のある配列（size < N）では、**第3リールのボーナス図柄を3枚ずつ**にする。
  // 2種×2枚の4枚だと引き込みで届く押下位置が最大20で、21箇所すべてを覆えず
  // 「BIG も REG も引けない位置」が必ず残る（以前は余った枠を回して3枚ずつだった）。
  if (size < N && reel === 2) for (const sym of bonusSyms) plan.set(sym, Math.max(plan.get(sym) ?? 0, 3));
  // さらに REG の図柄を1枚足す（4枚）。目印の3箇所から押した時の覆いに、固定コマの外の
  // ボーナス図柄が3枚要る（0・7・14番の目印の先にそれぞれ1枚）。3枚ずつだと固定の外に
  // 2枚しか残らず、BIG も REG も引けない押下位置が必ず1つ残った（5島とも盲点=1）。
  const regThird = yakuList.bonusYaku[0]?.symbols[2];
  if (size < N && reel === 2 && regThird !== undefined) plan.set(regThird, (plan.get(regThird) ?? 3) + 1);
  // 目印で枠が減った分は小役から1枚ずつ削る。**3枚役→4枚役→7枚役→5枚役**の順で、
  // 配当の高い役ほど薄く＝狙わないと取れない側へ寄せる（目押しの意味を残す）。
  const cutOrder = [3, 4, 7, 5];
  for (let guard = 0; guard < 20; guard++) {
    const total = [...plan.values()].reduce((a, b) => a + b, 0);
    if (total <= size) break;
    const payout = cutOrder[guard % cutOrder.length];
    const y = yakuList.coreYaku.find((c) => (c.payout ?? 7) === payout);
    const sym = y?.symbols[reel];
    if (sym !== undefined && (plan.get(sym) ?? 0) > 2) plan.set(sym, (plan.get(sym) ?? 0) - 1);
  }
  // 余った枠をボーナス図柄へ均等に配る。1周しても余るなら小役の主力（最厚）へ。
  let rest = size - [...plan.values()].reduce((a, b) => a + b, 0);
  for (let i = 0; rest > 0 && bonusSyms.length > 0 && i < rest + bonusSyms.length; i++) {
    const sym = bonusSyms[i % bonusSyms.length];
    if (sym === undefined) break;
    plan.set(sym, (plan.get(sym) ?? 0) + 1);
    rest--;
  }
  if (rest > 0) {
    const top = [...plan.entries()].sort((a, b) => b[1] - a[1])[0];
    if (top) plan.set(top[0], top[1] + rest);
  }
  return plan;
}

/** 枚数が計画どおりか。 */
function matchesPlan(reel: string[], plan: ReadonlyMap<string, number>): boolean {
  const counts = new Map<string, number>();
  for (const c of reel) counts.set(c, (counts.get(c) ?? 0) + 1);
  if (counts.size !== plan.size) return false;
  for (const [sym, n] of plan) if (counts.get(sym) !== n) return false;
  return true;
}

/** 現行配列を枚数計画へ寄せる。多い文字を減らし、足りない文字へ振り替える。 */
function toPlan(reel: string[], plan: ReadonlyMap<string, number>, rng: () => number): string[] {
  const out = [...reel];
  const tally = () => {
    const m = new Map<string, number>();
    for (const c of out) m.set(c, (m.get(c) ?? 0) + 1);
    return m;
  };
  for (let guard = 0; guard < 500; guard++) {
    const c = tally();
    const short = [...plan].find(([sym, n]) => (c.get(sym) ?? 0) < n);
    if (!short) break;
    const over: number[] = [];
    out.forEach((sym, i) => {
      if ((c.get(sym) ?? 0) > (plan.get(sym) ?? 0)) over.push(i);
    });
    if (over.length === 0) break;
    out[over[Math.floor(rng() * over.length)] ?? 0] = short[0];
  }
  return out;
}

/**
 * REG と**頭2文字を共有する BIG**。第1・第2リールが止まった時点ではどちらか
 * 分からず、第3リールで初めて決まる——祈りの瞬間そのもの。
 */
function pairedBig(yakuList: YakuList): Yaku | null {
  const reg = yakuList.bonusYaku[0];
  if (!reg) return null;
  return (
    yakuList.premiumYaku.find(
      (b) => b.symbols[0] === reg.symbols[0] && b.symbols[1] === reg.symbols[1],
    ) ?? null
  );
}

/**
 * 第3リールで **BIG と REG のどちらも引き込めない押下位置**の数。**0 がハード制約**。
 *
 * 実機の右リールは7とBARが隣り合っている（ジャグラーなら20番と19番）。同じ位置を
 * 押せば両方引き込めるので、「7を狙ったらBARが止まってREG」が起きる。
 *
 * これが無いと、**赤示唆でボーナスが濃厚なのに、押した位置によっては絶対に揃わない**。
 * 狙う場所が分からないまま外し続けることになり、示唆が情報として機能しない。
 * 実測で動物島は21位置中5箇所がこの穴だった。
 */
function thirdReelBlindSpots(yakuList: YakuList, reels: string[][]): number {
  const reg = yakuList.bonusYaku[0];
  const big = pairedBig(yakuList);
  const a = big?.symbols[2];
  const b = reg?.symbols[2];
  if (a === undefined || b === undefined) return 0;
  let blind = 0;
  for (let p = 0; p < N; p++) {
    if (!reachableFrom(reels[2], a, p) && !reachableFrom(reels[2], b, p)) blind++;
  }
  return blind;
}

/**
 * 第3リールで BIG図柄と REG図柄が**隣り合っている組の数**。**最低1組がハード制約**。
 *
 * 実機の右リールは7の隣がBAR（ジャグラーなら20番と19番）。狙った位置から1コマ
 * 滑るだけで BIG が REG に変わるので、「7を狙ったらBARが止まった」が起きる。
 * 4コマ以内にありさえすれば両方引けるが、間に別の図柄が挟まると滑りが大きくなり、
 * 取り違えの手応えが薄れる。
 *
 * **全部を隣接させることはできない。** け3枚・こ3枚を3組とも隣接させるとペアが
 * 固まり、ペア間に間隔7の穴が空いて「どちらも引けない位置」が3箇所出る。逆に
 * 6枚を散らして穴を消すと隣接がゼロになる。だから最低1組だけ要求して、
 * それ以上は副目的で増やす。
 */
function thirdReelAdjacentPairs(yakuList: YakuList, reels: string[][]): number {
  const reg = yakuList.bonusYaku[0];
  const big = pairedBig(yakuList);
  const a = big?.symbols[2];
  const b = reg?.symbols[2];
  if (a === undefined || b === undefined) return 0;
  const r = reels[2];
  let pairs = 0;
  for (let p = 0; p < N; p++) {
    const cur = r[p];
    const next = r[(p + 1) % N];
    if ((cur === a && next === b) || (cur === b && next === a)) pairs++;
  }
  return pairs;
}

/** 第3リールで BIG と REG の**両方**を引き込める押下位置の数（多いほどよい）。 */
function thirdReelBothCount(yakuList: YakuList, reels: string[][]): number {
  const reg = yakuList.bonusYaku[0];
  const big = pairedBig(yakuList);
  const a = big?.symbols[2];
  const b = reg?.symbols[2];
  if (a === undefined || b === undefined) return 0;
  let both = 0;
  for (let p = 0; p < N; p++) {
    if (reachableFrom(reels[2], a, p) && reachableFrom(reels[2], b, p)) both++;
  }
  return both;
}

/**
 * 役ごとに許す「引き込みで届かない押下位置」の数。**引き込み可能性の配分そのもの。**
 *
 * 実機は全部の役が引き込めるようにはなっていない。ジャグラーならぶどうとリプレイは
 * どこで押しても揃うが、ピエロとチェリーはこぼす。**枠は21コマしかないので、
 * どこかを確実にすればどこかがこぼれる**——その配分を決めるのがこの表。
 *
 * 枚数ではなく届かない位置で縛るのは、**枚数を揃えても配置が偏れば意味がない**ため。
 * 実測で4枚の「か」が位置6,7,12,13に固まり、間隔14の大穴が空いて届かない位置が
 * 9つ残った。同じ4枚でも等間隔なら1つで済む。
 *
 * 数字は配当の格に沿う。低配当の小役ほど毎ゲーム引くので確実に取れるべきで、
 * 高配当ほどこぼしてよい。ボーナスは**目押し前提**なので制約しない（実機の7も
 * 左2・中1・右1枚しかなく、引き込みでは届かない位置のほうが多い）。
 */
const MAX_UNREACHABLE: Record<number, number> = { 3: 3, 4: 5, 5: 8, 7: 8 };

/** その文字を、押下位置 press から引き込みで拾えるか。 */
function reachableFrom(cells: readonly string[], sym: string, press: number): boolean {
  for (let s = 0; s <= PULL_IN; s++) if (cells[(press + s) % N] === sym) return true;
  return false;
}

/** その文字が「届かない押下位置」の数（0〜N）。 */
function unreachableCount(cells: readonly string[], sym: string): number {
  let n = 0;
  for (let p = 0; p < N; p++) if (!reachableFrom(cells, sym, p)) n++;
  return n;
}

/**
 * 引き込み可能性の配分に対する違反量。**0 がハード制約**。
 *
 * 役の到達率は3文字の最小で決まるので、1文字でも痩せると役ごと死ぬ。だから
 * 役単位ではなく**文字単位**で上限を課す。
 */
function reachBudgetPenalty(yakuList: YakuList, reels: string[][]): number {
  let over = 0;
  const check = (sym: string | undefined, reel: number, limit: number) => {
    if (sym === undefined) return;
    // 枚数が減った文字（目印で枠が3つ減った・2026-10-02）は、等間隔に置いても
    // 届かない位置が N − 5×枚数 は必ず残る。上限がそれより厳しいと満たしようがないので、
    // **等間隔の値＋2** までは許す（偏りは別の項で縛っている）。
    const copies = reels[reel].filter((c) => c === sym).length;
    const floor = Math.max(0, N - (PULL_IN + 1) * copies);
    over += Math.max(0, unreachableCount(reels[reel], sym) - Math.max(limit, floor + 2));
  };
  for (const y of yakuList.coreYaku) {
    const limit = MAX_UNREACHABLE[y.payout ?? 0] ?? 8;
    for (let i = 0; i < 3; i++) check(y.symbols[i], i, limit);
  }
  // チェリーとボーナスは縛らない。**実機どおりこぼす側**——2枚しか置かないので
  // 届かない位置は最低でも11あり、上限を課しても満たしようがない。狙って取る役。
  return over;
}

/**
 * 届かない位置の重み付き合計。**上限を守った上でさらに良くする副目的。**
 * 低配当の役ほど頻繁に引くので重い。
 */
function unreachableTotal(yakuList: YakuList, reels: string[][]): number {
  const weightOf = (payout: number): number =>
    payout <= 3 ? 4 : payout <= 4 ? 3 : payout <= 5 ? 2 : 1;
  let total = 0;
  for (const y of yakuList.coreYaku) {
    const w = weightOf(y.payout ?? 7);
    for (let i = 0; i < 3; i++) {
      const sym = y.symbols[i];
      if (sym !== undefined) total += unreachableCount(reels[i], sym) * w;
    }
  }
  return total;
}

/** その文字がボーナス（BIG/REG）にしか使われないか。 */
function bonusOnlySymbols(yakuList: YakuList, reel: number): Set<string> {
  const s = new Set<string>();
  for (const y of [...yakuList.premiumYaku, ...yakuList.bonusYaku]) {
    const c = y.symbols[reel];
    if (c !== undefined) s.add(c);
  }
  for (const y of [...yakuList.coreYaku, ...yakuList.cherryYaku, ...yakuList.singleYaku]) {
    const c = y.symbols[reel];
    if (c !== undefined) s.delete(c);
  }
  return s;
}

/**
 * **基準となる押下位置**があるか（第1・第2リール）。
 *
 * 実機の「左枠上に赤7を狙え」と同じで、そこを押せばボーナスもチェリーも
 * 取りこぼさない位置を作る。遅れが出ても「ボーナスかチェリーか分からないから
 * どちらを狙えばいいか決まらない」という状態を無くすため。
 *
 * BIG1用とBIG2用の**2箇所**を要求する（どちらを狙ってもよい）。REGはBIG1と
 * 頭2文字を共有するので、BIG1の基準位置でREGも拾える。
 *
 * 返すのは違反数（0が合格）。全部が届く位置が多すぎる場合も罰する——どこを
 * 押しても拾えるなら、打ち方を覚える価値が無くなる。
 */
function basePositionPenalty(yakuList: YakuList, reels: string[][]): number {
  const cherry = yakuList.cherryYaku[0];
  const bigs = yakuList.premiumYaku;
  if (!cherry || bigs.length < 2) return 0;
  let bad = 0;
  for (const r of [0, 1]) {
    const cs = cherry.symbols[r];
    const reachAt = (press: number): Set<string> =>
      new Set(Array.from({ length: PULL_IN + 1 }, (_, s) => reels[r][(press + s) % N]));
    const covers = (sym: string | undefined): number[] =>
      sym === undefined
        ? []
        : Array.from({ length: N }, (_, p) => p).filter((p) => {
            const w = reachAt(p);
            return w.has(sym) && (cs === undefined || w.has(cs));
          });
    for (const b of bigs.slice(0, 2)) {
      if (covers(b.symbols[r]).length === 0) bad += 1; // 基準位置が無い
    }
    // 3つとも届く位置＝BIG1でもBIG2でも同じ場所、が多いと打ち方が1点に潰れる。
    // 少しはあってよいが、多いと「どこでも拾える」になるので上限を置く。
    const all = Array.from({ length: N }, (_, p) => p).filter((p) => {
      const w = reachAt(p);
      return bigs.slice(0, 2).every((b) => {
        const s = b.symbols[r];
        return s !== undefined && w.has(s);
      }) && (cs === undefined || w.has(cs));
    });
    if (all.length > 3) bad += all.length - 3;
  }
  return bad;
}

/**
 * **金示唆が成立する配置か**（第3リール）。返すのは違反数（0が合格）。
 *
 * 金示唆は「BIG1かREGか」の2択を伝える。役の構造上、頭2文字はBIG1とREGで共通
 * （しゃけ／しゃこ）なので、**第3リールだけがどちらかを決める**。ここで2つの図柄が
 * 離れていると、押した位置で片方しか狙えず「2択を待つ」体験が消える。
 *
 * 実機のジャグラーで7とBARが隣接していて、滑りがフラグ側へ振り分けるのと同じ。
 * **1箇所押せば制御が決めてくれる**位置を2箇所以上残す。
 */
function goldTellPenalty(yakuList: YakuList, reels: string[][]): number {
  const big1 = yakuList.premiumYaku[0]?.symbols[2];
  const reg = yakuList.bonusYaku[0]?.symbols[2];
  if (big1 === undefined || reg === undefined || big1 === reg) return 0;
  const r = reels[2];
  const both = Array.from({ length: N }, (_, p) => p).filter((p) => {
    const w = new Set(Array.from({ length: PULL_IN + 1 }, (_, s) => r[(p + s) % N]));
    return w.has(big1) && w.has(reg);
  }).length;
  return Math.max(0, GOLD_TELL_MIN - both);
}

/** 金示唆で「どちらも狙える」押下位置の下限。 */
const GOLD_TELL_MIN = 2;

/**
 * 到達率が種類ごとの帯に収まっているか。返すのは帯からの逸脱の合計（0が合格）。
 *
 * 上限が要るのは、**適当に押しても揃うなら目押しの意味が消える**ため。
 * 下限が要るのは、当たったのに揃わない体験を残さないため。
 * 順序（ボーナス < チェリー < 小役）も見る。絶対値より順序のほうが安定する。
 */
const REACH_BAND: Record<string, [number, number]> = {
  premium: [0.20, 0.35],
  bonus: [0.20, 0.35],
  cherry: [0.30, 0.45],
  core: [0.30, 0.55],
};

function bandPenalty(yakus: readonly Yaku[], rates: readonly number[]): number {
  let pen = 0;
  const byCat: Record<string, number[]> = { premium: [], bonus: [], cherry: [], core: [] };
  yakus.forEach((y, i) => {
    const band = REACH_BAND[y.category];
    const r = rates[i];
    if (!band || r === undefined) return;
    byCat[y.category]?.push(r);
    if (r < band[0]) pen += band[0] - r;
    if (r > band[1]) pen += r - band[1];
  });
  // 順序：ボーナスの最大 < チェリーの最小、チェリーの最大 < 小役の最小
  const bonusMax = Math.max(0, ...byCat.premium, ...byCat.bonus);
  const cherryMin = byCat.cherry.length ? Math.min(...byCat.cherry) : Infinity;
  const cherryMax = byCat.cherry.length ? Math.max(...byCat.cherry) : 0;
  const coreMin = byCat.core.length ? Math.min(...byCat.core) : Infinity;
  if (bonusMax > cherryMin) pen += bonusMax - cherryMin;
  if (cherryMax > coreMin) pen += cherryMax - coreMin;
  return pen;
}

/**
 * そのリールで固定するコマ（番号→図柄）。目印3つと、その真下のボーナス図柄3つ。
 * 真下の図柄は BIG1 → BIG2 → BIG1 の順（REG は BIG1 と頭2文字を共有するので兼ねる）。
 */
function fixedCells(yakuList: YakuList, reel: number, landmark: string): Map<number, string> {
  const bonus: string[] = [];
  for (const y of [...yakuList.premiumYaku, ...yakuList.bonusYaku]) {
    const c = y.symbols[reel];
    if (c !== undefined && !bonus.includes(c)) bonus.push(c);
  }
  const m = new Map<number, string>();
  LANDMARK_AT.forEach((i) => m.set(i, landmark));
  const under = [bonus[0], bonus[1] ?? bonus[0], bonus[0]];
  UNDER_LANDMARK.forEach((i, k) => {
    if (under[k] !== undefined) m.set(i, under[k]);
  });
  // 第3リールは、3つ目の目印の真下の BIG 図柄（13番）の**さらに1つ下に REG の図柄**を
  // 固定する。BIG を狙って押すと滑って REG が止まる＝「BIG か REG か」が第3リールで
  // 決まる楽しさを、探索任せにせず配列の作りで保証する（2026-10-05 決定）。
  const regSym = yakuList.bonusYaku[0]?.symbols[2];
  if (reel === 2 && regSym !== undefined && regSym !== under[2]) {
    m.set((UNDER_LANDMARK[2] - 1 + N) % N, regSym);
  }
  return m;
}

/**
 * 固定コマを置き、残りの枠を計画の枚数で埋める。並びはなるべく今の配列から引き継ぐ
 * （焼きなましの出発点を今の配列に近くしておくと、同じ性質の解に早く落ちる）。
 */
function layoutWithFixed(
  current: readonly string[],
  fixed: ReadonlyMap<number, string>,
  plan: ReadonlyMap<string, number>,
): string[] {
  const need = new Map(plan);
  for (const sym of fixed.values()) need.set(sym, (need.get(sym) ?? 0) - 1);
  const out: (string | null)[] = Array.from({ length: N }, (_, i) => fixed.get(i) ?? null);
  const pool = current.filter((c) => (need.get(c) ?? 0) > 0);
  const take = (sym: string): boolean => {
    const n = need.get(sym) ?? 0;
    if (n <= 0) return false;
    need.set(sym, n - 1);
    return true;
  };
  let k = 0;
  for (let i = 0; i < N; i++) {
    if (out[i] !== null) continue;
    while (k < pool.length && !take(pool[k])) k++;
    if (k < pool.length) out[i] = pool[k++];
  }
  for (let i = 0; i < N; i++) {
    if (out[i] !== null) continue;
    const sym = [...need.entries()].find(([, n]) => n > 0)?.[0];
    if (sym === undefined) throw new Error('枚数計画が21コマに合わない');
    need.set(sym, (need.get(sym) ?? 0) - 1);
    out[i] = sym;
  }
  return out as string[];
}

/**
 * **狙えば揃う**の取りこぼし件数（tests/audit/aim-guarantee と同じ測り方）。
 * 成立した役の図柄を、中段に来る位置の2コマ手前で押す。②ゼロと両立して揃うかを、
 * ゲームと同じ停止制御で見る。
 */
function aimMisses(
  yakuList: YakuList,
  reels: string[][],
  controller: StopController,
  judge: YakuJudge,
  orders: readonly (readonly number[])[],
): number {
  const yakus = [
    ...yakuList.coreYaku,
    ...yakuList.cherryYaku,
    ...yakuList.bonusYaku,
    ...yakuList.premiumYaku,
  ];
  let misses = 0;
  for (const y of yakus) {
    const role = yakuList.internalRoles.find((r) => r.displayYakuId === y.id && !r.freeze);
    const flagKey = role?.id ?? y.id;
    const aims = [0, 1, 2].map((r) =>
      y.symbols[r] === undefined
        ? Array.from({ length: N }, (_, p) => p)
        : reels[r].flatMap((c, i) => (c === y.symbols[r] ? [((i - 2) % N + N) % N] : [])),
    );
    for (const order of orders) {
      for (const p0 of aims[0]) {
        for (const p1 of aims[1]) {
          for (const p2 of aims[2]) {
            const grid = playPress(controller, reels, [p0, p1, p2], [y.id], flagKey, order);
            if (!judge.judgeAll(grid).hits.some((h) => h.yaku.id === y.id)) misses++;
          }
        }
      }
    }
  }
  return misses;
}

/**
 * 焼きなまし中に「狙えば揃う」を見る押し順。**全6通り**——2通りに絞ると、残りの押し順で
 * 揃わない配列を最良として掴み、書き出し前の全数検証で落ちた（実測で14通り残った）。
 */
const AIM_ORDERS_FAST: readonly (readonly number[])[] = STOP_ORDERS;

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

describe.skipIf(!RUN)('リール配列の再最適化', () => {
  it(
    '②がゼロになる配列を探し、data/reels へ書き出す',
    () => {
      const tuning = TuningSchema.parse(readJson(`${DATA}/tuning/default.json`));
      for (const chapter of CHAPTERS) {
        const yakuList = YakuListSchema.parse(readJson(`${DATA}/yaku/${chapter}.json`));
        const reelCfg = ReelConfigSchema.parse(readJson(`${DATA}/reels/${chapter}.json`));
        const resolver = new SlipResolver(yakuList, {
          assistMaxCells: tuning.assist.pullInCells,
        });
        const judge = new YakuJudge(yakuList);

        const landmark = LANDMARKS[chapter];
        // 目印がある島は、目印の3コマを除いた18コマで枚数を計画する。
        const plans = [0, 1, 2].map((r) => planCounts(yakuList, r, landmark ? N - 3 : N));
        const fixed = [0, 1, 2].map((r) =>
          landmark ? fixedCells(yakuList, r, landmark) : new Map<number, string>(),
        );
        /** 入れ替えてよい番号（固定コマ以外）。 */
        const free = fixed.map((f) => Array.from({ length: N }, (_, i) => i).filter((i) => !f.has(i)));
        // 枚数の照合は目印も含めた21コマで行う（入れ替えは枚数を変えないので、固定さえ守ればよい）。
        const fullPlans = plans.map((pl) => {
          const m = new Map(pl);
          if (landmark) m.set(landmark, LANDMARK_AT.length);
          return m;
        });
        // 枚数は計画で固定する。現行配列は計画とずれているので、まず寄せてから焼きなます。
        const seedRng = makeRng(20260905);
        // `OPT_FROM=<dir>` があれば、前回の最良（`OPT_SAVE` で保存したもの）から続ける。
        const fromFile = process.env.OPT_FROM ? `${process.env.OPT_FROM}/${chapter}.json` : null;
        // 保存した配列は枚数計画が変わっていることがあるので、今の計画と固定コマへ寄せ直す。
        const startCells: string[][] =
          fromFile && existsSync(fromFile)
            ? (JSON.parse(readFileSync(fromFile, 'utf-8')) as { reels: string[][] }).reels
            : reelCfg.reels.map((r) => r.cells);
        let cur = startCells.map((cells, i) =>
          landmark
            ? layoutWithFixed(cells.filter((c) => c !== landmark), fixed[i], plans[i])
            : toPlan([...cells], plans[i], seedRng),
        );
        const pools = plans.map((pl) => [...pl.keys()]);
        let curCtrl = makeController(yakuList, cur, resolver);
        let curLeaks = countLeaks(
          yakuList, cur, resolver, judge, Infinity, curCtrl, SCAN_ORDERS, SCAN_STEP,
        );
        let curGap = gapPenalty(cur, pools);
        let curTriples = countTripleTenpai(yakuList, cur);
        // 到達率の重み（当選率）は配列を変えても不変なので一度だけ作る。
        const scoreYakus = [
          ...yakuList.coreYaku,
          ...yakuList.cherryYaku,
          ...yakuList.bonusYaku,
          ...yakuList.premiumYaku,
        ];
        const weights = yakuWeights(yakuList, scoreYakus);
        /** 到達率の帯を見る対象（1枚役グループは帯の外なので除く）。 */
        const scoredYakus = scoreYakus;
        let curRates = reachableRates(yakuList, cur, curCtrl, judge, REACH_STEP);
        let curReach = reachScore(curRates, weights);
        let curBases = basePositionPenalty(yakuList, cur);
        let curGolds = goldTellPenalty(yakuList, cur);
        let curBand = bandPenalty(scoredYakus, curRates);
        let curSpread = spreadPenalty(cur, pools);
        let curRuns = runPenalty(cur);
        /**
         * 引き込みで届かない位置の上限は、**目印のある配列では課さない**（2026-10-05 決定）。
         * 目押しのゲームなので、適当に押して届かない位置があるのは仕様。偏りの抑えは
         * 副目的（届かず・偏り）に残す。
         */
        const budgetOf = (r: string[][]) => (landmark ? 0 : reachBudgetPenalty(yakuList, r));
        let curBudget = budgetOf(cur);
        let curBlind = thirdReelBlindSpots(yakuList, cur);
        let curBoth = thirdReelBothCount(yakuList, cur);
        let curPairs = thirdReelAdjacentPairs(yakuList, cur);
        let curUnreach = unreachableTotal(yakuList, cur);
        let curAim = aimMisses(yakuList, cur, curCtrl, judge, AIM_ORDERS_FAST);
        let best = cur.map((r) => [...r]);
        let bestLeaks = curLeaks;
        let bestGap = curGap;
        let bestReach = curReach;
        let bestTriples = curTriples;
        let bestBases = curBases;
        let bestGolds = curGolds;
        let bestBand = curBand;
        let bestSpread = curSpread;
        let bestRuns = curRuns;
        let bestBudget = curBudget;
        let bestBlind = curBlind;
        let bestBoth = curBoth;
        let bestPairs = curPairs;
        let bestUnreach = curUnreach;
        let bestAim = curAim;
        const t0 = Date.now();
        console.log(
          `\n[${chapter}] 初期 狙い漏れ=${curAim} ②=${curLeaks} 3本同時=${curTriples} 基準=${curBases} 金示唆=${curGolds} 3連続=${curRuns} 配分超過=${curBudget} 3リール盲点=${curBlind} 隣接=${curPairs} 両取り=${curBoth} 届かず=${curUnreach} 帯=${curBand.toFixed(3)} 偏り=${curSpread} 到達=${curReach.toFixed(4)}` +
            (REACH_MODE ? ` (reachモード・主ライン ${PRIMARY_PAYLINE.id})` : ''),
        );
        if (process.env.OPT_DETAIL === '2') {
          // 通常時とボーナス中で到達率がどう違うかを見る。ボーナス中は純増が
          // 10倍以上あるので、ここが落ちていると出玉に直結する。
          const nml = reachableRates(yakuList, cur, curCtrl, judge, REACH_STEP);
          const bns = reachableRates(yakuList, cur, curCtrl, judge, REACH_STEP, true);
          const avg = (a: number[]) => a.reduce((x, y2) => x + y2, 0) / a.length;
          console.log(
            `  通常時 平均${(avg(nml) * 100).toFixed(1)}%  ` +
              `ボーナス中 平均${(avg(bns) * 100).toFixed(1)}%`,
          );
        }
        if (process.env.OPT_DETAIL === '1') {
          // 役ごとの到達率。平均が同じでも「どの役が弱いか」で出玉は変わる
          // （小役は頻出・BIGは稀なので、重みが違う）。
          const detail = [
            ...yakuList.coreYaku,
            ...yakuList.cherryYaku,
            ...yakuList.bonusYaku,
            ...yakuList.premiumYaku,
          ];
          const rates = reachableRates(yakuList, cur, curCtrl, judge, REACH_STEP);
          console.log(
            '  ' +
              detail
                .map((y, i) => `${y.name}:${(rates[i] * 100).toFixed(0)}%`)
                .join(' ') +
              ` 1枚役:${(rates[detail.length] * 100).toFixed(0)}%`,
          );
        }

        const rng = makeRng(20260727);
        // reach モードは②＝0でも打ち切らない（そこからが本番なので）。
        /** ハード制約の違反の重み付き合計（feasible モードの目的関数）。 */
        const violation = (v: {
          aim: number; leaks: number; triples: number; bases: number; golds: number;
          runs: number; budget: number; blind: number; pairs: number;
        }) =>
          v.aim + v.leaks + 3 * (v.triples + v.bases + v.golds + v.runs + v.blind) +
          v.budget + 3 * Math.max(0, 1 - v.pairs);
        let curViol = violation({
          aim: curAim, leaks: curLeaks, triples: curTriples, bases: curBases, golds: curGolds,
          runs: curRuns, budget: curBudget, blind: curBlind, pairs: curPairs,
        });
        let bestViol = curViol;
        for (let iter = 0; iter < MAX_ITER && (REACH_MODE || bestViol > 0); iter++) {
          if (iter % 100 === 0) {
            // 途中でも最良を保存する（時間切れや中断で何時間ぶんも失わないように）
            if (process.env.OPT_SAVE && iter > 0) {
              mkdirSync(process.env.OPT_SAVE, { recursive: true });
              writeFileSync(
                `${process.env.OPT_SAVE}/${chapter}.json`,
                JSON.stringify({ reels: best }),
                'utf-8',
              );
            }
            console.log(
              `  [${chapter}] iter=${iter} 違反 今=${curViol} 最良=${bestViol} ` +
                `(狙い漏れ=${curAim} ②=${curLeaks} 配分超過=${curBudget} 盲点=${curBlind} 隣接=${curPairs}) ${((Date.now() - t0) / 1000).toFixed(0)}s`,
            );
          }
          const next = cur.map((r) => [...r]);
          const i = Math.floor(rng() * 3);
          // **スワップだけ**。文字の置換を混ぜると枚数が動いてしまう。固定コマ（目印と
          // その真下のボーナス図柄）は動かさない。
          const a = free[i][Math.floor(rng() * free[i].length)];
          const b = free[i][Math.floor(rng() * free[i].length)];
          if (next[i][a] === next[i][b]) continue;
          [next[i][a], next[i][b]] = [next[i][b], next[i][a]];
          if (!matchesPlan(next[i], fullPlans[i])) continue;

          const T = 6 * Math.pow(0.02 / 6, iter / MAX_ITER);
          const nextCtrl = makeController(yakuList, next, resolver);
          const leaks = countLeaks(
            yakuList, next, resolver, judge, curLeaks + (FEASIBLE_MODE ? 12 : 40), nextCtrl, SCAN_ORDERS, SCAN_STEP,
          );
          const gap = gapPenalty(next, pools);
          const rates = reachableRates(yakuList, next, nextCtrl, judge, REACH_STEP);
          const reach = reachScore(rates, weights);
          const triples = countTripleTenpai(yakuList, next);
          const bases = basePositionPenalty(yakuList, next);
          const golds = goldTellPenalty(yakuList, next);
          const band = bandPenalty(scoredYakus, rates);
          const spread = spreadPenalty(next, pools);
          const runs = runPenalty(next);
          const budget = budgetOf(next);
          const blind = thirdReelBlindSpots(yakuList, next);
          const both = thirdReelBothCount(yakuList, next);
          const pairs = thirdReelAdjacentPairs(yakuList, next);
          const unreach = unreachableTotal(yakuList, next);
          const aim = aimMisses(yakuList, next, nextCtrl, judge, AIM_ORDERS_FAST);
          // reach モードでは②を**ハード制約**にし（1件でも大ペナルティ）、
          // その上で到達率を上げる。既定モードは従来どおり②＋間隔。
          // 横3ライン同時テンパイ（triples）は②と同じ重みのハード制約。
          // ハード制約（②・3本同時・基準位置）は同じ重み。到達率の帯はその次に重い
          // ——上限が無いと「適当に押しても揃う」方向へ最適化が走るため。
          // 「狙えば揃う」の取りこぼし（aim）は②と同じ重みのハード制約。
          const d = REACH_MODE
            ? (aim - curAim) * 100000 +
              (leaks - curLeaks) * 100000 +
              (triples - curTriples) * 100000 +
              (bases - curBases) * 100000 +
              (golds - curGolds) * 100000 +
              (runs - curRuns) * 100000 +
              (budget - curBudget) * 100000 +
              (blind - curBlind) * 100000 +
              (Math.max(0, 1 - pairs) - Math.max(0, 1 - curPairs)) * 100000 +
              (curPairs - pairs) * 4000 +
              (curBoth - both) * 1500 +
              (unreach - curUnreach) * 800 +
              (band - curBand) * 30000 +
              (spread - curSpread) * 400 -
              (reach - curReach) * 10000
            : (aim - curAim) * 100 +
              (leaks - curLeaks) * 100 +
              (triples - curTriples) * 100 +
              (bases - curBases) * 100 +
              (golds - curGolds) * 100 +
              (runs - curRuns) * 100 +
              (budget - curBudget) * 100 +
              (blind - curBlind) * 100 +
              (Math.max(0, 1 - pairs) - Math.max(0, 1 - curPairs)) * 100 +
              (curPairs - pairs) * 4 +
              (curBoth - both) * 2 +
              (unreach - curUnreach) * 1 +
              (band - curBand) * 30 +
              (spread - curSpread) * 2 +
              (gap - curGap);
          const viol = violation({ aim, leaks, triples, bases, golds, runs, budget, blind, pairs });
          // feasible モードは違反の件数で焼く。温度は件数の単位（3→0.05）。
          const accept = FEASIBLE_MODE
            ? viol <= curViol ||
              rng() < Math.exp(-(viol - curViol) / (3 * Math.pow(0.05 / 3, iter / MAX_ITER)))
            : d < 0 || rng() < Math.exp(-d / (T * 100));
          if (accept) {
            curViol = viol;
            cur = next;
            curLeaks = leaks;
            curGap = gap;
            curReach = reach;
            curTriples = triples;
            curBases = bases;
            curGolds = golds;
            curBand = band;
            curSpread = spread;
            curRuns = runs;
            curBudget = budget;
            curBlind = blind;
            curBoth = both;
            curPairs = pairs;
            curUnreach = unreach;
            curAim = aim;
            const hardOk =
              aim === 0 &&
              leaks === 0 && triples === 0 && bases === 0 && golds === 0 && runs === 0 &&
              budget === 0 && blind === 0 && pairs >= 1;
            const improved = FEASIBLE_MODE
              ? viol < bestViol || (viol === bestViol && viol === 0 && band < bestBand - 1e-9)
              : REACH_MODE
              ? hardOk &&
                (bestAim > 0 ||
                 bestLeaks > 0 || bestTriples > 0 || bestBases > 0 || bestGolds > 0 ||
                 bestRuns > 0 || bestBudget > 0 || bestBlind > 0 || bestPairs < 1 ||
                 pairs > bestPairs ||
                 (pairs === bestPairs && both > bestBoth) ||
                 (pairs === bestPairs && both === bestBoth && unreach < bestUnreach) ||
                 band < bestBand - 1e-9 ||
                 (Math.abs(band - bestBand) < 1e-9 &&
                  (spread < bestSpread || (spread === bestSpread && reach > bestReach))))
              : aim + leaks + triples + bases + golds + runs + budget + blind <
                  bestAim + bestLeaks + bestTriples + bestBases + bestGolds + bestRuns +
                    bestBudget + bestBlind ||
                (aim === bestAim && leaks === bestLeaks && triples === bestTriples && bases === bestBases &&
                 golds === bestGolds && runs === bestRuns && budget === bestBudget &&
                 blind === bestBlind && pairs === bestPairs &&
                 (band < bestBand - 1e-9 ||
                  (Math.abs(band - bestBand) < 1e-9 && gap < bestGap)));
            if (improved) {
              bestViol = viol;
              best = next.map((r) => [...r]);
              bestLeaks = leaks;
              bestGap = gap;
              bestReach = reach;
              bestTriples = triples;
              bestBases = bases;
              bestGolds = golds;
              bestBand = band;
              bestSpread = spread;
              bestRuns = runs;
              bestBudget = budget;
              bestBlind = blind;
              bestBoth = both;
              bestPairs = pairs;
              bestUnreach = unreach;
              bestAim = aim;
              console.log(
                `  iter=${iter} 狙い漏れ=${aim} ②=${leaks} 3本同時=${triples} 基準=${bases} 金示唆=${golds} 3連続=${runs} 配分超過=${budget} 3リール盲点=${blind} 隣接=${pairs} 両取り=${both} 届かず=${unreach} 帯=${band.toFixed(3)} 偏り=${spread} 到達=${reach.toFixed(4)} (${((Date.now() - t0) / 1000).toFixed(0)}s)`,
              );
            }
          }
        }

        console.log(
          `[${chapter}] 結果 狙い漏れ=${bestAim} ②=${bestLeaks} 3本同時=${bestTriples} 金示唆=${bestGolds} 3連続=${bestRuns} 配分超過=${bestBudget} 3リール盲点=${bestBlind} 隣接=${bestPairs} 両取り=${bestBoth} 届かず=${bestUnreach} 間隔=${bestGap} 到達=${bestReach.toFixed(4)} ${((Date.now() - t0) / 1000).toFixed(0)}s`,
        );
        // 最良は**制約を満たしていなくても保存する**（`OPT_SAVE=<dir>`）。以前は書き出せない
        // 配列を捨てていたので、35分回した結果が残らず次も最初からやり直しになった。
        if (process.env.OPT_SAVE) {
          mkdirSync(process.env.OPT_SAVE, { recursive: true });
          writeFileSync(
            `${process.env.OPT_SAVE}/${chapter}.json`,
            JSON.stringify({ reels: best }),
            'utf-8',
          );
        }
        // 焼きなまし中は間引いて評価しているので、**採用する配列は全数・全押し順で
        // 検証し直す**。間引きで見逃した②がここで出たら書き出さない。
        const verified =
          bestLeaks === 0
            ? countLeaks(yakuList, best, resolver, judge)
            : bestLeaks;
        if (verified !== bestLeaks) {
          console.log(
            `[${chapter}] 全数検証で②=${verified}（間引き評価では0だった）`,
          );
        }
        // 横3ライン同時テンパイが残っている配列も書き出さない（②と同じ扱い）。
        if (verified === 0 && bestTriples > 0) {
          console.log(`[${chapter}] 横3ライン同時テンパイが${bestTriples}件残っている`);
        }
        if (verified === 0 && bestGolds > 0) {
          console.log(`[${chapter}] 金示唆の両取り位置が足りない（不足${bestGolds}箇所）`);
        }
        if (verified === 0 && bestBudget > 0) {
          console.log(`[${chapter}] 引き込み可能性の配分に超過が${bestBudget}残っている`);
        }
        if (verified === 0 && bestBlind > 0) {
          console.log(
            `[${chapter}] 第3リールに BIG/REG どちらも引けない位置が${bestBlind}箇所残っている`,
          );
        }
        if (verified === 0 && bestPairs < 1) {
          console.log(`[${chapter}] 第3リールで BIG と REG が隣り合う組が1つもない`);
        }
        if (verified === 0 && bestRuns > 0) {
          console.log(`[${chapter}] 同じ図柄の3連続が${bestRuns}箇所残っている`);
        }
        // 「狙えば揃う」も書き出し前に**全6通りの押し順**で確かめる（焼きなまし中は2通り）。
        const aimAll = aimMisses(
          yakuList, best, makeController(yakuList, best, resolver), judge, STOP_ORDERS,
        );
        if (aimAll > 0) console.log(`[${chapter}] 全押し順で狙って揃わない押し方が${aimAll}通り残っている`);
        if (
          verified === 0 && aimAll === 0 && bestTriples === 0 && bestGolds === 0 &&
          bestRuns === 0 && bestBudget === 0 && bestBlind === 0 && bestPairs >= 1
        ) {
          const out = {
            mode: chapter,
            reels: best.map((cells, i) => ({ id: reelCfg.reels[i].id, cells })),
          };
          const lines = ['{', `  "mode": "${chapter}",`];
          if (landmark) lines.push(`  "landmark": "${landmark}",`);
          lines.push('  "reels": [');
          out.reels.forEach((r, i) => {
            const arr = r.cells.map((c) => `"${c}"`).join(', ');
            lines.push('    {', `      "id": "${r.id}",`, `      "cells": [${arr}]`,
              i < 2 ? '    },' : '    }');
          });
          lines.push('  ]', '}');
          writeFileSync(`${DATA}/reels/${chapter}.json`, `${lines.join('\n')}\n`, 'utf-8');
          console.log(`[${chapter}] 書き出した`);
        } else {
          console.log(`[${chapter}] ハード制約（狙えば揃う・②・3本同時・金示唆・3連続・3リールの盲点と隣接）のどれかが残ったので書き出さない`);
        }
      }
    },
    // 全数で②を測ると1回5秒かかり、数時間回すことがある。CLI の --testTimeout は
    // ここに書いた値に負けるので、環境変数で延ばせるようにする。
    Number(process.env.OPT_TIMEOUT ?? 3600_000),
  );
});
