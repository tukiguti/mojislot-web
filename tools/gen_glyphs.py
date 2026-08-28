#!/usr/bin/env python3
"""リールのドット文字を作る。

**生成画像は全廃した。** 役ごとの一枚絵は5島中4島が古い役のまま残り（寿司島は7枚とも
不一致）、外部の画像生成に投げ直さないと直せないので誰も直さなかった。加えて絵で
セルを見分けられると「文字を読んで押す」というコンセプトが崩れるため、絵柄と文字の
切り替え設定ごと廃止する。リールは**ドット文字だけ**になる。

セルは 130x100（`ReelView.CELL_WIDTH/HEIGHT`）。液晶の背景も出題者もバナーも3倍なので、
ここも3倍で出るよう **44x34 ドット**で作る（130/44 ≒ 2.95）。文字は30ドット高。

**地の四角は描かない。** 色タイルは色の面積が大きく、文字が背景の一部に見えてしまう。
リールは黒地に色文字だけになり、実機のリールに近い。

    python3 tools/gen_glyphs.py            # public/art/glyphs/ へ書き出す
    python3 tools/gen_glyphs.py --preview  # /tmp に実寸プレビュー（全島・3倍と6倍）

色は表示側で Pixi の tint（乗算）で付ける。役ごとの色は TypeScript 側の
`SymbolColorResolver` が持っているので、色の決め方を Python へ写さない（写すと必ずずれる）。
字面を白、縁を中間の灰で焼いてあるので、tint 後は「色」と「その色の暗い版」になる。


## 回転中の見分けと TUNE

リールは縦に流れるので、回っている間に残るのは**列ごとの被覆**だけである。行の情報は
smear で消える。つまり「横棒の位置が違う」「内側に一画多い」といった違いは回転中は
効かず、**字面の横幅と、横方向のどこにインクがあるか**しか手掛かりが無い。

素のフォントを同じ大きさで焼くと同じリールに載る文字の横幅が揃い、列被覆が完全一致する
組が出る（作業前は16組）。そこで文字ごとに

- size    … フォントの大きさ。縦横とも変わる
- stretch … 横だけの伸縮
- dx      … 横位置。セル内で少しずらす
- gap     … 濁点・半濁点と字面の間。離すほど横に広がる
- rim     … 縁の灰の明るさ。tint 後の輪郭の濃さが文字ごとに変わる

を持たせ、同じリールに載る文字どうしの列被覆が重ならないように割り当てる。値は
`tools/tune_glyphs.py` の貪欲探索が出したものを転記してある。手で直してよいが、直したら
`python3 tools/tune_glyphs.py --measure` で数字が悪化していないか見ること。

濁点・半濁点はフォント任せをやめ、**手で描いた印**を字面の右上に離して置く。フォントの
濁点は小さく、回転中は「バとパ」「キとギ」が同じ形になる。濁点は縦棒2本、半濁点は
四角い輪にして、列被覆そのものを変えてある（点2つと丸では列被覆が同じになる）。
"""

from __future__ import annotations

import argparse
import json
import pathlib
import unicodedata

from PIL import Image, ImageDraw, ImageFont

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
OUT = ROOT / "public" / "art" / "glyphs"
FONT = "/System/Library/Fonts/ヒラギノ角ゴシック W6.ttc"

CW, CH = 44, 34      # セルのドット数
GLYPH_PX = 30        # 文字の高さ。地の四角を廃したので枠に触る心配が無く、大きく取れる
MASK_W = CW - 6      # 縁が2ドット出て、横のずらしも入るので、字面はこれ以内に収める
MASK_H = CH - 4
SS = 4               # ラスタライズの上げ幅。横だけ伸縮するので一度大きく焼いてから縮める
# 縁は**中間の灰**にしてある。表示側で役色を tint（乗算）するので、
# 灰は「その文字の色の暗い版」になる。真っ黒だと黒い縁のまま浮いて、
# どの文字も同じ輪郭に見えてしまう
RIM = (104, 100, 116, 255)
PAPER = (255, 255, 255, 255)

