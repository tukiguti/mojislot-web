import type { Yaku, YakuList } from '../data/schemas';
import { PAYLINES, visibleAt } from './Paylines';

/**
 * 引き込み保証（「狙えば揃う」）の判定。**[lol-slot] の `ReelControl` と同じ判定**。
 *
 * 実機の制御は「成立した役の図柄が4コマ以内にあれば必ず有効ラインへ引き込む」ことを
 * 求められる。各リールで「その時点で成立する最小のスベリ」を選ぶだけだと、
 * **先に止めたリールの位置しだいで、残りをどう止めても成立しなくなる**。
 *
 * 「成立」は**狙いの役が揃い、かつ出目に出てよい役（allowed）以外が1つも揃わない**こと。
 * 〔2026-10-02〕以前は狙いの役が揃うかだけを見ていたので、保証で選んだ滑りが
 * 他の役を揃えてしまい、順押しの停止テーブルに「揃って見えるのに0枚」が
 * 押し方の約6%で残っていた（監査が停止位置を渡しておらず、表を通っていなかった）。
 *
 *   feasible    … 未停止のリールに「どこかの位置」を置けば成立するか
 *   robust      … 未停止のリールを**どこで押されても**成立させ続けられるか
 *   robustAimed … 未停止のリールを**図柄を狙って押せば**成立させ続けられるか
 *
 * どれも再帰で、純粋関数なのでキャッシュする。
 *
 * 〔2026-10-02〕以前は停止テーブルを焼くツール（tests/tools/gen-stop-table）の中にだけ
 * あった。テーブルは順押しの分しか無いので、**順押し以外の押し順ではこの判定が通らず**、
 * 正しく狙っても 2.7〜18.7% で揃わなかった。停止制御（`StopController`）の本体へ移し、
 * どの押し順でも同じ判定で滑りを選ぶ。テーブルを焼くツールもこれを使う。
 */
export class PullInGuard {
  private readonly n: number;
  private readonly feasCache = new Map<string, boolean>();
  private readonly robustCache = new Map<string, boolean>();
  private readonly aimedCache = new Map<string, boolean>();
  private readonly allYakus: Yaku[];
  /** 出目に出てよい役ID。`chooseSlip` の呼び出しごとに差し替わる（キャッシュの鍵にも入る）。 */
  private allowed: ReadonlySet<string> = new Set();
  private allowedKey = '';

  /**
   * @param yakuList    全役。「出てはいけない役が揃っていないか」を見るのに使う
   * @param reels       3リールの配列
   * @param pullInCells 引き込みの最大コマ数（実機準拠の4）
   */
  constructor(
    yakuList: YakuList,
    private readonly reels: readonly (readonly string[])[],
    private readonly pullInCells: number,
  ) {
    this.n = reels[0].length;
    this.allYakus = [
      ...yakuList.premiumYaku,
      ...yakuList.bonusYaku,
      ...yakuList.coreYaku,
      ...yakuList.cherryYaku,
      ...yakuList.singleYaku,
    ];
  }

  /**
   * 出目に出てよい役を決める。省略すると「狙いの役だけ」。
   * ボーナス中のこぼし先（1枚役）のように、狙わないが出てもよい役があるので分けてある。
   */
  private useAllowed(targets: readonly Yaku[], allowedIds?: readonly string[]): void {
    const ids = [...(allowedIds ?? targets.map((y) => y.id))].sort();
    const key = ids.join('+');
    if (key === this.allowedKey) return;
    this.allowedKey = key;
    this.allowed = new Set(ids);
  }

  private rowsAt(reel: number, pos: number): string[] {
    const cells = this.reels[reel];
    return [visibleAt(cells, pos, 'top'), visibleAt(cells, pos, 'middle'), visibleAt(cells, pos, 'bottom')];
  }

  /**
   * 3リールとも止まった状態で、狙いの役が5ラインのどれかで成立し、
   * **出てよい役以外が1つも揃っていない**か。
   */
  private matches(targets: readonly Yaku[], stops: readonly number[]): boolean {
    const w = [this.rowsAt(0, stops[0]), this.rowsAt(1, stops[1]), this.rowsAt(2, stops[2])];
    const lined = (y: Yaku) =>
      PAYLINES.some((L) =>
        y.symbols.every((sym, r) => sym === undefined || w[r][L.cells[r][0]] === sym),
      );
    if (!targets.some(lined)) return false;
    return !this.allYakus.some((y) => !this.allowed.has(y.id) && lined(y));
  }

  private key(targets: readonly Yaku[], stops: readonly (number | null)[]): string {
    return `${targets.map((y) => y.id).join('+')}/${this.allowedKey}|${stops.join(',')}`;
  }

