#!/usr/bin/env python3
"""ハズレ図柄（どの役にも属さない絵柄）のドット絵（2026-10-16）。

リールの余りのコマに置く、**灰の線画**。実機のハズレ図柄（傘・犬・ヘッドホンなどを灰一色で
描いたもの）にならい、役の色にも金の輪にも染めず、目印の紺の帯とも違う「何も無い」絵にする。
島ごとに2種類（同じ絵柄を続けて・1つおきに置けないため、1種類では1リールに4枚までしか入らない）。

絵は高解像度（SS 倍）でベクターとして描き、塗りと線を別々に縮めてドットに落とす。
gen_glyphs.py の `glyph()` が、ハズレの文字ならここの `blank_glyph()` を呼ぶ。

    python3 tools/blank_glyphs.py --preview /tmp/blanks.png   # 10枚を並べた確認用の画像
"""
from __future__ import annotations

import argparse
import math
import pathlib

from PIL import Image, ImageDraw

CW, CH = 65, 50  # セルのドット数（gen_glyphs と同じ）
SS = 8           # 描く時の倍率

# 色（tint しない＝表示側で白を掛けるので、ここで決めた色がそのまま出る）
FACE = (226, 226, 230, 255)   # 面。明るい灰
LINE = (120, 122, 132, 255)   # 線。中くらいの灰
EDGE = (52, 52, 60, 255)      # 外の縁。暗い地の上でも輪郭が溶けないように

#: 島ごとのハズレ図柄。キーは data/reels に書く文字、値は絵の名前。
BLANKS: dict[str, dict[str, str]] = {
    "hiragana_food": {"湯": "yunomi", "箸": "hashi"},
    "hiragana_verb": {"鉛": "enpitsu", "消": "keshigomu"},
    "katakana_animal": {"足": "ashiato", "骨": "hone"},
    "security": {"歯": "haguruma", "螺": "neji"},
    "yasai": {"葉": "happa", "籠": "kago"},
}

W, H = CW * SS, CH * SS
LW = int(SS * 1.6)  # 線の太さ（ドットで約1.6）


def _rot(points, ang, cx=W / 2, cy=H / 2):
    a = math.radians(ang)
    ca, sa = math.cos(a), math.sin(a)
    return [(cx + (x - cx) * ca - (y - cy) * sa, cy + (x - cx) * sa + (y - cy) * ca) for x, y in points]


def _canvas():
    fill = Image.new("L", (W, H), 0)
    line = Image.new("L", (W, H), 0)
    return fill, line, ImageDraw.Draw(fill), ImageDraw.Draw(line)


def _shape(fd, ld, pts, width=LW):
    fd.polygon(pts, fill=255)
    ld.line(pts + [pts[0]], fill=255, width=width, joint="curve")


def _ell(fd, ld, box, width=LW, fill=True):
    if fill:
        fd.ellipse(box, fill=255)
    ld.ellipse(box, outline=255, width=width)


def _rect(x0, y0, x1, y1):
    return [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]


# ---------------------------------------------------------------- 絵柄

def yunomi():
    """湯のみ。下すぼまりの胴に、口の縁と帯を1本。"""
    f, l, fd, ld = _canvas()
    cx, top, bot = W / 2, H * 0.24, H * 0.80
    _shape(fd, ld, [(cx - 15 * SS, top), (cx + 15 * SS, top), (cx + 11 * SS, bot), (cx - 11 * SS, bot)])
    ld.line([(cx - 14 * SS, top + 5 * SS), (cx + 14 * SS, top + 5 * SS)], fill=255, width=LW)
    ld.line([(cx - 12.5 * SS, bot - 8 * SS), (cx + 12.5 * SS, bot - 8 * SS)], fill=255, width=LW)
    return f, l


def hashi():
    """箸と箸置き。2本の細い棒を斜めに。"""
    f, l, fd, ld = _canvas()
    for dy in (-3.2, 3.2):
        y = H / 2 + dy * SS
        pts = [(W * 0.14, y - 1.3 * SS), (W * 0.86, y - 0.6 * SS), (W * 0.86, y + 0.6 * SS), (W * 0.14, y + 1.3 * SS)]
        _shape(fd, ld, _rot(pts, -18))
    box = _rot(_rect(W * 0.60, H / 2 + 6 * SS, W * 0.74, H / 2 + 11 * SS), -18)
    _shape(fd, ld, box)
    return f, l


