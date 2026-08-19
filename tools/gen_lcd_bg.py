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


# 章ID → 情景の一覧。**それぞれが動く映像**で、プレイ中に移り変わる。
SCENES: dict[str, list[tuple]] = {
    "hiragana_food": [
        (scene_sushi, SUSHI_COLORS, FRAMES),
        (scene_sushi_front, SUSHI2_COLORS, FRAMES),
        (scene_sushi_tank, SUSHI3_COLORS, FRAMES),
    ],
    "katakana_animal": [
        (scene_animal, ANIMAL_COLORS, FRAMES),
        (scene_animal_rocks, ANIMAL2_COLORS, FRAMES),
        (scene_animal_water, ANIMAL3_COLORS, FRAMES),
    ],
    "hiragana_verb": [
        (scene_verb, VERB_COLORS, FRAMES),
        (scene_verb_library, VERB2_COLORS, FRAMES),
        (scene_verb_hall, VERB3_COLORS, FRAMES),
    ],
    "yasai": [
        (scene_yasai, YASAI_COLORS, FRAMES),
        (scene_yasai_market, YASAI2_COLORS, FRAMES),
        (scene_yasai_field, YASAI3_COLORS, FRAMES),
    ],
    "security": [
        (scene_security, SECURITY_COLORS, FRAMES),
        (scene_security_console, SEC2_COLORS, FRAMES),
        (scene_security_office, SEC3_COLORS, FRAMES),
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