  private feas(targets: readonly Yaku[], stops: readonly (number | null)[]): boolean {
    const k = this.key(targets, stops);
    const hit = this.feasCache.get(k);
    if (hit !== undefined) return hit;
    const work = [...stops];
    const rest = [0, 1, 2].filter((i) => work[i] === null);
    const search = (idx: number): boolean => {
      if (idx >= rest.length) return this.matches(targets, work as number[]);
      const r = rest[idx];
      for (let c = 0; c < this.n; c++) {
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
    this.feasCache.set(k, ok);
    return ok;
  }

  private rob(targets: readonly Yaku[], stops: readonly (number | null)[]): boolean {
    const k = this.key(targets, stops);
    const hit = this.robustCache.get(k);
    if (hit !== undefined) return hit;
    this.robustCache.set(k, true); // 再訪よけ
    let ok = true;
    outer: for (let r = 0; r < 3; r++) {
      if (stops[r] !== null) continue;
      for (let press = 0; press < this.n; press++) {
        let reachable = false;
        for (let slip = 0; slip <= this.pullInCells && !reachable; slip++) {
          const next = [...stops];
          next[r] = (press + slip) % this.n;
          if (this.feas(targets, next) && this.rob(targets, next)) reachable = true;
        }
        if (!reachable) {
          ok = false;
          break outer;
        }
      }
    }
    if (stops.every((v) => v !== null)) ok = this.matches(targets, stops as number[]);
    this.robustCache.set(k, ok);
    return ok;
  }

  /**
   * **狙った押下位置に限った保証**。`robust` は「どこで押されても」を求めるので
   * 配列によっては成立せず、そこで素の `feasible` へ落ちると貪欲に戻ってしまう。
   *
   * プレイヤーは図柄を狙って押すので、**その図柄が引き込める押下位置**だけを
   * 見れば十分。ここを保証すれば「正しく狙ったのに揃わない」は消える。
   */
  private aimed(targets: readonly Yaku[], stops: readonly (number | null)[]): boolean {
    const k = this.key(targets, stops);
    const hit = this.aimedCache.get(k);
    if (hit !== undefined) return hit;
    this.aimedCache.set(k, true);
    let ok = true;
    outer: for (let r = 0; r < 3; r++) {
      if (stops[r] !== null) continue;
      const syms = new Set(
        targets.map((y) => y.symbols[r]).filter((s): s is string => s !== undefined),
      );
      if (syms.size === 0) continue; // チェリーの第3リールなど、狙う図柄が無い
      for (let press = 0; press < this.n; press++) {
        // **狙った押し方の範囲**だけを見る。図柄に届くだけの端の位置（滑りを使い切って
        // 1つの段にしか置けない場所）まで保証しようとすると、どの停止位置を選んでも
        // 成立せず、素の feasible へ落ちて貪欲に戻る。実測でそうなった。
        const canAim = Array.from({ length: this.pullInCells + 1 }, (_, s) => (press + s) % this.n).some(
          (pos) => this.rowsAt(r, pos).some((c) => syms.has(c)),
        );
        if (!canAim) continue;
        let good = false;
        for (let slip = 0; slip <= this.pullInCells && !good; slip++) {
          const next = [...stops];
          next[r] = (press + slip) % this.n;
          if (this.feas(targets, next) && this.aimed(targets, next)) good = true;
        }
        if (!good) {
          ok = false;
          break outer;
        }
      }
    }
    if (stops.every((v) => v !== null)) ok = this.matches(targets, stops as number[]);
    this.aimedCache.set(k, ok);
    return ok;
  }

  /** 未停止のリールをどこかに置けば成立するか（出てよい役は allowedIds、省略時は targets だけ）。 */
  feasible(
    targets: readonly Yaku[],
    stops: readonly (number | null)[],
    allowedIds?: readonly string[],
  ): boolean {
    this.useAllowed(targets, allowedIds);
    return this.feas(targets, stops);
  }

  /**
   * そのリールを press から止める時のスベリを選ぶ。
   * ① 引き込み保証（狙った押下位置での保証 かつ どこで押されても揃いうる）を満たす候補
   * ② 狙った押下位置に限った保証（robustAimed）を満たす候補
   * ③ 保証はできないが成立させうる候補
   * を、`prefer` が返す優先順位（段の振り分けなど）で並べて先頭を採る。
   * どれも無ければ null（＝その役はもう揃えられない）。
   *
   * @param stops      各リールの**停止位置**（未停止は null）
   * @param allowedIds 出目に出てよい役ID（省略時は targets だけ）
   */
  chooseSlip(
    targets: readonly Yaku[],
    stops: readonly (number | null)[],
    reel: number,
    press: number,
    prefer: (slip: number) => number = () => 0,
    allowedIds?: readonly string[],
  ): number | null {
    this.useAllowed(targets, allowedIds);
    const cands = Array.from({ length: this.pullInCells + 1 }, (_, s) => s).sort(
      (a, b) => prefer(a) - prefer(b) || a - b,
    );
    for (const pass of [0, 1, 2]) {
      for (const s of cands) {
        const next = [...stops];
        next[reel] = (press + s) % this.n;
        if (!this.feas(targets, next)) continue;
        // **狙った押下位置での保証を最優先**にする。robust（どこで押されても
        // 揃いうる）は5ラインあるぶん通りやすく、選択の縛りとして弱い。先に
        // 通してしまうと「正しく狙ったのに揃わない」が残る（実測で4役）。
        if (pass === 0 && !(this.aimed(targets, next) && this.rob(targets, next))) continue;
        if (pass === 1 && !this.aimed(targets, next)) continue;
        return s;
      }
    }
    return null;
  }
}