# 役の強さごとの大きさ。**ボーナスを大きくするというより、他を小さくする**。
# ボーナスの文字は既に赤と青で一意なので、大小を付けても新しい手掛かりにはならない
# （色の予約が無かった頃は「読まずに大きさで探せる」ので採らない判断だった）。
TIER_SCALE = {"bonus": 1.08, "core": 0.94, "filler": 0.84}

CHAPTERS = [
    "hiragana_food",
    "hiragana_verb",
    "katakana_animal",
    "security",
    "yasai",
]

# 文字ごとの作り分け。キーは **"リール番号:文字"**。同じ文字でもリールで役の強さ
# （＝大きさ）が変わるので、リールごとに持つ。値は `tools/tune_glyphs.py` と
# 同じ測り方の貪欲探索が出したもの。
#
# **横ずらし(dx)は使わない。** 見分けの軸としては効くが、字がセルの中で左右に
# 寄って見えるのが目に付く。大きさ・横の伸縮・濁点の間隔・縁の明るさで代替する。
TUNE: dict[str, dict[str, dict[str, float]]] = {
    "hiragana_food": {
        "0:い": {
            "size": 25,
            "stretch": 0.88,
            "gap": 3
        },
        "0:え": {
            "size": 34,
            "stretch": 1.2,
            "gap": 3
        },
        "0:か": {
            "size": 25,
            "stretch": 1.12,
            "gap": 3
        },
        "0:さ": {
            "size": 25,
            "stretch": 1.08,
            "gap": 3
        },
        "0:し": {
            "size": 25,
            "stretch": 0.8,
            "gap": 3
        },
        "1:ぐ": {
            "size": 25,
            "stretch": 1.12,
            "gap": 6
        },
        "1:つ": {
            "size": 25,
            "stretch": 0.92,
            "gap": 3
        },
        "1:ゃ": {
            "size": 30,
            "stretch": 1.2,
            "gap": 3
        },
        "1:ら": {
            "size": 25,
            "stretch": 1.12,
            "gap": 3
        },
        "1:わ": {
            "size": 25,
            "stretch": 0.8,
            "gap": 3
        },
        "2:お": {
            "size": 25,
            "stretch": 0.84,
            "gap": 3
        },
        "2:こ": {
            "size": 34,
            "stretch": 1.2,
            "gap": 3
        },
        "2:し": {
            "size": 25,
            "stretch": 0.8,
            "gap": 3
        },
        "2:ま": {
            "size": 25,
            "stretch": 0.8,
            "gap": 3
        }
    },
    "hiragana_verb": {
        "0:あ": {
            "size": 25,
            "stretch": 0.8,
            "gap": 3
        },
        "0:い": {
            "size": 34,
            "stretch": 1.2,
            "gap": 3
        },
        "0:う": {
            "size": 25,
            "stretch": 1.2,
            "gap": 3
        },
        "0:お": {
            "size": 25,
            "stretch": 0.84,
            "gap": 3
        },
        "0:ね": {
            "size": 32,
            "stretch": 1.16,
            "gap": 3
        },
        "1:き": {
            "size": 25,
            "stretch": 0.92,
            "gap": 3
        },
        "1:そ": {
            "size": 25,
            "stretch": 0.8,
            "gap": 3
        },
        "1:た": {
            "size": 34,
            "stretch": 1.2,
            "gap": 3
        },
        "1:な": {
            "size": 25,
            "stretch": 0.96,
            "gap": 3
        },
        "1:よ": {
            "size": 25,
            "stretch": 0.8,
            "gap": 3
        },
        "1:る": {
            "size": 27,
            "stretch": 1.2,
            "gap": 3
        },
        "2:う": {
            "size": 25,
            "stretch": 0.8,
            "gap": 3
        },
        "2:ぐ": {
            "size": 25,
            "stretch": 0.8,
            "gap": 3
        },
        "2:す": {
            "size": 25,
            "stretch": 0.8,
            "gap": 3
        },
        "2:ぶ": {
            "size": 25,
            "stretch": 1.12,
            "gap": 6
        },
        "2:む": {
            "size": 29,
            "stretch": 1.2,
            "gap": 3
        }
    },
    "katakana_animal": {
        "0:イ": {
            "size": 32,
            "stretch": 1.2,
            "gap": 3
        },
        "0:ウ": {
            "size": 25,
            "stretch": 0.8,
            "gap": 3
        },
        "0:キ": {
            "size": 25,
            "stretch": 0.92,
            "gap": 3
        },
        "0:サ": {
            "size": 30,
            "stretch": 1.2,
            "gap": 3
        },
        "0:ト": {
            "size": 25,
            "stretch": 0.8,
            "gap": 3
        },
        "0:ナ": {
            "size": 25,
            "stretch": 1.12,
            "gap": 3
        },
        "1:イ": {
            "size": 27,
            "stretch": 1.16,
            "gap": 3
        },
        "1:サ": {
            "size": 31,
            "stretch": 1.2,
            "gap": 3
        },
        "1:マ": {
            "size": 34,
            "stretch": 1.2,
            "gap": 3
        },
        "1:ン": {
            "size": 27,
            "stretch": 1.16,
            "gap": 3
        },
        "2:キ": {
            "size": 25,
            "stretch": 0.92,
            "gap": 3
        },
        "2:ギ": {
            "size": 25,
            "stretch": 0.8,
            "gap": 6
        },
        "2:ゲ": {
            "size": 25,
            "stretch": 0.88,
            "gap": 6
        },
        "2:コ": {
            "size": 25,
            "stretch": 0.8,
            "gap": 3
        }
    },
    "security": {
        "0:シ": {
            "size": 25,
            "stretch": 0.8,
            "gap": 3
        },
        "0:ス": {
            "size": 27,
            "stretch": 1.16,
            "gap": 3
        },
        "0:ソ": {
            "size": 25,
            "stretch": 1.08,
            "gap": 3
        },
        "0:ダ": {
            "size": 29,
            "stretch": 1.2,
            "gap": 6
        },
        "0:ハ": {
            "size": 31,
            "stretch": 1.16,
            "gap": 3
        },
        "1:ェ": {
            "size": 25,
            "stretch": 0.8,
            "gap": 3
        },
        "1:グ": {
            "size": 25,
            "stretch": 1.0,
            "gap": 6
        },
        "1:ッ": {
            "size": 25,
            "stretch": 1.08,
            "gap": 3
        },
        "1:パ": {
            "size": 25,
            "stretch": 1.16,
            "gap": 6
        },
        "1:ル": {
            "size": 34,
            "stretch": 1.16,
            "gap": 3
        },
        "2:イ": {
            "size": 25,
            "stretch": 0.88,
            "gap": 3
        },
        "2:ク": {
            "size": 25,
            "stretch": 0.8,
            "gap": 3
        },
        "2:ト": {
            "size": 25,
            "stretch": 0.8,
            "gap": 3
        },
        "2:プ": {
            "size": 25,
            "stretch": 0.96,
            "gap": 6
        },
        "2:ム": {
            "size": 32,
            "stretch": 1.2,
            "gap": 3
        }
    },
    "yasai": {
        "0:オ": {
            "size": 25,
            "stretch": 0.92,
            "gap": 3
        },
        "0:セ": {
            "size": 32,
            "stretch": 1.16,
            "gap": 3
        },
        "0:ナ": {
            "size": 25,
            "stretch": 0.8,
            "gap": 3
        },
        "0:モ": {
            "size": 25,
            "stretch": 1.08,
            "gap": 3
        },
        "0:ラ": {
            "size": 25,
            "stretch": 1.2,
            "gap": 3
        },
        "0:レ": {
            "size": 25,
            "stretch": 0.8,
            "gap": 3
        },
        "1:イ": {
            "size": 25,
            "stretch": 0.8,
            "gap": 3
        },
        "1:ク": {
            "size": 25,
            "stretch": 0.8,
            "gap": 3
        },
        "1:ス": {
            "size": 31,
            "stretch": 1.2,
            "gap": 3
        },
        "1:タ": {
            "size": 27,
            "stretch": 1.2,
            "gap": 3
        },
        "1:ヤ": {
            "size": 34,
            "stretch": 1.2,
            "gap": 3
        },
        "1:ラ": {
            "size": 25,
            "stretch": 1.2,
            "gap": 3
        },
        "1:ロ": {
            "size": 25,
            "stretch": 1.12,
            "gap": 3
        },
        "2:シ": {
            "size": 25,
            "stretch": 0.96,
            "gap": 3
        },
        "2:ス": {
            "size": 25,
            "stretch": 1.2,
            "gap": 3
        },
        "2:チ": {
            "size": 31,
            "stretch": 1.2,
            "gap": 3
        },
        "2:ム": {
            "size": 25,
            "stretch": 1.2,
            "gap": 3
        },
        "2:ラ": {
            "size": 25,
            "stretch": 0.8,
            "gap": 3
        },
        "2:リ": {
            "size": 25,
            "stretch": 0.8,
            "gap": 3
        }
    }
}


