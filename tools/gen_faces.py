#!/usr/bin/env python3
"""出題者の正解／不正解の顔を、出題の顔から**差分で**作る。

    python3 tools/gen_faces.py                    # 全員ぶん生成
    python3 tools/gen_faces.py sushi_taisho       # 1人だけ

`tools/pixel/<名前>.txt`（出題の顔）を読み、`<名前>_correct.txt` /
`<名前>_wrong.txt` を書き出す。**出力は自動生成なので直接編集しない**——
素体を描き直したら、ここのパッチだけ直して再生成する。

## なぜ差分で作るか

同じ人物の別表情なので、素体を複製して手で直すと**顔の作りがずれて別人になる**。
差分にしておけば、変わったのは表情だけだと保証できる。

## 48×56 で表情を作る制約（tools/PIXEL_SPEC.md・FINDINGS_boy.md）

男性は目の背が1〜3行しかなく、実寸3倍では**眉・目・下瞼が1本の濃い帯**に見える。
帯の中で表情を作る余地がないので、差は次の3つで付ける。

1. **口** — いちばん面積があり、実寸でも形が読める
2. **顔の外の記号** — 正解はきらめき、不正解は汗。帯と競合しない位置に置ける
3. **眉の傾き 1〜2ドット** — 効くが、動かせる幅は狭い

目そのものは触らない（潰れて眉と一体化する）。

## 記号の形（実測）

- **きらめきは十字**（中心を明るく、四方に金）でよい。星は輝きの記号なので十字が正解
- **汗を十字にすると「＋」に見える。** 縦に長い滴（上が細く下が膨らむ）にする
- **パッチに余白の `.` を書いてはいけない。** 顔の輪郭（`K`）を透過で消してしまう。
  置き換える区間だけをぴったり書く
"""

from __future__ import annotations

import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from pixel_kit import H, W, load  # noqa: E402

SRC = pathlib.Path(__file__).resolve().parent / "pixel"

# 1パッチ = (行, 開始x, 置き換える文字列)。行の該当区間だけを差し替える。
Patch = tuple[int, int, str]


def sparkle(y: int, x: int) -> list[Patch]:
    """きらめき（十字・3×3）。中心を明るく、四方を金にする。x は中心。"""
    return [(y, x, "Y"), (y + 1, x - 1, "YyY"), (y + 2, x, "Y")]


def sweat(y: int, x: int) -> list[Patch]:
    """汗の一滴。**塗り詰まった塊**にする——線で描くと「＋」に見える（実測）。x は左端。"""
    return [(y, x + 1, "b"), (y + 1, x, "bb"), (y + 2, x, "bb")]


# 顔の外に置く記号の定位置。顔は x11〜37 に収まる人が多いので、その外側に置く。
SPARKLE_L = sparkle(17, 6)
SPARKLE_R = sparkle(17, 41)

