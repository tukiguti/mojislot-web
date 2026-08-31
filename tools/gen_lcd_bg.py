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

import math

from PIL import Image

W, H = 200, 134
# 1情景あたりのコマ数。**3コマだと点滅にしか見えない**——映像として読ませるには
# 動きが繋がる必要がある。12コマ×110ms で約1.3秒の輪。
FRAMES = 12
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
#
# ## 動かし方
#
# 各情景は「動く映像」として作る。**位置を剰余で回す**（`(base + frame*速さ) % 周期`）
# ことで、12コマの輪が繋がって流れ続けているように見える。周期がコマ数と噛み合って
# いないと、輪の切れ目でカクッと戻って見える。
#
# 動かす対象は湯気・泡・魚・雲・光の順送りなど**情景の一部**に留める。全部を
# 動かすと落ち着かず、リールから目を奪う。


def wave(x: int, frame: int, period: int = 6, amp: int = 1) -> int:
    """位置 x とコマ数から、波のような上下（左右）のずれを返す。"""
    return round(amp * math.sin((x / period + frame / FRAMES * math.tau)))


def cycle(base: int, frame: int, speed: int, period: int) -> int:
    """一定の速さで流れて折り返す位置。

    **周期は必ず `速さ × FRAMES` にする。** ここが噛み合っていないと、12コマの輪が
    一周した瞬間に位置がカクッと飛ぶ（実際に踏んだ）。並べる要素の間隔も周期と
    同じにすると、出ていった要素の代わりに次が同じ位相で入ってきて途切れない。
    """
    assert period == speed * FRAMES, f"周期 {period} は 速さ×コマ数 {speed * FRAMES} にする"
    return (base + frame * speed) % period


# ── 寿司 v0: カウンター。湯気が立ちのぼる ──

SUSHI_COLORS = {
    "n": "5A1F2AD0", "N": "742A38D0",
    "w": "3A2A20C8", "W": "4E392AC8",
    "k": "2A2A3AC0", "G": "3E4E60A0",
    "t": "6A4A38C0", "T": "7A6A50C0",
    "s": "9AA8C0A0", "d": "241C3A55",
}