def _rim_color(scale: float) -> tuple[int, int, int, int]:
    """縁の灰。明るさだけ動かす。白と灰の2値構造は保つ（tintで色が乗る前提）。"""
    r, g, b, _ = RIM
    f = lambda v: max(70, min(180, round(v * scale)))  # 下げ過ぎると縁が黒に沈んで浮く
    return (f(r), f(g), f(b), 255)


# ---------------------------------------------------------------- 字面を焼く

def _raster(ch: str, px: int) -> Image.Image:
    """1文字を大きく焼いて切り出す。返すのは SS 倍のままの濃淡。"""
    big = px * SS
    pad = big
    probe = Image.new("L", (big * 3 + pad * 2, big * 3 + pad * 2), 0)
    ImageDraw.Draw(probe).text((pad, pad), ch, font=ImageFont.truetype(FONT, big), fill=255)
    return probe.crop(probe.getbbox())


def _shrink(img: Image.Image, w: int, h: int) -> list[list[int]]:
    """SS倍の濃淡をドットに落とす。横と縦で別の倍率をかけられる。"""
    small = img.resize((max(1, w), max(1, h)), Image.LANCZOS)
    return [[1 if small.getpixel((x, y)) > 118 else 0 for x in range(small.width)]
            for y in range(small.height)]


