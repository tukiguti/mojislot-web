#!/usr/bin/env python3
"""寿司屋の大将（48×56）の素体と表情差分を書き出す。

    python3 tools/pixel/v2/sushi_taisho_gen.py

素体（出題）を組み立て、正解・不正解は素体のコピーに口・眉・顔の外の記号だけを
上書きして作る。素体を複製して手で直すと顔の作りがずれるため（PIXEL_SPEC）。
座標は x=桁（0〜47）、y=行（0〜55）。中心は x=23 と 24 の間。光は左上。
"""

from __future__ import annotations

import copy
import pathlib

W, H = 48, 56
OUT = pathlib.Path(__file__).resolve().parent


def blank() -> list[list[str]]:
    return [["."] * W for _ in range(H)]


def put(g, x, y, ch):
    if 0 <= x < W and 0 <= y < H:
        g[y][x] = ch


def stamp(g, x0, y0, rows: list[str]):
    """rows の ' ' は触らない。'_' は透過に戻す。"""
    for dy, row in enumerate(rows):
        for dx, ch in enumerate(row):
            if ch == " ":
                continue
            put(g, x0 + dx, y0 + dy, "." if ch == "_" else ch)


def span(g, y, x0, x1, ch):
    for x in range(x0, x1 + 1):
        put(g, x, y, ch)


def mspan(g, y, left, ch):
    """中心で左右対称に left..47-left を塗る。"""
    span(g, y, left, W - 1 - left, ch)


def recolor(g, x0, y0, x1, y1, frm: str, to: str):
    """矩形の中で、今 frm のどれかである画素だけを to にする（塗りの条件は今の色で切る）。"""
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            if g[y][x] in frm:
                g[y][x] = to


# ---------------------------------------------------------------- 形（シルエット）

HEAD = {
    1: 16, 2: 15, 3: 14, 4: 14,
    **{y: 13 for y in range(5, 23)},
    23: 14, 24: 14, 25: 15, 26: 16, 27: 18,
}


def silhouette(g):
    # 首
    for y in range(27, 35):
        span(g, y, 19, 28, "s")
    # 肩〜胴。大人の肩幅で横へ広げる
    sh = {32: 16, 33: 11, 34: 8, 35: 6, 36: 4, 37: 3, 38: 2}
    for y in range(32, H):
        mspan(g, y, sh.get(y, 1), "C")
    # 頭
    for y, l in HEAD.items():
        mspan(g, y, l, "s")
    # 耳
    for y in range(14, 21):
        put(g, 12, y, "s")
        put(g, 35, y, "s")
    for y in range(15, 20):
        put(g, 11, y, "s")
        put(g, 36, y, "s")
        put(g, 10, y, "s")
        put(g, 37, y, "s")
    # 鉢巻の結び目と垂れ（見る側の右）
    stamp(g, 33, 3, [
        "     CC ",
        "    CCCC",
        "   CCCC ",
        "  CCCCC ",
        " CCCCC  ",
        " CCCCC  ",
        " CCCCCC ",
        "  CCCCCC",
        "    CCCC",
        "     CCC",
    ])


def outline(g):
    """外周（透過に接する塗り）を K にする。画面の下端は切れているだけなので除く。"""
    src = [row[:] for row in g]
    for y in range(H):
        for x in range(W):
            if src[y][x] == ".":
                continue
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nx, ny = x + dx, y + dy
                if ny >= H:
                    continue
                if not (0 <= nx < W) or ny < 0 or src[ny][nx] == ".":
                    g[y][x] = "K"
                    break


# ---------------------------------------------------------------- 部位

def hair(g):
    """角刈り。平らな頭頂、白髪まじりのごま塩頭で年齢を出す。"""
    for y in range(1, 8):
        mspan(g, y, HEAD[y], "H")
    # 光（左上）と影（右）。l の点が白髪
    stamp(g, 15, 2, [
        " lLlLlLHlLHLL",
        "LlLHlLHLHlHL",
        "LHlHLHHlH",
        "HLHH",
    ])
    for y in range(2, 7):
        span(g, y, 29, 34, "h")
    stamp(g, 29, 2, ["L H ", " H  ", "H   "])
    span(g, 6, 14, 33, "h")   # 鉢巻の上の影