# 出題者ごと・表情ごとのパッチ。行番号は各素体の実測（人ごとに顔の位置が違う）。
FACES: dict[str, dict[str, list[Patch]]] = {
    # 寿司屋の大将（50代）。眉21・目22（1行）・口31-33。
    # 目の上に余白が無いので、眉は「内側を1行上げる」向きにしか動かせない。
    "sushi_taisho": {
        # 正解＝満足。眉を1行上げて開き、口を大きく開けて笑う。両脇にきらめき。
        "correct": [
            (20, 16, "KKKKKK"),          # 左眉を1行上へ
            (20, 26, "KKKKKK"),          # 右眉も
            (21, 16, "SSSSSS"),          # もとの眉の行は肌へ戻す
            (21, 26, "SSSSSS"),
            (31, 19, "dKKKKKKKKd"),      # 口を横へ広げる（上唇の線）
            (32, 19, "kMWWWWWWMk"),      # 開いた口＋歯
            (33, 19, "dMMMMMMMMd"),
            (34, 21, "kMMMMMMk"),        # 下唇まで1行伸ばす＝大口
            *SPARKLE_L,
            *SPARKLE_R,
        ],
        # 不正解＝渋い。眉の内側だけ上げて八の字、口は閉じて口角を下げる。汗。
        "wrong": [
            (20, 19, "KKK"),             # 左眉の内側を1行上へ（八の字）
            (20, 26, "KKK"),             # 右眉の内側も
            (21, 19, "SSS"),             # 上げたぶん、もとの位置は肌へ
            (21, 26, "SSS"),
            (31, 21, "SSSSSS"),          # 開いた口を消す
            (32, 21, "SKKKKS"),
            (33, 21, "kSSSSk"),          # 口角だけ1行下げる＝への字
            (34, 21, "SSSSSS"),
            *sweat(18, 39),              # こめかみの汗
        ],
    },
    # 動物園の飼育員（20代）。眉19・目20-21・口27-29（もともと歯を見せて笑っている）。
    "zookeeper": {
        # 正解＝快活。口を横へ広げて大笑い、眉も1行上げる。
        "correct": [
            (18, 17, "KKKKK"),
            (18, 26, "KKKKK"),
            (19, 17, "sssss"),           # 左は明部なので肌の明、右は陰なので肌の暗へ戻す
            (19, 26, "ddddd"),
            (27, 19, "kkkkkkkkkk"),
            (28, 19, "kCCCCCCCCk"),
            (29, 19, "kMMMMMMMMk"),
            (30, 21, "kMMMMMMk"),
            *SPARKLE_L,
            *SPARKLE_R,
        ],
        # 不正解＝しょんぼり。眉の内側だけ上げ、口を閉じて口角を下げる。
        "wrong": [
            (18, 20, "KK"),
            (19, 20, "ss"),
            (18, 26, "KK"),
            (19, 26, "dd"),
            (27, 21, "dddddd"),          # 笑い口を消す
            (28, 21, "dkkkkd"),
            (29, 22, "kddk"),            # 口角を1行下げる
            *sweat(21, 37),
        ],
    },
    # 国語の教師（30代女性）。眉14・眼鏡16-20（目18-19）・口24-25・ほお紅21。
    # 眼鏡の枠で目が囲まれているので、目そのものは触らない。
    "teacher": {
        # 正解＝穏やかに褒める。口を開けた控えめな笑み、眉を1行上げる。
        "correct": [
            (13, 17, "hhhh"),            # 左眉を1行上へ
            (14, 17, "SSSS"),
            (13, 25, "hhhh"),            # 右眉も
            (14, 25, "ssss"),
            (24, 21, "kMMMMk"),
            (25, 21, "MWWWWM"),
            (26, 22, "MMMM"),
            *SPARKLE_L,
            *SPARKLE_R,
        ],
        # 不正解＝残念そう。眉の内側を上げて八の字、口は閉じて口角を下げる。
        "wrong": [
            (13, 19, "hh"),
            (14, 19, "SS"),
            (13, 25, "hh"),
            (14, 25, "ss"),
            (24, 22, "Sdds"),            # もとの口を消す（鼻の影 dd は残す）
            (25, 22, "kkkk"),            # 1行下げて線を引く。鼻の直下だと影と繋がって髭に見える
            # 口角を1行下げる。**間のあごの影も消す**——線の下に影が残ると塊になって
            # 口角と繋がり、口から垂れているように見える
            (26, 21, "kSSSSk"),
            *sweat(17, 37),
        ],
    },
    # 八百屋の店主（40代）。**素体がすでに大笑い**（目を閉じた笑い目 X ＋ 大口 26-31）。
    # 正解は素体と近くなるので、差は不正解側を大きく変えて付ける。
    "greengrocer": {
        # 正解＝素体の大笑いのまま、きらめきだけ足す。これ以上口を開けられない。
        "correct": [
            *SPARKLE_L,
            *SPARKLE_R,
        ],
        # 不正解＝「あちゃー」。閉じた目はそのまま（悔しさに読める）、大口を閉じて口角を下げる。
        # 口を消した跡は斜めの境界で塗り分ける（左右で割ると顔の中央に縦の継ぎ目が走る）。
        "wrong": [
            (26, 19, "ssssssdddd"),
            (27, 18, "sssssssddddd"),
            (28, 17, "sssssssddddddd"),
            (29, 17, "sssssssddddddd"),
            (30, 18, "sssssddddddd"),
            (31, 20, "sssddddd"),
            (28, 21, "kkkkkk"),          # 閉じた口の線
            (29, 20, "k"),
            (29, 27, "k"),               # 口角を1行下げる
            *sweat(21, 41),
        ],
    },
    # セキュリティエンジニア（30代・眼鏡）。眼鏡の枠20-25で目22-23が囲まれ、
    # **眉は眼鏡に隠れて存在しない**。口30が2ドットしかない。差は口と記号だけで付ける。
    "engineer": {
        # 正解＝小さく笑う。口を開けて歯を見せる。
        "correct": [
            (30, 21, "kMWWMk"),
            (31, 22, "MMMM"),
            *SPARKLE_L,
            *SPARKLE_R,
        ],
        # 不正解＝口を結ぶ。口角を1行下げる。
        "wrong": [
            (30, 21, "SkkkkS"),
            (31, 21, "k"),
            (31, 26, "k"),
            *sweat(20, 38),
        ],
    },
}


def apply(grid: list[list[str]], patches: list[Patch]) -> list[list[str]]:
    out = [row[:] for row in grid]
    for y, x0, s in patches:
        if not 0 <= y < H:
            raise SystemExit(f"行 {y} は範囲外")
        if x0 + len(s) > W:
            raise SystemExit(f"行 {y} の x={x0} から {len(s)} 文字は幅を超える")
        for i, ch in enumerate(s):
            out[y][x0 + i] = ch
    return out


def write(name: str, face: str, grid: list[list[str]]) -> pathlib.Path:
    out = SRC / f"{name}_{face}.txt"
    head = (
        f"# {name} の{face}の顔。tools/gen_faces.py が生成（直接編集しない）\n"
        f"# 素体: {name}.txt\n"
    )
    out.write_text(head + "\n".join("".join(r) for r in grid) + "\n", encoding="utf-8")
    return out


def main() -> int:
    targets = sys.argv[1:] or list(FACES)
    for name in targets:
        if name not in FACES:
            raise SystemExit(f"{name} のパッチがありません（{', '.join(FACES)}）")
        base = load(SRC / f"{name}.txt")
        for face, patches in FACES[name].items():
            path = write(name, face, apply(base, patches))
            print(f"  {path.name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