def scene_sushi(frame: int) -> Grid:
    g = blank()
    dither(g, 20, 56, "d", top=0.9, bottom=0.25)
    sway = (frame // 3) % 2
    rect(g, 0, 0, W - 1, 18, "n")
    hline(g, 0, 0, W - 1, "N")
    for x in range(sway, W, 13):
        vline(g, x, 4, 18, "d")
    for x in range(10, W - 8, 23):                    # 品書きの木札
        rect(g, x, 26, x + 8, 52, "W")
        rect(g, x + 1, 28, x + 7, 50, "w")
        for y in range(31, 48, 4):
            hline(g, y, x + 3, x + 5, "T")
    rect(g, 8, 56, W - 9, 78, "k")                    # ネタケース
    rect(g, 10, 58, W - 11, 76, "G")
    for i, x in enumerate(range(16, W - 18, 15)):
        rect(g, x, 63, x + 9, 72, "t" if i % 2 else "T")
        hline(g, 63, x, x + 9, "T" if i % 2 else "t")
    rect(g, 0, 78, W - 1, H - 1, "w")                 # カウンター
    hline(g, 78, 0, W - 1, "W")
    for y in (92, 106, 120):
        hline(g, y, 0, W - 1, "W")
    for x in (28, 152):
        rect(g, x - 4, 82, x + 4, 90, "T")
        hline(g, 82, x - 4, x + 4, "W")
    for x in (66, 112):
        rect(g, x - 7, 86, x + 7, 89, "T")
    # 湯気。下から上へ流れ続ける（剰余で回すので輪の切れ目が出ない）
    for i, base in enumerate((28, 152)):
        for k in range(4):
            y = 82 - cycle(k * 9 + i * 4, frame, 3, 36)
            if 40 < y < 82:
                g[y][base + wave(y, frame, 4, 1)] = "s"
    return g


# ── 寿司 v1: 店先の夜。提灯が灯り、格子戸の向こうを人影が通る ──

SUSHI2_COLORS = {
    "n": "5A1F2AD0", "N": "742A38D0",
    "k": "2A2438C8", "K": "3A3048C8",
    "l": "8A5A2AC0", "L": "D89A44E0", "r": "6A2A2ED0",
    "s": "2E2A3AC8", "S": "3E3A4EC8",
    "p": "1A1626D0",                       # 人影
    "d": "241C3A55",
}


def scene_sushi_front(frame: int) -> Grid:
    g = blank()
    dither(g, 0, 60, "d", top=0.9, bottom=0.3)
    rect(g, 0, 0, W - 1, 14, "n")
    hline(g, 0, 0, W - 1, "N")
    for x in range((frame // 3) % 2, W, 13):
        vline(g, x, 4, 14, "d")
    rect(g, 20, 34, W - 21, 96, "k")                  # 格子戸
    # 戸の向こうを人影が横切る。**映像として一番効く**——一定の速さで通り過ぎる
    px = cycle(0, frame, 24, 288) - 44
    if 20 < px < W - 20:
        rect(g, max(22, px - 9), 52, min(W - 23, px + 9), 94, "p")
        circle(g, px, 46, 7, "p")
    for x in range(24, W - 22, 7):
        vline(g, x, 36, 94, "K")
    for y in range(40, 96, 14):
        hline(g, y, 22, W - 23, "K")
    for i, cx in enumerate((30, 170)):                # 提灯
        lit = "L" if (i * 2 + frame) % 6 else "l"
        rect(g, cx - 7, 24, cx + 7, 48, lit)
        rect(g, cx - 8, 30, cx + 8, 32, "r")
        rect(g, cx - 8, 40, cx + 8, 42, "r")
        hline(g, 23, cx - 5, cx + 5, "k")
        vline(g, cx, 16, 23, "k")
    rect(g, 0, 96, W - 1, H - 1, "s")
    for y in range(100, H, 10):
        hline(g, y, 0, W - 1, "S")
    for x in range(10, W, 24):
        vline(g, x, 96, H - 1, "S")
    return g


# ── 寿司 v2: 生け簀。魚が泳ぎ、泡が上がる ──

SUSHI3_COLORS = {
    "w": "24384EC8", "W": "31506AC8", "g": "3E6A80A0",
    "k": "2A2438D0", "f": "44506AC0", "b": "9AC0D0C0",
    "s": "3A2A20C8", "d": "241C3A55",
}


def scene_sushi_tank(frame: int) -> Grid:
    g = blank()
    dither(g, 0, 26, "d", top=0.9, bottom=0.4)
    rect(g, 6, 26, W - 7, 104, "k")
    rect(g, 9, 29, W - 10, 101, "w")
    for y in range(34, 100, 9):
        hline(g, y, 9, W - 10, "W")
    for i in range(4):
        hline(g, 30 + (frame // 4 + i) % 2, 9 + i * 48, 40 + i * 48, "g")
    # 魚。左右へ泳ぎ続ける（画面外へ抜けて反対から入る）
    for i, (cx, y, r, ph) in enumerate(((60, 58, 7, 0), (140, 74, 6, 3),
                                        (100, 52, 8, 6), (44, 90, 5, 9))):
        # 水槽の中を行き来する。横断させると12コマでは速すぎて魚に見えない
        sw = round(16 * math.sin((frame + ph) / FRAMES * math.tau))
        x = cx + sw
        circle(g, x, y + wave(x, frame, 8, 1), r, "f")
        tail = -r - 4 if sw >= 0 else r
        rect(g, x + tail, y - 1, x + tail + 4, y + 1, "f")
    for i, x in enumerate((28, 70, 118, 168)):        # 泡
        for k in range(4):
            y = 98 - cycle(k * 18, frame, 6, 72)
            if 30 < y < 100:
                g[y][x + wave(y, frame, 5, 1)] = "b"
    rect(g, 0, 104, W - 1, H - 1, "s")
    return g


# ── 動物 v0: 夜の柵。雲が流れ、ホタルが舞う ──

ANIMAL_COLORS = {
    "d": "1E2A3A80", "m": "6A7A9AB0",
    "t": "24382CC8", "T": "2E4636C8",
    "f": "3A3A4AD0", "F": "4E4E60D0",
    "q": "26402EC0", "h": "C8E08AFF",
    "c": "2A3A4EA0",                       # 雲
}


def scene_animal(frame: int) -> Grid:
    g = blank()
    dither(g, 0, 70, "d", top=0.9, bottom=0.25)
    circle(g, 168, 16, 6, "m")
    for i, (base, y, r) in enumerate(((24, 14, 9), (94, 26, 7), (164, 10, 8))):
        # 雲。横断させると12コマでは輪の切れ目で飛ぶので、ゆっくり漂わせる
        x = base + round(7 * math.sin((frame + i * 4) / FRAMES * math.tau))
        for dx in (-r, 0, r):
            circle(g, x + dx, y, r - abs(dx) // 3, "c")
    for cx, cy, r in ((26, 54, 18), (58, 62, 13), (104, 58, 16), (140, 64, 11)):
        circle(g, cx, cy, r, "t", "T")
    rect(g, 0, 92, W - 1, H - 1, "q")
    hline(g, 92, 0, W - 1, "F")
    for x in range(4, W, 14):
        rect(g, x, 80, x + 2, 104, "f")
        g[80][x] = "F"
    hline(g, 86, 0, W - 1, "f")
    hline(g, 98, 0, W - 1, "f")
    for i, (bx, by) in enumerate(((46, 44), (88, 36), (122, 50), (150, 42), (72, 58))):
        if (i + frame // 2) % 3 == 0:                 # 明滅しながら漂う
            g[by + wave(bx, frame + i * 3, 3, 3)][bx + wave(by, frame + i, 4, 4)] = "h"
    return g


# ── 動物 v1: 岩山の放飼場。草が波打ち、鳥が横切る ──

ANIMAL2_COLORS = {
    "d": "1E2A3A80", "q": "26402EC0", "Q": "31543CC0",
    "r": "3A3A48C8", "R": "4A4A5CC8",
    "t": "24382CC8", "T": "2E4636C8",
    "a": "3E3A34C8", "b": "5A6A80D0",      # 鳥
}


def scene_animal_rocks(frame: int) -> Grid:
    g = blank()
    dither(g, 0, 56, "d", top=0.9, bottom=0.3)
    bx = cycle(0, frame, 22, 264) - 32           # 鳥が横切る
    if 0 < bx < W - 6:
        wing = 2 if frame % 4 < 2 else -1
        g[24][bx] = "b"
        g[24 - wing][bx - 2] = "b"
        g[24 - wing][bx + 2] = "b"
    for cx, cy, r in ((34, 66, 26), (86, 74, 20), (150, 62, 30)):
        circle(g, cx, cy, r, "r", "R")
    for cx, cy, r in ((10, 52, 12), (120, 48, 14), (186, 50, 11)):
        circle(g, cx, cy, r, "t", "T")
    rect(g, 0, 92, W - 1, H - 1, "a")
    for x in range(0, W, 6):                          # 草が波打つ
        h = 5 + wave(x, frame, 7, 2)
        vline(g, x, 92 - h, 92, "q")
        g[92 - h][x] = "Q"
    return g


# ── 動物 v2: 水辺。波紋が流れる ──

ANIMAL3_COLORS = {
    "d": "1E2A3A80", "m": "6A7A9AB0",
    "w": "23384AC8", "W": "35566EC0", "g": "5A7A96A0",
    "r": "3A3A48C8", "R": "4A4A5CC8", "q": "26402EC0",
}


def scene_animal_water(frame: int) -> Grid:
    g = blank()
    dither(g, 0, 60, "d", top=0.9, bottom=0.3)
    circle(g, 40, 22, 8, "m")
    for cx, cy, r in ((120, 62, 22), (176, 68, 16)):
        circle(g, cx, cy, r, "r", "R")
    rect(g, 0, 74, W - 1, H - 1, "w")
    for i, y in enumerate(range(78, H, 7)):           # 波が横へ流れる
        off = cycle(i * 8, frame, 2, 24)
        for x in range(off - 24, W, 24):
            rect(g, max(0, x), y, min(W - 1, x + 11), y, "W")
    for i in range(6):                                # 月の映り込みが揺れる
        y = 80 + i * 8
        x = 40 + wave(y, frame, 3, 3)
        rect(g, x - 4, y, x + 4, y, "g")
    for x in range(0, 30, 4):
        vline(g, x, 62 + wave(x, frame, 5, 1), 76, "q")
    return g


# ── 動詞 v0: 教室。カーテンが揺れ、窓の外を鳥が通る ──

VERB_COLORS = {
    "b": "24382EC8", "B": "36503EC8", "c": "8A9A8A70",
    "w": "3A3A50C8", "l": "5A6A8AA0", "L": "7A8AAEB0",
    "k": "3A3048C8", "t": "2E2A3EC8", "T": "423C56C8",
    "p": "2A3040C0", "d": "241C3A55",
}


def scene_verb(frame: int) -> Grid:
    g = blank()
    dither(g, 0, 40, "d", top=0.9, bottom=0.3)
    rect(g, 6, 20, 108, 76, "B")
    rect(g, 9, 23, 105, 73, "b")
    for i, y in enumerate((34, 46, 58)):
        hline(g, y, 16, 16 + 60 - i * 14, "c")
    for i, x in enumerate((124, 158)):
        rect(g, x, 18, x + 28, 74, "w")
        rect(g, x + 2, 20, x + 26, 72, "l")
        # 窓の外を影が通る（外の世界が動いている合図）
        sx = cycle(0, frame, 12, 144) - 22
        if x + 2 < 124 + sx < x + 26:
            rect(g, 124 + sx - 3, 40, 124 + sx + 3, 72, "p")
        rect(g, x + 13, 20, x + 14, 72, "w")
        hline(g, 44, x + 2, x + 26, "w")
        sway = (frame // 3) % 2
        rect(g, x + 2 + sway, 18, x + 5 + sway, 74, "k")
    rect(g, 0, 96, W - 1, H - 1, "d")
    for row, (y, step, wdt) in enumerate(((98, 46, 34), (114, 56, 42))):
        for x in range(-8 + row * 10, W, step):
            rect(g, x, y, x + wdt, y + 10, "t")
            hline(g, y, x, x + wdt, "T")
    return g


# ── 動詞 v1: 図書室。ライトが明滅し、ホコリが舞う ──

VERB2_COLORS = {
    "d": "241C3A55", "s": "3A2E24C8", "S": "4E3E30C8",
    "b": "5A3038C0", "B": "34506AC0", "c": "3A5A44C0",
    "l": "9A8A5AC0", "L": "E0C878E0",
    "t": "2E2A3EC8", "T": "423C56C8", "p": "9A9A8060",
}


def scene_verb_library(frame: int) -> Grid:
    g = blank()
    dither(g, 0, 20, "d", top=0.9, bottom=0.4)
    for col, x in enumerate(range(4, W - 20, 46)):
        rect(g, x, 18, x + 38, 96, "s")
        for y in range(22, 94, 12):
            hline(g, y + 10, x + 1, x + 37, "S")
            for i, bx in enumerate(range(x + 2, x + 37, 3)):
                vline(g, bx, y, y + 9, ("b", "B", "c")[(i + col + y) % 3])
    rect(g, 0, 96, W - 1, H - 1, "t")
    hline(g, 96, 0, W - 1, "T")
    for i, x in enumerate((30, 150)):
        lit = "L" if (i * 3 + frame) % 7 else "l"
        rect(g, x - 6, 100, x + 6, 103, lit)
        vline(g, x, 103, 112, "S")
    for i in range(10):                               # ホコリがゆっくり舞う
        y = 94 - cycle(i * 7, frame, 2, 24) - (i % 4) * 22
        x = (i * 21 + 7) % W + wave(y, frame + i, 6, 2)
        if 8 < y < 94 and 0 <= x < W:
            g[y][x] = "p"
    return g


# ── 動詞 v2: 廊下。天井灯が順に点いていく ──

VERB3_COLORS = {
    "d": "241C3A55", "w": "3A3A50C8",
    "l": "5A6A8AA0", "L": "7A8AAEB0",
    "f": "2E2A3EC8", "F": "423C56C8", "c": "8A8AA6D0",
}


def scene_verb_hall(frame: int) -> Grid:
    g = blank()
    dither(g, 0, 22, "d", top=0.9, bottom=0.35)
    lamps = list(range(28, W, 60))
    on = (frame // 2) % len(lamps)                    # 灯りが奥へ順に送られる
    for i, x in enumerate(range(6, W - 30, 46)):
        rect(g, x, 22, x + 34, 84, "w")
        rect(g, x + 2, 24, x + 32, 82, "L" if i == on else "l")
        vline(g, x + 16, 24, 82, "w")
        hline(g, 52, x + 2, x + 32, "w")
    for i, x in enumerate(lamps):
        rect(g, x, 8, x + 18, 11, "c" if i == on else "w")
    rect(g, 0, 88, W - 1, H - 1, "f")
    for y in range(92, H, 9):
        hline(g, y, 0, W - 1, "F")
    if on * 46 + 6 < W:                               # 床の照り返しも一緒に動く
        rect(g, on * 46 + 8, 88, on * 46 + 38, H - 1, "F")
    return g


# ── 八百屋 v0: 店先。値札が揺れ、客の影が通る ──

YASAI_COLORS = {
    "r": "6A2A2ED0", "c": "C8BCA8C0",
    "w": "4A3A28C8", "W": "5E4A34C8",
    "g": "2E5A3CC0", "o": "7A5A2AC0", "p": "6A2A44C0",
    "t": "C8C0A8D0", "s": "1A1626C0", "d": "241C3A55",
}


def scene_yasai(frame: int) -> Grid:
    g = blank()
    dither(g, 18, 60, "d", top=0.85, bottom=0.25)
    rect(g, 0, 0, W - 1, 16, "c")
    for x in range(0, W, 20):
        rect(g, x, 0, x + 9, 16, "r")
    hline(g, 17, 0, W - 1, "w")
    sway = wave(0, frame, 1, 1)
    for i, x in enumerate(range(14, W - 10, 26)):
        col = ("g", "o", "p")[i % 3]
        s = sway if i % 2 == 0 else -sway
        vline(g, x + s, 18, 26, "w")
        rect(g, x - 3 + s, 26, x + 3 + s, 34, col)
        if i % 2 == 0:
            rect(g, x - 2 + s, 36, x + 2 + s, 40, "t")
    cx = cycle(0, frame, 24, 288) - 44           # 客の影が横切る
    if 0 < cx < W:
        rect(g, max(0, cx - 10), 52, min(W - 1, cx + 10), 78, "s")
        circle(g, cx, 46, 8, "s")
    rect(g, 0, 78, W - 1, H - 1, "w")
    for row, y in enumerate((78, 96, 114)):
        for x in range(-6 + row * 6, W, 30):
            rect(g, x, y, x + 26, y + 16, "w")
            hline(g, y, x, x + 26, "W")
            rect(g, x + 4, y + 4, x + 22, y + 10, ("g", "o", "p")[(row + x) % 3])
    return g


# ── 八百屋 v1: 市場の朝。吊り電球が振り子のように揺れる ──

YASAI2_COLORS = {
    "d": "241C3A55", "w": "4A3A28C8", "W": "5E4A34C8",
    "g": "2E5A3CC0", "o": "7A5A2AC0", "p": "6A2A44C0",
    "b": "3A3448C8", "l": "8A7A4AC0", "L": "E8D08AE0",
}


def scene_yasai_market(frame: int) -> Grid:
    g = blank()
    dither(g, 0, 30, "d", top=0.9, bottom=0.35)
    rect(g, 0, 10, W - 1, 14, "b")
    for x in range(6, W, 34):
        vline(g, x, 0, 10, "b")
    for i, x in enumerate((36, 100, 164)):            # 吊り電球が振れる
        s = wave(i * 20, frame, 1, 3)
        for y in range(14, 31):                       # 紐も一緒に傾ける
            g[y][x + round(s * (y - 14) / 17)] = "b"
        circle(g, x + s, 34, 4, "L" if (i * 2 + frame) % 5 else "l")
    for row, y in enumerate((56, 82, 108)):
        wdt = 34 + row * 8
        for x in range(-10 + row * 8, W, wdt + 6):
            rect(g, x, y, x + wdt, y + 24, "w")
            hline(g, y, x, x + wdt, "W")
            rect(g, x + 5, y + 6, x + wdt - 5, y + 15, ("g", "o", "p")[(row + x) % 3])
    return g


# ── 八百屋 v2: 畑。葉が波打つ ──

YASAI3_COLORS = {
    "d": "1E2A3A70", "m": "2E3A4AC0", "M": "3E4E60C0",
    "s": "4A3A28C8", "S": "5E4A34C8",
    "g": "2E5A3CC0", "G": "3E7A50C0",
}


def scene_yasai_field(frame: int) -> Grid:
    g = blank()
    dither(g, 0, 44, "d", top=0.9, bottom=0.25)
    for cx, r in ((30, 26), (86, 20), (150, 30)):
        circle(g, cx, 62, r, "m", "M")
    rect(g, 0, 60, W - 1, H - 1, "s")
    for i, y in enumerate(range(64, H, 12)):
        hline(g, y, 0, W - 1, "S")
        for x in range((i * 5) % 10, W, 10):          # 葉が波打つ
            s = wave(x + i * 4, frame, 9, 1)
            h = 3 + abs(wave(x - i * 3, frame, 11, 1))
            g[y - h][x + s] = "g"
            g[y - h - 1][x + s] = "G"
            if x + 2 + s < W:
                g[y - h][x + 2 + s] = "g"
    return g


# ── セキュリティ v0: サーバールーム。LEDが絶えず走る ──

SECURITY_COLORS = {
    "R": "30304CC8", "e": "45426AC8",
    "c": "1E2438C0", "f": "2A3050C0", "d": "241C3A55",
    "g": "5FE0A0FF", "a": "36624EE0", "y": "FFC65EFF",
}
FLOOR_Y = 102
RACK_TOP = 38
RACK_W = 22
RACK_XS = (2, 26, 50, 74, 98, 122, 146, 170)


def draw_rack(g: Grid, x: int) -> list[tuple[int, int]]:
    """サーバーラック1本。**床に接地**させ、LEDを置ける座標を返す。"""
    rect(g, x, RACK_TOP, x + RACK_W - 1, FLOOR_Y - 1, "R")
    hline(g, RACK_TOP, x, x + RACK_W - 1, "e")
    for y in range(RACK_TOP, FLOOR_Y):
        g[y][x] = "e"
        g[y][x + RACK_W - 1] = "e"
    slots = []
    for y in range(RACK_TOP + 5, FLOOR_Y - 2, 7):
        hline(g, y, x + 1, x + RACK_W - 2, "e")
        for dx in (3, 6, 9):
            g[y - 2][x + dx] = "a"
            slots.append((x + dx, y - 2))
    return slots


def scene_security(frame: int) -> Grid:
    g = blank()
    dither(g, 0, RACK_TOP, "d", top=0.95, bottom=0.35)
    hline(g, 12, 0, W - 1, "d")
    hline(g, 13, 0, W - 1, "c")
    slots: list[tuple[int, int]] = []
    for x in RACK_XS:
        slots += draw_rack(g, x)
    rect(g, 0, FLOOR_Y, W - 1, H - 1, "c")
    for y in range(FLOOR_Y + 4, H, 7):
        hline(g, y, 0, W - 1, "f")
    for n, (x, y) in enumerate(slots):                # 通信のようにLEDが走る
        if (n * 7 + frame * 5) % 9 == 0:
            g[y][x] = "g"
        elif (n * 5 + frame * 3) % 23 == 0:
            g[y][x] = "y"
    return g


# ── セキュリティ v1: 端末の前。文字行が流れ、カーソルが点滅する ──

SEC2_COLORS = {
    "d": "241C3A55", "k": "2A2A40C8", "K": "3E3E58C8",
    "s": "1E3A34D0", "g": "4EC08AE0", "G": "8AE0B0FF",
    "t": "32304AC8", "T": "45426AC8",
}


def scene_security_console(frame: int) -> Grid:
    g = blank()
    dither(g, 0, 20, "d", top=0.9, bottom=0.4)
    for i, x in enumerate((10, 74, 138)):
        rect(g, x, 20, x + 52, 78, "k")
        rect(g, x + 3, 23, x + 49, 75, "s")
        for row in range(8):                          # 行が下から上へ流れる
            y = 26 + cycle(row * 6, frame, 4, 48)
            wdt = 6 + ((row * 7 + i * 3) % 34)
            hline(g, y, x + 5, x + 5 + wdt, "G" if row % 4 == 0 else "g")
        if frame % 4 < 2:                             # カーソル
            rect(g, x + 5, 70, x + 8, 72, "G")
        hline(g, 78, x, x + 52, "K")
        rect(g, x + 20, 79, x + 32, 84, "K")
    rect(g, 0, 86, W - 1, H - 1, "t")
    hline(g, 86, 0, W - 1, "T")
    for x in range(14, W - 20, 4):
        rect(g, x, 96, x + 2, 100, "K")
    return g


# ── セキュリティ v2: 夜のオフィス。街の灯りが瞬き、車が流れる ──

SEC3_COLORS = {
    "d": "1E2438A0", "w": "2A2A44C8", "W": "3E3E58C8",
    "c": "3A4A6AC0", "y": "E8C878E0", "b": "8AB0E0D0",
    "t": "32304AC8", "T": "45426AC8",
    "m": "2E4A44D0", "M": "5FE0A0FF", "h": "FFE0A0FF",   # 車のライト
}


def scene_security_office(frame: int) -> Grid:
    g = blank()
    rect(g, 0, 0, W - 1, 74, "c")
    dither(g, 0, 40, "d", top=0.8, bottom=0.2)
    for i, x in enumerate(range(4, W, 13)):
        h = 20 + (i * 17) % 44
        rect(g, x, 74 - h, x + 9, 74, "w")
        for k, y in enumerate(range(74 - h + 3, 72, 6)):
            if (i * 3 + k * 5 + frame) % 7 == 0:      # 窓の灯りが瞬く
                rect(g, x + 2, y, x + 3, y + 1, "y" if k % 2 else "b")
    for i in range(2):                                # 街を車が流れる
        cx = cycle(i * 120, frame, 20, 240) - 20
        if 0 <= cx < W:
            g[71][cx] = "h"
            if cx + 1 < W:
                g[71][cx + 1] = "h"
    for x in range(0, W, 66):
        vline(g, x, 0, 76, "W")
    hline(g, 76, 0, W - 1, "W")
    rect(g, 0, 78, W - 1, H - 1, "t")
    hline(g, 78, 0, W - 1, "T")
    for i, x in enumerate((22, 92, 156)):
        rect(g, x, 82, x + 30, 102, "m")
        for row in range(3):
            if (i + row * 2 + frame) % 5 == 0:
                hline(g, 86 + row * 5, x + 3, x + 24, "M")
    return g


# ── 寿司 v3: 厨房の奥。蒸籠の湯気と換気扇 ──

SUSHI4_COLORS = {
    "d": "241C3A55", "w": "3A2A20C8", "W": "4E392AC8",
    "k": "2A2A3AC8", "K": "44445EC8",
    "p": "5A5A6EC0", "P": "76768AC0",      # 鍋・寸胴
    "s": "9AA8C0A0", "f": "3A3A4AD0",      # 湯気・換気扇の枠
    "t": "6A4A38C0",
}


def scene_sushi_kitchen(frame: int) -> Grid:
    g = blank()
    dither(g, 0, 40, "d", top=0.9, bottom=0.3)
    rect(g, 0, 12, W - 1, 16, "k")                     # 吊り棚
    for x in range(8, W, 18):
        rect(g, x, 4, x + 10, 12, "K")
    fx, fy = 162, 44                                   # 換気扇。羽根が回る
    rect(g, 120, 20, W - 1, 30, "f")                   # レンジフード
    hline(g, 20, 120, W - 1, "K")
    rect(g, fx - 24, fy - 24, fx + 24, fy + 24, "f")
    rect(g, fx - 20, fy - 20, fx + 20, fy + 20, "k")
    for b in range(4):
        a = (frame / FRAMES + b / 4) * math.tau
        for r in range(3, 19):
            g[fy + round(r * math.sin(a))][fx + round(r * math.cos(a))] = "K"
    for i, x in enumerate((26, 66, 106)):              # 蒸籠を積む
        for k in range(3):
            y = 74 - k * 9
            rect(g, x - 15, y, x + 15, y + 8, "w")
            hline(g, y, x - 15, x + 15, "W")
        for k in range(3):                             # 湯気
            y = 48 - cycle(k * 12 + i * 4, frame, 3, 36)
            if 12 < y < 48:
                g[y][x + wave(y, frame, 4, 2)] = "s"
    rect(g, 132, 80, 176, 98, "p")                     # 寸胴
    hline(g, 80, 132, 176, "P")
    rect(g, 0, 100, W - 1, H - 1, "w")                 # 調理台
    hline(g, 100, 0, W - 1, "W")
    for x in range(0, W, 26):
        vline(g, x, 100, H - 1, "t")
    return g


# ── 寿司 v4: 氷の台。水滴が落ちる ──

SUSHI5_COLORS = {
    "d": "241C3A55", "i": "5A7A96C0", "I": "8AB0C8C0",   # 氷
    "w": "3A2A20C8", "W": "4E392AC8",
    "t": "6A4A38C0", "T": "9A8A70C0", "r": "8A3038C0",   # ネタ
    "b": "9AC0D0C0", "g": "3E4E60A0",
}


def scene_sushi_ice(frame: int) -> Grid:
    g = blank()
    dither(g, 0, 34, "d", top=0.9, bottom=0.3)
    rect(g, 0, 34, W - 1, 44, "w")                     # 台の縁
    hline(g, 34, 0, W - 1, "W")
    rect(g, 0, 44, W - 1, 96, "i")                     # 氷
    for i in range(70):                                # 氷の粒
        x = (i * 37 + 11) % W
        y = 46 + (i * 23) % 48
        g[y][x] = "I" if (i + frame // 4) % 5 else "i"
    for i, x in enumerate(range(18, W - 14, 34)):      # 並べたネタ
        rect(g, x - 12, 56 + (i % 2) * 14, x + 12, 66 + (i % 2) * 14, "r" if i % 2 else "T")
        hline(g, 56 + (i % 2) * 14, x - 12, x + 12, "t")
    rect(g, 0, 96, W - 1, H - 1, "w")
    hline(g, 96, 0, W - 1, "W")
    for i, x in enumerate((34, 110, 172)):             # 水滴が落ちる
        y = 96 + cycle(i * 12, frame, 3, 36) - 34
        if 96 < y < H - 2:
            g[y][x] = "b"
            g[y + 1][x] = "b"
    return g


# ── 寿司 v5: 座敷。障子に影が映る ──

SUSHI6_COLORS = {
    "d": "241C3A55", "s": "6A6250C0", "S": "8A8068C0",   # 障子
    "k": "3A2E24D0",                                     # 桟
    "p": "2A2438D0",                                     # 影
    "w": "3A2A20C8", "W": "4E392AC8",
    "l": "C8A050C0", "L": "F0C878E0",                    # 行灯
}


def scene_sushi_room(frame: int) -> Grid:
    g = blank()
    dither(g, 0, 18, "d", top=0.9, bottom=0.4)
    rect(g, 10, 18, W - 11, 92, "s")                   # 障子
    # 障子の向こうを人影が通る。**紙越しなので輪郭がぼやける想定で大きめに置く**
    px = cycle(0, frame, 24, 288) - 44
    if 8 < px < W - 8:
        rect(g, max(12, px - 12), 40, min(W - 13, px + 12), 90, "p")
        circle(g, px, 34, 9, "p")
    for x in range(10, W - 10, 22):
        vline(g, x, 18, 92, "k")
    for y in range(18, 93, 18):
        hline(g, y, 10, W - 11, "k")
    rect(g, 8, 92, W - 9, 96, "k")
    for i, cx in enumerate((26, 174)):                 # 行灯
        rect(g, cx - 9, 62, cx + 9, 92, "L" if (i + frame // 2) % 5 else "l")
        rect(g, cx - 10, 60, cx + 10, 62, "k")
        rect(g, cx - 10, 92, cx + 10, 94, "k")
    rect(g, 0, 96, W - 1, H - 1, "w")                  # 畳
    for y in range(102, H, 12):
        hline(g, y, 0, W - 1, "W")
    return g


# ── 動物 v3: 鳥小屋。羽ばたきと舞う羽 ──

ANIMAL4_COLORS = {
    "d": "1E2A3A80", "n": "3A3A4AD0", "N": "4E4E60D0",   # 金網・止まり木
    "b": "6A5A48D0", "B": "8A7458D0",                    # 鳥
    "f": "9A9A80A0",                                     # 羽
    "q": "26402EC0", "a": "3E3A34C8",
}


def scene_animal_aviary(frame: int) -> Grid:
    g = blank()
    dither(g, 0, 60, "d", top=0.9, bottom=0.25)
    for x in range(0, W, 8):                            # 金網
        vline(g, x, 0, 96, "n")
    for y in range(0, 97, 8):
        hline(g, y, 0, W - 1, "n")
    for i, (x, y) in enumerate(((30, 52), (96, 38), (156, 60))):   # 止まり木
        rect(g, x - 24, y, x + 24, y + 3, "N")
        flap = 3 if (frame + i * 4) % 6 < 3 else 0      # 羽ばたく
        circle(g, x, y - 6, 5, "b")
        circle(g, x + 4, y - 8, 3, "B")
        rect(g, x - 9, y - 8 - flap, x - 4, y - 6 - flap, "b")
        rect(g, x + 5, y - 8 - flap, x + 10, y - 6 - flap, "b")
    for i in range(5):                                  # 羽が舞い落ちる
        y = cycle(i * 24, frame, 2, 24) + (i % 3) * 30
        x = (i * 41 + 13) % W + wave(y, frame + i, 5, 3)
        if 0 <= x < W and y < 96:
            g[y][x] = "f"
    rect(g, 0, 96, W - 1, H - 1, "a")
    for x in range(0, W, 5):
        vline(g, x, 96 - 4 - wave(x, frame, 8, 1), 96, "q")
    return g


# ── 動物 v4: 大型獣の獣舎。ゆっくり揺れる影 ──

ANIMAL5_COLORS = {
    "d": "1E2A3A80", "s": "3A3448C8", "S": "4E486AC8",   # 岩壁
    "b": "302A3ED0", "B": "45405AD0",                    # 獣
    "a": "3E3A34C8", "q": "26402EC0", "w": "5A4A30C0",   # 藁
}


def scene_animal_beast(frame: int) -> Grid:
    g = blank()
    dither(g, 0, 40, "d", top=0.9, bottom=0.3)
    rect(g, 0, 40, W - 1, 96, "s")                      # 岩壁
    for i in range(24):
        x = (i * 29) % W
        y = 44 + (i * 13) % 46
        rect(g, x, y, x + 7, y + 4, "S")
    sway = round(3 * math.sin(frame / FRAMES * math.tau))
    circle(g, 86 + sway, 78, 27, "b", "B")              # 胴
    circle(g, 46 + sway * 2, 60, 14, "b", "B")          # 頭
    circle(g, 54 + sway * 2, 50, 9, "B")                # 耳（輪郭を作るのに効く）
    for k in range(16):                                 # 鼻が垂れて揺れる
        g[62 + k][34 + sway * 2 + round(4 * math.sin((k + frame) / 7))] = "b"
        g[62 + k][35 + sway * 2 + round(4 * math.sin((k + frame) / 7))] = "b"
    for dx in (-16, 0, 16):                             # 脚
        rect(g, 76 + dx + sway, 92, 82 + dx + sway, 104, "b")
    rect(g, 0, 100, W - 1, H - 1, "a")
    for x in range(0, W, 7):                            # 藁
        y = 104 + (x // 7 % 3) * 6
        rect(g, x, y, x + 5, y + 1, "w")
    for x in range(0, W, 5):
        vline(g, x, 100 - 3, 100, "q")
    return g


# ── 動物 v5: 雨の日。雨が降り水たまりに波紋 ──

ANIMAL6_COLORS = {
    "d": "1E2A3A90", "r": "6A80A0A0", "R": "90A8C0C0",   # 雨
    "t": "24382CC8", "T": "2E4636C8",
    "a": "3E3A34C8", "p": "35506AC0", "P": "5A7A96C0",   # 水たまり
    "q": "26402EC0",
}


def scene_animal_rain(frame: int) -> Grid:
    g = blank()
    dither(g, 0, 70, "d", top=0.95, bottom=0.4)
    for cx, cy, r in ((30, 56, 16), (110, 50, 20), (176, 58, 14)):
        circle(g, cx, cy, r, "t", "T")
    rect(g, 0, 92, W - 1, H - 1, "a")
    for i, (x, y, w_) in enumerate(((40, 108, 26), (120, 118, 34), (176, 104, 18))):
        rect(g, x - w_, y, x + w_, y + 6, "p")          # 水たまり
        ring = (frame + i * 4) % 12                     # 波紋が広がる
        if ring < 8:
            rect(g, x - ring * 3, y + 2, x + ring * 3, y + 2, "P")
    for i in range(46):                                 # 雨
        speed = 2 + i % 2
        y = cycle(i * 7, frame, speed * 2, speed * 2 * FRAMES) % 120
        x = (i * 31 + 5) % W
        g[y][x] = "R" if i % 5 == 0 else "r"
        if y + 1 < H:
            g[y + 1][x] = "r"
    for x in range(0, W, 6):
        vline(g, x, 92 - 4, 92, "q")
    return g


# ── 動詞 v3: 校庭。遠くの校舎とボール ──

VERB4_COLORS = {
    "d": "1E2A3A80", "b": "3A3A50C8", "B": "50506EC8",   # 校舎
    "l": "5A6A8AA0", "t": "24382CC8", "T": "2E4636C8",
    "a": "4A4230C8", "A": "5E5440C8",                    # 地面
    "o": "C87A48D0",                                     # ボール
    "p": "2A2438C0",
}


def scene_verb_yard(frame: int) -> Grid:
    g = blank()
    dither(g, 0, 40, "d", top=0.9, bottom=0.25)
    rect(g, 8, 22, 96, 78, "b")                         # 校舎
    hline(g, 22, 8, 96, "B")
    for y in range(28, 76, 12):
        for x in range(12, 94, 12):
            rect(g, x, y, x + 8, y + 7, "l")
    for cx, cy, r in ((132, 54, 16), (168, 60, 12), (196, 50, 14)):
        circle(g, cx, cy, r, "t", "T")
    rect(g, 0, 84, W - 1, H - 1, "a")                   # 地面
    for y in range(90, H, 11):
        hline(g, y, 0, W - 1, "A")
    bx = cycle(0, frame, 16, 192) + 4                   # ボールが弾む
    bh = abs(round(18 * math.sin(frame / FRAMES * math.tau * 2)))
    if bx < W - 4:
        circle(g, bx, 80 - bh, 4, "o")
        rect(g, bx - 5, 84, bx + 5, 85, "p")            # 影
    return g


# ── 動詞 v4: 職員室。時計の針が回る ──

VERB5_COLORS = {
    "d": "241C3A55", "w": "3A3448C8", "W": "50486AC8",
    "p": "8A8270C0", "P": "AAA290C0",                    # 書類
    "c": "C8C0A8D0", "k": "2A2438D0",                    # 時計
    "t": "2E2A3EC8", "T": "423C56C8",
    "l": "E0C878C0",
}


def scene_verb_office(frame: int) -> Grid:
    g = blank()
    dither(g, 0, 22, "d", top=0.9, bottom=0.4)
    rect(g, 0, 20, W - 1, 84, "w")                      # 壁と棚
    # 書類は**まばらに・太く・高さを振って**置く。細かく等間隔に並べると
    # キーボードに見えた（実際にそうなった）
    for row, y in enumerate(range(26, 82, 14)):
        hline(g, y, 0, W - 1, "W")
        x = 4
        while x < W - 14:
            wdt = 9 + ((x + row * 7) % 3) * 6
            hgt = 8 + ((x // 5 + row) % 3) * 2
            rect(g, x, y + 12 - hgt, x + wdt, y + 11, "p" if (x + row) % 2 else "P")
            x += wdt + 4 + ((x + row) % 3) * 3
    cx, cy = 168, 40                                    # 時計。針が回る
    circle(g, cx, cy, 13, "c")
    circle(g, cx, cy, 11, "k")
    a = frame / FRAMES * math.tau
    for r in range(9):
        g[cy - round(r * math.cos(a))][cx + round(r * math.sin(a))] = "c"
    for r in range(6):
        g[cy - round(r * math.cos(a / 12))][cx + round(r * math.sin(a / 12))] = "c"
    rect(g, 0, 88, W - 1, H - 1, "t")                   # 机
    hline(g, 88, 0, W - 1, "T")
    for i, x in enumerate((24, 96, 160)):
        for k in range(3 + i):
            rect(g, x - 14, 86 - k * 3, x + 14, 88 - k * 3, "P" if k % 2 else "p")
    if frame % 6 < 3:
        rect(g, 60, 92, 78, 94, "l")                    # 端末の光
    return g


# ── 動詞 v5: 夕暮れの教室。影が伸びる ──

VERB6_COLORS = {
    "d": "3A2438A0", "s": "C87A48C0", "S": "E8A868D0",   # 夕日
    "w": "4A3A50C8", "l": "A06A5AB0", "L": "D89870C0",
    "b": "24382EC8", "B": "36503EC8",
    "t": "3A2E42C8", "T": "56486AC8", "p": "2A1E30C0",
}


def scene_verb_dusk(frame: int) -> Grid:
    g = blank()
    dither(g, 0, 30, "d", top=0.9, bottom=0.3)
    for i, x in enumerate((110, 152)):                  # 窓
        rect(g, x, 16, x + 34, 80, "w")
        rect(g, x + 2, 18, x + 32, 78, "L" if (i + frame // 3) % 2 else "l")
        vline(g, x + 16, 18, 78, "w")
        hline(g, 46, x + 2, x + 32, "w")
    circle(g, 146, 56, 9, "S")                          # 沈む夕日
    circle(g, 146, 56, 6, "s")
    rect(g, 6, 20, 96, 72, "B")                         # 黒板
    rect(g, 9, 23, 93, 69, "b")
    rect(g, 0, 88, W - 1, H - 1, "t")                   # 床
    for i, x in enumerate(range(4, 110, 34)):           # 机と伸びる影
        rect(g, x, 92, x + 26, 100, "T")
        shade = 10 + round(6 * math.sin(frame / FRAMES * math.tau))
        rect(g, x - shade, 100, x + 26 - shade, 104, "p")
    return g


# ── 八百屋 v3: 冷蔵ケース。蛍光灯が明滅し霜が流れる ──

YASAI4_COLORS = {
    "d": "241C3A55", "k": "2A2A3AD0", "K": "44445EC8",
    "G": "3E5A6AA0", "F": "7A98A8A0",                    # ガラス・霜
    "g": "2E5A3CC0", "o": "7A5A2AC0", "p": "6A2A44C0",
    "l": "8A9AA0C0", "L": "D8E8F0E0",                    # 蛍光灯
    "w": "4A3A28C8",
}


def scene_yasai_fridge(frame: int) -> Grid:
    g = blank()
    dither(g, 0, 16, "d", top=0.9, bottom=0.4)
    for i, x in enumerate((20, 110)):                   # 蛍光灯
        lit = "L" if (i * 2 + frame) % 11 else "l"
        rect(g, x, 10, x + 70, 13, lit)
    for i, x in enumerate((6, 104)):                    # 冷蔵ケース2台
        rect(g, x, 20, x + 88, 108, "k")
        rect(g, x + 3, 23, x + 85, 105, "G")
        for row, y in enumerate(range(28, 100, 24)):    # 棚の野菜
            hline(g, y + 20, x + 4, x + 84, "K")
            for k, bx in enumerate(range(x + 8, x + 82, 18)):
                rect(g, bx, y + 6, bx + 13, y + 18, ("g", "o", "p")[(k + row + i) % 3])
        for k in range(6):                              # 霜が伝う
            fy = 24 + cycle(k * 14, frame, 7, 84) % 80
            g[min(104, fy)][x + 10 + k * 13] = "F"
    rect(g, 0, 108, W - 1, H - 1, "w")
    return g


# ── 八百屋 v4: 荷下ろし。軽トラと人影 ──

YASAI5_COLORS = {
    "d": "241C3A55", "t": "4A5A6AC8", "T": "64788AC8",   # トラック
    "k": "2A2438D0", "w": "4A3A28C8", "W": "5E4A34C8",
    "g": "2E5A3CC0", "o": "7A5A2AC0",
    "l": "E8D08AD0", "p": "1A1626D0",
}


def scene_yasai_truck(frame: int) -> Grid:
    g = blank()
    dither(g, 0, 40, "d", top=0.9, bottom=0.3)
    rect(g, 10, 38, 104, 84, "t")                       # 荷台
    hline(g, 38, 10, 104, "T")
    rect(g, 104, 48, 148, 84, "t")                      # 運転席
    rect(g, 110, 54, 142, 70, "k")
    hline(g, 48, 104, 148, "T")
    for i, cx in enumerate((36, 128)):                  # 車輪が回る
        circle(g, cx, 92, 11, "k")
        a = frame / FRAMES * math.tau
        for r in range(-8, 9):
            g[92 + round(r * math.sin(a))][cx + round(r * math.cos(a))] = "T"
    rect(g, 150, 78, 166, 86, "l")                      # ヘッドライトの光
    for row, y in enumerate((44, 62)):                  # 荷台の木箱
        for x in range(16, 100, 30):
            rect(g, x, y, x + 26, y + 16, "w")
            hline(g, y, x, x + 26, "W")
            rect(g, x + 4, y + 4, x + 22, y + 10, ("g", "o")[(row + x) % 2])
    px = cycle(0, frame, 24, 288) - 60                  # 運ぶ人影
    if 0 < px < W:
        rect(g, max(0, px - 8), 92, min(W - 1, px + 8), 118, "p")
        circle(g, px, 86, 7, "p")
    rect(g, 0, 118, W - 1, H - 1, "k")
    return g


# ── 八百屋 v5: 雨の商店街。アーケードと水たまり ──

YASAI6_COLORS = {
    "d": "241C3A70", "a": "3A3448C8", "A": "50486AC8",   # アーケード
    "r": "6A2A2ED0", "c": "C8BCA8B0",
    "w": "4A3A28C8", "g": "2E5A3CC0", "o": "7A5A2AC0",
    "n": "6A80A0A0",                                     # 雨
    "p": "35506AC0", "P": "5A7A96C0",
}


def scene_yasai_arcade(frame: int) -> Grid:
    g = blank()
    rect(g, 0, 0, W - 1, 20, "a")                       # アーケードの屋根
    for x in range(0, W, 16):
        rect(g, x, 0, x + 7, 20, "A")
    dither(g, 20, 60, "d", top=0.85, bottom=0.3)
    for i, x in enumerate((6, 108)):                    # 店先2軒
        rect(g, x, 26, x + 84, 34, "c")
        for k in range(x, x + 84, 18):
            rect(g, k, 26, k + 8, 34, "r")
        for row, y in enumerate((74, 96)):
            for bx in range(x + 2, x + 80, 28):
                rect(g, bx, y, bx + 24, y + 14, "w")
                rect(g, bx + 4, y + 3, bx + 20, y + 9, ("g", "o")[(row + bx) % 2])
    for i in range(30):                                 # 屋根の切れ目から雨
        y = 20 + cycle(i * 9, frame, 6, 72) % 90
        x = (i * 43 + 9) % W
        if 20 < y < 112:
            g[y][x] = "n"
    for i, (x, y, w_) in enumerate(((44, 120, 30), (144, 116, 24))):
        rect(g, x - w_, y, x + w_, y + 6, "p")          # 水たまり
        ring = (frame + i * 6) % 12
        if ring < 8:
            rect(g, x - ring * 3, y + 2, x + ring * 3, y + 2, "P")
    return g


# ── セキュリティ v3: ネットワーク図。線をパケットが流れる ──

SEC4_COLORS = {
    "d": "241C3A55", "l": "2E4A5AC0", "L": "44708AC0",   # 結線
    "n": "3A4A6AD0", "N": "5A7A9AD0",                    # ノード
    "g": "5FE0A0FF", "y": "FFC65EFF",
    "t": "32304AC8",
}
NET_NODES = ((28, 34), (100, 22), (172, 40), (58, 76), (140, 82), (100, 108))
NET_LINKS = ((0, 1), (1, 2), (0, 3), (1, 4), (2, 4), (3, 5), (4, 5), (3, 4))


def scene_security_net(frame: int) -> Grid:
    g = blank()
    dither(g, 0, H - 1, "d", top=0.5, bottom=0.15)
    for a, b in NET_LINKS:                              # 結線
        (x0, y0), (x1, y1) = NET_NODES[a], NET_NODES[b]
        steps = max(abs(x1 - x0), abs(y1 - y0))
        for s in range(steps + 1):
            g[y0 + (y1 - y0) * s // steps][x0 + (x1 - x0) * s // steps] = "l"
    for i, (a, b) in enumerate(NET_LINKS):              # パケットが流れる
        (x0, y0), (x1, y1) = NET_NODES[a], NET_NODES[b]
        t_ = ((frame + i * 3) % FRAMES) / FRAMES
        px, py = round(x0 + (x1 - x0) * t_), round(y0 + (y1 - y0) * t_)
        for dx, dy in ((0, 0), (1, 0), (0, 1), (1, 1)):
            if 0 <= py + dy < H and 0 <= px + dx < W:
                g[py + dy][px + dx] = "g" if i % 3 else "y"
    for i, (x, y) in enumerate(NET_NODES):              # ノード
        circle(g, x, y, 9, "n", "N")
        circle(g, x, y, 4, "L" if (i + frame // 2) % 4 else "l")
    rect(g, 0, H - 8, W - 1, H - 1, "t")
    return g


# ── セキュリティ v4: 監視モニタの壁。走査線が流れる ──

SEC5_COLORS = {
    "d": "241C3A55", "k": "2A2A40D0", "K": "3E3E58C8",
    "s": "24343ED0", "S": "3A5060C0",                    # 画面
    "c": "6A98A8C0",                                     # 走査線
    "g": "5FE0A0FF", "t": "32304AC8",
}


def scene_security_cctv(frame: int) -> Grid:
    g = blank()
    dither(g, 0, 12, "d", top=0.9, bottom=0.4)
    for row in range(3):
        for col in range(5):
            x, y = 4 + col * 39, 10 + row * 38
            rect(g, x, y, x + 35, y + 34, "k")
            rect(g, x + 2, y + 2, x + 33, y + 32, "s")
            n = row * 5 + col
            for k in range(3):                          # 画面の中身（適当な影）
                bx = x + 6 + ((n * 7 + k * 11) % 20)
                by = y + 8 + ((n * 5 + k * 9) % 18)
                rect(g, bx, by, bx + 6, by + 8, "S")
            sy = y + 2 + cycle(n * 3, frame, 3, 36) % 30   # 走査線
            hline(g, sy, x + 2, x + 33, "c")
            if (n + frame) % 9 == 0:
                rect(g, x + 30, y + 4, x + 31, y + 5, "g")   # 録画ランプ
    rect(g, 0, H - 12, W - 1, H - 1, "t")
    hline(g, H - 12, 0, W - 1, "K")
    return g


# ── セキュリティ v5: 配線室。ケーブルの束とインジケータ ──

SEC6_COLORS = {
    "d": "241C3A55", "k": "2A2A40D0", "K": "3E3E58C8",
    "b": "3A4A6AC8", "o": "6A4A30C8", "r": "6A3040C8",   # ケーブル3色
    "g": "5FE0A0FF", "y": "FFC65EFF", "a": "36624EE0",
    "t": "32304AC8", "p": "1E2438C0",
}


def scene_security_cables(frame: int) -> Grid:
    g = blank()
    dither(g, 0, 20, "d", top=0.9, bottom=0.4)
    rect(g, 0, 16, W - 1, 24, "k")                      # ケーブルラック
    for i in range(32):                                 # 垂れ下がるケーブル
        x = 4 + i * 6
        col = ("b", "o", "r")[i % 3]
        depth = 40 + (i * 13) % 46
        for y in range(24, depth):
            g[y][min(W - 1, x + round(2 * math.sin((y + i * 3) / 9)))] = col
        circle(g, x, depth, 2, col)
    rect(g, 0, 92, W - 1, H - 1, "p")                   # パッチパネル
    for row, y in enumerate(range(96, H - 4, 12)):
        rect(g, 6, y, W - 7, y + 8, "k")
        hline(g, y, 6, W - 7, "K")
        for k, x in enumerate(range(10, W - 12, 9)):    # ポートのランプ
            n = row * 21 + k
            g[y + 4][x] = "g" if (n * 5 + frame * 7) % 11 == 0 else (
                "y" if (n * 3 + frame * 5) % 29 == 0 else "a")
    return g


# ── 寿司 v6: 回転レーン。皿が流れ続ける ──

SUSHI7_COLORS = {
    "d": "241C3A55",
    "w": "3A2A20C8", "W": "4E392AC8",                    # カウンター
    "b": "32303EC8", "B": "4A4858C8", "k": "2A2A3AC8",   # レーン
    "p": "8A8A96C0", "P": "AEAEB8C0",                    # 皿
    "t": "6A4A38C0", "T": "9A8A70C0", "r": "8A3038C0",   # ネタ
    "l": "C8A050C0",
}


def scene_sushi_lane(frame: int) -> Grid:
    g = blank()
    dither(g, 0, 44, "d", top=0.9, bottom=0.3)
    rect(g, 16, 8, 96, 26, "k")                          # 吊り看板
    hline(g, 8, 16, 96, "l")
    for x in range(24, 92, 13):
        vline(g, x, 12, 22, "l")
    rect(g, 0, 30, W - 1, 36, "w")                       # 鴨居
    hline(g, 30, 0, W - 1, "W")
    for i, x in enumerate((110, 130, 150, 170)):         # 短冊の品書き
        rect(g, x, 36, x + 9, 41 + (i % 3) * 2, "W")
        vline(g, x + 4, 38, 40 + (i % 3) * 2, "t")
    rect(g, 0, 46, W - 1, 76, "b")                       # レーン
    hline(g, 46, 0, W - 1, "B")
    for y in range(52, 76, 8):                           # ベルトの継ぎ目
        hline(g, y, 0, W - 1, "k")
    # 皿が流れる。2系統を96px間隔でずらして置くと、輪が一周しても皿の種類が入れ替わらない
    for base, neta, hgt in ((0, "t", 8), (48, "r", 11)):
        off = cycle(base, frame, 8, 96)
        for x in range(off - 96, W + 96, 96):
            rect(g, x - 15, 62, x + 15, 65, "p")         # 皿
            hline(g, 62, x - 15, x + 15, "P")
            rect(g, x - 9, 62 - hgt, x + 9, 61, neta)    # ネタ
            hline(g, 62 - hgt, x - 9, x + 9, "T")
    rect(g, 0, 76, W - 1, H - 1, "w")                    # カウンター
    hline(g, 76, 0, W - 1, "W")
    for y in (94, 110, 126):
        hline(g, y, 0, W - 1, "W")
    for x in (28, 158):                                  # 湯呑み（台に接地）
        rect(g, x - 6, 96, x + 6, 110, "t")
        hline(g, 96, x - 6, x + 6, "T")
    rect(g, 86, 100, 114, 106, "p")                      # 醤油皿
    hline(g, 100, 86, 114, "P")
    rect(g, 52, 92, 62, 110, "k")                        # 醤油差し
    hline(g, 92, 52, 62, "B")
    for x in (104, 132):                                 # 箸置き
        rect(g, x - 8, 118, x + 8, 121, "T")
    return g


# ── 寿司 v7: 魚市場のセリ。仲買人が横切る ──

SUSHI8_COLORS = {
    "d": "241C3A55", "k": "2A2A3AD0", "K": "42425AC8",   # シャッター
    "w": "3A2A20C8", "W": "4E392AC8",                    # セリ台
    "s": "6A7280C0", "S": "8A94A0C0",                    # 発泡箱
    "f": "545E74C0", "F": "8A9AB0C0",                    # 魚
    "i": "6A8296A0", "p": "1A1626D0",                    # 氷・人影
    "l": "E8D08AD0", "g": "302E3CC8",                    # 電球・土間
}


def scene_sushi_market(frame: int) -> Grid:
    g = blank()
    dither(g, 0, 18, "d", top=0.9, bottom=0.4)
    rect(g, 0, 16, W - 1, 56, "k")                       # 奥のシャッター
    for x in range(0, W, 5):
        vline(g, x, 18, 54, "K")
    for i, x in enumerate((40, 150)):                    # 吊り電球が揺れる
        s = wave(i * 24, frame, 1, 3)
        for y in range(0, 19):
            g[y][max(0, min(W - 1, x + round(s * y / 19)))] = "k"
        circle(g, x + s, 22, 4, "l")
    rect(g, 0, 56, W - 1, 66, "w")                       # セリ台
    hline(g, 56, 0, W - 1, "W")
    rect(g, 0, 66, W - 1, H - 1, "g")                    # 土間
    px = cycle(0, frame, 24, 288) - 50                   # 仲買人が横切る
    if 0 < px < W:
        # 細長いと柱に見える。**箱より背を低く・肩幅を広く**取って人にする
        rect(g, max(0, px - 13), 34, min(W - 1, px + 13), 88, "p")
        circle(g, px, 26, 10, "p")
    for x, y, wd, hg in ((6, 80, 46, 18), (62, 84, 34, 14),
                         (108, 78, 52, 20), (168, 86, 28, 12)):
        rect(g, x, y, x + wd, y + hg, "s")               # 発泡箱（大きさを振る）
        hline(g, y, x, x + wd, "S")
        rect(g, x + 4, y - 4, x + wd - 4, y - 1, "i")    # 詰めた氷
        rect(g, x + 9, y - 7, x + wd - 11, y - 4, "f")   # のぞく魚
    fx, fy = 34, 118                                     # 土間に横たわる大物
    for k in range(70):
        h = round(8 * math.sin(math.pi * k / 70))
        vline(g, fx + k, fy - h, fy + h, "f")
    hline(g, fy - 3, fx + 10, fx + 58, "F")
    for k in range(9):                                   # 尾びれ
        vline(g, fx + 69 + k, fy - k, fy + k, "f")
    circle(g, fx + 8, fy - 1, 2, "F")
    return g


# ── 動物 v6: ペンギンの水槽。水中を泳ぎ、泡が上がる ──

ANIMAL7_COLORS = {
    "d": "1E2A3A80", "w": "22364EC8", "W": "2E4A66C8",
    "g": "3E6A88A0", "i": "5A7A96C0", "I": "8AB0C8C0",
    "r": "3A3A48C8", "p": "191726D0", "P": "C0C8D4D0",
    "b": "9AC0D0C0",
}


def draw_penguin(g: Grid, x: int, y: int, d: int, flap: int) -> None:
    """横泳ぎのペンギン1羽。`d` は向き（+1 で右）。

    **丸を重ねただけだと黒い塊にしか見えない**（実際に踏んだ）。腹の白を前寄りに
    置いて、その上を羽で横切らせると初めて輪郭が立つ。
    """
    for k in range(-12, 13):                             # 胴（横長）
        hh = round(7 * math.sqrt(max(0.0, 1 - (k / 12.0) ** 2)))
        vline(g, x + d * k, y - hh, y + hh, "p")
    for k in range(-5, 10):                              # 腹（前寄りの下半分）
        hh = round(6 * math.sqrt(max(0.0, 1 - ((k - 2) / 8.0) ** 2)))
        vline(g, x + d * k, y + 1, y + hh, "P")
    circle(g, x + d * 13, y - 5, 5, "p")                 # 頭
    b0, b1 = sorted((x + d * 16, x + d * 22))
    rect(g, b0, y - 6, b1, y - 4, "P")                   # くちばし
    g[max(0, y - 8)][max(0, min(W - 1, x + d * 14))] = "P"          # 目
    for k in range(7):                                   # 羽が腹を横切る
        vline(g, x + d * (4 - k), y + 1 + k, y + 3 + k, "p")
    f0, f1 = sorted((x - d * 15, x - d * 9))
    rect(g, f0, y + 4 + flap, f1, y + 6 + flap, "P")     # 足ひれ


def scene_animal_penguin(frame: int) -> Grid:
    g = blank()
    dither(g, 0, 14, "d", top=0.9, bottom=0.4)
    rect(g, 0, 14, W - 1, H - 1, "w")
    for x in range(W):                                   # 水面が揺れる
        y = 16 + wave(x, frame, 9, 2)
        g[y][x] = "g"
        rect(g, x, 0, x, y - 1, "d")
    for y in range(32, H, 16):                           # 水の層
        hline(g, y, 0, W - 1, "W")
    for x0 in (26, 150):                                 # 差し込む光
        for y in range(20, 82):
            x = x0 + (y - 20) // 3
            if 0 <= x < W:
                g[y][x] = "g"
                if x + 1 < W:
                    g[y][x + 1] = "g"
    rect(g, 0, 110, W - 1, H - 1, "i")                   # 氷の底
    for cx, r in ((24, 16), (94, 12), (168, 18)):
        circle(g, cx, 110, r, "I")
    for cx, cy, r in ((58, 118, 10), (132, 120, 12)):
        circle(g, cx, cy, r, "r")
    for cx, y, ph in ((60, 46, 0), (134, 72, 5), (92, 96, 9)):
        # 水槽の中を行き来する。横断させると12コマでは速すぎて泳ぎに見えない
        sw = round(22 * math.sin((frame + ph) / FRAMES * math.tau))
        draw_penguin(g, cx + sw, y, 1 if sw >= 0 else -1, 0 if frame % 4 < 2 else 3)
    for i, x in enumerate((36, 78, 124, 174)):           # 泡
        for k in range(4):
            y = 108 - cycle(k * 24, frame, 8, 96)
            if 20 < y < 110:
                g[y][max(0, min(W - 1, x + wave(y, frame, 5, 2)))] = "b"
    return g


# ── 動物 v7: 園路。街灯が灯り、落ち葉が舞う ──

ANIMAL8_COLORS = {
    "d": "1E2A3A80", "t": "24382CC8", "T": "2E4636C8",
    "q": "26402EC0", "Q": "31543CC0",
    "p": "3A3630C8", "P": "504A40C8",                    # 道
    "b": "4A3A28C8", "B": "5E4A34C8",                    # ベンチ・看板
    "l": "8A8A70C0", "L": "E8D8A0E0",                    # 街灯
    "f": "9A7A50A0",                                     # 落ち葉
}


def scene_animal_path(frame: int) -> Grid:
    g = blank()
    dither(g, 0, 50, "d", top=0.9, bottom=0.3)
    for cx, cy, r in ((16, 40, 22), (66, 30, 18), (118, 38, 24), (182, 28, 20)):
        vline(g, cx, cy, 92, "b")                        # 幹（道まで下ろす）
        vline(g, cx + 1, cy, 92, "b")
        circle(g, cx, cy, r, "t", "T")
    for i, x in enumerate((44, 152)):                    # 街灯（道まで下ろす）
        rect(g, x, 34, x + 1, 92, "l")
        rect(g, x - 3, 88, x + 4, 92, "l")
        rect(g, x - 7, 26, x + 8, 34, "L" if (i * 2 + frame) % 7 else "l")
        hline(g, 26, x - 7, x + 8, "L")
    rect(g, 0, 92, W - 1, H - 1, "p")                    # 園路
    hline(g, 92, 0, W - 1, "P")
    for y in range(100, H, 12):
        hline(g, y, 0, W - 1, "P")
    for x in range(0, W, 5):                             # 道端の草
        vline(g, x, 92 - 4 - abs(wave(x, frame, 8, 2)), 92, "q")
    bx = 96                                              # ベンチ（接地）
    rect(g, bx - 26, 100, bx + 26, 104, "b")
    hline(g, 100, bx - 26, bx + 26, "B")
    rect(g, bx - 26, 88, bx + 26, 92, "b")
    for dx in (-22, 22):
        vline(g, bx + dx, 92, 114, "b")
        vline(g, bx + dx + 1, 104, 114, "b")
    rect(g, 166, 74, 194, 92, "b")                       # 案内看板
    hline(g, 74, 166, 194, "B")
    for y in (80, 86):
        hline(g, y, 170, 190, "B")
    vline(g, 180, 92, 112, "b")
    for i in range(7):                                   # 落ち葉が舞い落ちる
        y = cycle(i * 15, frame, 5, 60) + (i % 3) * 22
        x = (i * 31 + 9) % W + wave(y, frame + i, 6, 4)
        if 8 < y < 92 and 0 <= x < W:
            g[y][x] = "f"
            if x + 1 < W:
                g[y][x + 1] = "f"
    return g


# ── 動詞 v6: 体育館。舞台の幕が揺れ、人影が横切る ──

VERB7_COLORS = {
    "d": "241C3A55", "w": "3A3448C8", "W": "50486AC8",
    "l": "5A6A8AA0", "L": "7A8AAEB0",
    "c": "5A2A38C0", "C": "78394BC0", "k": "2A2438D0",
    "b": "5A4A34C8", "B": "72603FC8",                    # 床
    "o": "C87A48D0", "p": "1E1A2AD0",
}


def scene_verb_gym(frame: int) -> Grid:
    g = blank()
    rect(g, 0, 0, W - 1, 86, "w")
    dither(g, 0, 30, "d", top=0.8, bottom=0.3)
    for x in range(10, W - 20, 32):                      # 高窓
        rect(g, x, 8, x + 20, 26, "l")
        hline(g, 8, x, x + 20, "L")
        vline(g, x + 10, 8, 26, "w")
    rect(g, 0, 40, 74, 86, "k")                          # 舞台
    hline(g, 40, 0, 74, "W")
    for i, x in enumerate(range(0, 74, 7)):              # 幕が揺れる
        s = wave(i * 6, frame, 2, 2)
        vline(g, max(0, min(73, x + s)), 42, 78, "C" if i % 2 else "c")
        vline(g, max(0, min(73, x + s + 1)), 42, 78, "c")
    vline(g, 168, 44, 86, "W")                           # バスケットゴール
    vline(g, 169, 44, 86, "W")
    rect(g, 146, 28, 180, 46, "W")
    rect(g, 149, 31, 177, 43, "w")
    rect(g, 152, 46, 168, 48, "o")
    rect(g, 92, 32, 138, 54, "k")                        # 得点板
    hline(g, 32, 92, 138, "W")
    for i, x in enumerate((98, 118)):
        rect(g, x, 38, x + 14, 48, "L" if (i + frame // 3) % 2 else "l")
    for k in range(4):                                   # 跳び箱（床に接地）
        rect(g, 88 - k * 2, 86 - (k + 1) * 6, 118 + k * 2, 86 - k * 6,
             "b" if k % 2 else "B")
    rect(g, 0, 86, W - 1, H - 1, "b")                    # 床
    hline(g, 86, 0, W - 1, "B")
    for y in range(92, H, 9):
        hline(g, y, 0, W - 1, "B")
    for a in range(0, 360, 3):                           # コートのライン
        ex = 104 + round(46 * math.cos(math.radians(a)))
        ey = 114 + round(13 * math.sin(math.radians(a)))
        if 0 <= ex < W and 88 < ey < H:
            g[ey][ex] = "L"
    hline(g, 92, 0, W - 1, "L")
    px = cycle(0, frame, 24, 288) - 44                   # 人影が横切る
    if 0 < px < W:
        rect(g, max(0, px - 8), 58, min(W - 1, px + 8), 94, "p")
        circle(g, px, 52, 7, "p")
        rect(g, max(0, px - 14), 94, min(W - 1, px + 14), 96, "k")
    return g


# ── 動詞 v7: プール。水面が流れ、コースロープが上下する ──

VERB8_COLORS = {
    "d": "241C3A55", "w": "3A3448C8", "W": "50486AC8",
    "l": "5A6A8AA0", "L": "7A8AAEB0",
    "t": "56606EC0", "T": "838C9AC0",                    # プールサイド
    "b": "24485EC8", "B": "356A88B0", "g": "6A96ACA0",   # 水
    "r": "7A4A48C0", "R": "9A8258C0",                    # コースロープの浮き
}


def scene_verb_pool(frame: int) -> Grid:
    g = blank()
    rect(g, 0, 0, W - 1, 38, "w")
    dither(g, 0, 26, "d", top=0.85, bottom=0.3)
    for x in range(8, W - 24, 44):                       # 奥の高窓
        rect(g, x, 6, x + 26, 24, "l")
        hline(g, 6, x, x + 26, "L")
        vline(g, x + 13, 6, 24, "w")
    rect(g, 0, 38, W - 1, 56, "t")                       # プールサイド
    hline(g, 38, 0, W - 1, "T")
    for x in (22, 62, 102, 142, 182):                    # スタート台（接地）
        rect(g, x - 7, 26, x + 7, 38, "T")
        rect(g, x - 7, 34, x + 7, 38, "w")               # 前面を暗くして箱にする
        vline(g, x - 7, 26, 33, "w")
    rect(g, 0, 56, W - 1, H - 1, "b")                    # 水
    hline(g, 56, 0, W - 1, "w")
    for i, y in enumerate(range(66, H, 12)):             # 水面のきらめきが流れる
        off = cycle(i * 9, frame, 3, 36)
        for x in range(off - 36, W, 36):
            rect(g, max(0, x), y, min(W - 1, x + 12), y, "B")
    for row, y in enumerate((82, 112)):                  # コースロープが上下する
        for i, x in enumerate(range(0, W, 10)):
            dy = wave(x + row * 6, frame, 8, 1)
            rect(g, x, y + dy, x + 6, y + dy + 2, "R" if i % 4 == 0 else "r")
    for i in range(7):                                   # 水面の光
        x = (i * 27 + 6) % W
        y = 60 + (i % 2) * 6
        d = wave(x, frame, 4, 1)
        rect(g, x, y + d, x + 5, y + d, "g")
    return g


# ── 八百屋 v6: 軒先の吊るし売り。束が揺れる ──

YASAI7_COLORS = {
    "d": "241C3A55", "k": "2A2438D0", "K": "3E3A50C8",
    "w": "4A3A28C8", "W": "5E4A34C8",
    "o": "8A6A3AC0", "O": "A88A50C0",                    # 吊るした束
    "g": "2E5A3CC0", "p": "6A2A44C0", "y": "7A5A2AC0",
}


def scene_yasai_hang(frame: int) -> Grid:
    g = blank()
    rect(g, 0, 0, W - 1, 12, "k")                        # 庇
    rect(g, 0, 12, W - 1, 17, "K")                       # 梁
    dither(g, 17, 66, "d", top=0.85, bottom=0.3)
    for i, x in enumerate((28, 80, 130, 176)):           # 吊るした束が揺れる
        s = wave(i * 18, frame, 1, 3)
        for y in range(17, 36):
            g[y][max(0, min(W - 1, x + round(s * (y - 17) / 19)))] = "k"
        for k in range(4):                               # 束（玉が重なる）
            circle(g, x + s, 40 + k * 9, 7 + (i + k) % 3, "o", "O")
        hline(g, 36, x + s - 6, x + s + 6, "K")           # 縛り目
    rect(g, 0, 70, W - 1, 100, "w")                      # 奥の棚
    hline(g, 70, 0, W - 1, "W")
    hline(g, 86, 0, W - 1, "W")
    for row, y in enumerate((72, 88)):
        x = 4
        while x < W - 16:
            wd = 8 + ((x * 3 + row * 7) % 5) * 6          # 幅も高さもまばらに振る
            hg = 6 + ((x // 4 + row) % 3) * 3
            rect(g, x, y + 13 - hg, x + wd, y + 12, ("g", "y", "p")[(x + row) % 3])
            x += wd + 5 + ((x + row * 2) % 4) * 4
    rect(g, 0, 100, W - 1, H - 1, "k")                   # 土間
    for x, wd, hg in ((6, 44, 20), (58, 32, 16), (98, 50, 24), (156, 36, 18)):
        y = H - 2 - hg                                   # 木箱（接地・大きさを振る）
        rect(g, x, y, x + wd, y + hg, "w")
        hline(g, y, x, x + wd, "W")
        rect(g, x + 5, y + 4, x + wd - 5, y + 10, ("g", "y")[(x // 7) % 2])
    return g


# ── 八百屋 v7: ビニールハウス。霧が流れ、苗が揺れる ──

YASAI8_COLORS = {
    "d": "241C3A70", "a": "3A4A5AC0", "A": "5A7280C0",   # 骨組み
    "s": "4A3A28C8", "S": "5E4A34C8",                    # 畝
    "g": "2E5A3CC0", "G": "3E7A50C0",
    "m": "8AA0B0A0",                                     # 霧
}


def scene_yasai_house(frame: int) -> Grid:
    g = blank()
    dither(g, 0, 102, "d", top=0.85, bottom=0.25)
    arches = ((98, 78), (74, 60), (52, 42), (32, 26))
    for i, (rx, ry) in enumerate(arches):
        ch = "A" if i == 0 else "a"                      # 手前のアーチほど明るく
        for a in range(181):
            ex = 100 + round(rx * math.cos(math.radians(a)))
            ey = 102 - round(ry * math.sin(math.radians(a)))
            if 0 <= ex < W and 0 <= ey < H:
                g[ey][ex] = ch
                if ey + 1 < H:
                    g[ey + 1][ex] = ch
    rx, ry = arches[0]
    for x in (16, 52, 148, 184):                         # 縦の支柱（地面まで）
        dx = (x - 100) / rx
        vline(g, x, 102 - round(ry * math.sqrt(max(0.0, 1 - dx * dx))), 102, "a")
    for y in (46, 76):                                   # 母屋（アーチを繋ぐ）
        dy = (102 - y) / ry
        half = round(rx * math.sqrt(max(0.0, 1 - dy * dy)))
        hline(g, y, 100 - half, 100 + half, "a")
    for i in range(4):                                   # 霧が横に流れる
        off = cycle(i * 6, frame, 6, 72)
        for x in range(off - 72, W, 72):
            for k in range(5):
                mx, my = x + k * 14, 30 + i * 15 + (k % 2) * 5
                if 0 <= mx < W - 10 and 0 <= my < H:
                    hline(g, my, mx, mx + 4 + k, "m")
    rect(g, 0, 102, W - 1, H - 1, "s")                   # 地面
    for y in range(108, H, 10):                          # 畝
        hline(g, y, 0, W - 1, "S")
    for i in range(30):                                  # 苗が揺れる
        x = (i * 17 + 5) % W
        base = 108 + (i % 3) * 9
        h = 5 + (i * 7) % 9
        px = max(0, min(W - 1, x + wave(x, frame, 9, 1)))
        vline(g, px, base - h, base, "g")
        g[base - h][px] = "G"
        if px + 2 < W:
            g[base - h + 2][px + 2] = "g"
    return g


# ── セキュリティ v6: ログの滝。文字の列が降り続ける ──

SEC7_COLORS = {
    "d": "241C3A55", "a": "2C4A3EC0", "g": "489878D0", "G": "9AE0B8E0",
    "k": "2A2A40D0", "K": "45426AC8",
}


def scene_security_logs(frame: int) -> Grid:
    g = blank()
    dither(g, 0, H - 1, "d", top=0.5, bottom=0.2)
    for col, x in enumerate(range(3, W - 6, 9)):
        speed = 2 + col % 3                              # 列ごとに落ちる速さを変える
        period = speed * FRAMES
        off = cycle(col * 7, frame, speed, period)
        for y in range(off - period, H - 16, period):
            if y < 2:
                continue
            # 明るさは**位置で**決める。並び順で決めると輪の切れ目で色が飛ぶ
            ch = "G" if y > 88 else ("g" if y > 40 else "a")
            wd = 2 + ((y // 6 + col) % 4)
            hline(g, y, x, x + wd, ch)
    rect(g, 0, H - 16, W - 1, H - 1, "k")                # 手前の机
    hline(g, H - 16, 0, W - 1, "K")
    for x in range(16, W - 24, 5):
        rect(g, x, H - 10, x + 3, H - 7, "K")
    return g


# ── セキュリティ v7: 基板のクローズアップ。信号が箔を走る ──

SEC8_COLORS = {
    "b": "1E3A30D0", "B": "2A5040C0",                    # 基板
    "l": "8A7A48C0", "L": "C0B078C0",                    # 銅箔・ランド
    "k": "22222ED0", "K": "44445EC8",                    # チップ
    "c": "3A3A50D0", "C": "5A5A74C0",                    # コンデンサ
    "g": "5FE0A0FF", "y": "FFC65EFF",
}
BOARD_PATHS = (
    ((4, 20), (72, 20), (72, 58), (152, 58), (152, 30), (196, 30)),
    ((6, 112), (88, 112), (88, 82), (196, 82)),
    ((30, 40), (30, 98), (124, 98), (124, 128), (196, 128)),
)


def trace_cells(pts: tuple) -> list[tuple[int, int]]:
    """折れ線の通過セル。**光を走らせる経路**をそのまま箔として描く。"""
    cells: list[tuple[int, int]] = []
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        steps = max(abs(x1 - x0), abs(y1 - y0))
        for s in range(steps + 1):
            cells.append((x0 + (x1 - x0) * s // steps, y0 + (y1 - y0) * s // steps))
    return cells


def scene_security_board(frame: int) -> Grid:
    g = blank()
    rect(g, 0, 0, W - 1, H - 1, "b")
    for i in range(26):                                  # 基板のムラ
        x, y = (i * 43 + 7) % W, (i * 31 + 5) % H
        rect(g, x, y, x + 3, y + 1, "B")
    for i, pts in enumerate(BOARD_PATHS):
        cells = trace_cells(pts)
        for x, y in cells:
            g[y][x] = "l"
            if y + 1 < H:
                g[y + 1][x] = "l"
        for n in range(0, len(cells), 47 + i * 9):       # ランド
            circle(g, cells[n][0], cells[n][1], 2, "L")
        pos = round((frame + i * 4) % FRAMES / FRAMES * (len(cells) - 1))
        for k in range(6):                               # 信号が走る
            x, y = cells[max(0, pos - k * 3)]
            for dy in (0, 1):
                if y + dy < H:
                    g[y + dy][x] = "g" if k < 2 else "y" if k < 3 else "l"
    for x, y, wd, hg in ((44, 34, 44, 30), (128, 96, 40, 24)):
        rect(g, x, y, x + wd, y + hg, "k")               # チップ
        hline(g, y, x, x + wd, "K")
        rect(g, x + 6, y + 6, x + wd - 6, y + hg - 8, "k")
        hline(g, y + 6, x + 6, x + wd - 6, "K")
        for lx in range(x + 4, x + wd - 3, 6):           # 足
            vline(g, lx, y - 3, y - 1, "L")
            vline(g, lx, y + hg + 1, y + hg + 3, "L")
    for i, (cx, cy, r) in enumerate(((166, 50, 9), (100, 22, 6), (66, 116, 8))):
        circle(g, cx, cy, r, "c", "C")                   # コンデンサ
        hline(g, cy - r // 2, cx - r + 1, cx + r - 1, "C")
    for i, (x, y) in enumerate(((14, 62), (184, 108), (108, 60))):
        g[y][x] = "g" if (i * 3 + frame) % 5 else "y"    # 表示灯
        g[y][x + 1] = g[y][x]
    return g


# 章ID → 情景の一覧。**それぞれが動く映像**で、プレイ中に移り変わる。
SCENES: dict[str, list[tuple]] = {
    "hiragana_food": [
        (scene_sushi, SUSHI_COLORS, FRAMES),
        (scene_sushi_front, SUSHI2_COLORS, FRAMES),
        (scene_sushi_tank, SUSHI3_COLORS, FRAMES),
        (scene_sushi_kitchen, SUSHI4_COLORS, FRAMES),
        (scene_sushi_ice, SUSHI5_COLORS, FRAMES),
        (scene_sushi_room, SUSHI6_COLORS, FRAMES),
        (scene_sushi_lane, SUSHI7_COLORS, FRAMES),
        (scene_sushi_market, SUSHI8_COLORS, FRAMES),
    ],
    "katakana_animal": [
        (scene_animal, ANIMAL_COLORS, FRAMES),
        (scene_animal_rocks, ANIMAL2_COLORS, FRAMES),
        (scene_animal_water, ANIMAL3_COLORS, FRAMES),
        (scene_animal_aviary, ANIMAL4_COLORS, FRAMES),
        (scene_animal_beast, ANIMAL5_COLORS, FRAMES),
        (scene_animal_rain, ANIMAL6_COLORS, FRAMES),
        (scene_animal_penguin, ANIMAL7_COLORS, FRAMES),
        (scene_animal_path, ANIMAL8_COLORS, FRAMES),
    ],
    "hiragana_verb": [
        (scene_verb, VERB_COLORS, FRAMES),
        (scene_verb_library, VERB2_COLORS, FRAMES),
        (scene_verb_hall, VERB3_COLORS, FRAMES),
        (scene_verb_yard, VERB4_COLORS, FRAMES),
        (scene_verb_office, VERB5_COLORS, FRAMES),
        (scene_verb_dusk, VERB6_COLORS, FRAMES),
        (scene_verb_gym, VERB7_COLORS, FRAMES),
        (scene_verb_pool, VERB8_COLORS, FRAMES),
    ],
    "yasai": [
        (scene_yasai, YASAI_COLORS, FRAMES),
        (scene_yasai_market, YASAI2_COLORS, FRAMES),
        (scene_yasai_field, YASAI3_COLORS, FRAMES),
        (scene_yasai_fridge, YASAI4_COLORS, FRAMES),
        (scene_yasai_truck, YASAI5_COLORS, FRAMES),
        (scene_yasai_arcade, YASAI6_COLORS, FRAMES),
        (scene_yasai_hang, YASAI7_COLORS, FRAMES),
        (scene_yasai_house, YASAI8_COLORS, FRAMES),
    ],
    "security": [
        (scene_security, SECURITY_COLORS, FRAMES),
        (scene_security_console, SEC2_COLORS, FRAMES),
        (scene_security_office, SEC3_COLORS, FRAMES),
        (scene_security_net, SEC4_COLORS, FRAMES),
        (scene_security_cctv, SEC5_COLORS, FRAMES),
        (scene_security_cables, SEC6_COLORS, FRAMES),
        (scene_security_logs, SEC7_COLORS, FRAMES),
        (scene_security_board, SEC8_COLORS, FRAMES),
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