def enpitsu():
    """鉛筆。六角の軸と削った先。"""
    f, l, fd, ld = _canvas()
    y0, y1 = H / 2 - 5 * SS, H / 2 + 5 * SS
    body = [(W * 0.18, y0), (W * 0.66, y0), (W * 0.66, y1), (W * 0.18, y1)]
    tip = [(W * 0.66, y0), (W * 0.86, H / 2), (W * 0.66, y1)]
    _shape(fd, ld, _rot(body, -20))
    _shape(fd, ld, _rot(tip, -20))
    ld.line(_rot([(W * 0.18, H / 2), (W * 0.66, H / 2)], -20), fill=255, width=LW)
    lead = [(W * 0.80, H / 2 - 1.6 * SS), (W * 0.86, H / 2), (W * 0.80, H / 2 + 1.6 * SS)]
    fd.polygon(_rot(lead, -20), fill=0)
    ld.polygon(_rot(lead, -20), fill=255)
    return f, l


def keshigomu():
    """消しゴム。角の丸い直方体に紙のスリーブ。"""
    f, l, fd, ld = _canvas()
    body = _rot(_rect(W * 0.22, H * 0.30, W * 0.78, H * 0.70), -12)
    _shape(fd, ld, body)
    for x in (0.44, 0.70):
        ld.line(_rot([(W * x, H * 0.30), (W * x, H * 0.70)], -12), fill=255, width=LW)
    return f, l


def ashiato():
    """足あと。大きな肉球と指4つ。"""
    f, l, fd, ld = _canvas()
    cx, cy = W / 2, H * 0.62
    _ell(fd, ld, (cx - 10 * SS, cy - 7 * SS, cx + 10 * SS, cy + 9 * SS))
    for dx, dy in ((-13, -10), (-5, -16), (5, -16), (13, -10)):
        x, y = cx + dx * SS, cy + dy * SS
        _ell(fd, ld, (x - 4 * SS, y - 4.6 * SS, x + 4 * SS, y + 4.6 * SS))
    return f, l


def hone():
    """骨。棒の両端にこぶ2つずつ。"""
    f, l, fd, ld = _canvas()
    rod = _rot(_rect(W * 0.28, H / 2 - 3.6 * SS, W * 0.72, H / 2 + 3.6 * SS), -15)
    fd.polygon(rod, fill=255)
    for x in (0.25, 0.75):
        for dy in (-4, 4):
            px, py = _rot([(W * x, H / 2 + dy * SS)], -15)[0]
            _ell(fd, ld, (px - 5 * SS, py - 5 * SS, px + 5 * SS, py + 5 * SS))
    a, b, c, d = rod
    ld.line([a, b], fill=255, width=LW)
    ld.line([d, c], fill=255, width=LW)
    # 棒とこぶの継ぎ目の線は消す（こぶの輪郭が棒の中へ入らないように塗り直す）
    inner = _rot(_rect(W * 0.30, H / 2 - 2.4 * SS, W * 0.70, H / 2 + 2.4 * SS), -15)
    ld.polygon(inner, fill=0)
    return f, l


def haguruma():
    """歯車。歯8枚と中の穴。"""
    f, l, fd, ld = _canvas()
    cx, cy, r0, r1 = W / 2, H / 2, 12 * SS, 17 * SS
    pts = []
    for i in range(32):
        a = math.radians(i * 360 / 32)
        r = r1 if (i % 4) in (1, 2) else r0
        pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    _shape(fd, ld, pts)
    hole = (cx - 5 * SS, cy - 5 * SS, cx + 5 * SS, cy + 5 * SS)
    fd.ellipse(hole, fill=0)
    ld.ellipse(hole, outline=255, width=LW)
    return f, l


def neji():
    """ネジ。頭と、斜めのねじ山の軸。"""
    f, l, fd, ld = _canvas()
    head = _rot(_rect(W * 0.16, H / 2 - 9 * SS, W * 0.30, H / 2 + 9 * SS), -15)
    shaft = _rot(_rect(W * 0.30, H / 2 - 4.5 * SS, W * 0.82, H / 2 + 4.5 * SS), -15)
    _shape(fd, ld, shaft)
    _shape(fd, ld, head)
    for i in range(6):
        x = W * (0.36 + i * 0.075)
        ld.line(_rot([(x, H / 2 - 4.5 * SS), (x + 3 * SS, H / 2 + 4.5 * SS)], -15), fill=255, width=LW)
    return f, l


