#!/usr/bin/env python3
"""セキュリティエンジニア（章 security の出題者）のドット絵を組み立てる。

    python3 tools/pixel/v2/build_engineer.py

素体（出題の顔）を描き、正解・不正解は素体からの**差分**で作る。
書き出すのは engineer.txt / engineer_correct.txt / engineer_wrong.txt（48×56）。
人物像：落ち着いた20代後半の男性。紺のパーカーにヘッドセット、首から社員証。
"""

from __future__ import annotations

import pathlib

W, H = 48, 56
OUT = pathlib.Path(__file__).resolve().parent


class Grid:
    def __init__(self) -> None:
        self.g = [["."] * W for _ in range(H)]

    def get(self, x: int, y: int) -> str:
        return self.g[y][x] if 0 <= x < W and 0 <= y < H else "."

    def put(self, x: int, y: int, c: str, only: str | None = None) -> None:
        """only を渡すと「今そこがその色のどれか」のときだけ塗る。"""
        if 0 <= x < W and 0 <= y < H and (only is None or self.g[y][x] in only):
            self.g[y][x] = c

    def span(self, y: int, x0: int, x1: int, c: str, only: str | None = None) -> None:
        for x in range(x0, x1 + 1):
            self.put(x, y, c, only)

    def spans(self, rows: dict[int, tuple[int, int]], c: str) -> None:
        for y, (x0, x1) in rows.items():
            self.span(y, x0, x1, c)

    def copy(self) -> "Grid":
        n = Grid()
        n.g = [r[:] for r in self.g]
        return n

    def text(self, comment: str) -> str:
        return "".join(f"# {ln}\n" for ln in comment.splitlines()) + "".join(
            "".join(r) + "\n" for r in self.g
        )


# ---------------------------------------------------------------- 形の定義
FACE = {y: (14, 33) for y in range(13, 32)}
FACE.update({32: (15, 32), 33: (15, 32), 34: (16, 31), 35: (17, 30), 36: (19, 28)})

HAIR = {
    2: (18, 29), 3: (15, 32), 4: (13, 34), 5: (12, 35),
    **{y: (11, 36) for y in range(6, 15)},
}
# 前髪の下端（列 14..33 ごと）。谷は浅く、左から右へ流す
BANGS = [18, 18, 18, 17, 16, 17, 18, 18, 17, 16, 16, 17, 17, 16, 15, 16, 16, 15, 16, 17]

BODY = {39: (13, 34), 40: (9, 38), 41: (6, 41), 42: (4, 43), 43: (3, 44)}
BODY.update({y: (2, 45) for y in range(44, 56)})
EY = 23  # まつ毛の行
HOOD = {37: (15, 32), 38: (14, 33), 39: (12, 35), 40: (12, 35), 41: (13, 34), 42: (15, 32)}