def _trim(m: list[list[int]]) -> list[list[int]]:
    rows = [y for y, r in enumerate(m) if any(r)]
    cols = [x for x in range(len(m[0])) if any(r[x] for r in m)]
    if not rows or not cols:
        return [[0]]
    return [[m[y][x] for x in range(cols[0], cols[-1] + 1)] for y in range(rows[0], rows[-1] + 1)]


def _paste(dst: list[list[int]], src: list[list[int]], ox: int, oy: int) -> None:
    for y, row in enumerate(src):
        for x, v in enumerate(row):
            if v and 0 <= oy + y < len(dst) and 0 <= ox + x < len(dst[0]):
                dst[oy + y][ox + x] = 1


# ------------------------------------------------------------ 濁点・半濁点

# 濁点は**縦棒2本**、半濁点は**四角い輪**。フォントの点と丸は、回転して縦に流れると
# どちらも「上に何かある」だけになって区別が付かない。棒2本には列の隙間があり、
# 四角い輪には無いので、列被覆の段階で別物になる。
DAKUTEN = [
    "##..##",
    "##..##",
    "##..##",
    ".##..##",
    ".##..##",
    ".##..##",
    ".##..##",
]
HANDAKUTEN = [
    "#######",
    "#######",
    "##...##",
    "##...##",
    "##...##",
    "#######",
    "#######",
]


