#!/usr/bin/env python3
"""クイズの出題者のドット絵を、ゲームが読む PNG へ書き出す。

    python3 tools/build_quizmaster_art.py

`tools/pixel/<名前>.txt`（48×56 のマップ・仕様は tools/PIXEL_SPEC.md）を
`public/art/quizmaster/<章ID>_<表情>.png` へ等倍で出す。拡大はゲーム側が
整数倍（3倍）で行う——ここで拡大すると容量が9倍になるだけで得がない。

**章IDで出す**のは、ゲームが「島＝章」から出題者を引くため（src/data/quizmasters.ts）。
マップ名（職業）とゲーム側の章IDの対応をここ1箇所に閉じておく。

表情は 出題 / 正解 / 不正解 の3種。マップが無い表情は黙って飛ばす（ゲーム側は
出題の顔で代用する）ので、描けた分だけ足していける。
"""

from __future__ import annotations

import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from pixel_kit import load, to_image  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "tools" / "pixel"
DST = ROOT / "public" / "art" / "quizmaster"

# 章ID → マップ名（14_character-design.md §2 の対応表）
MASTERS = {
    "hiragana_food": "sushi_taisho",   # 寿司屋の大将
    "katakana_animal": "zookeeper",    # 動物園の飼育員
    "hiragana_verb": "teacher",        # 国語の教師
    "yasai": "greengrocer",            # 八百屋の店主
    "security": "engineer",            # セキュリティエンジニア
}

# 表情 → マップ名の接尾辞。出題は接尾辞なし（＝素の顔がそのまま出題の顔）
FACES = {"ask": "", "correct": "_correct", "wrong": "_wrong"}


def main() -> int:
    DST.mkdir(parents=True, exist_ok=True)
    written, missing = 0, []
    for chapter, name in MASTERS.items():
        for face, suffix in FACES.items():
            src = SRC / f"{name}{suffix}.txt"
            if not src.exists():
                missing.append(f"{name}{suffix}")
                continue
            out = DST / f"{chapter}_{face}.png"
            to_image(load(src)).save(out)
            print(f"  {src.name} → {out.relative_to(ROOT)}")
            written += 1
    print(f"{written} 枚を書き出しました")
    if missing:
        print(f"未収録（出題の顔で代用される）: {', '.join(missing)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
