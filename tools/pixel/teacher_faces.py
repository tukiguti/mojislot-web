#!/usr/bin/env python3
"""国語の教師：素体（出題）から正解・不正解の顔を差分で作る。

    python3 tools/pixel/teacher_faces.py

素体 teacher.txt を読み、teacher_correct.txt / teacher_wrong.txt を書き出す。
目と眼鏡は触らない。差は「顔の外の記号」「口」「眉の傾き」で付ける（PIXEL_SPEC）。
"""

from __future__ import annotations

import pathlib

HERE = pathlib.Path(__file__).resolve().parent
W = 48


def load(path: pathlib.Path) -> tuple[list[str], list[list[str]]]:
    lines = path.read_text(encoding="utf-8").splitlines()
    head = [l for l in lines if l.startswith("#")]
    grid = [list(l) for l in lines if not l.startswith("#")]
    return head, grid


def save(path: pathlib.Path, comment: str, grid: list[list[str]]) -> None:
    out = [f"# {comment}"] + ["".join(r) for r in grid]
    path.write_text("\n".join(out) + "\n", encoding="utf-8")


def skin_under(grid: list[list[str]], x: int, y: int) -> str:
    """眉や口を消した跡を埋める肌色。右下ほど陰（素体の陰の境界に合わせる）。"""
    return "d" if x >= 31 or (x >= 28 and y >= 29) else "s"


def clear(grid, cells):
    for x, y in cells:
        grid[y][x] = skin_under(grid, x, y)


def paint(grid, cells, c):
    for x, y in cells:
        grid[y][x] = c


# 素体の眉（左右とも2行）と口
BROW_L = [(x, 19) for x in range(18, 22)] + [(x, 20) for x in range(17, 22)]
BROW_R = [(x, 19) for x in range(26, 30)] + [(x, 20) for x in range(26, 31)]
MOUTH = [(21, 30), (26, 30)] + [(x, 31) for x in range(22, 26)]


def sparkle(grid, cx, cy, arm=2):
    """きらめき＝十字。中心を白、四方を金。外側の先だけ地に溶けるよう1段短く。"""
    grid[cy][cx] = "W"
    for i in range(1, arm + 1):
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            grid[cy + dy * i][cx + dx * i] = "Y"


def correct(grid):
    # 眉を1行上げて「ぱっと明るく」
    clear(grid, BROW_L + BROW_R)
    paint(grid, [(x, 18) for x in range(18, 22)], "h")
    paint(grid, [(x, 19) for x in range(17, 22)], "2")
    paint(grid, [(x, 18) for x in range(26, 30)], "h")
    paint(grid, [(x, 19) for x in range(26, 31)], "2")
    # 口を開けて笑う（D字）：口角を1行上げ、上の線を広く、中に舌。
    # 4ドット幅の丸い口は「驚き」に読まれたので、幅6＋口角で笑いにする
    clear(grid, MOUTH)
    paint(grid, [(20, 29), (27, 29)], "M")
    paint(grid, [(x, 30) for x in range(21, 27)], "M")
    paint(grid, [(21, 31), (26, 31)], "M")
    paint(grid, [(x, 31) for x in range(22, 26)], "m")
    paint(grid, [(x, 32) for x in range(22, 26)], "M")
    # きらめき（顔の外・右上と左）
    sparkle(grid, 41, 7, 2)
    sparkle(grid, 6, 16, 1)


def wrong(grid):
    # 困り眉：内側を上げて外側を下げる（2行ずらす）
    clear(grid, BROW_L + BROW_R)
    paint(grid, [(20, 18), (21, 18), (18, 19), (19, 19), (20, 19), (21, 19), (17, 20), (18, 20)], "2")
    paint(grid, [(26, 18), (27, 18), (26, 19), (27, 19), (28, 19), (29, 19), (29, 20), (30, 20)], "2")
    paint(grid, [(20, 18), (21, 18), (26, 18), (27, 18)], "h")
    # 口：閉じて口角を下げる。間の影は残さない
    clear(grid, MOUTH)
    paint(grid, [(x, 30) for x in range(22, 26)], "M")
    paint(grid, [(21, 31), (26, 31)], "M")
    # 汗：上1ドット・下2×3の塊（2×2では実寸で点にしか見えなかった）
    paint(grid, [(38, 14)], "b")
    paint(grid, [(x, y) for y in (15, 16, 17) for x in (37, 38)], "b")
    grid[16][37] = "W"


def main() -> None:
    _, base = load(HERE / "teacher.txt")
    for name, fn, note in (
        ("teacher_correct.txt", correct, "国語の教師・正解（teacher_faces.py で素体から生成）"),
        ("teacher_wrong.txt", wrong, "国語の教師・不正解（teacher_faces.py で素体から生成）"),
    ):
        g = [r[:] for r in base]
        fn(g)
        save(HERE / name, note, g)
        print(f"→ {HERE / name}")


if __name__ == "__main__":
    main()
