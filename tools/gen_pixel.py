#!/usr/bin/env python3
"""コトハ（クイズの出題者）のドット絵を生成する。

**48×56 で描いて、表示は3倍のニアレストネイバー**（=144×168）。液晶内に置く実寸に合う。
ドット絵にしたのは、この解像度なら1ピクセルずつ意図して置けるから。ベクターで
なめらかな曲線を当てずっぽうで書くより、粗い格子に収めるほうが形が決まる
（レトロパチスロ風という 14章 の当初方向とも一致する）。

構成は SVG 版と同じ **base → outfit → face** の3層。同じ48×56に描くので重ねれば合う。

    python3 tools/gen_pixel.py            # public/art/kotoha/ へ PNG を書き出す
    python3 tools/gen_pixel.py --scale 6  # 確認用に6倍で書き出す

パレットは文字1つ＝1色。マップを文字列で持つと diff が読めるし、
1ドットだけ直したい時に座標を数えずに済む。
"""

from __future__ import annotations

import argparse
import pathlib

from PIL import Image

W, H = 48, 56
OUT = pathlib.Path(__file__).resolve().parent.parent / "public" / "art" / "kotoha"

# 文字 → RGBA。'.' は透過。
#
# **ランプ（暗→明の段）を素材ごとに作り、色相をずらす。** 明度だけ下げると色が濁る
# ので、暗い側は青〜赤へ、明るい側は黄へ寄せる。肌の影は赤味を足すと血色が残る。
# 光源は**左上ひとつ**に固定（外周を一律に暗くする「ピロー塗り」はしない）。
PALETTE: dict[str, tuple[int, int, int, int]] = {
    ".": (0, 0, 0, 0),
    # 輪郭。K=外周、k=内側の色トレス。**地色より暗く**しないと黒髪で形が消える
    "K": (0x14, 0x12, 0x1C, 255),
    "k": (0x3A, 0x35, 0x50, 255),
    # 髪 2 → h → H → L → l。**黒髪**。真っ黒だと液晶の地色（暗い紫）に溶けるので、
    # 青寄りのダークグレーにして色相を背景から離し、天使の輪を強く当てて形を出す
    "2": (0x1E, 0x24, 0x2F, 255),
    "h": (0x2A, 0x32, 0x43, 255),
    "H": (0x3B, 0x45, 0x5E, 255),
    "L": (0x51, 0x5D, 0x7C, 255),
    "l": (0x9A, 0xA6, 0xCC, 255),
    # 肌 d → s → S（影ほど赤い）
    "d": (0xD9, 0x9A, 0x86, 255),
    "s": (0xF4, 0xBF, 0xA6, 255),
    "S": (0xFF, 0xE3, 0xCE, 255),
    # 目
    "W": (0xFF, 0xFF, 0xFF, 255),
    "e": (0x7F, 0xC4, 0xF2, 255),
    "E": (0x3D, 0x86, 0xCF, 255),
    "D": (0x16, 0x23, 0x3F, 255),
    # 口
    "M": (0x93, 0x34, 0x3F, 255),
    "m": (0xFF, 0x8E, 0x9C, 255),
    # 服 n → c → C（影は青紫へ）
    "n": (0xC9, 0xC4, 0xD2, 255),
    "c": (0xE4, 0xE0, 0xE6, 255),
    "C": (0xF9, 0xF7, 0xF2, 255),
    # リボン
    "r": (0xA8, 0x2E, 0x45, 255),
    "R": (0xE0, 0x50, 0x68, 255),
    "p": (0xFF, 0x8A, 0x9C, 255),
    # 差し色
    "B": (0xFF, 0x9A, 0x9A, 255),
    "b": (0x8E, 0xC9, 0xF0, 255),
    "Y": (0xFF, 0xD4, 0x5E, 255),
    "y": (0xFF, 0xEF, 0xAD, 255),
}


def parse(rows: list[str]) -> list[list[str]]:
    """文字列マップを検証しつつ2次元配列へ。桁ずれは黙って通すと形が崩れるので落とす。"""
    if len(rows) != H:
        raise ValueError(f"行数が {len(rows)}（{H} 行必要）")
    for y, r in enumerate(rows):
        if len(r) != W:
            raise ValueError(f"{y} 行目が {len(r)} 桁（{W} 桁必要）")
        for ch in r:
            if ch not in PALETTE:
                raise ValueError(f"{y} 行目に未定義の色 '{ch}'")
    return [list(r) for r in rows]


