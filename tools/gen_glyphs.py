#!/usr/bin/env python3
"""リールのドット文字を作る（v2・2026-10-02）。

**生成画像は全廃した。** 役ごとの一枚絵は5島中4島が古い役のまま残り（寿司島は7枚とも
不一致）、外部の画像生成に投げ直さないと直せないので誰も直さなかった。加えて絵で
セルを見分けられると「文字を読んで押す」というコンセプトが崩れるため、絵柄と文字の
切り替え設定ごと廃止する。リールは**ドット文字だけ**になる。

## v2 で変えたこと

- **島ごとに書体を変える**（`FONTS`）。寿司は見出し明朝、動物は丸ゴシック、動詞は
  ヒラギノの極太、八百屋は手書き風（Klee）、セキュリティは端末の等幅（Osaka Mono）。
  細い書体は字面を太らせる（`BOLD`）。回転中は線の太さしか残らないため
- **ドットを細かくした。** セル 130x100 を **65x50 ドット**（2倍）で作る。v1 は 44x34（3倍）
- **実機の図柄のような立体。** 黒い縁・落ち影・上から下への陰り・右下の面取り
- **役の格で飾りを変える。** ボーナスは金の外輪と強い艶、小役は弱い艶、それ以外は艶なし

## 2枚で1文字

色は表示側で Pixi の tint（乗算）で付ける。役ごとの色は TypeScript 側の
`SymbolColorResolver` が持っているので、色の決め方を Python へ写さない（写すと必ずずれる）。

乗算では白い艶や金の輪が出せない（白は役色に、金は役色との積に化ける）。そこで

- `r{n}_u{cp}.png`   … **地**。灰の濃淡で、tint で役色に染まる。影の黒は黒のまま残る
- `r{n}_u{cp}_g.png` … **艶**。白の艶と金の輪。tint せずに地の上へ重ねる

の2枚に分ける。艶が無い文字（その他の文字）も空の艶を書き出す（読み込み側を分岐させない）。

    python3 tools/gen_glyphs.py            # public/art/glyphs/ へ書き出す
    python3 tools/gen_glyphs.py --preview  # /tmp に実寸プレビュー（全島・2倍と4倍・役色は仮）


## 回転中の見分けと TUNE

リールは縦に流れるので、回っている間に残るのは**列ごとの被覆**だけである。行の情報は
smear で消える。つまり「横棒の位置が違う」「内側に一画多い」といった違いは回転中は
効かず、**字面の横幅と、横方向のどこにインクがあるか**しか手掛かりが無い。

素のフォントを同じ大きさで焼くと同じリールに載る文字の横幅が揃い、列被覆が完全一致する
組が出る。そこで文字ごとに

- size    … フォントの大きさ（65x50 ドットでの字の高さ）。縦横とも変わる
- stretch … 横だけの伸縮
- gap     … 濁点・半濁点と字面の間。離すほど横に広がる

を持たせ、同じリールに載る文字どうしの列被覆が重ならないように割り当てる。値は
`tools/tune_glyphs.py --search` の貪欲探索が出したものを転記してある。手で直してよいが、
直したら `python3 tools/tune_glyphs.py --measure` で数字が悪化していないか見ること。
**書体を変えたら探索をやり直す**（列被覆は書体で変わる）。

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

_ASSETS = pathlib.Path("/System/Library/AssetsV2/com_apple_MobileAsset_Font8")


def _asset(name: str) -> str:
    """macOS のダウンロード書体。初回は Font Book で入手しておく必要がある。"""
    hit = next(_ASSETS.glob(f"*/AssetData/{name}"), None)
    if hit is None:
        raise SystemExit(f"書体 {name} がありません（Font Book でダウンロードしてください）")
    return str(hit)


# 島ごとの書体。(パス, ttc の番号)。島の看板の絵と同じ空気に寄せる。
FONTS: dict[str, tuple[str, int]] = {
    "hiragana_food": (_asset("ToppanBunkyuMidashiMinchoStdN-ExtraBold.otf"), 0),
    "katakana_animal": (_asset("TsukushiBMaruGothic.ttc"), 1),
    "hiragana_verb": ("/System/Library/Fonts/ヒラギノ角ゴシック W8.ttc", 0),
    "yasai": (_asset("Klee.ttc"), 0),
    "security": (_asset("OsakaMono.ttf"), 0),
}
# 細い書体は字面を太らせる回数（1回で縦横に1ドットずつ）。
BOLD = {"hiragana_food": 1, "katakana_animal": 0, "hiragana_verb": 0, "yasai": 2, "security": 1}

CW, CH = 65, 50      # セルのドット数（130x100 のセルへ2倍）
GLYPH_PX = 45        # 文字の既定の高さ
PAD = 5              # 字面の外に取る余白。縁2＋金の輪2＋影1
MASK_W = CW - 2 * PAD - 2
MASK_H = CH - 2 * PAD
SS = 4               # ラスタライズの上げ幅。横だけ伸縮するので一度大きく焼いてから縮める
MARK_K = 1.5         # 手描きの濁点・半濁点の拡大率（v1 の 44x34 で描いたもの）

# 役の強さごとの大きさ。**ボーナスの文字ははっきり大きく**（2026-10-02 ユーザー指定）。
# 金の輪と合わせて、狙う図柄が一目で分かるようにする。上限は _fit（MASK_H）で決まるので、
# ボーナスが枠いっぱいに届くよう他を小さめに置いて差を作る。
TIER_SCALE = {"bonus": 1.2, "core": 0.88, "filler": 0.78}
# 格ごとの字面の上限（幅, 高さ）。大きさの倍率だけだと、探索が小役を大きく選んだ時に
# ボーナスと並んでしまう。上限で頭を押さえて、ボーナスだけが枠いっぱいに届くようにする。
LIMITS = {"bonus": (MASK_W, MASK_H), "core": (MASK_W - 6, 33), "filler": (MASK_W - 10, 29)}

CHAPTERS = [
    "hiragana_food",
    "hiragana_verb",
    "katakana_animal",
    "security",
    "yasai",
]

# いま焼いている島。書体と太らせる回数はこれで決まる（`use_chapter`）。
_chapter = "hiragana_verb"


def use_chapter(chapter: str) -> None:
    """以降の字面をその島の書体で焼く。tune_glyphs も島ごとにこれを呼ぶ。"""
    global _chapter
    _chapter = chapter

# 文字ごとの作り分け。キーは **"リール番号:文字"**。同じ文字でもリールで役の強さ
# （＝大きさ）が変わるので、リールごとに持つ。値は `tools/tune_glyphs.py` の貪欲探索が
# 出したもの。
TUNE: dict[str, dict[str, dict[str, float]]] = {
    "hiragana_food": {
        "0:い": {"size": 47, "stretch": 1.16},
        "0:え": {"stretch": 1.08},
        "0:か": {"stretch": 1.08},
        "0:さ": {"size": 43, "stretch": 0.84},
        "0:し": {"stretch": 0.84},
        "0:た": {"size": 49, "stretch": 1.16},
        "0:ま": {"stretch": 0.84},
        "1:ぐ": {"stretch": 0.92, "gap": 8},
        "1:び": {"gap": 8},
        "1:ゃ": {"size": 49, "stretch": 1.16},
        "1:ら": {"stretch": 1.08},
        "1:わ": {"stretch": 0.84},
        "1:ん": {"stretch": 0.92},
        "2:け": {"stretch": 1.16},
        "2:こ": {"stretch": 1.08},
        "2:し": {"size": 47},
        "2:ま": {"stretch": 0.84},
    },
    "hiragana_verb": {
        "0:あ": {"size": 39, "stretch": 0.84},
        "0:い": {"stretch": 1.16},
        "0:う": {"stretch": 0.84},
        "0:お": {"stretch": 0.84},
        "0:ね": {"stretch": 1.16},
        "0:は": {"stretch": 1.08},
        "0:や": {"stretch": 1.16},
        "1:き": {"stretch": 1.16},
        "1:す": {"size": 47, "stretch": 1.16},
        "1:そ": {"stretch": 0.84},
        "1:た": {"stretch": 0.92},
        "1:な": {"stretch": 1.08},
        "1:よ": {"stretch": 0.84},
        "1:る": {"stretch": 1.08},
        "2:う": {"stretch": 0.84},
        "2:ぐ": {"size": 41, "gap": 8},
        "2:す": {"stretch": 0.92},
        "2:ぶ": {"gap": 8},
        "2:む": {"stretch": 1.08},
        "2:る": {"stretch": 0.92},
    },
    "katakana_animal": {
        "0:イ": {"stretch": 1.08},
        "0:ウ": {"size": 41, "stretch": 0.84},
        "0:タ": {"stretch": 0.84},
        "0:ナ": {"stretch": 1.16},
        "1:イ": {"size": 41, "stretch": 0.84},
        "1:カ": {"size": 43, "stretch": 0.84},
        "1:マ": {"size": 49, "stretch": 1.16},
        "1:リ": {"stretch": 0.84},
        "1:ン": {"stretch": 1.08},
        "2:キ": {"stretch": 0.92},
        "2:ギ": {"stretch": 0.92, "gap": 8},
        "2:ゲ": {"gap": 8},
        "2:コ": {"stretch": 1.16},
        "2:ズ": {"gap": 8},
        "2:ン": {"stretch": 1.08},
    },
    "security": {
        "0:シ": {"size": 47, "stretch": 0.84},
        "0:ス": {"size": 49, "stretch": 1.16},
        "0:ソ": {"size": 39, "stretch": 0.84},
        "0:ダ": {"size": 43, "stretch": 0.92, "gap": 8},
        "0:ハ": {"stretch": 1.08},
        "0:バ": {"gap": 8},
        "0:ワ": {"size": 47},
        "1:ェ": {"size": 43, "stretch": 0.92},
        "1:グ": {"size": 41, "stretch": 0.84, "gap": 8},
        "1:ッ": {"size": 41, "stretch": 0.84},
        "1:パ": {"stretch": 0.92, "gap": 8},
        "1:ー": {"stretch": 1.08},
        "2:イ": {"stretch": 0.84},
        "2:ク": {"stretch": 0.84},
        "2:ト": {"stretch": 0.84},
        "2:プ": {"size": 43, "gap": 8},
        "2:ム": {"stretch": 1.08},
    },
    "yasai": {
        "0:オ": {"stretch": 0.84},
        "0:セ": {"size": 43},
        "0:ナ": {"stretch": 0.84},
        "0:プ": {"gap": 8},
        "0:モ": {"size": 49, "stretch": 1.16},
        "0:ラ": {"stretch": 1.08},
        "0:レ": {"size": 41, "stretch": 0.84},
        "1:ス": {"size": 49, "stretch": 1.16},
        "1:タ": {"size": 41, "stretch": 0.84},
        "1:ヤ": {"stretch": 0.92},
        "1:ラ": {"stretch": 1.08},
        "1:ロ": {"size": 43, "stretch": 0.84},
        "2:シ": {"size": 39, "stretch": 0.84},
        "2:ス": {"size": 47, "stretch": 1.16},
        "2:チ": {"stretch": 1.16},
        "2:ム": {"stretch": 1.16},
        "2:ラ": {"stretch": 1.16},
    },
}


# ---------------------------------------------------------------- 字面を焼く

def _raster(ch: str, px: int) -> Image.Image:
    """1文字を大きく焼いて切り出す。返すのは SS 倍のままの濃淡。"""
    path, index = FONTS[_chapter]
    big = px * SS
    pad = big
    probe = Image.new("L", (big * 3 + pad * 2, big * 3 + pad * 2), 0)
    font = ImageFont.truetype(path, big, index=index)
    ImageDraw.Draw(probe).text((pad, pad), ch, font=font, fill=255)
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
    """手描きの印を MARK_K 倍に起こす（最近傍。棒と輪の形を崩さない）。"""
    w = max(len(r) for r in art)
    src = [[1 if i < len(row) and row[i] == "#" else 0 for i in range(w)] for row in art]
    W, H = round(w * MARK_K), round(len(art) * MARK_K)
    return [[src[int(y / MARK_K)][int(x / MARK_K)] for x in range(W)] for y in range(H)]


def _mask(ch: str, size: int, stretch: float, gap: int = 4, tier: str = "bonus") -> list[list[int]]:
    """字面のドットマップ。濁点付きは、素の字と手描きの印を組み立てる。"""
    parts = unicodedata.normalize("NFD", ch)
    base_ch, combining = (parts[0], parts[1]) if len(parts) > 1 else (ch, "")

    img = _raster(base_ch, size)
    h = max(1, round(img.height / SS))
    w = max(1, round(img.width / SS * stretch))
    m = _trim(_shrink(img, w, h))
    # 細い書体は太らせる。回転中は線の太さしか残らない
    for _ in range(BOLD[_chapter]):
        m = _trim(grow(_pad(m, 1)))

    if not combining:
        return _fit(m, tier)

    art = _mark(DAKUTEN if combining == "゙" else HANDAKUTEN)
    mw, mh = len(art[0]), len(art)
    # gap は字面と印の間。離すほど字が横に広がるので、見分けの調整にも使う
    out = [[0] * (len(m[0]) + gap + mw) for _ in range(max(len(m), mh))]
    _paste(out, m, 0, len(out) - len(m))
    _paste(out, art, len(m[0]) + gap, 0)
    return _fit(_trim(out), tier)


def _fit(m: list[list[int]], tier: str = "bonus") -> list[list[int]]:
    """格の上限に収まらなければ縮める（`LIMITS`）。ボーナスの上限は縁と金の輪まで含めて
    セルに入る大きさ。"""
    lw, lh = LIMITS[tier]
    if len(m[0]) <= lw and len(m) <= lh:
        return m
    k = min(lw / len(m[0]), lh / len(m))
    w, h = max(1, int(len(m[0]) * k)), max(1, int(len(m) * k))
    img = Image.new("L", (len(m[0]), len(m)), 0)
    p = img.load()
    for y, row in enumerate(m):
        for x, v in enumerate(row):
            if v:
                p[x, y] = 255
    small = img.resize((w, h), Image.LANCZOS)
    return _trim([[1 if small.getpixel((x, y)) > 100 else 0 for x in range(w)] for y in range(h)])


def _pad(m: list[list[int]], p: int) -> list[list[int]]:
    w = len(m[0]) + 2 * p
    return ([[0] * w for _ in range(p)] + [[0] * p + r + [0] * p for r in m]
            + [[0] * w for _ in range(p)])


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


def face_of(ch: str, chapter: str, reel: int) -> list[list[int]]:
    """TUNE と役の格を当てた字面（余白なし）。tune_glyphs の測定もこれを通す。"""
    use_chapter(chapter)
    per = TUNE.get(chapter, {})
    t = per.get(f"{reel}:{ch}", per.get(ch, {}))
    tier = tier_of(chapter, reel, ch)
    size = int(round(float(t.get("size", GLYPH_PX)) * TIER_SCALE[tier]))
    return _mask(ch, size, float(t.get("stretch", 1.0)), int(t.get("gap", 4)), tier)


# ---------------------------------------------------------------- 立体に塗る

# 地（tint される）の濃淡。白は役色そのもの、灰はその暗い版になる。
EDGE = (30, 26, 38, 255)      # 外の縁。ほぼ黒（役色を掛けても黒に近いまま）
RIM = (112, 106, 124, 255)    # 内の縁。役色の暗い版
SHADOW = (0, 0, 0, 170)       # 落ち影。黒は tint しても黒
# 艶（tint しない）。
GLOSS_A = {"bonus": 150, "core": 95, "filler": 0}
RIDGE_A = {"bonus": 130, "core": 110, "filler": 0}
GOLD_HI, GOLD_MID, GOLD_LO = (255, 236, 150), (232, 176, 52), (176, 116, 20)
GOLD_EDGE = (70, 40, 6, 255)


def glyph(ch: str, chapter: str = "hiragana_verb", reel: int = 0) -> tuple[Image.Image, Image.Image]:
    """(地, 艶) の2枚を返す。地は tint で役色に、艶はそのまま重ねる。"""
    tier = tier_of(chapter, reel, ch)
    m = _pad(face_of(ch, chapter, reel), PAD)
    o1 = grow(m)
    o2 = grow(o1)
    g1 = grow(o2)
    g2 = grow(g1)
    h, w = len(m), len(m[0])
    rows = [y for y in range(h) if any(m[y])]
    top, bot = rows[0], rows[-1]
    span = max(1, bot - top)

    base = Image.new("RGBA", (CW, CH), (0, 0, 0, 0))
    gloss = Image.new("RGBA", (CW, CH), (0, 0, 0, 0))
    bp, gp = base.load(), gloss.load()
    ox, oy = (CW - w) // 2, (CH - h) // 2

    def put(px, x: int, y: int, c: tuple[int, int, int, int]) -> None:
        X, Y = ox + x, oy + y
        if 0 <= X < CW and 0 <= Y < CH:
            px[X, Y] = c

    outer = g2 if tier == "bonus" else o2
    for y in range(h):
        for x in range(w):
            if outer[y][x]:
                put(bp, x + 1, y + 2, SHADOW)
    if tier == "bonus":
        # 金の輪。上が明るく下が焦げる。外側に焦げ茶の線
        for y in range(h):
            for x in range(w):
                if g2[y][x] and not g1[y][x]:
                    put(gp, x, y, GOLD_EDGE)
                elif g1[y][x] and not o2[y][x]:
                    gy = (y - top) / span
                    c = GOLD_HI if gy < 0.35 else GOLD_MID if gy < 0.7 else GOLD_LO
                    put(gp, x, y, c + (255,))
    for y in range(h):
        for x in range(w):
            if o2[y][x] and not o1[y][x]:
                put(bp, x, y, EDGE)
            elif o1[y][x] and not m[y][x]:
                put(bp, x, y, RIM)
    for y in range(h):
        for x in range(w):
            if not m[y][x]:
                continue
            gy = (y - top) / span
            v = 255 - int(70 * gy)                       # 上が明るく下へ沈む
            up = y > 0 and m[y - 1][x]
            lf = x > 0 and m[y][x - 1]
            dn = y + 1 < h and m[y + 1][x]
            rt = x + 1 < w and m[y][x + 1]
            if not dn or not rt:
                v = int(v * 0.68)                        # 右下の面取り
            put(bp, x, y, (v, v, v, 255))
            if up and lf and dn and rt and gy < 0.42 and GLOSS_A[tier]:
                put(gp, x, y, (255, 255, 255, GLOSS_A[tier]))   # 上側の艶
            elif (not up or not lf) and RIDGE_A[tier]:
                put(gp, x, y, (255, 255, 255, RIDGE_A[tier]))   # 左上の稜線
    return base, gloss


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
    艶は同じ名前に `_g` を付ける。
    """
    return f"r{reel}_u" + "-".join(f"{ord(c):04x}" for c in ch)


