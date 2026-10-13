"""八百屋の店主（48×56）を素体から組み立て、表情差分を作って3枚のマップに書き出す。

    python3 tools/pixel/build_greengrocer.py

素体（出題）を部位ごとに塗ってから外周の輪郭と陰影を足し、正解・不正解は
素体のコピーに「顔の外の記号・口・眉」だけを上書きして作る（PIXEL_SPEC の表情差）。
"""
from __future__ import annotations

import pathlib

W, H = 48, 56
HERE = pathlib.Path(__file__).resolve().parent

Grid = list[list[str]]


def blank() -> Grid:
    return [['.'] * W for _ in range(H)]


def span(g: Grid, y: int, x0: int, x1: int, c: str) -> None:
    for x in range(max(0, x0), min(W - 1, x1) + 1):
        g[y][x] = c


def put(g: Grid, pts: str, c: str, ox: int = 0, oy: int = 0) -> None:
    """文字絵（'#' の位置に c を置く）を (ox, oy) から貼る。"""
    for dy, row in enumerate(pts.strip('\n').split('\n')):
        for dx, ch in enumerate(row):
            if ch == '#':
                g[oy + dy][ox + dx] = c


def stamp(g: Grid, art: str, ox: int, oy: int) -> None:
    """文字絵をそのまま（'.' 以外の文字を）貼る。' ' は触らない。"""
    for dy, row in enumerate(art.strip('\n').split('\n')):
        for dx, ch in enumerate(row):
            if ch not in ' ':
                g[oy + dy][ox + dx] = ch


# ---- 輪郭 ---------------------------------------------------------------
HEAD = {  # 行: (左, 右) 頭（髪＋顔）の外形。角ばったあご＝中年の男
    2: (18, 29), 3: (16, 31), 4: (14, 33), 5: (13, 34), 6: (12, 35), 7: (12, 35),
    **{y: (12, 35) for y in range(8, 25)},
    25: (13, 34), 26: (13, 34), 27: (14, 33), 28: (15, 32), 29: (16, 31), 30: (18, 29),
}
BODY = {  # 首と胴（シャツ）。肩幅を広く取って大人に見せる
    31: (18, 29), 32: (18, 29), 33: (17, 30),
    34: (14, 33), 35: (10, 37), 36: (7, 40), 37: (5, 42), 38: (4, 43), 39: (3, 44),
    **{y: (2, 45) for y in range(40, 56)},
}


