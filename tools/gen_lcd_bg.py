#!/usr/bin/env python3
"""演出液晶の背景（ドット絵・島ごとの情景）を生成する。

    python3 tools/gen_lcd_bg.py                 # 全島ぶん
    python3 tools/gen_lcd_bg.py security        # 1島だけ
    python3 tools/gen_lcd_bg.py --preview /tmp/bg.png security

出力は `public/art/lcdbg/<章ID>_<コマ>.png`（200×134・透過あり）。

## なぜ 200×134 か

液晶は 600×400 で、出題者のドット絵は**3倍**で置いてある。背景も同じ3倍グリッドに
乗せないと、1ドットの大きさが背景とキャラで食い違って濁る。400÷3 は割り切れないので
134行で作り、下2pxははみ出させる（背面なので見えない）。

## 情報を持たせない

これは**通常時に常に出ている背景**なので、ゲームの状態では一切変わらない。
レバーONで何かが始まると演出＝予告として読まれ、無演出のゲームが「何もない」で
なくなってしまう（[31] §3①）。コマ送りは一定の間隔で回り続けるだけにする。

そのため彩度と明度を落とし、**シルエットとして置く**。リールの文字とカットインが
主役で、これは空白を埋めるためだけに居る。
"""

from __future__ import annotations

import argparse
import pathlib
import sys

from PIL import Image

W, H = 200, 134
OUT = pathlib.Path(__file__).resolve().parent.parent / "public" / "art" / "lcdbg"

Grid = list[list[str]]

# Bayer 4×4 の閾値行列。階調を面で作るための定番で、縞に見えない
BAYER4 = [
    [0, 8, 2, 10],
    [12, 4, 14, 6],
    [3, 11, 1, 9],
    [15, 7, 13, 5],
]


def blank() -> Grid:
    """透過で埋めた1コマ。描かなかった所は既存の紫のグラデーションが透ける。"""
    return [["." for _ in range(W)] for _ in range(H)]


# ─── 描画の部品 ───

def rect(g: Grid, x0: int, y0: int, x1: int, y1: int, ch: str) -> None:
    """塗り潰した矩形（x1・y1 を含む）。"""
    for y in range(max(0, y0), min(H, y1 + 1)):
        for x in range(max(0, x0), min(W, x1 + 1)):
            g[y][x] = ch


def hline(g: Grid, y: int, x0: int, x1: int, ch: str) -> None:
    rect(g, x0, y, x1, y, ch)


def stamp(g: Grid, x: int, y: int, art: list[str]) -> None:
    """小さなタイルを置く。`.` の所は下を残す（重ね置きができる）。"""
    for dy, row in enumerate(art):
        for dx, c in enumerate(row):
            if c == ".":
                continue
            gy, gx = y + dy, x + dx
            if 0 <= gy < H and 0 <= gx < W:
                g[gy][gx] = c


def repeat(g: Grid, x: int, y: int, art: list[str], count: int, step: int) -> None:
    """タイルを横へ等間隔で並べる。背景はこれで作るのが基本。"""
    for i in range(count):
        stamp(g, x + i * step, y, art)


