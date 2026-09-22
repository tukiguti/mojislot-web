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


SIGNS = {
    "hiragana_food": sushi,
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
