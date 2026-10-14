#!/usr/bin/env python3
"""動物園の飼育員（katakana_animal の出題者）のマップを作る。

    python3 tools/pixel/zookeeper_gen.py

素体（出題）を描き、正解・不正解は素体からの差分で作る。顔の作りを3枚で揃えるため、
表情の差は口・眉・顔の外の記号だけに入れ、目は触らない（PIXEL_SPEC の知見）。
外周の輪郭 K は最後に「塗った画素に隣り合う透過画素」へ自動で置く。
"""

from __future__ import annotations

import pathlib

W, H = 48, 56
HERE = pathlib.Path(__file__).resolve().parent


def blank() -> list[list[str]]:
    return [["." for _ in range(W)] for _ in range(H)]


def put(g, x, y, ch):
    if 0 <= x < W and 0 <= y < H:
        g[y][x] = ch


def hline(g, y, x0, x1, ch):
    for x in range(x0, x1 + 1):
        put(g, x, y, ch)


def stamp(g, x0, y0, rows: list[str]):
    """文字列の小片を置く。空白は触らない。"""
    for dy, r in enumerate(rows):
        for dx, ch in enumerate(r):
            if ch != " ":
                put(g, x0 + dx, y0 + dy, ch)


def outline(g):
    """塗った画素の外側（上下左右に隣接する透過画素）を K にする。"""
    add = []
    for y in range(H):
        for x in range(W):
            if g[y][x] != ".":
                continue
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nx, ny = x + dx, y + dy
                if 0 <= nx < W and 0 <= ny < H and g[ny][nx] not in ".K":
                    add.append((x, y))
                    break
    for x, y in add:
        g[y][x] = "K"


# ---------------------------------------------------------------- 体（つなぎ）

def body(g):
    # 肩から下。行ごとの左右端（輪郭の内側）
    spans = {
        39: (14, 33), 40: (10, 37), 41: (7, 40), 42: (5, 42), 43: (4, 43),
    }
    for y in range(44, H):
        spans[y] = (3, 44)
    for y, (a, b) in spans.items():
        for x in range(a, b + 1):
            # 光は左上。左肩を明るく、右下ほど暗く。斜めの境界にする
            t = (x - a) + (y - 39) * 0.6
            if x - a < 3 and y < 47:
                ch = "q"
            elif x > b - 5 + (y - 39) // 4:
                ch = "g"
            else:
                ch = "G"
            g[y][x] = ch
    # 腕と胴の境（内側の線）
    for y in range(45, H):
        put(g, 10, y, "g")
        put(g, 37, y, "g")
    # 中央のファスナー
    for y in range(43, H):
        put(g, 24, y, "g")
    put(g, 24, 44, "7")
    put(g, 24, 45, "6")


def collar(g):
    # 首（影で赤味）と、つなぎの V 字の襟。中に白い T シャツ
    for y in range(35, 40):
        hline(g, y, 20, 27, "s")
        put(g, 26, y, "d")
        put(g, 27, y, "d")
    hline(g, 35, 20, 27, "d")  # あごの影
    # T シャツ
    stamp(g, 19, 39, ["CCCCCCCCCn"])
    stamp(g, 20, 40, ["CCCCCCCn"])
    stamp(g, 21, 41, ["nCCCnn"])
    stamp(g, 22, 42, ["nnnn"])
    # 襟（左は明るい、右は暗い）
    stamp(g, 14, 38, ["qqqqq"])
    stamp(g, 13, 39, ["qqqqqq"])
    stamp(g, 15, 40, ["qqqqq"])
    stamp(g, 17, 41, ["qqqq"])
    stamp(g, 19, 42, ["Gqq"])
    stamp(g, 29, 38, ["GGGGG"])
    stamp(g, 28, 39, ["GGGGGG"])
    stamp(g, 28, 40, ["GGGGg"])
    stamp(g, 27, 41, ["GGGg"])
    stamp(g, 26, 42, ["GGg"])
    # 襟の折り返しの内側の線
    for x, y in ((19, 38), (20, 39), (21, 40), (22, 41), (23, 42)):
        put(g, x, y, "g")
    for x, y in ((28, 38), (27, 39), (26, 40), (25, 41), (25, 42)):
        put(g, x, y, "g")


