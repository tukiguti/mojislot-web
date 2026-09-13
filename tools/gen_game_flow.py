#!/usr/bin/env python3
"""README のゲームフロー図（docs/game-flow.png）を作る。

**数値は動く。** 出玉のバランスを触るたびに図が置き去りになるので、
手描きの画像ではなくここから生成する形にした（2026-09-13）。
数値を直す場所は下の `SPEC` だけ。

    python3 tools/gen_game_flow.py

出典は `SIM=1 SPINS=1000000 --reporter=verbose npx vitest run tests/sim/payout-sim.test.ts`
の実測値と `data/` の設定値。**中級（±50ms）を基準**にし、腕で開く値だけ範囲を添える。
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "docs" / "game-flow.png"

# === 図に載せる数値（ここだけ直す） ===================================
SPEC = {
    "hall": [
        "同じ島は同じリール配列。違うのは設定1〜6だけ（日替わりで見えない）",
        "毎日1台以上は設定6を保証。データランプと演出率から推測する",
    ],
    "normal_lead": "ほぼ増えない区間。演出を読み、目押しで役を獲る",
    "normal_net": "純増 −0.66枚/G（腕で −1.03〜−0.49）",
    "normal": [
        "レバーONで内部役が確定 → その役を表現できる演出を抽選",
        "演出はクイズ・示唆・狙え・ステップアップ。ガセは無し",
        "順押しで目押し。当選役は4コマ以内なら引き込む",
        "小役 4/6/8/10枚、チェリー 4枚、1枚役 1枚、ハズレ",
        "ボーナス役をこぼしても持ち越し。リーチ目・確定ランプで告知",
    ],
    "enter": [
        "BIG 2種・REG を目押しで揃える",
        "合算 約1/158（設定3・中級）",
        "設定1 約1/176 〜 設定6 約1/135",
    ],
    "back": ["ボーナス終了", "終了画面で設定を示唆し", "通常時へ戻る"],
    "bonus_lead": "BIG 10G ／ REG 5G ＋ 上乗せ",
    "bonus_net": "出玉の山。純増 +5.14枚/G（腕で +1.7〜+8.5）",
    "bonus": [
        "毎ゲーム演出。小役を連続で揃えるとコンボ倍率 ×1.25〜×4.0",
        "一度でも外すとコンボはゼロから",
        "ボーナス役の再当選（約23%）を揃えると上乗せ BIG中+5G / REG中+3G",
        "ボーナス図柄の払い出しは3枚。受け取るのはゲーム数",
        "平均獲得 BIG 295枚／REG 137枚（腕で BIG 81〜629枚）",
    ],
    "foot": "出玉に効く技術介入は ビタ押し と ボーナス中に取りこぼさないこと の2つ",
}

# === 見た目 ==========================================================
W = 1800
PAD = 64
BG = (255, 253, 250)
RED = (197, 48, 48)
BLUE = (43, 90, 160)
GRAY = (90, 98, 112)
INK = (28, 30, 36)
CARD = (255, 255, 255)
LINE = (214, 218, 226)

FONT_DIR = Path("/System/Library/Fonts")


def font(weight: str, size: int) -> ImageFont.FreeTypeFont:
    """ヒラギノ角ゴシックを引く。W6=見出し、W3=本文。"""
    return ImageFont.truetype(str(FONT_DIR / f"ヒラギノ角ゴシック {weight}.ttc"), size)


F_TITLE = font("W6", 62)
F_HEAD = font("W6", 46)
F_LEAD = font("W6", 38)
F_BODY = font("W3", 33)
F_ARROW = font("W6", 32)
F_FOOT = font("W3", 30)


def text_w(draw: ImageDraw.ImageDraw, s: str, f: ImageFont.FreeTypeFont) -> int:
    return int(draw.textlength(s, font=f))


def centered(draw: ImageDraw.ImageDraw, y: int, s: str, f, fill) -> None:
    draw.text(((W - text_w(draw, s, f)) / 2, y), s, font=f, fill=fill)


def section(
    draw: ImageDraw.ImageDraw,
    y: int,
    title: str,
    color: tuple[int, int, int],
    lead: list[str],
    bullets: list[str],
) -> int:
    """見出し帯＋白いカード。返り値は次に描き始める y。"""
    x0, x1 = PAD, W - PAD
    head_h = 92
    body_h = 40 + len(lead) * 58 + len(bullets) * 56 + 24

    draw.rectangle([x0, y, x1, y + head_h], fill=color)
    centered(draw, y + 20, title, F_HEAD, CARD)

    top = y + head_h
    draw.rectangle([x0, top, x1, top + body_h], fill=CARD, outline=color, width=4)

    ty = top + 26
    for s in lead:
        centered(draw, ty, s, F_LEAD, INK)
        ty += 58
    ty += 12
    for s in bullets:
        draw.text((x0 + 56, ty + 6), "★", font=F_BODY, fill=color)
        draw.text((x0 + 104, ty), s, font=F_BODY, fill=INK)
        ty += 56

    return top + body_h


def arrow_down(draw: ImageDraw.ImageDraw, cx: int, y0: int, y1: int, color) -> None:
    """下向きの太い矢印。"""
    shaft = 22
    head = 46
    draw.rectangle([cx - shaft // 2, y0, cx + shaft // 2, y1 - head], fill=color)
    draw.polygon(
        [(cx - head // 2, y1 - head), (cx + head // 2, y1 - head), (cx, y1)],
        fill=color,
    )


def arrow_up(draw: ImageDraw.ImageDraw, cx: int, y0: int, y1: int, color) -> None:
    """上向き（ボーナス終了 → 通常時）。"""
    shaft = 22
    head = 46
    draw.rectangle([cx - shaft // 2, y0 + head, cx + shaft // 2, y1], fill=color)
    draw.polygon(
        [(cx - head // 2, y0 + head), (cx + head // 2, y0 + head), (cx, y0)],
        fill=color,
    )


def main() -> None:
    # 高さは仮に大きく取って、描き終えてから切り詰める。
    img = Image.new("RGB", (W, 2600), BG)
    draw = ImageDraw.Draw(img)

    draw.rectangle([0, 0, W, 118], fill=RED)
    centered(draw, 24, "ゲームフロー", F_TITLE, CARD)

    y = 158
    y = section(draw, y, "ホール（台選び）", GRAY,
                ["6島×4台＋試打コーナー6台の全30台から1台を選ぶ"], SPEC["hall"])

    # ホール → 通常時
    gap = 150
    arrow_down(draw, W // 2, y + 24, y + gap - 8, INK)
    draw.text((W // 2 + 60, y + 52), "座る（3枚掛け）", font=F_ARROW, fill=INK)
    y += gap

    y = section(draw, y, "通常時", BLUE,
                [SPEC["normal_lead"], SPEC["normal_net"]], SPEC["normal"])

    # 通常時 ⇄ ボーナス。左が突入（赤・下向き）、右が終了（青・上向き）。
    gap = 230
    lx, rx = W // 2 - 220, W // 2 + 220
    arrow_down(draw, lx, y + 24, y + gap - 8, RED)
    arrow_up(draw, rx, y + 24, y + gap - 8, BLUE)

    ty = y + 36
    for s in SPEC["enter"]:
        draw.text((lx - 40 - text_w(draw, s, F_ARROW), ty), s, font=F_ARROW, fill=RED)
        ty += 44
    ty = y + 36
    for s in SPEC["back"]:
        draw.text((rx + 40, ty), s, font=F_ARROW, fill=BLUE)
        ty += 44
    y += gap

    y = section(draw, y, "ボーナス", RED,
                [SPEC["bonus_lead"], SPEC["bonus_net"]], SPEC["bonus"])

    y += 44
    draw.line([PAD, y, W - PAD, y], fill=LINE, width=3)
    y += 26
    centered(draw, y, SPEC["foot"], F_FOOT, GRAY)
    y += 58

    img.crop((0, 0, W, y)).save(OUT)
    print(f"{OUT.relative_to(ROOT)} ({W}x{y})")


if __name__ == "__main__":
    main()