def compose(*layers: list[list[str]]) -> list[list[str]]:
    """後ろのレイヤーで上書き。'.' は透過なので下が残る。"""
    out = [row[:] for row in layers[0]]
    for layer in layers[1:]:
        for y in range(H):
            for x in range(W):
                if layer[y][x] != ".":
                    out[y][x] = layer[y][x]
    return out


def shade(grid: list[list[str]]) -> list[list[str]]:
    """光源（左上）に合わせて影を落とす。**材質ごとに形へ沿わせる**。

    最初は「左上からの距離」1本で落としたら、顔と服を**斜め一直線**の継ぎ目が
    横切って、面ではなく照明のグラデーションに見えた。影は形に付くものなので、
    髪は右側、肌は前髪の下とあご下、服は右の回り込み、と部位ごとに置く。

    手で1ドットずつ置くとムラが出るので規則で落とし、例外だけマップ側で直す。
    """
    out = [row[:] for row in grid]
    for y in range(H):
        for x in range(W):
            ch = grid[y][x]
            if ch == "H":
                if x >= 36:
                    out[y][x] = "2"          # 右端の回り込み
                elif x >= 30:
                    out[y][x] = "h"          # 右側
                elif y <= 12 and x <= 19:
                    out[y][x] = "L"          # 左上の艶
            elif ch == "S":
                if y <= 19:
                    out[y][x] = "s"          # 前髪の落ち影
                elif x >= 29:
                    out[y][x] = "s"          # 右の回り込み
                elif y >= 35:
                    out[y][x] = "s"          # あご下
            elif ch == "C":
                if x >= 37:
                    out[y][x] = "n"
                elif x >= 31 or x <= 11:
                    out[y][x] = "c"          # 右の回り込みと左の折り返し
            elif ch == "R":
                if y >= 13:
                    out[y][x] = "r"
    return out


def selout(grid: list[list[str]]) -> list[list[str]]:
    """**内側の境界線**だけを明るい線へ差し替える（色トレス）。

    最初はシルエットの縁を明るくしたら、暗い液晶の上で輪郭が溶けて形が消えた。
    色トレスは内部の線に効くもので、外周は暗いまま残す。影側（右）の内部線も
    暗いままにしないと、暗部でコントラストが失われる。
    """
    out = [row[:] for row in grid]
    for y in range(1, H - 1):
        for x in range(1, W - 1):
            if grid[y][x] != "K":
                continue
            if "." in (grid[y - 1][x], grid[y + 1][x], grid[y][x - 1], grid[y][x + 1]):
                continue          # シルエットの縁
            if x >= 30:
                continue          # 影側は暗いまま
            out[y][x] = "k"
    return out


def to_png(grid: list[list[str]], path: pathlib.Path, scale: int,
           override: dict | None = None) -> None:
    pal = {**PALETTE, **(override or {})}
    img = Image.new("RGBA", (W, H))
    img.putdata([pal[grid[y][x]] for y in range(H) for x in range(W)])
    if scale != 1:
        img = img.resize((W * scale, H * scale), Image.NEAREST)
    img.save(path)