def pocket_and_chick(g):
    # 胸ポケット（キャラの左胸＝画面右）
    for y in range(46, 52):
        hline(g, y, 29, 36, "G")
    hline(g, 46, 29, 36, "g")       # ポケットの口
    for y in range(46, 52):
        put(g, 29, y, "g")
        put(g, 36, y, "g")
    hline(g, 52, 29, 36, "g")
    hline(g, 47, 30, 35, "q")       # 口の縁の光
    # ポケットから顔を出すひよこ
    stamp(g, 30, 40, [
        " KKKK ",
        "KyyYYK",
        "KyXYXK",
        "KYYRRYK",
        "KYYYYK",
        "KYYYYK",
    ])
    put(g, 30, 41, "K")


def badge(g):
    # 名札（キャラの右胸＝画面左）に肉球
    for y in range(46, 50):
        hline(g, y, 13, 19, "7")
    hline(g, 49, 13, 19, "6")
    for y in range(46, 50):
        put(g, 19, y, "6")
    stamp(g, 14, 46, [" g g", "    ", " gg "])
    put(g, 14, 47, "g")
    put(g, 17, 47, "g")


# ---------------------------------------------------------------- 頭

FACE = {  # 行: (左端, 右端) 肌の範囲
    13: (14, 33), 14: (14, 33), 15: (14, 33),
    **{y: (14, 33) for y in range(16, 28)},
    28: (15, 32), 29: (15, 32), 30: (16, 31), 31: (17, 30),
    32: (18, 29), 33: (19, 28), 34: (21, 26),
}


def face(g):
    for y, (a, b) in FACE.items():
        for x in range(a, b + 1):
            # 右側と下側を斜めに影へ
            # 影の境界は斜め（下へ行くほど左へ広がる）。左右で割らない
            edge = b - 1 - max(0, y - 22) // 2
            ch = "d" if x >= edge else "s"
            g[y][x] = ch
        # 左頬に明るい面
    for y in range(22, 30):
        put(g, FACE[y][0] + 1, y, "S")
    # 耳
    stamp(g, 12, 21, ["ss", "sd", "sd", "ss"])
    stamp(g, 34, 21, ["dd", "dd", "dd", "dd"])
    # つばの影（額）
    hline(g, 13, 14, 33, "d")
    hline(g, 14, 14, 33, "d")


def hair(g):
    # 帽子の下からのぞく短い髪（横だけ）
    for y in range(13, 18):
        put(g, 13, y, "h")
        put(g, 14, y, "h")
        put(g, 33, y, "h")
        put(g, 34, y, "2")
    for y in range(13, 17):
        put(g, 15, y, "h")
        put(g, 32, y, "2")
    # 前髪の小さな房（つばの下）
    stamp(g, 16, 13, ["hhhhhh", "hh hh "])
    stamp(g, 26, 13, ["hhhhh2", " hh 2"])


def hat(g):
    # サファリハット。頂は丸く、つばは横に大きく張り出す
    crown = {
        1: (19, 28), 2: (17, 30), 3: (16, 31), 4: (15, 32),
        5: (15, 32), 6: (14, 33), 7: (14, 33), 8: (14, 33), 9: (14, 33),
    }
    for y, (a, b) in crown.items():
        for x in range(a, b + 1):
            if x - a < 4 - (y - 1) // 3 or (y <= 2 and x < 24):
                ch = "7"
            elif x > b - 3:
                ch = "5"
            else:
                ch = "6"
            g[y][x] = ch
    # 頂のへこみ（内側の線）
    for x in range(21, 27):
        put(g, x, 2, "5")
    # 帽子のバンド
    hline(g, 8, 14, 33, "G")
    hline(g, 9, 14, 33, "g")
    put(g, 14, 8, "q")
    put(g, 15, 8, "q")
    # 肉球マーク
    stamp(g, 21, 3, [".g.g.", "g...g", ".ggg.", ".ggg."])
    for y in range(3, 7):
        for x in range(21, 26):
            if g[y][x] == ".":
                g[y][x] = "6"
    # つば
    brim = {10: (8, 39), 11: (6, 41), 12: (7, 40)}
    for y, (a, b) in brim.items():
        for x in range(a, b + 1):
            if y == 10:
                ch = "7" if x < 20 else ("6" if x < 34 else "5")
            elif y == 11:
                ch = "6" if x < 18 else "5"
            else:
                ch = "5"
            g[y][x] = ch
    hline(g, 10, 14, 33, "6")  # 頭の前の部分は一段暗い（頭の付け根）
    hline(g, 10, 14, 19, "7")


