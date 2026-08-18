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


SCENES = {
    "hiragana_food": (scene_sushi, SUSHI_COLORS, 3),
    "katakana_animal": (scene_animal, ANIMAL_COLORS, 3),
    "hiragana_verb": (scene_verb, VERB_COLORS, 3),
    "yasai": (scene_yasai, YASAI_COLORS, 3),
    "security": (scene_security, SECURITY_COLORS, 3),
}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("chapters", nargs="*")
    ap.add_argument("--preview", type=pathlib.Path, help="実寸3倍の確認用に書き出す")
    args = ap.parse_args()

    OUT.mkdir(parents=True, exist_ok=True)
    for chapter in args.chapters or list(SCENES):
        if chapter not in SCENES:
            raise SystemExit(f"{chapter} の情景が未定義（{', '.join(SCENES)}）")
        build, colors, frames = SCENES[chapter]
        for f in range(frames):
            img = to_image(build(f), colors)
            path = OUT / f"{chapter}_{f}.png"
            img.save(path)
            print(f"  {path.name}  {path.stat().st_size / 1024:.1f} KB")
        if args.preview:
            # 液晶の地色の上に実寸3倍で並べる。実際に見える大きさで判断する
            bg = (0x2A, 0x18, 0x30, 255)
            im = Image.new("RGBA", (W * 3, (H * 3 + 8) * frames), bg)
            for f in range(frames):
                im.alpha_composite(to_image(build(f), colors, 3), (0, f * (H * 3 + 8)))
            im.save(args.preview)
            print(f"  → {args.preview}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
