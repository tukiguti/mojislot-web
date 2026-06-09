#!/usr/bin/env python3
"""
実機ジャグラーのリール配列（固定パターン）を、各章の役の文字へ置き換えて
data/reels/<章id>.json を書き出す（自動生成ではなく実機パターンの直接置換）。

usage: python3 scripts/build_chapter_reels.py <章id>

役コード:
  7=7図柄(premiumYaku[0]) / B=バー(premiumYaku[1]) / G=ぶどう(coreYaku[0]) /
  R=リプレイ(coreYaku[1]) / L=ベル(coreYaku[2]) / P=ピエロ(coreYaku[3]) /
  C=チェリー(cherryYaku[0]・左中のみ)

各リール21コマ。役コードを、そのリール位置の役の文字 symbols[r] に置換する。
共有文字は先勝ち（タイル生成側 build_chapter_tiles と整合）で1タイルにまとまる。
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# 実機ジャグラー風の役パターン（pos1→21）。参考画像③＋定番配置を基に作成。
# 各リールに必要な役を全て含み（=全役成立可能）、同役の隣接なし・ボーナス図柄は分散。
PATTERN = {
    "left": [
        "G", "7", "R", "G", "C", "G", "R", "P", "B", "G", "L",
        "R", "P", "G", "B", "R", "G", "C", "G", "R", "L",
    ],
    "middle": [
        "R", "7", "G", "P", "C", "G", "R", "L", "G", "B", "R",
        "G", "P", "R", "G", "B", "C", "G", "R", "L", "G",
    ],
    "right": [
        "L", "7", "B", "G", "R", "G", "P", "G", "R", "B", "G",
        "R", "L", "G", "P", "R", "G", "L", "G", "R", "G",
    ],
}


def role_map(data):
    """役コード -> 役オブジェクト。足りない場合は None。"""
    core = data["coreYaku"]
    prem = data["premiumYaku"]
    cherry = data.get("cherryYaku", [])
    return {
        "7": prem[0] if len(prem) > 0 else None,
        "B": prem[1] if len(prem) > 1 else None,
        "G": core[0] if len(core) > 0 else None,
        "R": core[1] if len(core) > 1 else None,
        "L": core[2] if len(core) > 2 else None,
        "P": core[3] if len(core) > 3 else None,
        "C": cherry[0] if len(cherry) > 0 else None,
    }


def main():
    if len(sys.argv) < 2:
        sys.exit("usage: build_chapter_reels.py <章id>")
    chapter = sys.argv[1]
    data = json.load(open(os.path.join(ROOT, "data/yaku", f"{chapter}.json")))
    rmap = role_map(data)

    reels = []
    for ridx, rid in enumerate(("left", "middle", "right")):
        cells = []
        for role in PATTERN[rid]:
            yk = rmap.get(role)
            if yk is None:
                sys.exit(f"役コード {role} に対応する役が {chapter} に無い")
            # チェリー(2文字)は右リールに無い前提。symbols[ridx] が無ければエラー。
            if ridx >= len(yk["symbols"]):
                sys.exit(f"{chapter} の役 {yk['id']} はリール{ridx}に文字が無い(role {role})")
            cells.append(yk["symbols"][ridx])
        assert len(cells) == 21
        reels.append((rid, cells))

    out = os.path.join(ROOT, "data/reels", f"{chapter}.json")
    lines = ["{", f'  "mode": "{chapter}",', '  "reels": [']
    for i, (rid, cells) in enumerate(reels):
        arr = ", ".join('"' + c + '"' for c in cells)
        comma = "," if i < len(reels) - 1 else ""
        lines.append("    {")
        lines.append(f'      "id": "{rid}",')
        lines.append(f'      "cells": [{arr}]')
        lines.append("    }" + comma)
    lines.append("  ]")
    lines.append("}")
    with open(out, "w") as f:
        f.write("\n".join(lines) + "\n")
    print(f"wrote {out}")
    for rid, cells in reels:
        print(f"  {rid}: {' '.join(cells)}")


if __name__ == "__main__":
    main()