def headband(g):
    """ねじり鉢巻。白と藍の斜め縞でねじりを見せる。"""
    for y in range(7, 11):
        mspan(g, y, 12 if y in (8, 9) else 13, "C")
    for y in range(7, 11):
        for x in range(12, 36):
            if g[y][x] == "C":
                if (x + y) % 4 == 0:
                    g[y][x] = "3"
                elif (x + y) % 4 == 1:
                    g[y][x] = "n"
    # 結び目
    for y in range(3, 13):
        for x in range(33, 42):
            if g[y][x] == "C":
                k = (x - y) % 4
                g[y][x] = {0: "3", 1: "n"}.get(k, "C")
    stamp(g, 34, 7, [
        "k  ",
        "kn ",
        "kn ",
        "k  ",
    ])


def face(g):
    # 鉢巻の落とす影
    span(g, 11, 14, 33, "d")
    # もみあげ（短い・白髪まじり）
    stamp(g, 13, 11, ["ll", "lL", "ll", "lL", "l"])
    stamp(g, 33, 11, ["L", "L", "H", "L", "H"])
    # 額と頬の光
    span(g, 12, 16, 22, "S")
    stamp(g, 15, 18, ["SS", "SS", "S"])
    # 右の影（斜めの境界）
    for y in range(12, 27):
        x0 = 31 - max(0, (y - 18) // 2)
        for x in range(x0, 35):
            if g[y][x] == "s":
                g[y][x] = "d"
    # 耳の中
    stamp(g, 11, 15, ["S ", "sd", "sd", "sd", "s "])
    stamp(g, 35, 15, [" d", "ds", "ds", "ds", " d"])

    # 眉（2行・太い。内側が低い＝きりっと）
    stamp(g, 15, 12, ["22222  ", "2222222"])
    stamp(g, 26, 12, ["  22222", "2222222"])
    # 目（3行＝まつ毛1段＋虹彩2行）。虹彩は暗く小さく、目尻に小じわ
    stamp(g, 14, 15, [" KKKKK ", "dKWDDWk", "  kDDk "])
    stamp(g, 27, 15, [" KKKKK ", "kWDDWKd", " kDDk  "])
    # 鼻
    stamp(g, 25, 18, ["d", "d"])
    stamp(g, 22, 20, ["d  d", " dd "])
    # ほうれい線
    stamp(g, 29, 21, ["d ", " d", " d"])
    # あご（四角く、下に影）
    span(g, 26, 21, 26, "d")
    span(g, 27, 19, 28, "d")
    span(g, 28, 19, 28, "d")


def mouth_ask(g):
    """出題：口角を片方だけ上げた、にやりとした口。"""
    stamp(g, 20, 23, ["       M", " MMMMMM ", "   dd   "])


def neck_and_coat(g):
    # 首の影
    for y in range(29, 34):
        span(g, y, 25, 28, "d")
    # 白衣の陰影（右ほど暗く）
    for y in range(32, H):
        for x in range(W):
            if g[y][x] == "C":
                if x >= 40 - (y - 32) // 6:
                    g[y][x] = "n"
                elif x >= 30:
                    g[y][x] = "c"
    # 襟（右前＝見る側の右の身頃が上）。上の身頃の縁は首の右から左下へ
    for y in range(32, 47):
        t = y - 32
        xe = 28 - (t * 6) // 10          # 上の身頃の縁
        put(g, xe, y, "k")
        put(g, xe + 1, y, "c")
        put(g, xe + 2, y, "c")
        # 縁の左は下の身頃。そこに影を落とす
        if g[y][xe - 1] in "Cc":
            put(g, xe - 1, y, "n")
    # 下の身頃の縁（首の左から右下へ、上の身頃に潜る）
    for y in range(32, 41):
        t = y - 32
        xu = 19 + (t * 5) // 10
        if g[y][xu] in "sCcd":
            put(g, xu, y, "k")
            put(g, xu - 1, y, "C")
            put(g, xu - 2, y, "C")
    # 胸元の肌（縁と縁の間）
    for y in range(32, 41):
        t = y - 32
        xu = 19 + (t * 5) // 10
        xe = 28 - (t * 6) // 10
        for x in range(xu + 1, xe):
            g[y][x] = "d" if x >= xe - 2 or y <= 33 else "s"
    # 腕と胴の境（袖の付け根）
    for y in range(40, H):
        put(g, 9, y, "n")
        put(g, 38, y, "k")


def hand_with_nigiri(g):
    """見る側の左の手で、胸の前に握り（まぐろ）を一貫。寿司屋だと一目で分かる記号。"""
    # 袖（左下から胸の前へ）
    stamp(g, 2, 46, [
        "      kkkkkk",
        "    kkCCCCCck",
        "  kkCCCCCCcck",
        " kCCCCCCCcck ",
        "kCCCCCCCccnk ",
        "CCCCCCCccnk  ",
        "CCCCCCccnk   ",
        "CCCCCccnnk   ",
        "CCCCccnnk    ",
        "CCCccnnk     ",
    ])
    # 手と握り（赤身。白い筋を斜めに入れ、しゃりは横長）
    stamp(g, 4, 38, [
        "  KKKKKKKKKK  ",
        " KRRpRrrpRrrK ",
        "KRRrpRrrrprrrK",
        "KCC7CC7CC777nK",
        " K7777777nnnK ",
        "ksSsSssssdddk ",
        "ksdsdsdsdddk  ",
        " ksssssdddk   ",
        "  kkdddkkk    ",
    ])


def base() -> list[list[str]]:
    g = blank()
    silhouette(g)
    hair(g)
    headband(g)
    face(g)
    mouth_ask(g)
    neck_and_coat(g)
    hand_with_nigiri(g)
    outline(g)
    return g


def save(g, name: str, note: str):
    path = OUT / f"{name}.txt"
    lines = [f"# 寿司屋の大将 {note}（tools/pixel/v2/sushi_taisho_gen.py が書き出す）"]
    lines += ["".join(r) for r in g]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


# ---------------------------------------------------------------- 表情差分

def restore(g, b, x0, y0, x1, y1):
    """素体から口まわりを消す前の、口の無い肌に戻す（素体の肌色で埋める）。"""
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            if g[y][x] in "Mmd W":
                g[y][x] = "d" if x >= 30 - max(0, (y - 18) // 2) else "s"


def sparkle(g, x, y, big=True):
    """十字のきらめき。中心を明るく四方に金。"""
    put(g, x, y, "y")
    r = 2 if big else 1
    for i in range(1, r + 1):
        for dx, dy in ((i, 0), (-i, 0), (0, i), (0, -i)):
            put(g, x + dx, y + dy, "Y")


def correct(b):
    g = copy.deepcopy(b)
    # 口：大きく開けて笑う（歯と舌）
    restore(g, b, 19, 22, 28, 26)
    stamp(g, 19, 22, [
        " MMMMMMMM ",
        " MWWWWWWM ",
        "  MmmmmM  ",
        "   MMMM   ",
    ])
    # 眉：内側を上げてほどく（きりっとした内下がりをやめる）
    recolor(g, 14, 12, 34, 13, "2", "s")
    stamp(g, 15, 12, [" 222222", "222222 "])
    stamp(g, 26, 12, ["222222 ", " 222222"])
    # 顔の外の記号：きらめき
    sparkle(g, 5, 15)
    sparkle(g, 42, 19, big=False)
    sparkle(g, 8, 26, big=False)
    return g


def wrong(b):
    g = copy.deepcopy(b)
    # 口：への字。口角の間の影は消す（垂れて見えるので）
    restore(g, b, 19, 22, 28, 26)
    stamp(g, 20, 23, [
        "  MMMM  ",
        " M    M ",
        "M      M",
    ])
    # 眉：困り眉（内側を上げる）
    recolor(g, 14, 12, 34, 13, "2", "s")
    stamp(g, 15, 12, ["   2222", "22222  "])
    stamp(g, 26, 12, ["2222   ", "  22222"])
    # 顔の外の記号：汗（塗り詰めた塊。上1・下2×2）
    stamp(g, 6, 14, [
        " K  ",
        "KbK ",
        "KWbK",
        "KbbK",
        " KK ",
    ])
    return g


if __name__ == "__main__":
    b = base()
    save(b, "sushi_taisho", "出題")
    save(correct(b), "sushi_taisho_correct", "正解")
    save(wrong(b), "sushi_taisho_wrong", "不正解")
