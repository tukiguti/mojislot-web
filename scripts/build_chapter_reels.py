#!/usr/bin/env python3
"""
任意の章のリール帯（21コマ×3リール）を実機ジャグラー風の枚数配分で作る（汎用版）。

usage: python3 scripts/build_chapter_reels.py <章id>

枚数配分（実機ジャグラー風・1リール21コマ）:
- 7図柄(premium[0]) / バー図柄(premium[1]): 各2枚
- チェリー(cherry): 2枚（出現するリールのみ）
- ぶどう相当=最頻小役(coreYaku[0]): 残り全部（7〜9枚）
- その他の小役(coreYaku[1:]): 各4枚
共有文字（先勝ち premium→core→cherry→bonus）は1タイルにまとまるので
実際の枚数は多少前後する。配置はボーナス図柄を離す制約付きのシード固定シャッフル。
"""
import json
import os
import sys
import random

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

REEL_LEN = 21
SPECIAL_COUNT = 2   # 7図柄・バー図柄の枚数
CHERRY_COUNT = 2    # チェリーの枚数
SMALL_COUNT = 4     # ぶどう以外の小役の枚数
MIN_SPECIAL_GAP = 6  # 同じボーナス図柄をリング上で離す最小間隔


def claimed_per_reel(data):
    """各リール r の distinct symbol を先勝ち順で [(symbol, category, yaku_id)] で返す。"""
    ordered = (
        data["premiumYaku"]
        + data["coreYaku"]
        + data.get("cherryYaku", [])
        + data["bonusYaku"]
    )
    reels = [dict() for _ in range(3)]  # r -> {symbol: (category, yaku_id)}
    for y in ordered:
        for r, s in enumerate(y["symbols"]):
            if s not in reels[r]:
                reels[r][s] = (y["category"], y["id"])
    return reels


def counts_for_reel(claim, grape_id):
    """symbol -> 枚数（合計 REEL_LEN）。grape(最頻小役)が残りを総取り。"""
    counts = {}
    grape_syms = []
    fixed = 0
    for s, (cat, yid) in claim.items():
        if cat == "premium":
            counts[s] = SPECIAL_COUNT
            fixed += SPECIAL_COUNT
        elif cat == "cherry":
            counts[s] = CHERRY_COUNT
            fixed += CHERRY_COUNT
        elif cat == "core" and yid == grape_id:
            grape_syms.append(s)  # 後で残りを割当
        elif cat == "core":
            counts[s] = SMALL_COUNT
            fixed += SMALL_COUNT
        else:  # bonus 等（通常は全借用で出てこない）
            counts[s] = SMALL_COUNT
            fixed += SMALL_COUNT
    remain = REEL_LEN - fixed
    if grape_syms:
        # grape が残りを総取り（複数あれば均等）
        base, extra = divmod(remain, len(grape_syms))
        for i, s in enumerate(grape_syms):
            counts[s] = base + (1 if i < extra else 0)
    else:
        # grape がこのリールに無い → 余りを既存の小役へ上乗せ
        smalls = [s for s, (c, _) in claim.items() if c == "core"]
        if not smalls:
            smalls = list(counts.keys())
        i = 0
        while remain > 0 and smalls:
            counts[smalls[i % len(smalls)]] += 1
            remain -= 1
            i += 1
    assert sum(counts.values()) == REEL_LEN, (counts, sum(counts.values()))
    return counts


def ring_dist(a, b, n):
    d = abs(a - b)
    return min(d, n - d)


def valid(seq, specials, cherry):
    """実機ルール：①同じ図柄を隣接させない(リング込み) ②ボーナス図柄を離す
    ③チェリーは7(specials[0])の近く(±2)に最低1枚（告知）。"""
    n = len(seq)
    # ① 同一図柄の隣接禁止（ぶどう連続も禁止）
    for i in range(n):
        if seq[i] == seq[(i + 1) % n]:
            return False
    # ② ボーナス図柄を離す
    for sp in specials:
        idx = [i for i, x in enumerate(seq) if x == sp]
        for a in range(len(idx)):
            for b in range(a + 1, len(idx)):
                if ring_dist(idx[a], idx[b], n) < MIN_SPECIAL_GAP:
                    return False
    # ③ チェリー告知：7の±2にチェリーが1枚以上
    if cherry and specials:
        seven_idx = [i for i, x in enumerate(seq) if x == specials[0]]
        cher_idx = [i for i, x in enumerate(seq) if x == cherry]
        if seven_idx and cher_idx:
            ok = any(
                ring_dist(s, c, n) <= 2 for s in seven_idx for c in cher_idx
            )
            if not ok:
                return False
    return True


def greedy(counts, rng):
    """各位置で「残り枚数が最も多く・直前と異なる」図柄を置く貪欲法。
    最頻図柄(ぶどう)が自然に1コマおきへ散る。詰まったら None。"""
    remaining = dict(counts)
    total = sum(counts.values())
    seq = []
    for pos in range(total):
        cands = [
            s for s in remaining
            if remaining[s] > 0 and (not seq or s != seq[-1])
        ]
        if pos == total - 1 and seq:
            cands = [s for s in cands if s != seq[0]]  # リング末尾の隣接回避
        if not cands:
            return None
        rng.shuffle(cands)
        cands.sort(key=lambda s: -remaining[s])
        # 残り最多の図柄を優先しつつ、同率はランダム
        top = remaining[cands[0]]
        pick = rng.choice([s for s in cands if remaining[s] == top])
        seq.append(pick)
        remaining[pick] -= 1
    return seq


def build(counts, specials, cherry, reel_idx):
    """リールごとに別シードで貪欲生成→実機ルール検証。"""
    base = reel_idx * 100003
    for k in range(300000):
        rng = random.Random(base + k)
        seq = greedy(counts, rng)
        if seq and valid(seq, specials, cherry):
            return seq, base + k
    raise RuntimeError("no valid arrangement")


def main():
    if len(sys.argv) < 2:
        sys.exit("usage: build_chapter_reels.py <章id>")
    chapter = sys.argv[1]
    data = json.load(open(os.path.join(ROOT, "data/yaku", f"{chapter}.json")))
    grape_id = data["coreYaku"][0]["id"] if data["coreYaku"] else None
    claims = claimed_per_reel(data)

    reels = []
    for ridx, (rid, claim) in enumerate(zip(("left", "middle", "right"), claims)):
        counts = counts_for_reel(claim, grape_id)
        specials = [s for s, (c, _) in claim.items() if c == "premium"]
        cherry = next((s for s, (c, _) in claim.items() if c == "cherry"), None)
        seq, seed = build(counts, specials, cherry, ridx)
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