def happa():
    """葉っぱ。尖った楕円と葉脈。"""
    f, l, fd, ld = _canvas()
    pts = []
    for i in range(41):
        t = i / 40 * math.pi
        x = W * 0.18 + (W * 0.64) * (1 - math.cos(t)) / 2
        y = H / 2 - 11 * SS * math.sin(t) ** 0.9
        pts.append((x, y))
    for i in range(41):
        t = (40 - i) / 40 * math.pi
        x = W * 0.18 + (W * 0.64) * (1 - math.cos(t)) / 2
        y = H / 2 + 11 * SS * math.sin(t) ** 0.9
        pts.append((x, y))
    pts = _rot(pts, -18)
    _shape(fd, ld, pts)
    ld.line(_rot([(W * 0.12, H / 2), (W * 0.80, H / 2)], -18), fill=255, width=LW)
    for x in (0.36, 0.50, 0.64):
        for s in (-1, 1):
            ld.line(_rot([(W * x, H / 2), (W * (x + 0.08), H / 2 + s * 6.5 * SS)], -18), fill=255, width=LW)
    return f, l


def kago():
    """かご。台形の籠と編み目、持ち手。"""
    f, l, fd, ld = _canvas()
    top, bot = H * 0.44, H * 0.84
    body = [(W * 0.20, top), (W * 0.80, top), (W * 0.72, bot), (W * 0.28, bot)]
    ld.arc((W * 0.30, H * 0.10, W * 0.70, H * 0.78), 180, 360, fill=255, width=LW)
    _shape(fd, ld, body)
    for y in (0.57, 0.70):
        ld.line([(W * 0.21, H * y), (W * 0.79, H * y)], fill=255, width=LW)
    for x in (0.38, 0.50, 0.62):
        ld.line([(W * x, top), (W * (x + (0.5 - x) * 0.25), bot)], fill=255, width=LW)
    return f, l


DRAW = {
    "yunomi": yunomi, "hashi": hashi, "enpitsu": enpitsu, "keshigomu": keshigomu,
    "ashiato": ashiato, "hone": hone, "haguruma": haguruma, "neji": neji,
    "happa": happa, "kago": kago,
}


def _dots(img: Image.Image, thr: int) -> list[list[int]]:
    small = img.resize((CW, CH), Image.BOX)
    return [[1 if small.getpixel((x, y)) > thr else 0 for x in range(CW)] for y in range(CH)]


def _grow(m: list[list[int]]) -> list[list[int]]:
    h, w = len(m), len(m[0])
    return [[1 if any(0 <= y + dy < h and 0 <= x + dx < w and m[y + dy][x + dx]
                      for dy in (-1, 0, 1) for dx in (-1, 0, 1)) else 0
             for x in range(w)] for y in range(h)]


def blank_name(chapter: str, ch: str) -> str | None:
    """その島でハズレ図柄なら絵の名前、違えば None。"""
    return BLANKS.get(chapter, {}).get(ch)


def blank_glyph(chapter: str, ch: str) -> tuple[Image.Image, Image.Image]:
    """(地, 艶)。地に色を焼き込み、艶は空（表示側は tint を白にする）。"""
    fill, line = DRAW[BLANKS[chapter][ch]]()
    f = _dots(fill, 110)
    ln = _dots(line, 70)
    shape = [[f[y][x] or ln[y][x] for x in range(CW)] for y in range(CH)]
    outer = _grow(shape)
    base = Image.new("RGBA", (CW, CH), (0, 0, 0, 0))
    bp = base.load()
    for y in range(CH):
        for x in range(CW):
            if ln[y][x]:
                bp[x, y] = LINE
            elif f[y][x]:
                bp[x, y] = FACE
            elif outer[y][x]:
                bp[x, y] = EDGE
    return base, Image.new("RGBA", (CW, CH), (0, 0, 0, 0))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--preview", required=True, help="確認用の画像の書き出し先")
    args = ap.parse_args()
    scale = 4
    bgs = [(0x76, 0x76, 0x7E), (0, 0, 0), (0xF4, 0xF2, 0xEC)]
    items = [(c, ch) for c, m in BLANKS.items() for ch in m]
    board = Image.new("RGBA", (len(items) * CW * scale, len(bgs) * CH * scale), (0, 0, 0, 255))
    for j, bg in enumerate(bgs):
        for i, (c, ch) in enumerate(items):
            cell = Image.new("RGBA", (CW, CH), bg + (255,))
            g, _ = blank_glyph(c, ch)
            cell.alpha_composite(g)
            board.paste(cell.resize((CW * scale, CH * scale), Image.NEAREST), (i * CW * scale, j * CH * scale))
    board.save(pathlib.Path(args.preview))
    print(args.preview)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
