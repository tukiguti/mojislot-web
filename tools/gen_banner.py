#!/usr/bin/env python3
"""告知バナー（狙え！／BIG BONUS／REGULAR）をドット絵で作る。

液晶の中（背景・出題者）はドット絵なのに、液晶の外に重なるカットインや狙えだけが
生成画像だった。**画面の中でトーンが割れる**ので、外側もドット絵へ寄せる。

漢字は手でドットを置くより**フォントを低解像度でラスタライズして整える**方が形が
決まる。24px前後まで落とすとアンチエイリアスが濁るので、閾値で2値化してから
縁取りと塗りを別に足す。フォントは形の当たりを取るためだけに使い、
仕上げ（縁・影・塗り）は全部こちらで置く。

    python3 tools/gen_banner.py              # public/art/ui/ へ PNG を書き出す
    python3 tools/gen_banner.py --preview    # /tmp に 1x と 6x を並べて確認用に出す

表示は CSS 側で拡大する。**ニアレストネイバー必須**（image-rendering: pixelated）。
"""

from __future__ import annotations

import argparse
import pathlib

from PIL import Image, ImageDraw, ImageFont

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "art" / "ui"
FONT_JP = "/System/Library/Fonts/ヒラギノ角ゴシック W6.ttc"
FONT_EN = "/System/Library/Fonts/Supplemental/Arial Black.ttf"

# 液晶の地色。プレビューの背景に使う（実際は暗幕の上に出る）
LCD_BG = (42, 24, 48, 255)

# --- パレット -------------------------------------------------------------
# 既存のドット絵（pixel_kit.py）と同じ考え方で、暗い側は赤紫へ、明るい側は黄へ
# 色相をずらす。明度だけ動かすと濁る。
INK = (20, 18, 28, 255)          # 外周の輪郭
EDGE = (249, 247, 242, 255)      # 内側の白縁

# 塗りのランプ（下→上で明るく）。役色ごとに3段
RAMPS = {
    "gold": [(196, 96, 24, 255), (240, 152, 40, 255), (255, 206, 92, 255)],
    "blue": [(38, 74, 140, 255), (62, 126, 198, 255), (132, 200, 246, 255)],
    "silver": [(96, 100, 122, 255), (150, 155, 176, 255), (226, 230, 240, 255)],
}


def rasterize(text: str, font_path: str, px: int, tracking: int = 0) -> list[list[int]]:
    """文字を px 高さで2値のマスへ落とす。返すのは 0/1 の二次元配列。"""
    font = ImageFont.truetype(font_path, px)
    pad = px  # 描画時のはみ出し逃げ
    probe = Image.new("L", (px * len(text) * 2 + pad * 2, px * 3 + pad * 2), 0)
    d = ImageDraw.Draw(probe)
    if tracking:
        # 字間を触る時だけ1文字ずつ置く。**送り幅はフォントの advance を使う**
        # （目分量で詰めると文字ごとに間が揃わない）
        x = float(pad)
        for ch in text:
            d.text((x, pad), ch, font=font, fill=255)
            x += d.textlength(ch, font=font) + tracking
    else:
        d.text((pad, pad), text, font=font, fill=255)
    bbox = probe.getbbox()
    if bbox is None:
        return [[]]
    crop = probe.crop(bbox)
    # 閾値で2値化。半分より濃いドットだけ残す＝細部が落ちても輪郭は保つ
    return [[1 if crop.getpixel((x, y)) > 110 else 0 for x in range(crop.width)]
            for y in range(crop.height)]


def squeeze(mask: list[list[int]], gap: int = 3) -> list[list[int]]:
    """文字間の空き列を gap ドットへ詰める。

    全角の「！」などはフォントが左右に大きな余白を持つので、そのまま並べると
    そこだけ間延びする。ドット絵は1ドットが大きいぶん余白の差が目立つ。
    """
    h, w = len(mask), len(mask[0])
    empty = [all(mask[y][x] == 0 for y in range(h)) for x in range(w)]
    keep: list[int] = []
    run = 0
    for x in range(w):
        if empty[x]:
            run += 1
            if run <= gap:
                keep.append(x)
        else:
            run = 0
            keep.append(x)
    return [[mask[y][x] for x in keep] for y in range(h)]


