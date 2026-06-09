#!/usr/bin/env python3
"""
食べ物章のリール帯（21コマ×3リール）を実機風に再設計して
data/reels/hiragana_food.json を書き出す。

方針:
- 各リールに、そのリール位置で必要な全文字（役が揃うため）を必ず含める。
- プレミアム/ボーナス文字（す/し/や/こ）はコマ数少なめ（2）で、リング上で十分離す
  ＝実機の「ボーナス図柄は本数が少なく散っている」感。
- コア食材は2〜3コマ。配置はシード固定シャッフル＋制約（同図柄を隣接させない／
  ボーナス図柄を離す）で、規則的な繰り返しにならない不規則＝実機風にする。決定的。
"""
import json
import os
import random

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data/reels/hiragana_food.json")

# 各リールの 文字→コマ数（合計21）。premium/bonus は 2 本で散らす。
LEFT = {"い": 3, "み": 3, "う": 3, "ま": 3, "と": 3, "ぶ": 2, "さ": 2, "す": 2}
MIDDLE = {"ち": 3, "か": 3, "な": 3, "ぐ": 3, "う": 2, "ど": 2, "ん": 3, "し": 2}
RIGHT = {"ご": 3, "ん": 2, "ぎ": 2, "ろ": 3, "ふ": 2, "う": 2, "ま": 3, "や": 2, "こ": 2}

# 各リールで「散らしたい」ボーナス系図柄
SPECIALS = {"left": ["す"], "middle": ["し"], "right": ["や", "こ"]}
MIN_SPECIAL_GAP = 7  # リング上で同一ボーナス図柄を離す最小間隔


def ring_dist(a, b, n):
    d = abs(a - b)
    return min(d, n - d)


def valid(seq, specials):
    n = len(seq)
    # 同じ図柄をリング上で隣接させない
    for i in range(n):
        if seq[i] == seq[(i + 1) % n]:
            return False
    # ボーナス図柄の各占有を十分離す
    for sp in specials:
        idx = [i for i, x in enumerate(seq) if x == sp]
        for a in range(len(idx)):
            for b in range(a + 1, len(idx)):
                if ring_dist(idx[a], idx[b], n) < MIN_SPECIAL_GAP:
                    return False
    return True


def build(counts, specials):
    pool = []
    for s, n in counts.items():
        pool += [s] * n
    assert len(pool) == 21
    # 決定的にするためシードを 0 から探索し、制約を満たす最初の並びを採用
    for seed in range(100000):
        rng = random.Random(seed)
        seq = pool[:]
        rng.shuffle(seq)
        if valid(seq, specials):
            return seq, seed
    raise RuntimeError("no valid arrangement found")


def main():
    reels = []
    for rid, counts in (("left", LEFT), ("middle", MIDDLE), ("right", RIGHT)):
        seq, seed = build(counts, SPECIALS[rid])
        reels.append((rid, seq))
        print(f"{rid} (seed {seed}) -> {' '.join(seq)}")

    # cells を1行で書く独自整形（既存フォーマット踏襲）
    lines = ["{", '  "mode": "hiragana_food",', '  "reels": [']
    for i, (rid, cells) in enumerate(reels):
        arr = ", ".join('"' + c + '"' for c in cells)
        comma = "," if i < len(reels) - 1 else ""
        lines.append("    {")
        lines.append(f'      "id": "{rid}",')
        lines.append(f'      "cells": [{arr}]')
        lines.append("    }" + comma)
    lines.append("  ]")
    lines.append("}")
    with open(OUT, "w") as f:
        f.write("\n".join(lines) + "\n")
    print("wrote", OUT)


if __name__ == "__main__":
    main()