# ──────────────────────────────────────────────────────────────────────────
# 素体。髪・顔・首・胴。顔のパーツ（目・口）は face 側に置く。
#
# 形の決めごと:
#   - 頭は縦長のタマゴ。真円にすると絵文字になる
#   - 前髪は毛先を下向きに、谷は1〜2ドットだけ。深く切ると「牙」に見える
#   - もみあげは顔の外側に沿わせる。太いと動物の耳になる
#   - 天使の輪は途切れさせる。1本の帯にすると硬い
# ──────────────────────────────────────────────────────────────────────────
BASE = parse([
    "................................................",  # 0
    ".................KKKKKKKKKKKKKK.................",  # 1
    "...............KKHHHHHHHHHHHHHHKK...............",  # 2
    ".............KKHHHHHHHHHHHHHHHHHHKK.............",  # 3
    "............KHHHHHHHHHHHHHHHHHHHHHHK............",  # 4
    "...........KHHHHHHHHHHHHHHHHHHHHHHHHK...........",  # 5
    "..........KHHHHHlllllllHHHHHHHHHHHHHHK..........",  # 6
    ".........KHHHHHHlllllllllHHHHHHHHHHHHHK.........",  # 7
    ".........KHHHHHHHllllllHHHHHHHHHHHHHHHK.........",  # 8
    ".........KHHHHHHHHHHHHHHHHHHHHHHHHHHHHK.........",  # 9
    ".........KHHHHHHHHHHHHHHHHHHHHHHHHHHHHK.........",  # 10
    "......KK...KK.HHHHHHHHHHHHHHHHHHHHHHHHK.........",  # 11
    ".....KRRK.KRRKHHHHHHHHHHHHHHHHHHHHHHHHK.........",  # 12
    ".....KRRRKRRRKHHHHHHHHHHHHHHHHHHHHHHHHK.........",  # 13
    ".....KRRRpRRRKHHHHHHHHHHHHHHHHHHHHHHHHK.........",  # 14
    ".....KRRRKRRRKHHHHHHHHHHHHHHHHHHHHHHHHK.........",  # 15
    "......KRK.KRK.HHHHHHHHHHHHHHHHHHHHHHHHK.........",  # 16
    ".......K...K..HHHHHHHHHHHHHHHHHHHHHHHHK.........",  # 17
    ".........KHHHHHHHHHHHHHHHHHHHHHHHHHHHHK.........",  # 18
    ".........KHHHKSSSSSSSSSHHSSSSSSSSSKHHHK.........",  # 19
    ".........KHhHKSSSSSSSSSSSSSSSSSSSSKH2HK.........",  # 20
    ".........KHhHKSSSSSSSSSSSSSSSSSSSSKH2HK.........",  # 21
    ".........KHhHKSSSSSSSSSSSSSSSSSSSSKH2HK.........",  # 22
    ".........KHhHKSSSSSSSSSSSSSSSSSSSSKH2HK.........",  # 23
    ".........KHhHKSSSSSSSSSSSSSSSSSSSSKH2HK.........",  # 24
    ".........KHhHKSSSSSSSSSSSSSSSSSSSSKH2HK.........",  # 25
    ".........KHhHKSSSSSSSSSSSSSSSSSSSSKH2HK.........",  # 26
    ".........KHhHKSSSSSSSSSSSSSSSSSSSSKH2HK.........",  # 27
    ".........KHhHKSSSSSSSSSSSSSSSSSSSSKH2HK.........",  # 28
    ".........KHhHKSSSSSSSSSSSSSSSSSSSSKH2HK.........",  # 29
    ".........KHhHKSSSSSSSSSSSSSSSSSSSSKH2HK.........",  # 30
    ".........KHhHKSSSSSSSSSSSSSSSSSSSSKH2HK.........",  # 31
    ".........KHhHKSSSSSSSSSSSSSSSSSSSSKH2HK.........",  # 32
    ".........KHhHKKSSSSSSSSSSSSSSSSSSKKH2HK.........",  # 33
    ".........KHhHHKKSSSSSSSSSSSSSSSSKKHH2HK.........",  # 34
    ".........KHhHHHHKKSSSSSSSSSSSSKKHHHH2HK.........",  # 35
    ".........KHhHHHHHHKKSSSSSSSSKKHHHHHH2HK.........",  # 36
    ".........KHhHHHHHHHHKSSSSSSKHHHHHHHH2HK.........",  # 37
    ".........KHhHHHHHHHHKssssssKHHHHHHHH2HK.........",  # 38
    ".........KHhHHHHHHKCCCCCCCCCCKHHHHHH2HK.........",  # 39
    "........KHHhHHHHHKCCCCCCCCCCCCKHHHHH2HHK........",  # 40
    "........KHHhHHHKCCCCCCCCCCCCCCCCKHHH2HHK........",  # 41
    ".......KHHHhHHKccCCCCCCCCCCCCCCCCKHH2HHHK.......",  # 42
    ".......KHHHhHKccCCCCCCCCCCCCCCCCCCKH2HHHK.......",  # 43
    ".......KHHHhHKccCCCCCCCCCCCCCCCCCCKH2HHK........",  # 44
    ".......KHHHhKccCCCCCCCCCCCCCCCCCCCC.KHHK........",  # 45
    ".......KHHHKccCCCCCCCCCCCCCCCCCCCCCC.KK.........",  # 46
    ".......KHHKccCCCCCCCCCCCCCCCCCCCCCCCC.K.........",  # 47
    ".......KKccCCCCCCCCCCCCCCCCCCCCCCCCCCCCKK.......",  # 48
    ".......KccCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCK.......",  # 49
    ".......KccCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCK.......",  # 50
    ".......KccCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCK.......",  # 51
    ".......KccCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCK.......",  # 52
    ".......KccCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCK.......",  # 53
    ".......KccCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCK.......",  # 54
    ".......KKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKK.......",  # 55
])


