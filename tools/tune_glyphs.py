#!/usr/bin/env python3
"""回転中に見分けが付くよう、文字ごとの大きさ・横幅・横位置を割り当てる。

リールが回っている間、目に残るのは**列ごとの被覆**だけである（縦に流れて行の情報が
消えるため）。素のフォントを同じ大きさで焼くと同じリールの文字の横幅が揃ってしまい、
列被覆が完全に一致する組ができる。そうなると「どちらの文字か」は原理的に判別できない。

ここでは同じリールに載る全組について

    iou  = 重なり（止まっている時の似かた）
    blur = 列被覆の重なり（回っている時の似かた）

を測り、`blur` を下げることを主目的に `gen_glyphs.TUNE` の値を貪欲探索する。素の形から
離れるほど字が崩れるので、既定値（size=30, stretch=1.0, dx=0）からのずれには軽い罰則を
置き、**必要な文字だけ**が動くようにしてある。

    python3 tools/tune_glyphs.py --measure          # いまの生成物を測るだけ
    python3 tools/tune_glyphs.py --measure --dir X  # 別ディレクトリを測る
    python3 tools/tune_glyphs.py --search           # 探索して TUNE の中身を出力する
"""

from __future__ import annotations

import argparse
import itertools
import random
import unicodedata
import json
import pathlib
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import gen_glyphs as G  # noqa: E402

SIZES = [27, 28, 29, 30, 31, 32]
STRETCHES = [0.88, 0.94, 1.0, 1.06, 1.12]
DXS = [-2, -1, 0, 1, 2]
GAPS = [2, 3, 4, 5]        # 濁点付きだけ。印を字面から離すと横幅が変わる
RIM_BRIGHT, RIM_DARK = 1.35, 0.72   # 似た組の片方ずつに振る縁の明るさ

DEFAULT = {"size": 30, "stretch": 1.0, "dx": 0, "gap": 3, "rim": 1.0}


# ------------------------------------------------------------------ 測る

def scores(a: np.ndarray, b: np.ndarray) -> tuple[float, float]:
    iou = (a & b).sum() / max(1, (a | b).sum())
    ca, cb = a.any(0), b.any(0)
    blur = (ca & cb).sum() / max(1, (ca | cb).sum())
    return float(iou), float(blur)


def pairs_of(chapter: str) -> list[tuple[int, str, str, str]]:
    """同じリールに載る組。見分けが要るのはここ。返すのは (リール番号, 表示名, a, b)。

    字はリールごとに別ファイルなので（役の強さで大きさが変わるため）、
    測るときも番号が要る。
    """
    reels = json.loads((G.DATA / "reels" / f"{chapter}.json").read_text())["reels"]
    out = []
    for i, r in enumerate(reels):
        for a, b in itertools.combinations(sorted(set(r["cells"])), 2):
            out.append((i, r["id"], a, b))
    return out


def weighted_pairs(chapter: str) -> list[tuple[str, str, float]]:
    """探索が見る組。同じリールは満点、**同じ島の別リール**も割り引いて入れる。

    配列（`data/reels/*.json`）は別の作業で入れ替わる。今このリールに同居していない
    というだけで見分けを諦めると、配列が動いた次の日に「バとパが同じ形」に戻る。
    島の中では全部の組を見ておく。
    """
    same = {(a, b) for _, _, a, b in pairs_of(chapter)}
    out = [(a, b, 1.0) for a, b in same]
    chars = sorted(set(G.chars_of(chapter)))
    for a, b in itertools.combinations(chars, 2):
        if (a, b) not in same:
            out.append((a, b, 0.3))
    return out


def measure_dir(base: pathlib.Path) -> list[tuple]:
    rows = []
    for chapter in G.CHAPTERS:
        cache: dict[str, np.ndarray] = {}
        for reel, rid, a, b in pairs_of(chapter):
            for c in (a, b):
                k = f"{reel}:{c}"
                if k not in cache:
                    p = base / chapter / f"{G.name_of(reel, c)}.png"
                    cache[k] = np.array(Image.open(p).convert("L")) > 60
            iou, blur = scores(cache[f"{reel}:{a}"], cache[f"{reel}:{b}"])
            rows.append((chapter, rid, a, b, iou, blur))
    return rows


def report(rows: list[tuple], top: int = 25) -> None:
    rows = sorted(rows, key=lambda r: (-r[5], -r[4]))
    n100 = sum(1 for r in rows if r[5] >= 0.999)
    n95 = sum(1 for r in rows if r[5] >= 0.95)
    n90 = sum(1 for r in rows if r[5] >= 0.90)
    niou = sum(1 for r in rows if r[4] >= 0.55)
    print(f"組数 {len(rows)} / 縦ブレ1.00 {n100} / >=0.95 {n95} / >=0.90 {n90} / IoU>=0.55 {niou}")
    print(f"{'章':17}{'リール':8}組    IoU   縦ブレ")
    for chapter, rid, a, b, iou, blur in rows[:top]:
        print(f"{chapter:17}{rid:8}{a}{b}  {iou:.3f} {blur:.3f}")


