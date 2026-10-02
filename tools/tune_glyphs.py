#!/usr/bin/env python3
"""回転中に見分けが付くよう、文字ごとの大きさ・横幅・横位置を割り当てる。

リールが回っている間、目に残るのは**列ごとの被覆**だけである（縦に流れて行の情報が
消えるため）。素のフォントを同じ大きさで焼くと同じリールの文字の横幅が揃ってしまい、
列被覆が完全に一致する組ができる。そうなると「どちらの文字か」は原理的に判別できない。

ここでは同じリールに載る全組について

    iou  = 重なり（止まっている時の似かた）
    blur = 列被覆の重なり（回っている時の似かた）

を測り、`blur` を下げることを主目的に `gen_glyphs.TUNE` の値を貪欲探索する。素の形から
離れるほど字が崩れるので、既定値（size=45, stretch=1.0）からのずれには軽い罰則を
置き、**必要な文字だけ**が動くようにしてある。

探索の単位は**リール別の文字**（"0:い"）。同じ文字でもリールで役の格が変わり、
焼く大きさが違うため（`gen_glyphs.TIER_SCALE`）。書体は島ごと（`gen_glyphs.FONTS`）。

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

SIZES = [39, 41, 43, 45, 47, 49]
STRETCHES = [0.84, 0.92, 1.0, 1.08, 1.16]
GAPS = [3, 4, 6, 8]        # 濁点付きだけ。印を字面から離すと横幅が変わる

DEFAULT = {"size": G.GLYPH_PX, "stretch": 1.0, "gap": 4}


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


def units_of(chapter: str) -> list[str]:
    """探索の単位。"リール番号:文字"。"""
    reels = json.loads((G.DATA / "reels" / f"{chapter}.json").read_text())["reels"]
    return [f"{i}:{c}" for i, r in enumerate(reels) for c in sorted(set(r["cells"]))]


def weighted_pairs(chapter: str) -> list[tuple[str, str, float]]:
    """探索が見る組。同じリールは満点、**同じ島の別リール**も割り引いて入れる。

    配列（`data/reels/*.json`）は別の作業で入れ替わる。今このリールに同居していない
    というだけで見分けを諦めると、配列が動いた次の日に「バとパが同じ形」に戻る。
    島の中では全部の組を見ておく。
    """
    out = []
    for a, b in itertools.combinations(units_of(chapter), 2):
        if a.split(":", 1)[1] == b.split(":", 1)[1]:
            continue                      # 同じ文字の別リール版は見分ける必要が無い
        out.append((a, b, 1.0 if a[0] == b[0] else 0.3))
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
            cell.alpha_composite(G.glyph(ch, chapter, j)[0])
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
    """(島, リール別の文字, size, stretch, gap) ごとの字面を作り置きする。"""

    def __init__(self) -> None:
        self.masks: dict[tuple, list[list[int]]] = {}

    def mask(self, chapter: str, unit: str, size: int, stretch: float, gap: int = 4):
        key = (chapter, unit, size, stretch, gap)
        if key not in self.masks:
            reel, ch = unit.split(":", 1)
            G.use_chapter(chapter)
            tier = G.tier_of(chapter, int(reel), ch)
            scaled = int(round(size * G.TIER_SCALE[tier]))
            self.masks[key] = G._mask(ch, scaled, stretch, gap, tier)
        return self.masks[key]

    def bitmap(self, chapter: str, unit: str, t: dict) -> np.ndarray:
        m = self.mask(chapter, unit, int(t["size"]), float(t["stretch"]), int(t["gap"]))
        a = np.array(m, dtype=bool)
        img = np.zeros((G.CH, G.CW), dtype=bool)
        oy = (G.CH - a.shape[0]) // 2
        ox = (G.CW - a.shape[1]) // 2
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

    def height(self, chapter: str, unit: str, size: int, stretch: float, gap: int = 4) -> int:
        return len(self.mask(chapter, unit, size, stretch, gap))

    def has_mark(self, unit: str) -> bool:
        return len(unicodedata.normalize("NFD", unit.split(":", 1)[1])) > 1


def pair_cost(iou: float, blur: float) -> float:
    """縦ブレを主、止まっている時の重なりを従にした罰則。1.0 付近で急に重くする。"""
    c = (max(0.0, blur - 0.70) / 0.30) ** 3
    c += 0.5 * (max(0.0, iou - 0.45) / 0.55) ** 2
    return c


def reg_cost(t: dict) -> float:
    return 0.03 * abs(t["size"] - G.GLYPH_PX) + 0.7 * abs(t["stretch"] - 1.0)


def total_cost(chars, prs, tune, bmp) -> float:
    return (sum(reg_cost(tune[c]) for c in chars)
            + sum(w * pair_cost(*scores(bmp[a], bmp[b])) for a, b, w in prs))


def search(chapter: str, bank: Bank, passes: int = 4, starts: int = 8) -> dict[str, dict]:
    """貪欲降下。**始点を変えて何度か回す**。1回だけだと ギ と ゲ のように
    「どちらを大きくしても片方が別の字とぶつかる」組で浅い底に落ちる。
    種は固定しているので、同じ入力からは必ず同じ割り当てが出る。"""
    rng = random.Random(20260829)
    units = units_of(chapter)
    prs = weighted_pairs(chapter)
    best_all, best_cost = None, float("inf")
    for k in range(starts):
        t = _descend(chapter, bank, passes, rng, seed_random=k > 0)
        bmp = {u: bank.bitmap(chapter, u, t[u]) for u in units}
        v = total_cost(units, prs, t, bmp)
        if v < best_cost:
            best_all, best_cost = t, v
    return best_all


def _descend(chapter: str, bank: Bank, passes: int, rng: random.Random,
             seed_random: bool) -> dict[str, dict]:
    units = units_of(chapter)
    prs = weighted_pairs(chapter)
    tune = {u: dict(DEFAULT) for u in units}
    is_bonus = {u: G.tier_of(chapter, int(u.split(":", 1)[0]), u.split(":", 1)[1]) == "bonus"
                for u in units}
    if seed_random:
        for u in units:
            size = rng.choice(SIZES)
            tune[u].update(size=max(size, G.GLYPH_PX) if is_bonus[u] else size,
                           stretch=rng.choice(STRETCHES),
                           gap=rng.choice(GAPS) if bank.has_mark(u) else DEFAULT["gap"])
    involved = {u: [(a, b, w) for a, b, w in prs if u in (a, b)] for u in units}

    def cost_of(u: str, cur: dict[str, dict], bmp: dict[str, np.ndarray]) -> float:
        s = reg_cost(cur[u])
        for a, b, w in involved[u]:
            s += w * pair_cost(*scores(bmp[a], bmp[b]))
        return s

    # 「ェ」「ー」のような小書き・記号は素から背が低い。絶対値で足切りすると
    # 候補が全滅して調整できなくなるので、**その文字の素の背丈**を基準にする
    floor = {u: max(5, bank.height(chapter, u, G.GLYPH_PX, 1.0) * 0.86) for u in units}

    bmp = {u: bank.bitmap(chapter, u, tune[u]) for u in units}
    for _ in range(passes):
        moved = False
        for u in units:
            best, best_t, best_b = cost_of(u, tune, bmp), dict(tune[u]), bmp[u]
            gaps = GAPS if bank.has_mark(u) else [DEFAULT["gap"]]
            # ボーナスの文字は既定より縮めない（大きさで格を見せるため）
            sizes = [z for z in SIZES if z >= G.GLYPH_PX] if is_bonus[u] else SIZES
            for size, st, gap in itertools.product(sizes, STRETCHES, gaps):
                if bank.height(chapter, u, size, st, gap) < floor[u]:
                    continue          # 縮め過ぎない。_fit が効いて別物の大きさになる
                t = {"size": size, "stretch": st, "gap": gap}
                bmp[u] = bank.bitmap(chapter, u, t)
                v = cost_of(u, {**tune, u: t}, bmp)
                if v < best - 1e-9:
                    best, best_t, best_b = v, t, bmp[u]
            bmp[u] = best_b
            if best_t != tune[u]:
                moved = True
            tune[u] = best_t
        if not moved:
            break
    return tune


def emit(tunes: dict[str, dict[str, dict]]) -> str:
    lines = ["TUNE: dict[str, dict[str, dict[str, float]]] = {"]
    for chapter, t in tunes.items():
        lines.append(f'    "{chapter}": {{')
        for ch, v in t.items():
            if v == DEFAULT:
                continue
            body = ", ".join(
                f'"{k}": {v[k]!r}' for k in ("size", "stretch", "gap")
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