# ──────────────────────────────────────────────────────────────────────────
# 表情。base の上に重ねる。目・眉・口・ほお＋顔の外の記号。
#
# この解像度では**目の形そのものを変える**しかない（サイズを1ドット変えても読めない）。
#   出題   = 見開き（白目＋虹彩＋瞳）
#   正解   = 閉じ目（^ の弧）
#   不正解 = 半目（まつ毛を1段下ろす）
# ──────────────────────────────────────────────────────────────────────────
ASK = parse([
    "................................................",  # 0
    "................................................",  # 1
    "................................................",  # 2
    "................................................",  # 3
    "................................................",  # 4
    "................................................",  # 5
    "................................................",  # 6
    "................................................",  # 7
    "......................................YYY.......",  # 8
    ".....................................YY.YY......",  # 9
    "........................................YY......",  # 10
    ".......................................YY.......",  # 11
    "......................................YY........",  # 12
    "................................................",  # 13
    "......................................YY........",  # 14
    "................................................",  # 15
    "................................................",  # 16
    "................................................",  # 17
    "................................................",  # 18
    "................................................",  # 19
    "................................................",  # 20
    ".................hhhh......hhhh.................",  # 21
    "................................................",  # 22
    ".................KKKK......KKKK.................",  # 23
    "................KKKKKK....KKKKKK................",  # 24
    "................KWEEEK....KWEEEK................",  # 25
    "................KWEEDK....KWEEDK................",  # 26
    ".................KKKK......KKKK.................",  # 27
    "................................................",  # 28
    "..............BB................BB..............",  # 29
    ".......................KK.......................",  # 30
    "......................KMMK......................",  # 31
    ".......................KK.......................",  # 32
    "................................................",  # 33
    "................................................",  # 34
    "................................................",  # 35
    "................................................",  # 36
    "................................................",  # 37
    "................................................",  # 38
    "................................................",  # 39
    "................................................",  # 40
    "................................................",  # 41
    "................................................",  # 42
    "................................................",  # 43
    "................................................",  # 44
    "................................................",  # 45
    "................................................",  # 46
    "................................................",  # 47
    "................................................",  # 48
    "................................................",  # 49
    "................................................",  # 50
    "................................................",  # 51
    "................................................",  # 52
    "................................................",  # 53
    "................................................",  # 54
    "................................................",  # 55
])

CORRECT = parse([
    "................................................",  # 0
    "................................................",  # 1
    "................................................",  # 2
    "................................................",  # 3
    "................................................",  # 4
    "................................................",  # 5
    "................................................",  # 6
    ".......................................Y........",  # 7
    "......................................YYY.......",  # 8
    ".....................................YyYyY......",  # 9
    "......................................YYY.......",  # 10
    ".......................................Y........",  # 11
    "................................................",  # 12
    "................................................",  # 13
    "....Y...........................................",  # 14
    "...YyY..........................................",  # 15
    "....Y...........................................",  # 16
    "................................................",  # 17
    "................................................",  # 18
    "................................................",  # 19
    "................................................",  # 20
    ".................hhhh......hhhh.................",  # 21
    "................................................",  # 22
    "................................................",  # 23
    "..................KK........KK..................",  # 24
    ".................K..K......K..K.................",  # 25
    "................K....K....K....K................",  # 26
    "................................................",  # 27
    "..............BB................BB..............",  # 28
    "..............BB................BB..............",  # 29
    ".....................KKKKKK.....................",  # 30
    ".....................KMMMMK.....................",  # 31
    "......................KmmK......................",  # 32
    ".......................KK.......................",  # 33
    "................................................",  # 34
    "................................................",  # 35
    "................................................",  # 36
    "................................................",  # 37
    "................................................",  # 38
    "................................................",  # 39
    "................................................",  # 40
    "................................................",  # 41
    "................................................",  # 42
    "................................................",  # 43
    "................................................",  # 44
    "................................................",  # 45
    "................................................",  # 46
    "................................................",  # 47
    "................................................",  # 48
    "................................................",  # 49
    "................................................",  # 50
    "................................................",  # 51
    "................................................",  # 52
    "................................................",  # 53
    "................................................",  # 54
    "................................................",  # 55
])

