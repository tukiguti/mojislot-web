#!/usr/bin/env python3
"""
食べ物章のリール図柄タイルを一括合成する。

役データ（data/yaku/hiragana_food.json）と図柄アート（assets/art-src/symbols/food/）から、
各セル (reelIndex, 文字) に対応する図柄タイル webp を public/art/symbols/food/ に出力。

色解決と同じ「先勝ち（premium→core→bonus）」で共有文字（す/し）を一意化するため、
出力名は「そのセルを最初に主張した役」= {yakuId}_{reelIndex}.webp。
ReelView 側も同じ順序でマップを組むので一致する。
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "scripts"))
from compose_symbol import compose  # noqa: E402

ART_DIR = os.path.join(ROOT, "assets/art-src/symbols/food")
OUT_DIR = os.path.join(ROOT, "public/art/symbols/hiragana_food")
FONT = "/System/Library/Fonts/ヒラギノ明朝 ProN.ttc"
FONT_INDEX = 2  # Hiragino Mincho ProN W6

# 役id → 図柄アートファイル
ART_MAP = {
    "ichigo": "ichigo.png",
    "mikan": "mikan.png",
    "unagi": "unagi.png",
    "maguro": "maguro.png",
    "tofu": "tofu.png",
    "budou": "budou.png",
    "sanma": "sanma.png",
    "sushiya": "sushiya_premium.png",
    "reg": "sushiko_reg.png",
}


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    data = json.load(open(os.path.join(ROOT, "data/yaku/hiragana_food.json")))
    ordered = data["premiumYaku"] + data["coreYaku"] + data["bonusYaku"]

    seen = set()
    count = 0
    for yaku in ordered:
        art = os.path.join(ART_DIR, ART_MAP[yaku["id"]])
        for r, sym in enumerate(yaku["symbols"]):
            key = (r, sym)
            if key in seen:
                continue  # 先勝ち：すでに上位役が主張済みのセルは飛ばす
            seen.add(key)
            out = os.path.join(OUT_DIR, f"{yaku['id']}_{r}.webp")
            compose(art, sym, FONT, FONT_INDEX, out)
            count += 1
    print(f"\n{count} tiles -> {OUT_DIR}")


if __name__ == "__main__":
    main()
