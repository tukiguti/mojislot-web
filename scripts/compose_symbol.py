#!/usr/bin/env python3
"""
リール図柄タイルの合成スクリプト。
codex が生成した「食材・枠・背景」だけの図柄 PNG に、正しい日本語1文字を
PIL で重ね焼きして、文字崩れ無しのフル図柄タイルを作る。

usage:
  python3 scripts/compose_symbol.py ART.png 文字 FONT.ttc FONT_INDEX OUT.webp

タイルはリールのセル比 130:100 に合わせ 390x300（3x）で出力。
"""
import sys
from PIL import Image, ImageDraw, ImageFont, ImageFilter

CELL_W, CELL_H = 390, 300  # 130:100 の 3x
TARGET_RATIO = CELL_W / CELL_H  # 1.3
# 文字は全タイル共通の固定サイズ（字ごとに大きさがブレないように）。
# 仮名の字面差（い<ま）はそのまま＝自然で揃って見える。
GLYPH_SIZE = 168
VIGNETTE_STRENGTH = 92  # 中央を落とす濃さ（小さいほど食材が見える）


def crop_to_ratio(img: Image.Image, ratio: float) -> Image.Image:
    w, h = img.size
    if w / h > ratio:
        # 横が余る → 左右を中央クロップ
        nw = int(h * ratio)
        x = (w - nw) // 2
        return img.crop((x, 0, x + nw, h))
    else:
        nh = int(w / ratio)
        y = (h - nh) // 2
        return img.crop((0, y, w, y + nh))


def center_vignette(size, strength=VIGNETTE_STRENGTH, blur=60) -> Image.Image:
    """中央を暗く落とすソフトな楕円ビネット（文字の視認性確保用）。"""
    w, h = size
    overlay = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(overlay)
    # 中央 ~72% を覆う楕円
    ex, ey = int(w * 0.14), int(h * 0.14)
    d.ellipse((ex, ey, w - ex, h - ey), fill=strength)
    overlay = overlay.filter(ImageFilter.GaussianBlur(blur))
    dark = Image.new("RGBA", (w, h), (0, 0, 0, 255))
    dark.putalpha(overlay)
    return dark


def compose(art_path, glyph, font_path, font_index, out_path, zoom=1.0):
    """zoom>1.0 で内側へクロップ＝ネオン枠を切り落として食材を全面化（通常役用）。"""
    art = Image.open(art_path).convert("RGBA")
    art = crop_to_ratio(art, TARGET_RATIO)
    if zoom > 1.0:
        w, h = art.size
        cw, ch = int(w / zoom), int(h / zoom)
        x, y = (w - cw) // 2, (h - ch) // 2
        art = art.crop((x, y, x + cw, y + ch))
    art = art.resize((CELL_W, CELL_H), Image.LANCZOS)

    # glyph が空なら「文字なし版」＝図柄のみ（ビネットも入れない）
    if not glyph:
        art.convert("RGB").save(out_path, "WEBP", quality=92, method=6)
        print("saved (no glyph)", out_path)
        return

    # 中央を少し暗く落として文字を浮かせる
    art = Image.alpha_composite(art, center_vignette((CELL_W, CELL_H)))

    # 全タイル共通の固定サイズで描く（字ごとのブレ防止）
    size = GLYPH_SIZE
    font = ImageFont.truetype(font_path, size, index=font_index)
    stroke = max(3, size // 14)

    draw = ImageDraw.Draw(art)
    # 中央配置：bbox から実描画オフセットを補正
    bbox = font.getbbox(glyph, stroke_width=stroke)
    gw, gh = bbox[2] - bbox[0], bbox[3] - bbox[1]
    cx = (CELL_W - gw) / 2 - bbox[0]
    cy = (CELL_H - gh) / 2 - bbox[1]

    # ドロップシャドウ
    shadow = Image.new("RGBA", art.size, (0, 0, 0, 0))
    sdraw = ImageDraw.Draw(shadow)
    sdraw.text((cx + 4, cy + 5), glyph, font=font, fill=(0, 0, 0, 180),
               stroke_width=stroke, stroke_fill=(0, 0, 0, 180))
    shadow = shadow.filter(ImageFilter.GaussianBlur(4))
    art = Image.alpha_composite(art, shadow)

    draw = ImageDraw.Draw(art)
    draw.text((cx, cy), glyph, font=font, fill=(255, 255, 255, 255),
              stroke_width=stroke, stroke_fill=(0, 0, 0, 235))

    art.convert("RGB").save(out_path, "WEBP", quality=92, method=6)
    print("saved", out_path, "fontsize", size)


def main():
    zoom = float(sys.argv[6]) if len(sys.argv) > 6 else 1.0
    compose(sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4]), sys.argv[5], zoom)


if __name__ == "__main__":
    main()
