#!/usr/bin/env python3
"""ドット絵キャラの作画キット。テキストのマップ1枚から PNG とプレビューを作る。

    python3 tools/pixel_kit.py tools/pixel/foo.txt --preview /tmp/foo.png
    python3 tools/pixel_kit.py --sheet /tmp/all.png tools/pixel/*.txt

マップは **48桁 × 56行**、1文字＝1色。`#` で始まる行はコメント（何行でも可、先頭に置く）。
桁ずれ・未定義色はエラーで落とす。黙って通すと形が崩れるので。

仕様の全文は tools/PIXEL_SPEC.md。
"""

from __future__ import annotations

import argparse
import pathlib
import sys

from PIL import Image, ImageDraw

W, H = 48, 56
BG = (0x2A, 0x18, 0x30, 255)   # 液晶の地色。プレビューはこの上に置く


def _c(s: str) -> tuple[int, int, int, int]:
    return (int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16), 255)


# 1文字＝1色。ランプ（暗→明の段）ごとに文字を並べてある。
# 暗い側は青〜赤へ、明るい側は黄へ色相をずらしてある（明度だけ動かすと濁るため）。
PALETTE: dict[str, tuple[int, int, int, int]] = {
    ".": (0, 0, 0, 0),          # 透過
    # 輪郭。K=外周（地色より暗い）/ k=内側の線（色トレス）
    "K": _c("14121C"), "k": _c("3A3550"),
    # 髪（暗→明）。既定は黒髪。色は --hair で差し替えられる
    "2": _c("1E242F"), "h": _c("2A3243"), "H": _c("3B455E"),
    "L": _c("515D7C"), "l": _c("9AA6CC"),
    # 肌（暗→明）。影は赤味を足して血色を残す
    "d": _c("D99A86"), "s": _c("F4BFA6"), "S": _c("FFE3CE"),
    # 目
    "W": _c("FFFFFF"), "e": _c("7FC4F2"), "E": _c("3D86CF"), "D": _c("16233F"),
    # 口
    "M": _c("93343F"), "m": _c("FF8E9C"),
    # 服（暗→明）。白系。影は青紫へ
    "n": _c("C9C4D2"), "c": _c("E4E0E6"), "C": _c("F9F7F2"),
    # 服の差し色（藍）。制服・作務衣・つなぎ等に
    "1": _c("22304A"), "3": _c("34486B"), "4": _c("4C6591"),
    # 服の差し色（生成り／木綿）。白衣・前掛け・手ぬぐい等に
    "5": _c("BFA98A"), "6": _c("DCCBAE"), "7": _c("F2E7D2"),
    # 赤系（リボン・鉢巻・法被）
    "r": _c("A82E45"), "R": _c("E05068"), "p": _c("FF8A9C"),
    # 緑系（エプロン・野菜）
    "g": _c("2F6B48"), "G": _c("47986A"), "q": _c("7FC79A"),
    # 差し色
    "B": _c("FF9A9A"),  # ほお
    "b": _c("8EC9F0"),  # 汗・寒色
    "Y": _c("FFD45E"),  # 金・アクセント
    "y": _c("FFEFAD"),  # 金のハイライト
    "N": _c("6B6B78"),  # 金属・眼鏡のフレーム
    "X": _c("0A0A10"),  # 最暗（瞳孔・влас影の芯）
}


def load(path: pathlib.Path) -> list[list[str]]:
    rows: list[str] = []
    for i, raw in enumerate(path.read_text(encoding="utf-8").splitlines()):
        if raw.startswith("#"):
            continue
        rows.append(raw)
    if len(rows) != H:
        raise SystemExit(f"{path}: {len(rows)} 行（{H} 行必要）")
    for y, r in enumerate(rows):
        if len(r) != W:
            raise SystemExit(f"{path}: {y} 行目が {len(r)} 桁（{W} 桁必要）\n  {r!r}")
        for x, ch in enumerate(r):
            if ch not in PALETTE:
                raise SystemExit(f"{path}: {y} 行 {x} 桁に未定義の色 {ch!r}")
    return [list(r) for r in rows]


def to_image(grid: list[list[str]], scale: int = 1) -> Image.Image:
    img = Image.new("RGBA", (W, H))
    img.putdata([PALETTE[grid[y][x]] for y in range(H) for x in range(W)])
    return img if scale == 1 else img.resize((W * scale, H * scale), Image.NEAREST)


def preview(grid: list[list[str]], path: pathlib.Path) -> None:
    """確認用。液晶の地色の上に **6倍と実寸3倍**を並べる。

    3倍が実際に画面へ出る大きさ。6倍だけ見て整えると、実寸で潰れる描き込みに
    気づけない。必ず両方を見ること。
    """
    big, small, pad = 6, 3, 12
    im = Image.new("RGBA", (pad * 3 + W * big + W * small, pad * 2 + H * big), BG)
    im.alpha_composite(to_image(grid, big), (pad, pad))
    im.alpha_composite(to_image(grid, small), (pad * 2 + W * big, pad))
    im.save(path)


def sheet(paths: list[pathlib.Path], out: pathlib.Path, scale: int = 4) -> None:
    grids = [(p.stem, load(p)) for p in paths]
    cols = min(4, len(grids))
    rows = (len(grids) + cols - 1) // cols
    pad, lab = 12, 16
    iw, ih = W * scale, H * scale + lab
    im = Image.new("RGBA", (pad + cols * (iw + pad), pad + rows * (ih + pad)), BG)
    dr = ImageDraw.Draw(im)
    for i, (name, g) in enumerate(grids):
        x = pad + (i % cols) * (iw + pad)
        y = pad + (i // cols) * (ih + pad)
        im.alpha_composite(to_image(g, scale), (x, y))
        dr.text((x + 2, y + H * scale + 2), name, fill=(0xC8, 0xBC, 0xD8, 255))
    im.save(out)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("maps", nargs="*", type=pathlib.Path)
    ap.add_argument("-o", "--out", type=pathlib.Path, help="等倍PNGの書き出し先")
    ap.add_argument("--preview", type=pathlib.Path, help="確認用プレビューの書き出し先")
    ap.add_argument("--sheet", type=pathlib.Path, help="複数マップを並べた一覧")
    ap.add_argument(
        "--scale", type=int, default=4, help="一覧の倍率（既定4・実寸で見るなら3）"
    )
    ap.add_argument("--palette", action="store_true", help="使える文字と色を一覧する")
    args = ap.parse_args()

    if args.palette:
        for ch, rgba in PALETTE.items():
            print(f"  {ch}  #{rgba[0]:02X}{rgba[1]:02X}{rgba[2]:02X}" if ch != "." else "  .  透過")
        return 0
    if not args.maps:
        ap.error("マップを1つ以上指定してください")

    if args.sheet:
        sheet(args.maps, args.sheet, args.scale)
        print(f"一覧 → {args.sheet}")
        return 0

    grid = load(args.maps[0])
    print(f"OK  {args.maps[0]}  {W}x{H}  使用色 {len({c for r in grid for c in r}) - 1} 種")
    if args.out:
        to_image(grid).save(args.out)
        print(f"  → {args.out}")
    if args.preview:
        preview(grid, args.preview)
        print(f"  → {args.preview}（左が6倍・右が実寸3倍）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