# プレビューの仮の役色（本物は SymbolColorResolver）。格ごとに順に回す。
_PREVIEW = {
    "bonus": [(235, 60, 60), (70, 140, 255)],
    "core": [(255, 150, 40), (80, 200, 120), (180, 110, 255), (60, 200, 220)],
    "filler": [(150, 150, 160)],
}


def _tint(img: Image.Image, rgb: tuple[int, int, int]) -> Image.Image:
    out = img.copy()
    p = out.load()
    for y in range(out.height):
        for x in range(out.width):
            R, G, B, A = p[x, y]
            p[x, y] = (R * rgb[0] // 255, G * rgb[1] // 255, B * rgb[2] // 255, A)
    return out


def sheet(chapter: str, scale: int) -> Image.Image:
    """1島ぶんを並べる。行がリール。役色は仮の色で塗る。"""
    reels = json.loads((DATA / "reels" / f"{chapter}.json").read_text())["reels"]
    rows = [sorted(set(r["cells"])) for r in reels]
    cols = max(len(r) for r in rows)
    w, h = CW * scale + 6, CH * scale + 6
    img = Image.new("RGBA", (cols * w, len(rows) * h), (14, 12, 20, 255))
    for j, row in enumerate(rows):
        used: dict[str, int] = {}
        for i, ch in enumerate(row):
            tier = tier_of(chapter, j, ch)
            pal = _PREVIEW[tier]
            col = pal[used.get(tier, 0) % len(pal)]
            used[tier] = used.get(tier, 0) + 1
            base, gloss = glyph(ch, chapter, j)
            cell = _tint(base, col)
            cell.alpha_composite(gloss)
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
        for old in d.glob("*.png"):
            old.unlink()
        reels = json.loads((DATA / "reels" / f"{chapter}.json").read_text())["reels"]
        n = 0
        for reel, r in enumerate(reels):
            for ch in sorted(set(r["cells"])):
                base, gloss = glyph(ch, chapter, reel)
                base.save(d / f"{name_of(reel, ch)}.png")
                gloss.save(d / f"{name_of(reel, ch)}_g.png")
                n += 1
        total += n
        print(f"{chapter}: {n}文字（リール別・地と艶の2枚ずつ）")
    size = sum(f.stat().st_size for f in out.rglob("*.png"))
    print(f"計 {total}文字  {size / 1024:.0f}KB")

    if args.preview:
        for sc in (2, 4):
            parts = [sheet(c, sc) for c in CHAPTERS]
            board = Image.new(
                "RGBA",
                (max(p.width for p in parts), sum(p.height + 12 for p in parts)),
                (14, 12, 20, 255),
            )
            y = 0
            for p in parts:
                board.paste(p, (0, y))
                y += p.height + 12
            path = pathlib.Path(f"/tmp/glyphs_preview_x{sc}.png")
            board.save(path)
            print(f"preview: {path}（役色は仮・実寸{sc}倍）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
