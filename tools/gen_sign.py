#!/usr/bin/env python3
"""筐体の看板（上パネル）のドット絵を島ごとに生成する。

    python3 tools/gen_sign.py                  # 全島ぶん
    python3 tools/gen_sign.py hiragana_food    # 1島だけ
    python3 tools/gen_sign.py --preview /tmp/sign.png hiragana_food

出力は `public/art/sign/<章ID>.png`（216×44）。

## なぜ 216×44 か

液晶の背景・出題者・リールの文字と**同じ3倍のドット格子**に乗せる。看板の板は
canvas 換算でおよそ 650×132 なので、3で割って 216×44。1ドットの大きさが液晶の
中と揃わないと、画面の中と外で絵の世界が分かれて見える。

## 構図の約束

- **真ん中は空ける。** 島名は絵に焼き込まず、DOM の文字を上に載せる（島名を
  変えても描き直さずに済む）。x=76〜140 には何も置かない
- **上の隅は台形で切れる。** 看板は上辺が狭い台形（肩 9%）なので、上の角に
  大事なものを置かない
- **上辺にはランプが並ぶ**（DOM）。y=0〜6 は背景だけにする
"""

from __future__ import annotations

import argparse
import pathlib
import sys

from PIL import Image, ImageDraw

W, H = 216, 44
OUT = pathlib.Path(__file__).resolve().parent.parent / "public" / "art" / "sign"


def _rgb(s: str) -> tuple[int, int, int, int]:
    s = s.lstrip("#")
    return (int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16), 255)


class Canvas:
    """アンチエイリアスの無い描画だけを使う小さな道具。"""

    def __init__(self, bg: str) -> None:
        self.img = Image.new("RGBA", (W, H), _rgb(bg))
        self.d = ImageDraw.Draw(self.img)

    def rect(self, x0: int, y0: int, x1: int, y1: int, c: str) -> None:
        self.d.rectangle([x0, y0, x1, y1], fill=_rgb(c))

    def oval(self, x0: int, y0: int, x1: int, y1: int, c: str) -> None:
        self.d.ellipse([x0, y0, x1, y1], fill=_rgb(c))

    def poly(self, pts: list[tuple[int, int]], c: str) -> None:
        self.d.polygon(pts, fill=_rgb(c))

    def px(self, x: int, y: int, c: str) -> None:
        if 0 <= x < W and 0 <= y < H:
            self.img.putpixel((x, y), _rgb(c))

    def line(self, pts: list[tuple[int, int]], c: str) -> None:
        self.d.line(pts, fill=_rgb(c), width=1)


# === 島1 寿司：朱と生成り。左に握り、右に湯気の立つ湯呑み ===
def sushi() -> Image.Image:
    SHU = "#c8342a"  # 朱（地）
    SHU_D = "#b02a21"  # 地の下の帯
    KINARI = "#fdf4e3"  # 生成り（シャリ・湯呑み）
    KINARI_S = "#e8d9bd"  # 生成りの影
    AKA = "#5a100c"  # 赤身・湯呑みの帯
    AKA_H = "#b86a5c"  # 赤身の照り
    NORI = "#2a0604"  # 海苔

    c = Canvas(SHU)
    # 地の下に、ゆるい弧の帯（カウンターの縁）
    c.oval(-40, 34, W + 40, 70, SHU_D)

    # --- 握り（x=14〜70）---
    # シャリ
    c.oval(18, 24, 66, 41, KINARI)
    c.rect(22, 32, 62, 40, KINARI)
    c.rect(22, 38, 62, 40, KINARI_S)
    # 赤身（シャリに覆い被さる）
    c.poly([(12, 25), (22, 17), (40, 14), (58, 16), (70, 24), (64, 28), (40, 24), (18, 29)], AKA)
    # 赤身の照り
    c.line([(24, 19), (40, 17), (56, 19)], AKA_H)
    # 海苔の帯
    c.rect(38, 15, 43, 40, NORI)

    # --- 湯呑み（x=154〜200）---
    # 胴（下がやや広い台形）
    c.poly([(158, 20), (194, 20), (197, 40), (155, 40)], KINARI)
    c.rect(155, 38, 197, 40, KINARI_S)
    # 帯
    c.rect(157, 25, 195, 29, AKA)
    # 口縁の影
    c.rect(159, 20, 193, 21, KINARI_S)
    # 糸尻
    c.rect(157, 41, 195, 42, AKA)
    # 湯気（2本の波。上辺のランプ列 y<=6 には掛けない）
    for sx in (168, 182):
        for i, dx in enumerate((0, 1, 1, 0, -1, -1, 0, 1, 1, 0)):
            c.px(sx + dx, 17 - i, KINARI)
            c.px(sx + dx + 1, 17 - i, KINARI)
    return c.img