def _mark(art: list[str]) -> list[list[int]]:
    w = max(len(r) for r in art)
    return [[1 if i < len(row) and row[i] == "#" else 0 for i in range(w)] for row in art]


def _mask(ch: str, size: int, stretch: float, gap: int = 3) -> list[list[int]]:
    """字面のドットマップ。濁点付きは、素の字と手描きの印を組み立てる。"""
    parts = unicodedata.normalize("NFD", ch)
    base_ch, combining = (parts[0], parts[1]) if len(parts) > 1 else (ch, "")

    img = _raster(base_ch, size)
    h = max(1, round(img.height / SS))
    w = max(1, round(img.width / SS * stretch))
    m = _trim(_shrink(img, w, h))

    if not combining:
        return _fit(m)

    art = _mark(DAKUTEN if combining == "゙" else HANDAKUTEN)
    mw, mh = len(art[0]), len(art)
    # gap は字面と印の間。離すほど字が横に広がるので、見分けの調整にも使う
    out = [[0] * (len(m[0]) + gap + mw) for _ in range(max(len(m), mh))]
    _paste(out, m, 0, len(out) - len(m))
    _paste(out, art, len(m[0]) + gap, 0)
    return _fit(_trim(out))


def _fit(m: list[list[int]]) -> list[list[int]]:
    """枠に収まらなければ縮める。縁の2ドットまで含めてセルに入るようにする。"""
    if len(m[0]) <= MASK_W and len(m) <= MASK_H:
        return m
    k = min(MASK_W / len(m[0]), MASK_H / len(m))
    w, h = max(1, int(len(m[0]) * k)), max(1, int(len(m) * k))
    img = Image.new("L", (len(m[0]), len(m)), 0)
    p = img.load()
    for y, row in enumerate(m):
        for x, v in enumerate(row):
            if v:
                p[x, y] = 255
    small = img.resize((w, h), Image.LANCZOS)
    return _trim([[1 if small.getpixel((x, y)) > 100 else 0 for x in range(w)] for y in range(h)])


def grow(m: list[list[int]]) -> list[list[int]]:
    h, w = len(m), len(m[0])
    out = [[0] * w for _ in range(h)]
    for y in range(h):
        for x in range(w):
            if m[y][x]:
                out[y][x] = 1
                continue
            for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                if 0 <= y + dy < h and 0 <= x + dx < w and m[y + dy][x + dx]:
                    out[y][x] = 1
                    break
    return out


_TIER_CACHE: dict[str, dict[tuple[int, str], str]] = {}


def tier_of(chapter: str, reel: int, ch: str) -> str:
    """その文字が**そのリールで**どの強さの役に属するか。

    同じ文字でもリールによって役割が変わる（寿司島の「し」は左でしゃけ＝ボーナス、
    右でいわし＝小役）。だから字はリールごとに持つ。
    """
    if chapter not in _TIER_CACHE:
        d = json.loads((DATA / "yaku" / f"{chapter}.json").read_text())
        m: dict[tuple[int, str], str] = {}
        for key, tier in (("premiumYaku", "bonus"), ("bonusYaku", "bonus"),
                          ("coreYaku", "core"), ("cherryYaku", "core"),
                          ("singleYaku", "filler")):
            for y in d.get(key, []):
                for r, s in enumerate(y["symbols"]):
                    m.setdefault((r, s), tier)
        _TIER_CACHE[chapter] = m
    return _TIER_CACHE[chapter].get((reel, ch), "filler")