# ------------------------------------------------------------ 目で見る

def smear_sheet(chapter: str, scale: int = 4) -> Image.Image:
    """回転中の見えかたを作る。縦に流したときに列へ残るインクの量を出す。

    数字（列被覆）は「その列にインクがあるか」しか見ないが、目には**濃さ**も見える。
    上段が止まっている時、下段が回っている時。下段どうしが同じ見た目なら、
    その2文字はどれだけ目押ししても区別できない。
    """
    reels = json.loads((G.DATA / "reels" / f"{chapter}.json").read_text())["reels"]
    rows = [sorted(set(r["cells"])) for r in reels]
    cols = max(len(r) for r in rows)
    cw, chh = G.CW * scale + 6, G.CH * scale + 6
    img = Image.new("RGBA", (cols * cw, len(rows) * chh * 2), (24, 20, 32, 255))
    for j, row in enumerate(rows):
        for i, ch in enumerate(row):
            cell = Image.new("RGBA", (G.CW, G.CH), (0, 0, 0, 0))
            cell.alpha_composite(G.glyph(ch, chapter))
            a = np.array(cell.convert("L"), dtype=float)
            col = a.mean(0)
            blur = np.tile((col / max(1e-6, col.max()) * 255), (G.CH, 1)).astype("uint8")
            still = cell.resize((G.CW * scale, G.CH * scale), Image.NEAREST)
            spun = Image.fromarray(blur).convert("RGBA").resize(
                (G.CW * scale, G.CH * scale), Image.NEAREST)
            img.paste(still, (i * cw, j * chh * 2), still)
            img.paste(spun, (i * cw, j * chh * 2 + chh))
    return img


# ------------------------------------------------------------------ 探索

class Bank:
    """(文字, size, stretch) ごとの字面を作り置きする。dx は貼る位置なので後から効く。"""

    def __init__(self) -> None:
        self.masks: dict[tuple, list[list[int]]] = {}

    def mask(self, ch: str, size: int, stretch: float, gap: int = 3):
        key = (ch, size, stretch, gap)
        if key not in self.masks:
            self.masks[key] = G._mask(ch, size, stretch, gap)
        return self.masks[key]

    def bitmap(self, ch: str, t: dict) -> np.ndarray:
        m = self.mask(ch, int(t["size"]), float(t["stretch"]), int(t["gap"]))
        a = np.array(m, dtype=bool)
        img = np.zeros((G.CH, G.CW), dtype=bool)
        oy = (G.CH - a.shape[0]) // 2
        ox = (G.CW - a.shape[1]) // 2 + int(t["dx"])
        ox = max(2, min(G.CW - 2 - a.shape[1], ox))
        # 縁は grow を2回。列で見ると字面の左右へ2ドット広がるのと同じ
        for dy in range(-2, 3):
            for dx in range(-2, 3):
                if abs(dy) + abs(dx) > 2:
                    continue
                ys, xs = oy + dy, ox + dx
                y0, x0 = max(0, ys), max(0, xs)
                y1 = min(G.CH, ys + a.shape[0])
                x1 = min(G.CW, xs + a.shape[1])
                if y1 > y0 and x1 > x0:
                    img[y0:y1, x0:x1] |= a[y0 - ys:y1 - ys, x0 - xs:x1 - xs]
        return img

    def height(self, ch: str, size: int, stretch: float, gap: int = 3) -> int:
        return len(self.mask(ch, size, stretch, gap))

    def has_mark(self, ch: str) -> bool:
        return len(unicodedata.normalize("NFD", ch)) > 1


def pair_cost(iou: float, blur: float) -> float:
    """縦ブレを主、止まっている時の重なりを従にした罰則。1.0 付近で急に重くする。"""
    c = (max(0.0, blur - 0.70) / 0.30) ** 3
    c += 0.5 * (max(0.0, iou - 0.45) / 0.55) ** 2
    return c


def reg_cost(t: dict) -> float:
    return 0.045 * abs(t["size"] - 30) + 0.7 * abs(t["stretch"] - 1.0) + 0.12 * abs(t["dx"])


def total_cost(chars, prs, tune, bmp) -> float:
    return (sum(reg_cost(tune[c]) for c in chars)
            + sum(w * pair_cost(*scores(bmp[a], bmp[b])) for a, b, w in prs))


def search(chapter: str, bank: Bank, passes: int = 4, starts: int = 8) -> dict[str, dict]:
    """貪欲降下。**始点を変えて何度か回す**。1回だけだと ギ と ゲ のように
    「どちらを大きくしても片方が別の字とぶつかる」組で浅い底に落ちる。
    種は固定しているので、同じ入力からは必ず同じ割り当てが出る。"""
    rng = random.Random(20260829)
    best_all, best_cost = None, float("inf")
    for k in range(starts):
        t = _descend(chapter, bank, passes, rng, seed_random=k > 0)
        chars = G.chars_of(chapter)
        bmp = {c: bank.bitmap(c, t[c]) for c in chars}
        v = total_cost(chars, weighted_pairs(chapter), t, bmp)
        if v < best_cost:
            best_all, best_cost = t, v
    return best_all