def circle(g: Grid, cx: int, cy: int, r: int, ch: str, shade: str | None = None) -> None:
    """塗り潰した円。木や月など、丸い塊は実寸では輪郭しか見えないので単色で置く。"""
    for y in range(-r, r + 1):
        for x in range(-r, r + 1):
            if x * x + y * y > r * r:
                continue
            gy, gx = cy + y, cx + x
            if 0 <= gy < H and 0 <= gx < W:
                g[gy][gx] = shade if (shade and (x + y) < -r // 2) else ch


def vline(g: Grid, x: int, y0: int, y1: int, ch: str) -> None:
    rect(g, x, y0, x, y1, ch)


def dither(g: Grid, y0: int, y1: int, ch: str, *, top: float, bottom: float) -> None:
    """縦方向の濃度勾配を市松で作る。

    ドット絵で階調を出す唯一の手段。滑らかなグラデーションを混ぜると、
    そこだけ様式が崩れて「絵が2種類ある」状態になる。
    """
    span = max(1, y1 - y0)
    for y in range(max(0, y0), min(H, y1 + 1)):
        t = (y - y0) / span
        density = top + (bottom - top) * t
        for x in range(W):
            # Bayer 4×4。自前の式で作ると**斜め縞**が出て、模様として目に付いた
            if BAYER4[y % 4][x % 4] / 16 < density:
                g[y][x] = ch


def to_image(g: Grid, colors: dict[str, str], scale: int = 1) -> Image.Image:
    pal = {".": (0, 0, 0, 0)}
    for ch, hexs in colors.items():
        pal[ch] = (
            int(hexs[0:2], 16), int(hexs[2:4], 16), int(hexs[4:6], 16),
            int(hexs[6:8], 16) if len(hexs) == 8 else 255,
        )
    img = Image.new("RGBA", (W, H))
    img.putdata([pal[g[y][x]] for y in range(H) for x in range(W)])
    return img if scale == 1 else img.resize((W * scale, H * scale), Image.NEAREST)


# ─── 島ごとの情景 ───
#
# 色は**液晶の地色（#2A1830）より少しだけ明るい**程度に留める。ここが目立つと
# リールの文字とカットインが負ける。alpha 付きで薄く重ねる。

FLOOR_Y = 102   # 床。ラックはここに接地させる（浮くと部屋に見えない）
RACK_TOP = 38
RACK_W = 22
RACK_XS = (2, 26, 50, 74, 98, 122, 146, 170)  # 幅200に8本

SECURITY_COLORS = {
    "R": "30304CC8",  # ラックの面
    "e": "45426AC8",  # 縁・棚板
    "c": "1E2438C0",  # 床
    "f": "2A3050C0",  # 床のパネル目地
    "d": "241C3A55",  # 天井の暗がり（**薄く**。濃いとディザの市松が模様として見える）
    "g": "5FE0A0FF",  # LED 緑（点灯）
    "a": "36624EE0",  # LED 緑（消灯）
    "y": "FFC65EFF",  # LED 橙（点灯）
}


def draw_rack(g: Grid, x: int) -> list[tuple[int, int]]:
    """サーバーラック1本。**床に接地**させ、LEDを置ける座標を返す。"""
    rect(g, x, RACK_TOP, x + RACK_W - 1, FLOOR_Y - 1, "R")
    hline(g, RACK_TOP, x, x + RACK_W - 1, "e")
    for y in range(RACK_TOP, FLOOR_Y):          # 左右の縁
        g[y][x] = "e"
        g[y][x + RACK_W - 1] = "e"
    slots = []
    for y in range(RACK_TOP + 5, FLOOR_Y - 2, 7):   # 棚板とその上のLED列
        hline(g, y, x + 1, x + RACK_W - 2, "e")
        for dx in (3, 6, 9):
            g[y - 2][x + dx] = "a"
            slots.append((x + dx, y - 2))
    return slots


def scene_security(frame: int) -> Grid:
    """サーバールーム。動くのは **LED だけ**——形が動くと目で追ってしまう。"""
    g = blank()
    dither(g, 0, RACK_TOP, "d", top=0.95, bottom=0.35)  # 天井の暗がり
    hline(g, 12, 0, W - 1, "d")                          # ケーブルトレー
    hline(g, 13, 0, W - 1, "c")

    slots: list[tuple[int, int]] = []
    for x in RACK_XS:
        slots += draw_rack(g, x)

    rect(g, 0, FLOOR_Y, W - 1, H - 1, "c")               # 床
    for i, y in enumerate(range(FLOOR_Y + 4, H, 7)):     # 床パネルの目地
        hline(g, y, 0, W - 1, "f")

    # 点灯するLEDを選ぶ。**位置は固定で、点く場所だけがコマごとに変わる**。
    # 素数を足していくことで、3コマとも違う散り方になり、規則も読めない
    for n, (x, y) in enumerate(slots):
        if (n * 7 + frame * 11) % 9 == 0:
            g[y][x] = "g"
        elif (n * 5 + frame * 13) % 23 == 0:
            g[y][x] = "y"
    return g


# ── 寿司: のれん・ネタケース・カウンター。湯気が3コマで立ちのぼる ──

SUSHI_COLORS = {
    "n": "5A1F2AD0",  # のれん
    "N": "742A38D0",  # のれんの明部
    "w": "3A2A20C8",  # カウンターの木
    "W": "4E392AC8",  # 木の明部
    "k": "2A2A3AC0",  # ケースの枠
    "G": "3E4E60A0",  # ガラス
    "t": "6A4A38C0",  # ネタ（赤身）
    "T": "7A6A50C0",  # ネタ（白身）
    "s": "9AA8C0A0",  # 湯気
    "d": "241C3A55",  # 奥の暗がり
}


def scene_sushi(frame: int) -> Grid:
    """寿司屋のカウンター。**ケースをカウンターに載せて**繋げる——
    離すと帯が3本並んでいるだけに見える（最初の版がそうだった）。"""
    g = blank()
    dither(g, 20, 56, "d", top=0.9, bottom=0.25)
    # のれん。**1ドットだけ**ずらして揺らす。大きく動かすと目で追ってしまう
    sway = frame % 2
    rect(g, 0, 0, W - 1, 18, "n")
    hline(g, 0, 0, W - 1, "N")
    for x in range(sway, W, 13):          # 布の切れ目
        rect(g, x, 4, x, 18, "d")
    # 奥の壁に品書きの木札
    for i, x in enumerate(range(10, W - 8, 23)):
        rect(g, x, 26, x + 8, 52, "W")
        rect(g, x + 1, 28, x + 7, 50, "w")
        for y in range(31, 48, 4):        # 字に見せる横線
            hline(g, y, x + 3, x + 5, "T")
    # ネタケース。カウンター（y=78）の上に載せる
    rect(g, 8, 56, W - 9, 78, "k")
    rect(g, 10, 58, W - 11, 76, "G")
    for i, x in enumerate(range(16, W - 18, 15)):
        rect(g, x, 63, x + 9, 72, "t" if i % 2 else "T")
        hline(g, 63, x, x + 9, "T" if i % 2 else "t")
    # カウンター（木目を入れる。無地だと帯に見える）
    rect(g, 0, 78, W - 1, H - 1, "w")
    hline(g, 78, 0, W - 1, "W")
    for y in (92, 106, 120):
        hline(g, y, 0, W - 1, "W")
        hline(g, y + 1, 0, W - 1, "w")
    # カウンターの上の湯呑と皿
    for x in (28, 152):
        rect(g, x - 4, 82, x + 4, 90, "T")   # 湯呑
        hline(g, 82, x - 4, x + 4, "W")
    for x in (66, 112):
        rect(g, x - 7, 86, x + 7, 89, "T")   # 平皿
    # 湯気。位置は固定で、**形だけ**がコマで変わる
    for base in (28, 152):
        for i, (dx, dy) in enumerate(((0, -2), (1, -5), (0, -8), (-1, -11), (0, -14))):
            if (i + frame) % 3 != 0:
                g[82 + dy][base + dx] = "s"
    return g


# ── 動物: 夜の柵と木。ホタルが飛ぶ ──

ANIMAL_COLORS = {
    "d": "1E2A3A80",  # 夜空
    "m": "6A7A9AB0",  # 月
    "t": "24382CC8",  # 木のシルエット
    "T": "2E4636C8",  # 木の明部
    "f": "3A3A4AD0",  # 柵
    "F": "4E4E60D0",  # 柵の明部
    "q": "26402EC0",  # 草
    "h": "C8E08AFF",  # ホタル
}


def scene_animal(frame: int) -> Grid:
    g = blank()
    dither(g, 0, 70, "d", top=0.9, bottom=0.25)
    # 月
    for y in range(-6, 7):
        for x in range(-6, 7):
            if x * x + y * y <= 34:
                g[16 + y][168 + x] = "m"
    # 木。丸を積んで塊にする（枝は実寸で消える）
    for cx, cy, r in ((26, 54, 18), (58, 62, 13), (104, 58, 16), (140, 64, 11)):
        for y in range(-r, r + 1):
            for x in range(-r, r + 1):
                if x * x + y * y <= r * r and 0 <= cy + y < H and 0 <= cx + x < W:
                    g[cy + y][cx + x] = "T" if (x + y) < -r // 2 else "t"
    # 柵
    rect(g, 0, 92, W - 1, H - 1, "q")
    hline(g, 92, 0, W - 1, "F")
    for x in range(4, W, 14):
        rect(g, x, 80, x + 2, 104, "f")
        g[80][x] = "F"
    hline(g, 86, 0, W - 1, "f")
    hline(g, 98, 0, W - 1, "f")
    # ホタル。3コマで散り方が変わる
    for i, (x, y) in enumerate(((46, 44), (88, 36), (122, 50), (150, 42), (72, 58))):
        if (i + frame) % 3 == 0:
            g[y + frame][x] = "h"
    return g


# ── 動詞: 教室の黒板と窓。窓の光がゆっくり変わる ──

VERB_COLORS = {
    "b": "24382EC8",  # 黒板
    "B": "36503EC8",  # 黒板の枠
    "c": "8A9A8A70",  # チョークの線
    "w": "3A3A50C8",  # 窓枠
    "l": "5A6A8AA0",  # 窓の光（弱）
    "L": "7A8AAEB0",  # 窓の光（強）
    "k": "3A3048C8",  # カーテン
    "t": "2E2A3EC8",  # 机
    "T": "423C56C8",  # 机の天板
    "d": "241C3A55",
}


def scene_verb(frame: int) -> Grid:
    g = blank()
    dither(g, 0, 40, "d", top=0.9, bottom=0.3)
    # 黒板
    rect(g, 6, 20, 108, 76, "B")
    rect(g, 9, 23, 105, 73, "b")
    for i, y in enumerate((34, 46, 58)):
        hline(g, y, 16, 16 + 60 - i * 14, "c")
    # 窓（右）。光の強さがコマで変わる＝**教室の外の明るさが揺れている**だけ
    for i, x in enumerate((124, 158)):
        rect(g, x, 18, x + 28, 74, "w")
        rect(g, x + 2, 20, x + 26, 72, "L" if (i + frame) % 3 == 0 else "l")
        rect(g, x + 13, 20, x + 14, 72, "w")
        hline(g, 44, x + 2, x + 26, "w")
        # カーテンは1ドットだけ揺れる
        rect(g, x + 2 + (frame % 2), 18, x + 5 + (frame % 2), 74, "k")
    # 机の列
    rect(g, 0, 96, W - 1, H - 1, "d")
    for row, (y, step, wdt) in enumerate(((98, 46, 34), (114, 56, 42))):
        for x in range(-8 + row * 10, W, step):
            rect(g, x, y, x + wdt, y + 10, "t")
            hline(g, y, x, x + wdt, "T")
    return g


# ── 八百屋: テント・木箱・吊るした野菜。値札が揺れる ──

YASAI_COLORS = {
    "r": "6A2A2ED0",  # テントの赤
    "c": "C8BCA8C0",  # テントの生成り
    "w": "4A3A28C8",  # 木箱
    "W": "5E4A34C8",  # 木箱の明部
    "g": "2E5A3CC0",  # 葉物
    "o": "7A5A2AC0",  # 根菜
    "p": "6A2A44C0",  # 紫の野菜
    "t": "C8C0A8D0",  # 値札
    "d": "241C3A55",
}


def scene_yasai(frame: int) -> Grid:
    g = blank()
    dither(g, 18, 60, "d", top=0.85, bottom=0.25)
    # テント（縞）
    rect(g, 0, 0, W - 1, 16, "c")
    for x in range(0, W, 20):
        rect(g, x, 0, x + 9, 16, "r")
    hline(g, 17, 0, W - 1, "w")
    # 吊るした野菜と値札。1ドットの揺れ
    sway = frame % 2
    for i, x in enumerate(range(14, W - 10, 26)):
        col = ("g", "o", "p")[i % 3]
        rect(g, x + sway, 18, x + sway, 26, "w")
        rect(g, x - 3 + sway, 26, x + 3 + sway, 34, col)
        if i % 2 == 0:
            rect(g, x - 2 + sway, 36, x + 2 + sway, 40, "t")
    # 木箱の段（手前ほど大きく積む）
    rect(g, 0, 78, W - 1, H - 1, "w")
    for row, y in enumerate((78, 96, 114)):
        for x in range(-6 + row * 6, W, 30):
            rect(g, x, y, x + 26, y + 16, "w")
            hline(g, y, x, x + 26, "W")
            rect(g, x + 4, y + 4, x + 22, y + 10, ("g", "o", "p")[(row + x) % 3])
    return g


# ── 寿司 v1: 店先の夜。提灯の灯りが揺れる ──

SUSHI2_COLORS = {
    "n": "5A1F2AD0", "N": "742A38D0",
    "k": "2A2438C8",   # 格子戸の枠
    "K": "3A3048C8",   # 格子の桟
    "l": "8A5A2AC0",   # 提灯の紙（弱）
    "L": "D89A44E0",   # 提灯の紙（強）
    "r": "6A2A2ED0",   # 提灯の帯
    "s": "2E2A3AC8",   # 石畳
    "S": "3E3A4EC8",
    "d": "241C3A55",
}


def scene_sushi_front(frame: int) -> Grid:
    g = blank()
    dither(g, 0, 60, "d", top=0.9, bottom=0.3)
    rect(g, 0, 0, W - 1, 14, "n")                    # 暖簾
    hline(g, 0, 0, W - 1, "N")
    for x in range(frame % 2, W, 13):
        rect(g, x, 4, x, 14, "d")
    rect(g, 20, 34, W - 21, 96, "k")                 # 格子戸
    for x in range(24, W - 22, 7):
        vline(g, x, 36, 94, "K")
    for y in range(40, 96, 14):
        hline(g, y, 22, W - 23, "K")
    for i, cx in enumerate((30, 170)):               # 提灯
        lit = "L" if (i + frame) % 3 != 0 else "l"
        rect(g, cx - 7, 24, cx + 7, 48, lit)
        rect(g, cx - 8, 30, cx + 8, 32, "r")
        rect(g, cx - 8, 40, cx + 8, 42, "r")
        hline(g, 23, cx - 5, cx + 5, "k")
        vline(g, cx, 16, 23, "k")
    rect(g, 0, 96, W - 1, H - 1, "s")                # 石畳
    for y in range(100, H, 10):
        hline(g, y, 0, W - 1, "S")
    for x in range(10, W, 24):
        vline(g, x, 96, H - 1, "S")
    return g


# ── 寿司 v2: 生け簀。泡が上がる ──

SUSHI3_COLORS = {
    "w": "24384EC8",   # 水
    "W": "31506AC8",   # 水の明部
    "g": "3E6A80A0",   # 水面のゆらぎ
    "k": "2A2438D0",   # 水槽の枠
    "f": "44506AC0",   # 魚影
    "b": "9AC0D0C0",   # 泡
    "s": "3A2A20C8",   # 台
    "d": "241C3A55",
}


def scene_sushi_tank(frame: int) -> Grid:
    g = blank()
    dither(g, 0, 26, "d", top=0.9, bottom=0.4)
    rect(g, 6, 26, W - 7, 104, "k")                  # 水槽
    rect(g, 9, 29, W - 10, 101, "w")
    for y in range(34, 100, 9):                      # 水の層
        hline(g, y, 9, W - 10, "W")
    for i in range(4):                               # 水面のゆらぎ
        hline(g, 30 + (i + frame) % 2, 9 + i * 48, 40 + i * 48, "g")
    for i, (x, y, r) in enumerate(((40, 58, 7), (96, 74, 6), (150, 52, 8), (120, 90, 5))):
        circle(g, x, y, r, "f")                      # 魚影
        rect(g, x + r, y - 1, x + r + 4, y + 1, "f")
    for i, x in enumerate((28, 70, 118, 168)):       # 泡
        for k in range(4):
            y = 98 - ((k * 9 + frame * 7 + i * 5) % 66)
            if 30 < y < 100:
                g[y][x] = "b"
    rect(g, 0, 104, W - 1, H - 1, "s")
    return g


# ── 動物 v1: 岩山の放飼場 ──

ANIMAL2_COLORS = {
    "d": "1E2A3A80", "q": "26402EC0", "Q": "31543CC0",
    "r": "3A3A48C8", "R": "4A4A5CC8",   # 岩
    "t": "24382CC8", "T": "2E4636C8",   # 木
    "a": "3E3A34C8",                    # 地面
}


def scene_animal_rocks(frame: int) -> Grid:
    g = blank()
    dither(g, 0, 56, "d", top=0.9, bottom=0.3)
    for cx, cy, r in ((34, 66, 26), (86, 74, 20), (150, 62, 30)):   # 岩山
        circle(g, cx, cy, r, "r", "R")
    for cx, cy, r in ((10, 52, 12), (120, 48, 14), (186, 50, 11)):  # 木
        circle(g, cx, cy, r, "t", "T")
    rect(g, 0, 92, W - 1, H - 1, "a")                                # 地面
    for x in range(0, W, 6):                                         # 草
        h = 4 + (x // 6 + frame) % 3
        vline(g, x, 92 - h, 92, "q")
        g[92 - h][x] = "Q"
    return g


# ── 動物 v2: 水辺。水面の反射が揺れる ──

ANIMAL3_COLORS = {
    "d": "1E2A3A80", "m": "6A7A9AB0",
    "w": "23384AC8", "W": "35566EC0", "g": "5A7A96A0",
    "r": "3A3A48C8", "R": "4A4A5CC8",
    "q": "26402EC0",
}


def scene_animal_water(frame: int) -> Grid:
    g = blank()
    dither(g, 0, 60, "d", top=0.9, bottom=0.3)
    circle(g, 40, 22, 8, "m")                        # 月
    for cx, cy, r in ((120, 62, 22), (176, 68, 16)):  # 岩
        circle(g, cx, cy, r, "r", "R")
    rect(g, 0, 74, W - 1, H - 1, "w")                # 水面
    for i, y in enumerate(range(78, H, 7)):
        hline(g, y, 0, W - 1, "W")
    for i in range(6):                               # 月の映り込み（横にずれる）
        y = 80 + i * 8
        x = 40 + ((i + frame) % 3 - 1) * 2
        rect(g, x - 4, y, x + 4, y, "g")
    for x in range(0, 30, 4):                        # 葦
        vline(g, x, 62, 76, "q")
    return g


# ── 動詞 v1: 図書室。スタンドライトが明滅 ──

VERB2_COLORS = {
    "d": "241C3A55",
    "s": "3A2E24C8", "S": "4E3E30C8",   # 棚
    "b": "5A3038C0", "B": "34506AC0", "c": "3A5A44C0",  # 本の背
    "l": "9A8A5AC0", "L": "E0C878E0",   # ライト
    "t": "2E2A3EC8", "T": "423C56C8",   # 机
}


def scene_verb_library(frame: int) -> Grid:
    g = blank()
    dither(g, 0, 20, "d", top=0.9, bottom=0.4)
    for col, x in enumerate(range(4, W - 20, 46)):   # 本棚
        rect(g, x, 18, x + 38, 96, "s")
        for y in range(22, 94, 12):
            hline(g, y + 10, x + 1, x + 37, "S")
            for i, bx in enumerate(range(x + 2, x + 37, 3)):
                vline(g, bx, y, y + 9, ("b", "B", "c")[(i + col + y) % 3])
    rect(g, 0, 96, W - 1, H - 1, "t")                # 机
    hline(g, 96, 0, W - 1, "T")
    for i, x in enumerate((30, 150)):                # スタンドライト
        lit = "L" if (i + frame) % 3 != 0 else "l"
        rect(g, x - 6, 100, x + 6, 103, lit)
        vline(g, x, 103, 112, "S")
    return g


# ── 動詞 v2: 廊下。天井灯が明滅 ──

VERB3_COLORS = {
    "d": "241C3A55",
    "w": "3A3A50C8", "l": "5A6A8AA0", "L": "7A8AAEB0",
    "f": "2E2A3EC8", "F": "423C56C8",
    "c": "8A8AA6D0",
}


def scene_verb_hall(frame: int) -> Grid:
    g = blank()
    dither(g, 0, 22, "d", top=0.9, bottom=0.35)
    for i, x in enumerate(range(6, W - 30, 46)):     # 窓の列
        rect(g, x, 22, x + 34, 84, "w")
        rect(g, x + 2, 24, x + 32, 82, "L" if (i + frame) % 3 == 0 else "l")
        vline(g, x + 16, 24, 82, "w")
        hline(g, 52, x + 2, x + 32, "w")
    for i, x in enumerate(range(28, W, 60)):         # 天井灯
        rect(g, x, 8, x + 18, 11, "c" if (i + frame) % 2 else "w")
    rect(g, 0, 88, W - 1, H - 1, "f")                # 床
    for y in range(92, H, 9):
        hline(g, y, 0, W - 1, "F")
    return g


# ── 八百屋 v1: 市場の朝。吊り電球が揺れる ──

YASAI2_COLORS = {
    "d": "241C3A55",
    "w": "4A3A28C8", "W": "5E4A34C8",
    "g": "2E5A3CC0", "o": "7A5A2AC0", "p": "6A2A44C0",
    "b": "3A3448C8",                      # 梁
    "l": "8A7A4AC0", "L": "E8D08AE0",     # 電球
}


def scene_yasai_market(frame: int) -> Grid:
    g = blank()
    dither(g, 0, 30, "d", top=0.9, bottom=0.35)
    rect(g, 0, 10, W - 1, 14, "b")                   # 梁
    for x in range(6, W, 34):
        vline(g, x, 0, 10, "b")
    sway = frame % 2
    for i, x in enumerate((36, 100, 164)):           # 吊り電球
        vline(g, x + sway, 14, 30, "b")
        circle(g, x + sway, 34, 4, "L" if (i + frame) % 3 != 0 else "l")
    for row, y in enumerate((56, 82, 108)):          # 木箱の山
        wdt = 34 + row * 8
        for x in range(-10 + row * 8, W, wdt + 6):
            rect(g, x, y, x + wdt, y + 24, "w")
            hline(g, y, x, x + wdt, "W")
            rect(g, x + 5, y + 6, x + wdt - 5, y + 15, ("g", "o", "p")[(row + x) % 3])
    return g


# ── 八百屋 v2: 畑。葉が揺れる ──

YASAI3_COLORS = {
    "d": "1E2A3A70",
    "m": "2E3A4AC0", "M": "3E4E60C0",    # 遠くの山
    "s": "4A3A28C8", "S": "5E4A34C8",    # 畝
    "g": "2E5A3CC0", "G": "3E7A50C0",    # 葉
}


def scene_yasai_field(frame: int) -> Grid:
    g = blank()
    dither(g, 0, 44, "d", top=0.9, bottom=0.25)
    for cx, r in ((30, 26), (86, 20), (150, 30)):    # 遠くの山
        circle(g, cx, 62, r, "m", "M")
    rect(g, 0, 60, W - 1, H - 1, "s")                # 畑
    for i, y in enumerate(range(64, H, 12)):         # 畝
        hline(g, y, 0, W - 1, "S")
        for x in range((i * 5) % 10, W, 10):         # 葉。1ドットだけ揺れる
            sway = (x // 10 + frame) % 2
            g[y - 3][x + sway] = "g"
            g[y - 4][x + sway] = "G"
            g[y - 3][min(W - 1, x + 2 + sway)] = "g"
    return g


# ── セキュリティ v1: 端末の前。画面の行が流れる ──

SEC2_COLORS = {
    "d": "241C3A55",
    "k": "2A2A40C8", "K": "3E3E58C8",    # 筐体
    "s": "1E3A34D0",                     # 画面の地
    "g": "4EC08AE0", "G": "8AE0B0FF",    # 文字行
    "t": "32304AC8", "T": "45426AC8",    # 机
}


def scene_security_console(frame: int) -> Grid:
    g = blank()
    dither(g, 0, 20, "d", top=0.9, bottom=0.4)
    for i, x in enumerate((10, 74, 138)):            # モニタ3枚
        rect(g, x, 20, x + 52, 78, "k")
        rect(g, x + 3, 23, x + 49, 75, "s")
        for row in range(9):                         # 文字行が1行ずつ流れる
            y = 26 + ((row * 6 + frame * 2) % 48)
            wdt = 6 + ((row * 7 + i * 3) % 34)
            hline(g, y, x + 5, x + 5 + wdt, "G" if row % 4 == 0 else "g")
        hline(g, 78, x, x + 52, "K")
        rect(g, x + 20, 79, x + 32, 84, "K")         # スタンド
    rect(g, 0, 86, W - 1, H - 1, "t")                # 机
    hline(g, 86, 0, W - 1, "T")
    for x in range(14, W - 20, 4):                   # キーボード
        rect(g, x, 96, x + 2, 100, "K")
    return g


# ── セキュリティ v2: 夜のオフィス。窓の外の街が明滅 ──

SEC3_COLORS = {
    "d": "1E2438A0",
    "w": "2A2A44C8", "W": "3E3E58C8",    # 窓枠
    "c": "3A4A6AC0",                     # 夜景の地
    "y": "E8C878E0", "b": "8AB0E0D0",    # 街の灯り
    "t": "32304AC8", "T": "45426AC8",    # 机
    "m": "2E4A44D0", "M": "5FE0A0FF",    # モニタ
}


def scene_security_office(frame: int) -> Grid:
    g = blank()
    rect(g, 0, 0, W - 1, 74, "c")                    # 窓の外
    dither(g, 0, 40, "d", top=0.8, bottom=0.2)
    for i, x in enumerate(range(4, W, 13)):          # ビル
        h = 20 + (i * 17) % 44
        rect(g, x, 74 - h, x + 9, 74, "w")
        for k, y in enumerate(range(74 - h + 3, 72, 6)):   # 窓の灯り
            if (i + k + frame) % 4 == 0:
                rect(g, x + 2, y, x + 3, y + 1, "y" if k % 2 else "b")
    for x in range(0, W, 66):                        # 窓枠
        vline(g, x, 0, 76, "W")
    hline(g, 76, 0, W - 1, "W")
    rect(g, 0, 78, W - 1, H - 1, "t")                # 机
    hline(g, 78, 0, W - 1, "T")
    for i, x in enumerate((22, 92, 156)):            # モニタ
        rect(g, x, 82, x + 30, 102, "m")
        for row in range(3):
            if (i + row + frame) % 3 == 0:
                hline(g, 86 + row * 5, x + 3, x + 24, "M")
    return g


# 章ID → 情景の一覧。**プレイ中に移り変わる**（実機のステージチェンジと同じ扱い）。
SCENES: dict[str, list[tuple]] = {
    "hiragana_food": [
        (scene_sushi, SUSHI_COLORS, 3),
        (scene_sushi_front, SUSHI2_COLORS, 3),
        (scene_sushi_tank, SUSHI3_COLORS, 3),
    ],
    "katakana_animal": [
        (scene_animal, ANIMAL_COLORS, 3),
        (scene_animal_rocks, ANIMAL2_COLORS, 3),
        (scene_animal_water, ANIMAL3_COLORS, 3),
    ],
    "hiragana_verb": [
        (scene_verb, VERB_COLORS, 3),
        (scene_verb_library, VERB2_COLORS, 3),
        (scene_verb_hall, VERB3_COLORS, 3),
    ],
    "yasai": [
        (scene_yasai, YASAI_COLORS, 3),
        (scene_yasai_market, YASAI2_COLORS, 3),
        (scene_yasai_field, YASAI3_COLORS, 3),
    ],
    "security": [
        (scene_security, SECURITY_COLORS, 3),
        (scene_security_console, SEC2_COLORS, 3),
        (scene_security_office, SEC3_COLORS, 3),
    ],
}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("chapters", nargs="*")
    ap.add_argument("--sheet", type=pathlib.Path, help="全情景を実寸3倍で並べる")
    args = ap.parse_args()

    OUT.mkdir(parents=True, exist_ok=True)
    total = 0
    for chapter in args.chapters or list(SCENES):
        if chapter not in SCENES:
            raise SystemExit(f"{chapter} の情景が未定義（{', '.join(SCENES)}）")
        for v, (build, colors, frames) in enumerate(SCENES[chapter]):
            for f in range(frames):
                path = OUT / f"{chapter}_{v}_{f}.png"
                to_image(build(f), colors).save(path)
                total += path.stat().st_size
        print(f"  {chapter}: 情景 {len(SCENES[chapter])} 種")
    print(f"合計 {total / 1024:.1f} KB → {OUT}")

    if args.sheet:
        # 実寸3倍で全情景を並べる。**この大きさで判断する**
        rows = [(c, v) for c in SCENES for v in range(len(SCENES[c]))]
        cols = 3
        pad = 8
        im = Image.new(
            "RGBA",
            (pad + cols * (W * 3 + pad), pad + -(-len(rows) // cols) * (H * 3 + pad)),
            (0x2A, 0x18, 0x30, 255),
        )
        for n, (c, v) in enumerate(rows):
            build, colors, _ = SCENES[c][v]
            x = pad + (n % cols) * (W * 3 + pad)
            y = pad + (n // cols) * (H * 3 + pad)
            im.alpha_composite(to_image(build(0), colors, 3), (x, y))
        im.save(args.sheet)
        print(f"  → {args.sheet}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