WRONG = parse([
    "................................................",  # 0
    "................................................",  # 1
    "................................................",  # 2
    "................................................",  # 3
    "................................................",  # 4
    "................................................",  # 5
    "................................................",  # 6
    "................................................",  # 7
    ".....................................bb.........",  # 8
    "....................................bbbb........",  # 9
    "....................................bbbb........",  # 10
    ".....................................bb.........",  # 11
    "................................................",  # 12
    "................................................",  # 13
    "................................................",  # 14
    "................................................",  # 15
    "................................................",  # 16
    "................................................",  # 17
    "................................................",  # 18
    "................................................",  # 19
    "...................hh......hh...................",  # 20
    "................hh............hh................",  # 21
    "................................................",  # 22
    "................................................",  # 23
    "................KKKKKK....KKKKKK................",  # 24
    "................KKKKKK....KKKKKK................",  # 25
    "................KWEEEK....KWEEEK................",  # 26
    ".................KKKK......KKKK.................",  # 27
    "................................................",  # 28
    "..............bb................bb..............",  # 29
    "................................................",  # 30
    ".......................KK.......................",  # 31
    "......................K..K......................",  # 32
    "................................................",  # 33
    "................................................",  # 34
    "................................................",  # 35
    "................................................",  # 36
    "................................................",  # 37
    "................................................",  # 38
    "................................................",  # 39
    "................................................",  # 40
    "................................................",  # 41
    "................................................",  # 42
    "................................................",  # 43
    "................................................",  # 44
    "................................................",  # 45
    "................................................",  # 46
    "................................................",  # 47
    "................................................",  # 48
    "................................................",  # 49
    "................................................",  # 50
    "................................................",  # 51
    "................................................",  # 52
    "................................................",  # 53
    "................................................",  # 54
    "................................................",  # 55
])

FACES = {"ask": ASK, "correct": CORRECT, "wrong": WRONG}


# ──────────────────────────────────────────────────────────────────────────
# バリエーション。**色は差分だけ、形はマップを差し替える**。
# 見比べて選ぶためのもので、決まったら既定へ畳む。
# ──────────────────────────────────────────────────────────────────────────

def rgb(s: str) -> tuple[int, int, int, int]:
    return (int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16), 255)


def hair(a: str, b: str, c: str, d: str, e: str) -> dict[str, tuple[int, int, int, int]]:
    """髪のランプ（最暗→影→基本→明→天使の輪）。"""
    return {"2": rgb(a), "h": rgb(b), "H": rgb(c), "L": rgb(d), "l": rgb(e)}


def eyes(iris: str, light: str, pupil: str = "16233F") -> dict[str, tuple[int, int, int, int]]:
    return {"E": rgb(iris), "e": rgb(light), "D": rgb(pupil)}


# 輪郭は髪の明るさに合わせて変える。地色（#2A1830）より暗くないと形が消えるが、
# 明るい髪なら茶系の輪郭のほうが馴染む。
OL_DARK = {"K": rgb("14121C"), "k": rgb("3A3550")}
OL_WARM = {"K": rgb("4A2F28"), "k": rgb("6B4436")}

COLOR_SETS: dict[str, dict] = {
    "black_blue":  {**hair("1E242F", "2A3243", "3B455E", "515D7C", "9AA6CC"), **eyes("3D86CF", "7FC4F2"), **OL_DARK},
    "black_amber": {**hair("1E242F", "2A3243", "3B455E", "515D7C", "9AA6CC"), **eyes("D8912B", "F5CE72", "3A2410"), **OL_DARK},
    "black_ruby":  {**hair("1E242F", "2A3243", "3B455E", "515D7C", "9AA6CC"), **eyes("C0394B", "F07A88", "3A0E16"), **OL_DARK},
    "navy_cyan":   {**hair("141C30", "1E2B4A", "2E4270", "44608F", "8FB4D8"), **eyes("46C8D8", "9FE8F0"), **OL_DARK},
    "brown_amber": {**hair("2A1C14", "3E2A1C", "5A3E28", "7A5738", "BFA07A"), **eyes("D8912B", "F5CE72", "3A2410"), **OL_WARM},
    "ash_violet":  {**hair("2A2630", "3D3746", "574F63", "756B82", "BDB2C4"), **eyes("9A6FD0", "C8A8F0"), **OL_DARK},
    "blonde_blue": {**hair("8F5A2E", "C08037", "E8B25C", "F7D68F", "FFF3CF"), **eyes("3D86CF", "7FC4F2"), **OL_WARM},
    "auburn_green":{**hair("3A1A18", "5A2622", "7E3830", "A6544A", "D89A8A"), **eyes("4FA860", "8FD89A"), **OL_WARM},
}