# ---------------------------------------------------------------- 顔の部品

def eyes(g):
    # 目は3行（まぶた1段＋虹彩2行）。左右とも光は左上
    stamp(g, 17, 22, ["KKKKK", " WeEW", " WEXW"])
    stamp(g, 26, 22, ["KKKKK", "WeEW ", "WEXW "])


def brows_neutral(g):
    stamp(g, 17, 18, ["hhhhh", " 2222"])
    stamp(g, 26, 18, ["hhhhh", "2222 "])


def nose(g):
    put(g, 24, 26, "d")
    put(g, 24, 27, "d")


def cheeks(g):
    stamp(g, 16, 27, ["BB"])
    stamp(g, 30, 27, ["BB"])


def mouth_ask(g):
    # 口角の上がった小さな笑み（閉じ気味に少し開ける）
    stamp(g, 20, 29, ["M      M", " MMMMMM "])


def base():
    g = blank()
    body(g)
    collar(g)
    face(g)
    hair(g)
    hat(g)
    eyes(g)
    brows_neutral(g)
    nose(g)
    cheeks(g)
    mouth_ask(g)
    pocket_and_chick(g)
    badge(g)
    return g


def finish(g):
    outline(g)
    return g


# ---------------------------------------------------------------- 差分

def clear_mouth(g):
    for y in range(28, 33):
        for x in range(19, 30):
            if g[y][x] in "Mm":
                g[y][x] = "s"


def correct(g):
    clear_mouth(g)
    # 大きく開けた笑顔
    stamp(g, 19, 28, ["d        d", " MMMMMMMM ", " MCCCCCCM ", "  MmmmmM  ", "   MMMM   "])
    # 眉を少し上げる
    for x in range(17, 31):
        for y in (18, 19):
            if g[y][x] in "h2":
                g[y][x] = "s"
    stamp(g, 17, 17, [" hhhh", "hh222"])
    stamp(g, 26, 17, ["hhhh ", "222hh"])
    # きらめき（十字）
    stamp(g, 39, 14, ["  Y  ", "  Y  ", "YYyYY", "  Y  ", "  Y  "])
    stamp(g, 4, 20, [" Y ", "YyY", " Y "])


def wrong(g):
    clear_mouth(g)
    # 口角の下がった「あー」の口
    stamp(g, 20, 29, ["  MMMM  ", " MmmmmM ", " M    M "])
    # 眉を困り眉に（内側を上げる）
    for x in range(17, 31):
        for y in (18, 19):
            if g[y][x] in "h2":
                g[y][x] = "s"
    stamp(g, 17, 18, ["   hh", "hhh22", "22   "])
    stamp(g, 26, 18, ["hh   ", "22hhh", "   22"])
    # 汗（上1・下2×2の塊）
    stamp(g, 36, 14, [" b ", " bb", "bbb", "bbb", " b "])


def write(name: str, g, note: str):
    lines = [f"# {note}"] + ["".join(r) for r in g]
    (HERE / name).write_text("\n".join(lines) + "\n", encoding="utf-8")


def main():
    write("zookeeper.txt", finish(base()), "動物園の飼育員 出題（素体）。zookeeper_gen.py で生成")
    g = base(); correct(g)
    write("zookeeper_correct.txt", finish(g), "動物園の飼育員 正解。素体からの差分")
    g = base(); wrong(g)
    write("zookeeper_wrong.txt", finish(g), "動物園の飼育員 不正解。素体からの差分")


if __name__ == "__main__":
    main()