def _descend(chapter: str, bank: Bank, passes: int, rng: random.Random,
             seed_random: bool) -> dict[str, dict]:
    chars = G.chars_of(chapter)
    prs = weighted_pairs(chapter)
    tune = {c: dict(DEFAULT) for c in chars}
    if seed_random:
        for c in chars:
            tune[c].update(size=rng.choice(SIZES), stretch=rng.choice(STRETCHES),
                           dx=rng.choice(DXS),
                           gap=rng.choice(GAPS) if bank.has_mark(c) else 3)
    involved = {c: [(a, b, w) for a, b, w in prs if c in (a, b)] for c in chars}

    def cost_of(c: str, cur: dict[str, dict], bmp: dict[str, np.ndarray]) -> float:
        s = reg_cost(cur[c])
        for a, b, w in involved[c]:
            s += w * pair_cost(*scores(bmp[a], bmp[b]))
        return s

    # 「ェ」「ー」のような小書き・記号は素から背が低い。絶対値で足切りすると
    # 候補が全滅して調整できなくなるので、**その文字の素の背丈**を基準にする
    floor = {c: max(4, bank.height(c, 30, 1.0, 3) * 0.86) for c in chars}

    bmp = {c: bank.bitmap(c, tune[c]) for c in chars}
    for _ in range(passes):
        moved = False
        for c in chars:
            best, best_t, best_b = cost_of(c, tune, bmp), dict(tune[c]), bmp[c]
            gaps = GAPS if bank.has_mark(c) else [3]
            for size, st, dx, gap in itertools.product(SIZES, STRETCHES, DXS, gaps):
                if bank.height(c, size, st, gap) < floor[c]:
                    continue          # 縮め過ぎない。_fit が効いて別物の大きさになる
                t = {"size": size, "stretch": st, "dx": dx, "gap": gap,
                     "rim": tune[c]["rim"]}
                bmp[c] = bank.bitmap(c, t)
                v = cost_of(c, {**tune, c: t}, bmp)
                if v < best - 1e-9:
                    best, best_t, best_b = v, t, bmp[c]
            bmp[c] = best_b
            if best_t != tune[c]:
                moved = True
            tune[c] = best_t
        if not moved:
            break
    return tune


def assign_rims(chapter: str, tune: dict[str, dict], bank: Bank) -> None:
    """まだ似ている組の片方だけ縁の明るさを動かす。回転中の輪郭の濃さが変わる。

    白と灰の2値構造は保つ（灰の明度だけ動かす）ので、tint で色が乗る仕組みは壊れない。
    列被覆は変わらないので数字には出ないが、目には効く。
    """
    bmp = {c: bank.bitmap(c, tune[c]) for c in G.chars_of(chapter)}
    worst = sorted(
        ((scores(bmp[a], bmp[b])[1], scores(bmp[a], bmp[b])[0], a, b)
         for a, b, w in weighted_pairs(chapter) if w >= 1.0),
        reverse=True,
    )
    used: dict[str, float] = {}
    for blur, iou, a, b in worst:
        if blur < 0.88 and iou < 0.55:
            continue
        if a in used or b in used:
            continue
        used[a] = RIM_BRIGHT      # 片方の縁を明るく
        used[b] = RIM_DARK       # 片方を暗く
    for c, v in used.items():
        tune[c]["rim"] = v


def emit(tunes: dict[str, dict[str, dict]]) -> str:
    lines = ["TUNE: dict[str, dict[str, dict[str, float]]] = {"]
    for chapter, t in tunes.items():
        lines.append(f'    "{chapter}": {{')
        for ch, v in t.items():
            if v == DEFAULT:
                continue
            body = ", ".join(
                f'"{k}": {v[k]!r}' for k in ("size", "stretch", "dx", "gap", "rim")
                if v[k] != DEFAULT[k]
            )
            lines.append(f'        "{ch}": {{{body}}},')
        lines.append("    },")
    lines.append("}")
    return "\n".join(lines)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--measure", action="store_true")
    ap.add_argument("--search", action="store_true")
    ap.add_argument("--dir", default=str(G.OUT))
    ap.add_argument("--top", type=int, default=25)
    ap.add_argument("--smear", action="store_true")
    args = ap.parse_args()

    if args.search:
        bank = Bank()
        tunes = {}
        for chapter in G.CHAPTERS:
            tunes[chapter] = search(chapter, bank)
            assign_rims(chapter, tunes[chapter], bank)
            print(f"{chapter}: done", file=sys.stderr)
        print(emit(tunes))
        return 0

    if args.smear:
        parts = [smear_sheet(c) for c in G.CHAPTERS]
        board = Image.new("RGBA", (max(p.width for p in parts),
                                   sum(p.height + 14 for p in parts)), (24, 20, 32, 255))
        y = 0
        for p in parts:
            board.paste(p, (0, y))
            y += p.height + 14
        out = pathlib.Path("/tmp/glyphs_smear.png")
        board.save(out)
        print(f"smear: {out}（上=停止 / 下=回転中）")
        return 0

    report(measure_dir(pathlib.Path(args.dir)), args.top)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