def glyph(ch: str, chapter: str = "", reel: int = 0) -> Image.Image:
    """透過の上に白い字面＋2ドットの縁。色は表示側の tint で付く。"""
    # 作り分けは**リール別**に引く（同じ文字でもリールで役の強さ＝大きさが変わるため）。
    # リール別の指定が無ければ文字単位の指定に落ちる
    per = TUNE.get(chapter, {})
    t = per.get(f"{reel}:{ch}", per.get(ch, {}))
    size = int(round(float(t.get("size", GLYPH_PX))
                     * TIER_SCALE[tier_of(chapter, reel, ch)]))
    m = _mask(ch, size, float(t.get("stretch", 1.0)), int(t.get("gap", 3)))
    o = grow(grow(m))
    rim = _rim_color(float(t.get("rim", 1.0)))

    img = Image.new("RGBA", (CW, CH), (0, 0, 0, 0))
    p = img.load()
    oy = (CH - len(m)) // 2
    ox = (CW - len(m[0])) // 2 + int(t.get("dx", 0))
    ox = max(2, min(CW - 2 - len(m[0]), ox))
    for y in range(len(o)):
        for x in range(len(o[0])):
            X, Y = ox + x - 2, oy + y - 2
            if 0 <= X < CW and 0 <= Y < CH and o[y][x]:
                p[X, Y] = rim
    for y in range(len(m)):
        for x in range(len(m[0])):
            X, Y = ox + x, oy + y
            if 0 <= X < CW and 0 <= Y < CH and m[y][x]:
                p[X, Y] = PAPER
    return img


def chars_of(chapter: str) -> list[str]:
    reels = json.loads((DATA / "reels" / f"{chapter}.json").read_text())["reels"]
    seen: list[str] = []
    for r in reels:
        for c in r["cells"]:
            if c not in seen:
                seen.append(c)
    return seen


def name_of(reel: int, ch: str) -> str:
    """ファイル名は**リール番号＋コードポイント**。

    日本語のままだとURLエンコードの差で事故るのでコードポイントにする。リール番号が
    付くのは、同じ文字でもリールによって役の強さが変わり大きさが違うため。
    """
    return f"r{reel}_u" + "-".join(f"{ord(c):04x}" for c in ch)


def sheet(chapter: str, scale: int) -> Image.Image:
    """1島ぶんを並べる。リールの並びが分かるよう、行をリールごとに分ける。"""
    reels = json.loads((DATA / "reels" / f"{chapter}.json").read_text())["reels"]
    rows = [sorted(set(r["cells"])) for r in reels]
    cols = max(len(r) for r in rows)
    w, h = CW * scale + 6, CH * scale + 6
    img = Image.new("RGBA", (cols * w, len(rows) * h), (24, 20, 32, 255))
    for j, row in enumerate(rows):
        for i, ch in enumerate(row):
            cell = Image.new("RGBA", (CW, CH), (0, 0, 0, 0))
            cell.alpha_composite(glyph(ch, chapter, j))
            r = cell.resize((CW * scale, CH * scale), Image.NEAREST)
            img.paste(r, (i * w, j * h), r)
    return img


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--preview", action="store_true")
    ap.add_argument("--out", default=str(OUT))
    args = ap.parse_args()

    out = pathlib.Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    total = 0
    for chapter in CHAPTERS:
        d = out / chapter
        d.mkdir(exist_ok=True)
        reels = json.loads((DATA / "reels" / f"{chapter}.json").read_text())["reels"]
        n = 0
        for reel, r in enumerate(reels):
            for ch in sorted(set(r["cells"])):
                glyph(ch, chapter, reel).save(d / f"{name_of(reel, ch)}.png")
                n += 1
        total += n
        print(f"{chapter}: {n}枚（リール別）")
    size = sum(f.stat().st_size for f in out.rglob("*.png"))
    print(f"計 {total}枚  {size / 1024:.0f}KB")

    if args.preview:
        for sc in (3, 6):
            parts = [sheet(c, sc) for c in CHAPTERS]
            board = Image.new(
                "RGBA",
                (max(p.width for p in parts), sum(p.height + 12 for p in parts)),
                (24, 20, 32, 255),
            )
            y = 0
            for p in parts:
                board.paste(p, (0, y))
                y += p.height + 12
            path = pathlib.Path(f"/tmp/glyphs_preview_x{sc}.png")
            board.save(path)
            print(f"preview: {path}（tintなし・実寸{sc}倍）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