def _put(grid: list[list[str]], y: int, col: int, s: str) -> None:
    for i, ch in enumerate(s):
        if ch != ".":
            grid[y][col + i] = ch


def eye_style(name: str) -> list[list[str]]:
    """目だけを差し替えるレイヤー。左右対称に置く（右目は左右反転）。

    この解像度では**形を変えるしかない**。1ドットのサイズ差は読めない。
    """
    shapes = {
        # 丸目。標準。
        "round": [".KKKK.", "KKKKKK", "KWEEEK", "KWEEDK", ".KKKK."],
        # つり目。外側（左目なら左）が上がる。
        "sharp": ["KKKK..", "KKKKKK", "KWEEEK", ".KEEDK", "..KKK."],
        # たれ目。外側が下がる。
        "droop": ["..KKKK", "KKKKKK", "KWEEEK", "KWEEDK", "KKKK.."],
        # 大きめ。1行深くして虹彩を増やす。
        "big":   [".KKKK.", "KKKKKK", "KWEEEK", "KWEEEK", "KWEEDK", ".KKKK."],
        # 男性。**背を低く、まつ毛を1段に**。ここを変えないと女性の顔のまま
        "male":  ["KKKKKK", "KWEEEK", "KEEDDK", ".KKKK."],
    }
    g = [["."] * W for _ in range(H)]
    rows = shapes[name]
    for i, r in enumerate(rows):
        _put(g, 23 + i, 16, r)
        _put(g, 23 + i, 26, r[::-1])
    return g


def hair_style(name: str) -> list[list[str]]:
    """髪型を差し替えた素体。シルエットが変わる差分だけを扱う。"""
    g = [list(row) for row in BASE_PLAIN]
    HAIRC = ("H", "h", "2", "L", "l")

    def clear_hair(y0: int) -> None:
        for y in range(y0, H):
            for x in range(W):
                if g[y][x] in HAIRC:
                    g[y][x] = "."

    def cap(y: int) -> None:
        """その行の髪の下に切り口の線を引く。"""
        for x in range(W):
            if g[y][x] in HAIRC and g[y + 1][x] == ".":
                g[y + 1][x] = "K"

    if name == "long":
        return g

    if name == "bob":
        # あごの高さで切りそろえ、毛先を外へ広げる。
        # **長さだけ変えても差が出ない**（肩から下はシャツに隠れる）ので、
        # 顔まわりのシルエットを変えるしかない。
        clear_hair(35)
        for y in range(28, 35):
            grow = (y - 27) // 2 + 1
            for dx in range(grow):
                for x in (9 - 1 - dx, 38 + 1 + dx):
                    if 0 <= x < W and g[y][x] == ".":
                        g[y][x] = "H"
        cap(34)
        for y in range(27, 36):
            for x in range(W):
                if g[y][x] == "H":
                    for ny, nx in ((y - 1, x), (y, x - 1), (y, x + 1)):
                        if 0 <= ny < H and 0 <= nx < W and g[ny][nx] == ".":
                            g[ny][nx] = "K"
        return g

    if name == "parted":
        # 中央分け。おでこを少しだけ出す。開けすぎると生え際が後退して見える
        for y in range(15, 19):
            half = 3 + (y - 15)          # 下ほど広く開く
            for x in range(24 - half, 24 + half):
                g[y][x] = "S"
            g[y][23 - half] = "K"
            g[y][24 + half] = "K"
        for y in range(12, 15):          # 分け目
            g[y][23] = "h"
            g[y][24] = "h"
        return g

    if name == "twin":
        # 耳の高さで二つ結び。**頭の外へはっきり出す**。
        # 横髪の延長として少し広げるだけでは、ロングとの差が読めなかった。
        for y in range(22, 42):
            if y < 25:
                w = y - 21
            elif y < 37:
                w = 5
            else:
                w = max(0, 5 - (y - 36))
            for dx in range(w):
                for x in (8 - dx, 39 + dx):
                    if 0 <= x < W and g[y][x] in (".", "C", "c", "n"):
                        g[y][x] = "H"
        for y in range(21, 43):
            for x in range(W):
                if g[y][x] == "H":
                    for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
                        if 0 <= ny < H and 0 <= nx < W and g[ny][nx] == ".":
                            g[ny][nx] = "K"
        return g

    if name == "short":
        # 耳の高さで切る。前髪はそのまま、横と後ろだけ落とす
        clear_hair(30)
        cap(29)
        return g

    if name == "spiky":
        # 短髪＋毛先が横へ跳ねる。**上へ伸ばす余白が無い**（頭頂が1行目）ので、
        # トゲは耳の高さから横へ出す。上に置くと画面外へ切れて浮いた点になる
        clear_hair(30)
        cap(29)
        for cy, ln in ((21, 6), (26, 8), (31, 5)):
            for dy in (-1, 0, 1):
                for i in range(ln - abs(dy) * 2):
                    for x in (8 - i, 39 + i):
                        if 0 <= x < W and g[cy + dy][x] == ".":
                            g[cy + dy][x] = "H"
        for y in range(17, 32):
            for x in range(W):
                if g[y][x] == "H":
                    for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
                        if 0 <= ny < H and 0 <= nx < W and g[ny][nx] == ".":
                            g[ny][nx] = "K"
        return g

    raise ValueError(name)