def _paw(c: Canvas, x: int, y: int, col: str) -> None:
    """足跡1つ（肉球＋指4つ）。x,y は肉球の左上。"""
    c.oval(x, y + 4, x + 9, y + 11, col)
    for dx, dy in ((-1, 0), (3, -2), (7, -2), (10, 0)):
        c.oval(x + dx, y + dy, x + dx + 3, y + dy + 3, col)


def _nigiri(c: Canvas, x: int, y: int) -> None:
    """小さい握り（リミックス用）。x,y は左上、幅22。"""
    c.oval(x + 2, y + 7, x + 20, y + 15, "#fdf4e3")
    c.poly([(x, y + 7), (x + 5, y + 2), (x + 17, y + 2), (x + 22, y + 7), (x + 11, y + 6)], "#c8342a")
    c.rect(x + 9, y + 2, x + 12, y + 15, "#2a0604")


def _padlock(c: Canvas, x: int, y: int, col: str, hole: str, w: int = 26) -> None:
    """錠前。x,y は本体の左上。w は本体の幅。"""
    h = int(w * 0.8)
    t = max(3, w // 8)
    # つる（逆U）
    c.rect(x + w // 5, y - h // 2, x + w // 5 + t, y, col)
    c.rect(x + w - w // 5 - t, y - h // 2, x + w - w // 5, y, col)
    c.rect(x + w // 5, y - h // 2 - t, x + w - w // 5, y - h // 2, col)
    # 本体と鍵穴
    c.rect(x, y, x + w, y + h, col)
    c.oval(x + w // 2 - 2, y + h // 3 - 2, x + w // 2 + 2, y + h // 3 + 2, hole)
    c.rect(x + w // 2 - 1, y + h // 3, x + w // 2 + 1, y + h * 2 // 3, hole)


def _person(c: Canvas, head: tuple[int, int], joints: list[list[tuple[int, int]]], col: str) -> None:
    """ピクトグラムの人。頭（円）と手足の折れ線（太さ3）。"""
    hx, hy = head
    c.oval(hx - 3, hy - 3, hx + 3, hy + 3, col)
    for seg in joints:
        c.d.line(seg, fill=_rgb(col), width=3, joint="curve")


# === 島2 動物：黄土と深緑。左に猫の顔、右に足跡 ===
def animal() -> Image.Image:
    OUDO = "#d4921c"
    OUDO_D = "#b87a14"
    MIDORI = "#2e6b30"
    KURO = "#1c2a16"
    CREAM = "#fff6c0"

    c = Canvas(OUDO)
    c.oval(-40, 34, W + 40, 70, MIDORI)  # 下の草地
    # 草の穂先
    for x in range(4, W, 9):
        c.rect(x, 33, x + 1, 35, MIDORI)

    # --- 猫の顔（中心 x=42）---
    c.poly([(26, 20), (28, 8), (36, 16)], KURO)  # 左耳
    c.poly([(58, 20), (56, 8), (48, 16)], KURO)  # 右耳
    c.poly([(28, 18), (29, 11), (34, 16)], "#e89a8a")
    c.poly([(56, 18), (55, 11), (50, 16)], "#e89a8a")
    c.oval(24, 13, 60, 40, KURO)  # 顔
    c.oval(32, 26, 52, 38, CREAM)  # 口もと
    c.rect(32, 21, 35, 24, CREAM)  # 目
    c.rect(49, 21, 52, 24, CREAM)
    c.rect(33, 22, 34, 23, KURO)
    c.rect(50, 22, 51, 23, KURO)
    c.rect(41, 28, 43, 29, "#e89a8a")  # 鼻
    for dy in (29, 32):  # ひげ
        c.line([(20, dy), (30, dy + 1)], CREAM)
        c.line([(54, dy + 1), (64, dy)], CREAM)

    # --- 足跡（右へ歩いていく）---
    for i, (x, y) in enumerate(((150, 28), (164, 18), (178, 27), (192, 16))):
        _paw(c, x, y, KURO if i % 2 == 0 else OUDO_D)
    return c.img


# === 島3 動詞：黒×蛍光ミント。動作のピクトグラム ===
def verb() -> Image.Image:
    KURO = "#0b1416"
    MINT = "#2effd0"
    MINT_D = "#0f6f5c"

    c = Canvas(KURO)
    # 床の線と、案内板めいた枠の目盛り
    c.rect(0, 40, W, 41, MINT_D)
    for x in range(0, W, 6):
        c.px(x, 43, MINT_D)

    # --- 走る人（左）---
    _person(
        c,
        (40, 13),
        [
            [(39, 17), (35, 27)],  # 胴
            [(38, 20), (46, 22), (50, 18)],  # 前の腕
            [(38, 20), (31, 22), (28, 26)],  # 後ろの腕
            [(35, 27), (43, 31), (46, 38)],  # 前の脚
            [(35, 27), (30, 33), (24, 34)],  # 後ろの脚
        ],
        MINT,
    )
    # 速度線
    for dy in (18, 24, 30):
        c.line([(12, dy), (20, dy)], MINT_D)

    # --- 跳ぶ人（右）---
    _person(
        c,
        (176, 11),
        [
            [(176, 15), (176, 26)],  # 胴
            [(176, 18), (168, 12), (166, 7)],  # 上げた左腕
            [(176, 18), (184, 12), (186, 7)],  # 上げた右腕
            [(176, 26), (170, 33), (172, 37)],  # 左脚
            [(176, 26), (182, 33), (180, 37)],  # 右脚
        ],
        MINT,
    )
    # 跳んだ跡
    c.rect(168, 40, 184, 41, MINT)
    return c.img


# === 島4 八百屋：若草と木箱。左に野菜の木箱、右に大根と値札 ===
def yasai() -> Image.Image:
    WAKAKUSA = "#2f5d1e"
    WAKAKUSA_D = "#24481a"
    KI = "#a8743c"
    KI_D = "#6e4a22"
    TOMATO = "#d8402a"
    NINJIN = "#e8822a"
    HA = "#7ac142"
    KIIRO = "#e8d44c"
    SHIRO = "#f4f0dc"

    c = Canvas(WAKAKUSA)
    c.rect(0, 36, W, H, WAKAKUSA_D)

    # --- 木箱と野菜（左）---
    # 箱の上から覗く野菜
    for x in (20, 30, 40):
        c.oval(x, 17, x + 9, 26, TOMATO)
        c.rect(x + 4, 16, x + 5, 17, HA)
    c.poly([(51, 15), (55, 15), (57, 27), (49, 27)], NINJIN)
    c.rect(51, 11, 55, 15, HA)
    c.poly([(58, 17), (62, 17), (63, 27), (57, 27)], NINJIN)
    c.rect(58, 13, 62, 17, HA)
    # 箱
    c.rect(16, 24, 66, 41, KI)
    for y in (29, 35):
        c.rect(16, y, 66, y, KI_D)
    c.rect(16, 24, 17, 41, KI_D)
    c.rect(65, 24, 66, 41, KI_D)
    c.rect(34, 30, 48, 34, KI_D)  # ステンシルの札

    # --- 大根と値札（右）---
    c.poly([(152, 38), (158, 12), (164, 12), (168, 38)], SHIRO)
    c.oval(151, 34, 169, 42, SHIRO)
    # 葉は上辺のランプ列（y<=6）に掛けない高さに留める
    for dx, h in ((-6, 5), (0, 7), (6, 5)):
        c.poly([(161 + dx, 12 - h), (158 + dx, 13), (164 + dx, 13)], HA)
    # 値札
    c.poly([(178, 16), (200, 16), (200, 34), (178, 34), (174, 25)], KIIRO)
    c.oval(177, 24, 179, 26, WAKAKUSA_D)
    c.rect(184, 21, 196, 22, KI_D)  # 字の代わりの線
    c.rect(184, 26, 194, 27, KI_D)
    c.rect(184, 30, 190, 31, KI_D)
    return c.img


# === 島5 セキュリティ：黒鉄とCRT緑。左に錠前、右に鍵 ===
def security() -> Image.Image:
    KUROGANE = "#0e120f"
    CRT = "#39ff6a"
    CRT_D = "#145a26"

    c = Canvas(KUROGANE)
    # 走査線と、流れる 0/1 の粒（地の模様）
    for y in range(8, H, 3):
        c.rect(0, y, W, y, "#101812")
    for x, y in ((8, 12), (70, 36), (146, 10), (206, 30), (12, 38), (200, 12)):
        c.rect(x, y, x + 1, y + 3, CRT_D)
        c.rect(x + 4, y, x + 6, y + 3, CRT_D)

    # --- 錠前（左）---
    _padlock(c, 30, 20, CRT, KUROGANE, w=28)

    # --- 鍵（右）---
    c.oval(150, 16, 168, 34, CRT)  # 持ち手
    c.oval(155, 21, 163, 29, KUROGANE)
    c.rect(167, 23, 200, 27, CRT)  # 軸
    c.rect(190, 27, 193, 33, CRT)  # 歯
    c.rect(196, 27, 199, 31, CRT)
    return c.img


# === 島7 リミックス：藍紫の地に5島の小物を少しずつ ===
def remix() -> Image.Image:
    AI = "#2a2540"
    AI_D = "#1c1830"

    c = Canvas(AI)
    # 5島の色の帯（下辺）
    for i, col in enumerate(("#c8342a", "#d99a20", "#2effd0", "#7ac142", "#39ff6a")):
        c.rect(i * W // 5, 40, (i + 1) * W // 5, H, col)
    c.rect(0, 38, W, 39, AI_D)

    # 左：握りとトマト
    _nigiri(c, 18, 18)
    c.oval(46, 22, 57, 33, "#d8402a")
    c.rect(51, 20, 52, 22, "#7ac142")
    # 右：足跡と錠前
    _paw(c, 154, 22, "#d99a20")
    _paw(c, 166, 14, "#d99a20")
    _padlock(c, 184, 22, "#39ff6a", AI, w=16)
    return c.img


SIGNS = {
    "hiragana_food": sushi,
    "katakana_animal": animal,
    "hiragana_verb": verb,
    "yasai": yasai,
    "security": security,
    "remix": remix,
}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("ids", nargs="*")
    ap.add_argument("--preview", type=pathlib.Path)
    a = ap.parse_args()
    ids = a.ids or list(SIGNS)
    OUT.mkdir(parents=True, exist_ok=True)
    for i in ids:
        if i not in SIGNS:
            print(f"未定義の島: {i}", file=sys.stderr)
            return 1
        img = SIGNS[i]()
        if a.preview:
            img.resize((W * 4, H * 4), Image.NEAREST).save(a.preview)
            print(a.preview)
        else:
            path = OUT / f"{i}.png"
            img.save(path)
            print(path.relative_to(OUT.parent.parent.parent))
    return 0


if __name__ == "__main__":
    sys.exit(main())