def base() -> Grid:
    g = blank()
    # 胴：白いTシャツ
    for y, (a, b) in BODY.items():
        span(g, y, a, b, 'c')
    # 袖をまくった腕：袖口の折り返しと、脇の内側の線
    for y in range(44, 56):
        g[y][10] = 'k'
        g[y][37] = 'k'
    span(g, 45, 2, 9, 'C')
    span(g, 46, 2, 9, 'n')
    span(g, 45, 38, 45, 'C')
    span(g, 46, 38, 45, 'n')
    for y in range(47, 56):
        span(g, y, 2, 9, 's')
        span(g, y, 38, 45, 's')
    # 首（肌）
    for y in range(30, 35):
        span(g, y, 19, 28, 's')
    # 頭：髪と顔
    for y, (a, b) in HEAD.items():
        span(g, y, a, b, 's')
    for y in range(2, 8):  # 短く刈った髪（鉢巻の上）
        a, b = HEAD[y]
        span(g, y, a, b, 'h')
    # 耳
    for y in range(14, 21):
        g[y][10] = g[y][11] = 's'
        g[y][36] = g[y][37] = 's'
    g[14][10] = g[20][10] = g[14][37] = g[20][37] = '.'
    # もみあげ（短い）
    for y in range(10, 16):
        g[y][12] = 'h'
        g[y][35] = 'h'
    g[10][13] = g[11][13] = 'h'
    g[10][34] = g[11][34] = 'h'

    # ねじり鉢巻（手ぬぐい）：斜めの縞でねじりを見せる
    for y in range(7, 11):
        for x in range(11, 37):
            t = (x - y) % 4
            g[y][x] = '7' if t in (0, 1) else ('6' if t == 2 else '5')
    # 結び目と、右上へ跳ねる端
    stamp(g, """
 ...77..
 .7767.
 7766556
 776555.
 .6655..
""".replace('.', ' '), 33, 6)
    stamp(g, """
   77
  776
 7765
 765
""", 37, 2)
    stamp(g, """
 7
 76
 765
""", 40, 8)

    # Tシャツの襟ぐり
    span(g, 33, 18, 29, 'n')
    # 前掛け（緑のエプロン）：首から下がる紐と胸当て
    for y in range(33, 41):
        k = y - 33
        g[y][17 - k // 3] = 'g'
        g[y][18 - k // 3] = 'G'
        g[y][29 + k // 3] = 'G'
        g[y][30 + k // 3] = 'g'
    for y in range(40, 56):
        span(g, y, 13, 34, 'G')
    # 胸当ての屋号「八」
    stamp(g, """
...C.C...
...C.C...
...C..C..
..C...C..
..C....C.
.C.....C.
C.......C
""".replace('.', ' '), 19, 42)
    # ポケット
    span(g, 51, 15, 32, 'g')
    for y in range(52, 56):
        g[y][15] = 'g'
        g[y][32] = 'g'
        g[y][24] = 'g'
    return g


def face(g: Grid) -> None:
    brows(g, 'ask')
    # 目：3行（まつ毛1段＋虹彩2行）＝男の目
    stamp(g, """
kkkkk
WWDDW
..DD.
""".replace('.', ' '), 16, 16)
    stamp(g, """
kkkkk
WDDWW
.DD..
""".replace('.', ' '), 27, 16)
    # 鼻：右側に影
    g[19][24] = 'd'
    g[20][24] = 'd'
    g[21][23] = 'd'
    g[21][24] = 'd'
    # 目尻のしわ（年齢）
    g[17][14] = 'd'
    g[18][15] = 'd'
    g[17][33] = 'd'
    g[18][32] = 'd'
    # 口ひげ：鼻の下に短く。ほうれい線の代わりに年齢を決める
    put(g, """
.#######.
##.....##
""", 'h', 20, 22)
    # もみあげの白髪
    for y in (13, 14, 15):
        g[y][12] = 'L'
        g[y][35] = 'L'
    # 赤ら顔のほお（威勢のよさ）
    g[20][16] = g[20][17] = 'B'
    g[20][31] = g[20][32] = 'B'
    mouth(g, 'ask')


MOUTHS = {
    # 出題：歯を見せてニッと笑う（口角は左右とも上）
    'ask': """
#........#
.MCCCCCCM.
..MMMMMM..
""",
    # 正解：大きく開けて笑う（舌が見える）
    'correct': """
M..........M
.MCCCCCCCCM.
.MMMMMMMMMM.
..MMmmmmMM..
...MMMMMM...
""",
    # 不正解：への字にゆがめる
    # 不正解：歯を食いしばって口角を下げる（「ありゃ」の苦笑い）
    'wrong': """
..MMMMMM..
.MCCCCCCM.
M........M
""",
}


BROWS = {  # 左眉（右眉は左右反転）。行12〜14・8列
    # 出題：目頭を下げて外へはね上げる（「当ててみな！」の挑む顔）
    'ask': """
###.....
#######.
...#####
""",
    # 正解：水平に持ち上げて開く
    'correct': """
.######.
########
........
""",
    # 不正解：目頭を上げて八の字（困り顔）
    'wrong': """
.....###
.#######
#####...
""",
}


def brows(g: Grid, kind: str) -> None:
    rows = BROWS[kind].strip('\n').split('\n')
    for dy, row in enumerate(rows):
        for dx, ch in enumerate(row):
            y = 12 + dy
            g[y][14 + dx] = 'h' if ch == '#' else 's'
            g[y][33 - dx] = 'h' if ch == '#' else 's'


SPARKLE = """
..Y..
..Y..
YYyYY
..Y..
..Y..
"""
SMALL_SPARKLE = """
.Y.
YyY
.Y.
"""
SWEAT = """
..b.
.bbb
bWbb
bbbb
.bb.
"""


def expression(g: Grid, kind: str) -> None:
    """素体の顔に、眉・口・顔の外の記号だけを上書きする。"""
    brows(g, kind)
    mouth(g, kind)
    if kind == 'correct':
        stamp(g, SPARKLE.replace('.', ' '), 3, 4)
        stamp(g, SMALL_SPARKLE.replace('.', ' '), 6, 13)
        stamp(g, SPARKLE.replace('.', ' '), 41, 14)
    elif kind == 'wrong':
        stamp(g, SWEAT.replace('.', ' '), 5, 10)


def mouth(g: Grid, kind: str) -> None:
    # 口の範囲をいったん肌に戻す
    for y in range(24, 30):
        for x in range(18, 31):
            if g[y][x] in 'MmC':
                g[y][x] = 's'
    art = MOUTHS[kind]
    rows = art.strip('\n').split('\n')
    w = len(rows[0])
    ox = 24 - w // 2
    for dy, row in enumerate(rows):
        for dx, ch in enumerate(row):
            if ch == '#':
                g[25 + dy][ox + dx] = 'M'
            elif ch != '.':
                g[25 + dy][ox + dx] = ch


def shade(g: Grid) -> None:
    """左上光源。斜めの境界で右下を暗く、左上を明るく（色ごとに条件を切る）。"""
    for y in range(H):
        for x in range(W):
            c = g[y][x]
            t = x + y  # 斜めの位置
            if c == 's':
                if t >= 60 or (y >= 30 and y <= 33):
                    g[y][x] = 'd'
                elif t <= 30:
                    g[y][x] = 'S'
            elif c == 'h':
                if t <= 22:
                    g[y][x] = 'H'
                elif t >= 40:
                    g[y][x] = '2'
            elif c == 'c':
                if t >= 72:
                    g[y][x] = 'n'
                elif t <= 46:
                    g[y][x] = 'C'
            elif c == 'G':
                if t >= 74:
                    g[y][x] = 'g'
                elif t <= 56:
                    g[y][x] = 'q'
    # 鉢巻の下にできる影
    for x in range(12, 36):
        if g[11][x] in 'sS':
            g[11][x] = 'd'


def outline(g: Grid) -> None:
    """透過に接する画素の外側に暗い外周線を置く。"""
    marks = []
    for y in range(H):
        for x in range(W):
            if g[y][x] != '.':
                continue
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nx, ny = x + dx, y + dy
                if 0 <= nx < W and 0 <= ny < H and g[ny][nx] not in '.K':
                    marks.append((x, y))
                    break
    for x, y in marks:
        g[y][x] = 'K'


def write(g: Grid, name: str, note: str) -> None:
    lines = [f'# 八百屋の店主（章 yasai）{note}。build_greengrocer.py が生成']
    lines += [''.join(r) for r in g]
    (HERE / f'{name}.txt').write_text('\n'.join(lines) + '\n', encoding='utf-8')


def main() -> None:
    body = base()
    face(body)
    for kind, name, note in (
        ('ask', 'greengrocer', '出題'),
        ('correct', 'greengrocer_correct', '正解'),
        ('wrong', 'greengrocer_wrong', '不正解'),
    ):
        g = [r[:] for r in body]
        expression(g, kind)
        shade(g)
        outline(g)
        write(g, name, note)


if __name__ == '__main__':
    main()