# ── リボンは別レイヤーへ切り出す ──────────────────────────────────────────
# 素体に直接描くと、リボンを外したい変種（男性版など）で下の髪を復元できない。
def _split_ribbon() -> tuple[list[list[str]], list[list[str]]]:
    plain = [row[:] for row in BASE]
    ribbon = [["."] * W for _ in range(H)]
    for y in range(10, 19):
        for x in range(3, 15):
            ch = BASE[y][x]
            if ch in ("R", "r", "p") or (ch == "K" and x < 9):
                ribbon[y][x] = ch
                plain[y][x] = "." if x < 9 else "H"
            elif ch == "K" and 9 <= x <= 13 and BASE[y][x - 1] in ("R", "r", "p", "K"):
                ribbon[y][x] = ch
                plain[y][x] = "K" if x == 9 else "H"
    return plain, ribbon


BASE_PLAIN, RIBBON = _split_ribbon()


def square_jaw(g: list[list[str]]) -> list[list[str]]:
    """あごの絞りを1段下げて角ばらせる（男性版）。丸いままだと少年に見えない。"""
    out = [row[:] for row in g]
    for y in (36, 35, 34, 33):
        out[y] = g[y - 1][:]
    return out


def build(hair: str = "long", male: bool = False) -> list[list[str]]:
    """髪型と体つきを組み合わせた素体（陰影・色トレスまで通す）。"""
    g = hair_style(hair)
    if male:
        g = square_jaw(g)
    else:
        g = compose(g, RIBBON)
    return selout(shade(g))