def base() -> Grid:
    G = Grid()

    # --- 胴（パーカー：藍 1/3/4）。光は左上
    G.spans(BODY, "3")
    for y in range(39, 56):
        for x in range(2, 46):
            if G.get(x, y) != "3":
                continue
            if x + (y - 39) * 0.15 < 12 and y < 50:
                G.put(x, y, "4")           # 左肩の光
            elif x - (y - 40) * 0.3 > 36:
                G.put(x, y, "1")           # 右側の影
    # 腕と胴の境（内側の線）
    for y in range(44, 56):
        G.put(9 - (y - 44) // 5, y, "1")
        G.put(38 + (y - 44) // 5, y, "k")

    # --- フード（首まわりにたまった布）
    G.spans(HOOD, "4")
    for y, (x0, x1) in HOOD.items():
        G.span(y, x1 - 4, x1, "3")
        G.put(x1, y, "1")
    G.span(42, 15, 32, "3")
    G.span(42, 26, 32, "1")
    # 首の穴
    G.spans({37: (19, 28), 38: (19, 28), 39: (19, 28), 40: (20, 27), 41: (21, 26)}, "1")

    # --- 首
    G.spans({35: (19, 28), 36: (19, 28), 37: (20, 27), 38: (20, 27), 39: (21, 26)}, "s")
    G.span(37, 20, 27, "d")
    G.span(38, 23, 27, "d")
    G.span(39, 21, 26, "d")
    G.put(20, 38, "d")

    # --- 顔
    G.spans(FACE, "s")
    for y, (x0, x1) in FACE.items():
        # 右側の影は斜めの境界（左右で割らない）
        edge = x1 - max(0, (y - 22) // 3)
        G.span(y, edge, x1, "d")
    for y in range(20, 26):              # 左ほおの光
        G.span(y, 15, 16 + (25 - y) // 3, "S")
    G.span(34, 17, 30, "d", only="s")    # あごの下の影
    G.span(35, 18, 29, "d")
    G.span(36, 19, 28, "d")

    # --- 髪（黒髪）
    G.spans(HAIR, "h")
    for i, b in enumerate(BANGS):
        for y in range(15, b + 1):
            G.put(14 + i, y, "h")
    for y in range(15, 22):              # 横の髪（ヘッドセットまで）
        G.span(y, 12, 14, "h")
        G.span(y, 33, 35, "h")
    for y in range(22, 25):              # もみあげは細く
        G.put(14, y, "2")
        G.put(33, y, "2")
    # 前髪の下に落ちる影（肌の上だけ）
    for i, b in enumerate(BANGS):
        G.put(14 + i, b + 1, "d", only="sS")
    # 髪の陰影：左上が明るく、右下ほど暗い
    for y in range(2, 22):
        for x in range(11, 37):
            if G.get(x, y) != "h":
                continue
            if x + y < 22:
                G.put(x, y, "L")
            elif x - y > 21 or y >= 15 and x > 30:
                G.put(x, y, "2")
    for x, y in [(15, 5), (16, 5), (17, 4), (18, 4), (19, 4), (14, 6), (13, 7)]:
        G.put(x, y, "l")                 # 艶
    # 前髪の房（内側の線で表す）
    for x0, y0, n in [(18, 12, 6), (23, 11, 6), (28, 11, 5)]:
        for k_ in range(n):
            G.put(x0 + k_ // 2, y0 + k_, "2", only="hL")

    # --- ヘッドセット
    band = [(12, y) for y in range(12, 21)] + [(35, y) for y in range(12, 21)]
    band += [(13, 10), (13, 11), (14, 8), (14, 9), (15, 7), (16, 6), (17, 5)]
    band += [(34, 10), (34, 11), (33, 8), (33, 9), (32, 7), (31, 6), (30, 5)]
    band += [(x, 4) for x in range(18, 30)]
    for x, y in band:
        G.put(x, y, "N")
    for x, y in [(18, 3), (17, 4), (16, 5), (15, 6), (14, 7)]:
        G.put(x, y, "K", only="hLl")     # 帯の外側に影を一筋
    for x in range(19, 29):
        G.put(x, 3, "l", only="hLl")     # 帯の上の光
    cup = {21: (11, 13), 22: (10, 14), **{y: (10, 14) for y in range(23, 29)}, 29: (11, 13)}
    for y, (x0, x1) in cup.items():
        G.span(y, x0, x1, "k")
        G.span(y, 47 - x1, 47 - x0, "k")
    for y in range(22, 27):              # 左の耳当ては光を受ける
        G.put(11, y, "N")
    G.put(12, 22, "l")
    for y in range(22, 29):
        G.put(14, y, "K")
        G.put(33, y, "K")
    G.put(36, 23, "N")
    G.put(35, 25, "b")                   # 通話中のランプ
    # マイクのアーム（右の耳当てから口元へ）
    for x, y in [(34, 30), (33, 31), (33, 32), (32, 33)]:
        G.put(x, y, "K")
    G.span(33, 30, 31, "k")
    G.span(34, 30, 31, "K")

    # --- 眉（2行・まっすぐ・落ち着いた人）
    G.span(20, 17, 20, "2")
    G.span(21, 16, 21, "2")
    G.span(20, 27, 30, "2")
    G.span(21, 26, 31, "2")

    # --- 目（3行＝まつ毛1段＋虹彩2行）
    for x0 in (16, 26):
        G.span(EY, x0, x0 + 5, "K")
        G.span(EY + 1, x0 + 1, x0 + 4, "W")
        G.span(EY + 2, x0 + 1, x0 + 4, "W")
    for x0 in (18, 27):
        G.put(x0, EY + 1, "D"); G.put(x0 + 1, EY + 1, "D")
        G.put(x0, EY + 2, "E"); G.put(x0 + 1, EY + 2, "D")

    # --- 鼻・口
    G.put(24, 28, "d")
    G.put(24, 29, "d")
    G.put(23, 29, "d")
    G.span(32, 22, 25, "M")
    G.put(26, 31, "M")

    # --- 社員証（首から下げる）
    for x, y in [(21, 42), (21, 43), (22, 44), (22, 45), (23, 46)]:
        G.put(x, y, "r")
    for x, y in [(26, 42), (26, 43), (25, 44), (25, 45), (24, 46)]:
        G.put(x, y, "R" if y < 44 else "r")
    G.span(47, 23, 24, "N")
    for y in range(48, 56):
        G.span(y, 19, 28, "C")
        G.put(28, y, "c")
    G.span(48, 19, 28, "E")
    G.span(49, 19, 28, "E")
    G.span(48, 19, 21, "e")
    for y in range(51, 55):
        G.span(y, 20, 22, "s")
    G.span(51, 20, 22, "h")
    G.span(51, 24, 27, "k")
    G.span(53, 24, 26, "k")
    # パーカーの紐
    for y in range(43, 48):
        G.put(18, y, "c")
        G.put(29, y, "n")

    outline(G)
    return G


def outline(G: Grid) -> None:
    """シルエットの外周に地色より暗い輪郭を置く。"""
    edge = []
    for y in range(H):
        for x in range(W):
            if G.get(x, y) != ".":
                continue
            if any(G.get(x + dx, y + dy) not in ".K" for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                edge.append((x, y))
    for x, y in edge:
        G.put(x, y, "K")


# ---------------------------------------------------------------- 表情（差分）
def clear_brows(G: Grid) -> None:
    """眉を消して下の肌に戻す（眉は肌の上にしか無い）。"""
    for y in (20, 21):
        for x in list(range(16, 22)) + list(range(26, 32)):
            if G.get(x, y) == "2":
                G.put(x, y, "d" if x >= FACE[y][1] - max(0, (y - 22) // 3) else "s")


def sparkle(G: Grid, cx: int, cy: int, r: int) -> None:
    for i in range(1, r + 1):
        for dx, dy in ((i, 0), (-i, 0), (0, i), (0, -i)):
            G.put(cx + dx, cy + dy, "Y")
    G.put(cx, cy, "y")


def correct(G0: Grid) -> Grid:
    G = G0.copy()
    # 口：開けて口角を上げる
    G.span(31, 21, 27, "s", only="M")
    G.span(32, 21, 27, "s", only="M")
    # 開いた口は中を暗く、舌は1点だけ（ピンクの面にすると唇に見える）
    G.put(21, 30, "M"); G.put(27, 30, "M")
    G.span(31, 22, 26, "M")
    G.span(32, 23, 25, "M"); G.put(24, 32, "m")
    # 眉を1つ上げる
    clear_brows(G)
    G.span(19, 17, 20, "2"); G.span(20, 16, 21, "2")
    G.span(19, 27, 30, "2"); G.span(20, 26, 31, "2")
    sparkle(G, 41, 8, 3)
    sparkle(G, 6, 14, 1)
    return G


def wrong(G0: Grid) -> Grid:
    G = G0.copy()
    # 口：波打つ（困り笑い）。口角を下げるときは間の影も消す
    G.span(31, 21, 27, "s", only="M")
    G.span(32, 21, 27, "s", only="M")
    G.put(21, 33, "M"); G.span(32, 22, 23, "M"); G.put(24, 33, "M"); G.span(32, 25, 26, "M"); G.put(27, 33, "M")
    # 眉：内側を上げる
    clear_brows(G)
    G.span(21, 16, 18, "2"); G.span(20, 18, 21, "2"); G.span(19, 20, 21, "2")
    G.span(21, 29, 31, "2"); G.span(20, 26, 29, "2"); G.span(19, 26, 27, "2")
    # 汗：塗り詰まった塊（上1ドット・下2×2）
    drop = [(39, 14), (39, 15), (38, 16), (39, 16), (38, 17), (39, 17), (38, 18), (39, 18)]
    for x, y in drop:
        G.put(x, y, "b")
    G.put(38, 17, "C")
    for x, y in drop:
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            if G.get(x + dx, y + dy) in ".K":
                G.put(x + dx, y + dy, "K")
    return G


def main() -> None:
    b = base()
    note = "セキュリティエンジニア（章 security）。build_engineer.py が書き出す。手で直さない"
    for name, g in (("engineer", b), ("engineer_correct", correct(b)), ("engineer_wrong", wrong(b))):
        (OUT / f"{name}.txt").write_text(g.text(f"{note}\n表情: {name}"), encoding="utf-8")
        print(OUT / f"{name}.txt")


if __name__ == "__main__":
    main()