def outline(mask: list[list[int]], width: int = 1) -> list[list[int]]:
    """マスクを4近傍へ width ドット太らせる（斜めは含めない＝角が丸まらない）。"""
    h, w = len(mask), len(mask[0])
    cur = mask
    for _ in range(width):
        nxt = [[0] * w for _ in range(h)]
        for y in range(h):
            for x in range(w):
                if cur[y][x]:
                    nxt[y][x] = 1
                    continue
                for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                    ny, nx = y + dy, x + dx
                    if 0 <= ny < h and 0 <= nx < w and cur[ny][nx]:
                        nxt[y][x] = 1
                        break
        cur = nxt
    return cur


def pad(mask: list[list[int]], n: int) -> list[list[int]]:
    w = len(mask[0])
    row = [0] * (w + n * 2)
    return [row[:] for _ in range(n)] + [[0] * n + r + [0] * n for r in mask] + [row[:] for _ in range(n)]


def banner(text: str, font_path: str, px: int, ramp: str, tracking: int = 0,
           gap: int = 0) -> Image.Image:
    """文字＋白縁＋黒縁を1枚のドット絵にする。gap>0 で文字間の空きを詰める。"""
    raw = rasterize(text, font_path, px, tracking)
    glyph = pad(squeeze(raw, gap) if gap else raw, 4)
    h, w = len(glyph), len(glyph[0])
    white = outline(glyph, 1)
    black = outline(white, 1)

    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    px_ = img.load()
    ramp_c = RAMPS[ramp]

    for y in range(h):
        for x in range(w):
            if black[y][x]:
                px_[x, y] = INK
    for y in range(h):
        for x in range(w):
            if white[y][x]:
                px_[x, y] = EDGE
    # 塗りは上から下へ3段。行の位置で段を決める＝文字ごとに色が変わらない
    ys = [y for y in range(h) if any(glyph[y])]
    top, bot = (min(ys), max(ys)) if ys else (0, h - 1)
    span = max(1, bot - top)
    for y in range(h):
        t = (y - top) / span
        c = ramp_c[2] if t < 0.34 else ramp_c[1] if t < 0.72 else ramp_c[0]
        for x in range(w):
            if glyph[y][x]:
                px_[x, y] = c
    # 下端1ドットだけ最暗にして厚みを出す
    for x in range(w):
        for y in range(h - 1):
            if glyph[y][x] and not glyph[y + 1][x]:
                px_[x, y] = ramp_c[0]
    return img


SPECS = [
    # (ファイル名, 文字, フォント, 高さpx, 色, 字間, 詰め)
    # 全角の「！」は左右の余白が大きいので詰める。英字は単語の空白まで潰れるので詰めない
    # 表示幅は CSS 固定（.aim-notice-img 最大360px・実測352px）なので、
    # **3倍で出るように元の幅を決める**。液晶の背景も出題者も3倍なので、ここだけ
    # 粗いと同じ枠の中で別素材に見える。352/3 ≒ 117px が狙う幅
    ("aim", "狙え！", FONT_JP, 49, "gold", 0, 3),
    ("big_bonus", "BIG BONUS", FONT_EN, 22, "gold", 0, 0),
    ("regular", "REGULAR", FONT_EN, 22, "silver", 0, 0),
    # カットインの見出し。役の3文字はリールのドット文字を流用するので、ここだけ
    # フォント描画のまま残すとカットインの中でトーンが割れる。
    ("cutin_premium", "PREMIUM!", FONT_EN, 20, "gold", 0, 0),
    ("cutin_regular", "REGULAR!", FONT_EN, 20, "silver", 0, 0),
]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--preview", action="store_true")
    args = ap.parse_args()

    OUT.mkdir(parents=True, exist_ok=True)
    made = []
    for name, text, font, px, ramp, tr, gp in SPECS:
        im = banner(text, font, px, ramp, tr, gp)
        im.save(OUT / f"{name}.png")
        made.append((name, im))
        print(f"{name}.png  {im.width}x{im.height}  {(OUT / f'{name}.png').stat().st_size / 1024:.1f}KB")

    if args.preview:
        w = max(i.width for _, i in made) * 6
        h = sum(i.height * 6 + 12 for _, i in made)
        sheet = Image.new("RGBA", (w, h), LCD_BG)
        y = 0
        for _, i in made:
            r = i.resize((i.width * 6, i.height * 6), Image.NEAREST)
            sheet.paste(r, (0, y), r)
            y += r.height + 12
        p = pathlib.Path("/tmp/banner_preview.png")
        sheet.save(p)
        print(f"preview: {p}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
