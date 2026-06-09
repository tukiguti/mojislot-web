#!/usr/bin/env python3
"""
任意の章のリール帯（21コマ×3リール）を実機風に再設計する（汎用版）。

usage: python3 scripts/build_chapter_reels.py <章id>

- 役データ data/yaku/<章id>.json から、各リール位置で必要な文字を導出
  （色と同じ先勝ち premium→core→bonus。共有文字は上位役が主張）。
- プレミアム/ボーナス文字はコマ数少なめ(2)・リング上で離す＝出にくいボーナス図柄感。
- コア文字は残りコマを均等配分（2〜3）。
- 配置はシード固定シャッフル＋制約（同図柄非隣接／ボーナス図柄を7コマ以上離す）で
  不規則＝実機風。決定的。
"""
import json
import os
import sys
import random

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

REEL_LEN = 21
SPECIAL_COUNT = 2  # premium/bonus 文字のコマ数
MIN_SPECIAL_GAP = 7


def claimed_per_reel(data):
    """各リール r について [(symbol, is_special)] を先勝ち順で返す。"""
    # 先勝ち順: premium → core → cherry → bonus（色/タイルと同じ）
    ordered = (
        data["premiumYaku"]
        + data["coreYaku"]
        + data.get("cherryYaku", [])
        + data["bonusYaku"]
    )
    reels = [dict() for _ in range(3)]  # r -> {symbol: is_special}
    for y in ordered:
        special = y["category"] in ("premium", "bonus")
        for r, s in enumerate(y["symbols"]):
            if s not in reels[r]:
                reels[r][s] = special
    return reels


def counts_for_reel(claim):
    """symbol->is_special から symbol->コマ数 を作る（合計 REEL_LEN）。"""
    specials = [s for s, sp in claim.items() if sp]
    cores = [s for s, sp in claim.items() if not sp]
    counts = {s: SPECIAL_COUNT for s in specials}
    remain = REEL_LEN - SPECIAL_COUNT * len(specials)
    if not cores:
        raise RuntimeError("no core symbols on a reel")
    base, extra = divmod(remain, len(cores))
    for i, s in enumerate(cores):
        counts[s] = base + (1 if i < extra else 0)
    assert sum(counts.values()) == REEL_LEN, counts
    return counts, specials


def ring_dist(a, b, n):
    d = abs(a - b)
    return min(d, n - d)


def valid(seq, specials):
    n = len(seq)
    for i in range(n):
        if seq[i] == seq[(i + 1) % n]:
            return False
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
    for seed in range(200000):
        rng = random.Random(seed)
        seq = pool[:]
        rng.shuffle(seq)
        if valid(seq, specials):
            return seq, seed
    raise RuntimeError("no valid arrangement")


def main():
    if len(sys.argv) < 2:
        sys.exit("usage: build_chapter_reels.py <章id>")
    chapter = sys.argv[1]
    data = json.load(open(os.path.join(ROOT, "data/yaku", f"{chapter}.json")))
    claims = claimed_per_reel(data)

    reels = []
    for rid, claim in zip(("left", "middle", "right"), claims):
        counts, specials = counts_for_reel(claim)
        seq, seed = build(counts, specials)
        reels.append((rid, seq))
        print(f"{chapter} {rid} (seed {seed}) -> {' '.join(seq)}")

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
    print("wrote", out)


if __name__ == "__main__":
    main()
