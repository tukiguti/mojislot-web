#!/usr/bin/env python3
"""
任意の章のリール図柄タイルを一括合成する（汎用版）。

usage: python3 scripts/build_chapter_tiles.py <章id>

- マスターアート: assets/art-src/symbols/<章id>/<役id>.png（codex生成）
- 役データ:       data/yaku/<章id>.json
- 出力タイル:     public/art/symbols/<章id>/<役id>_<reelIndex>.webp（130:100 の3x）

色と同じ「先勝ち（premium→core→bonus）」で共有文字を一意化し、出力名は
「そのセルを最初に主張した役」= <役id>_<reelIndex>.webp。ReelView 側も同じ順序。
コア/脇役は枠なしアート前提でクロップ無し（zoom=1.0）。
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "scripts"))
from compose_symbol import compose  # noqa: E402

FONT = "/System/Library/Fonts/ヒラギノ明朝 ProN.ttc"
FONT_INDEX = 2  # Hiragino Mincho ProN W6


def main():
    if len(sys.argv) < 2:
        sys.exit("usage: build_chapter_tiles.py <章id>")
    chapter = sys.argv[1]
    art_dir = os.path.join(ROOT, "assets/art-src/symbols", chapter)
    out_dir = os.path.join(ROOT, "public/art/symbols", chapter)
    os.makedirs(out_dir, exist_ok=True)

    data = json.load(open(os.path.join(ROOT, "data/yaku", f"{chapter}.json")))
    # 先勝ち順は SymbolStyle / main.ts と揃える: premium → core → cherry → bonus
    ordered = (
        data["premiumYaku"]
        + data["coreYaku"]
        + data.get("cherryYaku", [])
        + data["bonusYaku"]
    )

    seen = set()
    count = 0
    for yaku in ordered:
        art = os.path.join(art_dir, f"{yaku['id']}.png")
        for r, sym in enumerate(yaku["symbols"]):
            key = (r, sym)
            if key in seen:
                continue  # 先勝ち：上位役が主張済みのセルは飛ばす
            seen.add(key)
            # ここで初めてアートが必要。RB のように全セルを借用する役は
            # ループに入ってこない（=アート不要）。実際に合成する時だけ存在を要求。
            if not os.path.exists(art):
                sys.exit(f"missing art: {art} (役 {yaku['id']} の {sym} 用)")
            out = os.path.join(out_dir, f"{yaku['id']}_{r}.webp")
            compose(art, sym, FONT, FONT_INDEX, out)
            count += 1
    print(f"{count} tiles -> {out_dir}")


if __name__ == "__main__":
    main()