def face_layer(name: str, eye: str = "round", male: bool = False) -> list[list[str]]:
    """表情レイヤー。男性版は眉を太く低くする（ここを変えないと女性の顔のまま）。"""
    src = {"ask": ASK, "correct": CORRECT, "wrong": WRONG}[name]
    f = [row[:] for row in src]
    if male and eye == "round":
        eye = "male"
    if eye != "round" and name == "ask":
        for y in range(23, 29):
            f[y] = list("." * W)
        f = compose(f, eye_style(eye if eye != "male" else "male"))
        if eye == "male":
            # 4行なので1行下げて、顔の中心線との関係を保つ
            shifted = [["."] * W for _ in range(H)]
            for y in range(23, 28):
                shifted[y + 1] = f[y][:]
                f[y] = ["."] * W
            f = compose(f, shifted)
    if male:
        for y in range(20, 23):
            for x in range(W):
                if f[y][x] == "h":
                    f[y][x] = "."
        for x in range(16, 22):
            f[21][x] = "2"
            f[22][x] = "2"
        for x in range(26, 32):
            f[21][x] = "2"
            f[22][x] = "2"
    return f


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--scale", type=int, default=1,
                    help="書き出し倍率。1なら等倍（表示側で拡大する前提）")
    ap.add_argument("--sheet", metavar="PATH",
                    help="確認用の一覧PNGを書き出す（6倍と実寸3倍を並べる）")
    ap.add_argument("--variants", metavar="DIR",
                    help="色・目・髪型のバリエーション比較シートを書き出す")
    args = ap.parse_args()

    OUT.mkdir(parents=True, exist_ok=True)
    base = selout(shade(BASE))
    to_png(base, OUT / "px_base.png", args.scale)
    for name, face in FACES.items():
        to_png(face, OUT / f"px_face_{name}.png", args.scale)
        # 顔は shade を通さない。目や口に影が乗ると表情が濁る
        to_png(compose(base, face), OUT / f"px_{name}.png", args.scale)
    print(f"{W}x{H} → {OUT}（倍率 {args.scale}）")

    if args.sheet:
        # 確認用の一覧。液晶の地色に置いて、6倍（描き込み）と3倍（実寸）を並べる。
        # HTML を public/ に置くとデプロイに紛れ込むので、画像1枚で完結させる。
        bg = (0x2A, 0x18, 0x30, 255)
        pad, gap = 16, 16
        big, small = 6, 3
        sw = pad * 2 + W * big * 3 + gap * 2
        sh = pad * 3 + H * big + H * small
        sheet = Image.new("RGBA", (sw, sh), bg)
        for i, name in enumerate(FACES):
            g = compose(base, FACES[name])
            im = Image.new("RGBA", (W, H))
            im.putdata([PALETTE[g[y][x]] for y in range(H) for x in range(W)])
            sheet.alpha_composite(im.resize((W * big, H * big), Image.NEAREST),
                                  (pad + i * (W * big + gap), pad))
            sheet.alpha_composite(im.resize((W * small, H * small), Image.NEAREST),
                                  (pad + i * (W * small + gap), pad * 2 + H * big))
        out = pathlib.Path(args.sheet)
        sheet.save(out)
        print(f"一覧 → {out}")

    if args.variants:
        d = pathlib.Path(args.variants)
        d.mkdir(parents=True, exist_ok=True)
        bg = (0x2A, 0x18, 0x30, 255)
        s = 4  # 4倍。粗さを見つつ一覧に収まる大きさ

        def tile(grid, override=None):
            pal = {**PALETTE, **(override or {})}
            im = Image.new("RGBA", (W, H))
            im.putdata([pal[grid[y][x]] for y in range(H) for x in range(W)])
            return im.resize((W * s, H * s), Image.NEAREST)

        def sheet(items, cols, path):
            """items = [(画像, ラベル)]。ラベルはASCII（PILの既定フォントは和文が出ない）。"""
            from PIL import ImageDraw
            rows = (len(items) + cols - 1) // cols
            pad, lab = 12, 16
            iw, ih = W * s, H * s + lab
            im = Image.new("RGBA", (pad + cols * (iw + pad), pad + rows * (ih + pad)), bg)
            dr = ImageDraw.Draw(im)
            for i, (tileimg, label) in enumerate(items):
                x = pad + (i % cols) * (iw + pad)
                y = pad + (i // cols) * (ih + pad)
                im.alpha_composite(tileimg, (x, y))
                dr.text((x + 2, y + W * 0 + H * s + 2), label, fill=(0xC8, 0xBC, 0xD8, 255))
            im.save(path)
            print(f"  {path}")

        base_l = selout(shade(BASE))
        ask = compose(base_l, ASK)
        sheet([(tile(ask, ov), name) for name, ov in COLOR_SETS.items()],
              4, d / "kotoha_colors.png")

        # 目は現行の色（黒髪×青）で比較する
        cur = COLOR_SETS["black_blue"]
        items = []
        for name in ("round", "sharp", "droop", "big"):
            face = compose(ASK, eye_style(name))
            # 差し替えた目が元の目と重ならないよう、元の目の行を消してから重ねる
            f = [r[:] for r in ASK]
            for y in range(23, 29):
                f[y] = list("." * W)
            f = compose(f, eye_style(name))
            items.append((tile(compose(base_l, f), cur), name))
        sheet(items, 4, d / "kotoha_eyes.png")

        items = []
        for name in ("long", "bob", "parted", "twin", "short", "spiky"):
            items.append((tile(compose(build(name), ASK), cur), name))
        sheet(items, 3, d / "kotoha_hair.png")

        # 男女 × 髪型。男性版は眉を太く、あごを角ばらせ、リボンを外す
        items = []
        for male, hairs in ((False, ("long", "bob", "short")),
                            (True, ("short", "spiky", "parted"))):
            for hname in hairs:
                g = build(hname, male=male)
                f = face_layer("ask", male=male)
                items.append((tile(compose(g, f), cur),
                              ("M " if male else "F ") + hname))
        sheet(items, 3, d / "kotoha_people.png")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
