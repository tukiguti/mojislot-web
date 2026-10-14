#!/usr/bin/env python3
"""ボーナス・カットインの一枚絵（5島×3役＝15枚）をドット絵で作る。

    python3 tools/gen_cutin_art.py              # 15枚を public/art/cutin/ へ
    python3 tools/gen_cutin_art.py --only yasai # 島を絞る
    python3 tools/gen_cutin_art.py --sheet /tmp/sheet.png

## 寸法と構図

カットインは演出液晶（#lcd-fx・600:432）いっぱいに `background-size: cover` で敷かれる。
**論理 200×144 で描いて3倍（600×432）に最近傍で拡大**して書き出す。液晶の背景・
出題者・リールの文字と同じ3倍のドットにそろえるため。CSS の `.premium-cutin-art` には
`image-rendering: pixelated` が無いので、拡大は焼き込んでおく。

絵の上には中央に「見出し（PREMIUM!/REGULAR!）＋役の3文字」が重なる（style.css の
.premium-cutin-content）。液晶幅 600 のとき、見出しは幅 300px・3文字は 1文字 162×125px
を3つ並べて幅 ≒534px、縦に積んで中央寄せなので、**論理座標で y≈38〜106・x≈11〜189**
が文字の下になる。そこで

- 主役（役の言葉そのもの）は**下の帯（y≥108）**に置く
- 上の帯（y≤36）は島の決まった意匠（のれん・日除け・空・水面など）と、主役の補助
- 中央は暗めで模様を弱くし、文字の後ろで絵がうるさくならないようにする

## 格の付け方

- BIG は金の額縁・主役を複数・きらめき・彩度高め
- REG は銀の細い額縁・主役は1つで小さめ・きらめき無し・色を落とす
"""

from __future__ import annotations

import argparse
import math
import pathlib
import sys

import numpy as np
from PIL import Image, ImageDraw

W, H, SCALE = 200, 144, 3
ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "public" / "art" / "cutin"

# 文字の下になる範囲（論理座標）。描画の目安とプレビューの確認に使う。
TEXT_BOX = (11, 38, 189, 106)

Color = tuple[int, int, int, int]


def c(h: str, a: int = 255) -> Color:
    h = h.lstrip("#")
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), a)


OUTLINE = c("14111C")
GOLD = [c("6B3F12"), c("B5761E"), c("F0B43A"), c("FFE58A"), c("FFFBE0")]
SILVER = [c("3C4250"), c("6E7787"), c("A8B1C0"), c("DCE2EC"), c("FFFFFF")]

YY, XX = np.mgrid[0:H, 0:W]


# ---------------------------------------------------------------- 下回り


def layer() -> np.ndarray:
    return np.zeros((H, W, 4), np.uint8)


def m_ellipse(cx: float, cy: float, rx: float, ry: float) -> np.ndarray:
    return ((XX + 0.5 - cx) / rx) ** 2 + ((YY + 0.5 - cy) / ry) ** 2 <= 1.0


def m_rect(x0: int, y0: int, x1: int, y1: int) -> np.ndarray:
    """x0..x1・y0..y1（両端含む）"""
    return (XX >= x0) & (XX <= x1) & (YY >= y0) & (YY <= y1)


def _pil_mask(fn) -> np.ndarray:
    im = Image.new("L", (W, H), 0)
    fn(ImageDraw.Draw(im))
    return np.array(im) > 0


def m_poly(pts) -> np.ndarray:
    return _pil_mask(lambda d: d.polygon([tuple(p) for p in pts], fill=255))


def m_line(pts, width: int = 1) -> np.ndarray:
    return _pil_mask(lambda d: d.line([tuple(p) for p in pts], fill=255, width=width))


def shift(m: np.ndarray, dx: int, dy: int) -> np.ndarray:
    """m を (dx,dy) ずらす。はみ出しは False。"""
    out = np.zeros_like(m)
    ys = slice(max(dy, 0), H + min(dy, 0))
    yd = slice(max(-dy, 0), H + min(-dy, 0))
    xs = slice(max(dx, 0), W + min(dx, 0))
    xd = slice(max(-dx, 0), W + min(-dx, 0))
    out[ys, xs] = m[yd, xd]
    return out


def put(lay: np.ndarray, m: np.ndarray, col: Color) -> None:
    lay[m] = col


def solid(lay: np.ndarray) -> np.ndarray:
    return lay[..., 3] > 0


def outline(lay: np.ndarray, col: Color = OUTLINE) -> np.ndarray:
    """不透明部分の4近傍外周に1ドットの輪郭を足す（地色より暗い外周）。"""
    a = solid(lay)
    ring = (shift(a, 1, 0) | shift(a, -1, 0) | shift(a, 0, 1) | shift(a, 0, -1)) & ~a
    lay[ring] = col
    return lay


def comp(dst: np.ndarray, src: np.ndarray) -> None:
    """src を dst に重ねる（αは 0/255 以外も素直に混ぜる）。"""
    a = src[..., 3:4].astype(np.float32) / 255.0
    dst[..., :3] = (src[..., :3] * a + dst[..., :3] * (1 - a)).astype(np.uint8)
    dst[..., 3] = np.maximum(dst[..., 3], src[..., 3])


def tint(dst: np.ndarray, m: np.ndarray, col: Color, alpha: float) -> None:
    """m の範囲を col へ alpha だけ寄せる（背景の光や影に使う）。"""
    base = dst[m][:, :3].astype(np.float32)
    dst[m, :3] = (base * (1 - alpha) + np.array(col[:3]) * alpha).astype(np.uint8)


def bevel(lay: np.ndarray, m: np.ndarray, ramp: list[Color], depth: int = 1) -> None:
    """平たい形に左上光源の陰影を付ける。ramp は 暗,中,明（4色なら 最暗,暗,中,明）。

    右下の縁を暗く、左上の縁を明るく。外周を一律に暗くする「ピロー塗り」にしない。
    """
    if len(ramp) == 3:
        ramp = [ramp[0]] + ramp
    put(lay, m, ramp[2])
    dark = m.copy()
    for k in range(1, depth + 2):
        dark &= shift(m, -k, -k)
    put(lay, m & ~dark, ramp[1])  # 右下側の帯
    put(lay, m & ~shift(m, -1, -1) & ~shift(m, -1, 0), ramp[0])  # 右下の縁
    put(lay, m & ~shift(m, 1, 1) & ~shift(m, 1, 0) & ~shift(m, 0, 1), ramp[3])  # 左上の縁
    put(lay, m & ~shift(m, 1, 1) & shift(m, 1, 0) & shift(m, 0, 1), ramp[3])


def ball(lay: np.ndarray, cx: float, cy: float, rx: float, ry: float, ramp: list[Color],
         spec: Color | None = None, light=(-0.55, -0.7)) -> np.ndarray:
    """球の陰影。ramp は暗→明。光は左上。最後に小さなハイライト。"""
    m = m_ellipse(cx, cy, rx, ry)
    nx = (XX + 0.5 - cx) / rx
    ny = (YY + 0.5 - cy) / ry
    nz = np.sqrt(np.clip(1 - nx * nx - ny * ny, 0, 1))
    lx, ly = light
    lz = math.sqrt(max(0.0, 1 - lx * lx - ly * ly))
    d = np.clip(nx * lx + ny * ly + nz * lz, 0, 1)
    # 段に分ける（暗部を広めに取ると立体が締まる）
    n = len(ramp)
    idx = np.clip((d ** 1.3 * n).astype(int), 0, n - 1)
    for i in range(n):
        put(lay, m & (idx == i), ramp[i])
    if spec is not None:
        sx = cx + lx * rx * 0.45
        sy = cy + ly * ry * 0.45
        put(lay, m & m_ellipse(sx, sy, max(rx * 0.2, 0.9), max(ry * 0.16, 0.8)), spec)
    return m


def sparkle(lay: np.ndarray, x: int, y: int, r: int, ramp=GOLD) -> None:
    """十字のきらめき。中心を明るく、腕を金に。"""
    for k in range(-r, r + 1):
        col = ramp[3] if abs(k) < r else ramp[2]
        if 0 <= x + k < W and 0 <= y < H:
            lay[y, x + k] = col
        if 0 <= x < W and 0 <= y + k < H:
            lay[y + k, x] = col
    if r >= 3:
        for dx, dy in ((1, 1), (-1, 1), (1, -1), (-1, -1)):
            if 0 <= x + dx < W and 0 <= y + dy < H:
                lay[y + dy, x + dx] = ramp[2]
    lay[y, x] = ramp[4]


def vgrad(img: np.ndarray, y0: int, y1: int, cols: list[Color]) -> None:
    """y0..y1 を cols の段で塗る。段の境目は1行だけ市松で混ぜる。"""
    n = len(cols)
    span = (y1 - y0 + 1) / n
    for y in range(y0, y1 + 1):
        i = min(int((y - y0) / span), n - 1)
        img[y, :] = cols[i]
        nxt = int((y + 1 - y0) / span)
        if nxt != i and nxt < n:
            row = (np.arange(W) + y) % 2 == 0
            img[y, row] = cols[nxt]


def glow(img: np.ndarray, cx: float, cy: float, rx: float, ry: float, col: Color,
         steps=(0.10, 0.18, 0.26)) -> None:
    """同心の楕円を段で重ねる光。段差を残してドット絵らしく。"""
    k = len(steps)
    for i, a in enumerate(steps):
        f = 1 - i / k
        tint(img, m_ellipse(cx, cy, rx * f, ry * f), col, a)


def frame(img: np.ndarray, tier: str) -> None:
    """額縁。BIG＝金の二重線と角飾り、REG＝銀の細線。"""
    if tier == "big":
        put(img, m_rect(0, 0, W - 1, H - 1) & ~m_rect(1, 1, W - 2, H - 2), OUTLINE)
        ring = m_rect(1, 1, W - 2, H - 2) & ~m_rect(3, 3, W - 4, H - 4)
        lay = layer()
        bevel(lay, ring, [GOLD[1], GOLD[2], GOLD[3]])
        comp(img, lay)
        put(img, m_rect(4, 4, W - 5, H - 5) & ~m_rect(5, 5, W - 6, H - 6), c("14111C", 180))
        for x, y in ((6, 6), (W - 7, 6), (6, H - 7), (W - 7, H - 7)):
            d = layer()
            dm = m_poly([(x, y - 4), (x + 4, y), (x, y + 4), (x - 4, y)])
            bevel(d, dm, [GOLD[1], GOLD[2], GOLD[3]])
            outline(d)
            comp(img, d)
            img[y, x] = GOLD[4]
    else:
        put(img, m_rect(0, 0, W - 1, H - 1) & ~m_rect(1, 1, W - 2, H - 2), OUTLINE)
        put(img, m_rect(1, 1, W - 2, H - 2) & ~m_rect(2, 2, W - 3, H - 3), SILVER[2])
        put(img, m_rect(2, 2, W - 3, H - 3) & ~m_rect(3, 3, W - 4, H - 4), OUTLINE)


def desat(img: np.ndarray, amount: float, toward: Color = c("2A2E3A")) -> None:
    """REG 用。色を落として格下に見せる（明度は保ったまま彩度を抜く）。"""
    rgb = img[..., :3].astype(np.float32)
    gray = rgb @ np.array([0.30, 0.59, 0.11], np.float32)
    mixed = rgb * (1 - amount) + gray[..., None] * amount
    img[..., :3] = np.clip(mixed, 0, 255).astype(np.uint8)


# ---------------------------------------------------------------- 寿司（hiragana_food）

SU_BG = [c("0E1024"), c("15183A"), c("1B2050"), c("15183A")]
RICE = [c("8E8AA0"), c("C9C6D6"), c("EFEDF5"), c("FFFFFF")]
WOOD_L = [c("6E4A22"), c("A57636"), c("D2A35A"), c("F0CE8A")]  # 檜のカウンター
WOOD_D = [c("2C1A10"), c("4E2E17"), c("744624"), c("9A6434")]  # 下駄（付け台）


def seigaiha(img: np.ndarray, col: Color, alpha: float, y0: int, y1: int) -> None:
    """青海波。ドットで描ける大きさ（半径6）にして、薄く敷く。"""
    m = np.zeros((H, W), bool)
    for row, cy in enumerate(range(y0, y1 + 8, 6)):
        off = 6 if row % 2 else 0
        for cx in range(-12 + off, W + 12, 12):
            for r in (6, 4):
                ring = m_ellipse(cx, cy, r + 0.5, r + 0.5) & ~m_ellipse(cx, cy, r - 0.5, r - 0.5)
                m |= ring & (YY <= cy)
    tint(img, m & (YY >= y0) & (YY <= y1), col, alpha)


def noren(img: np.ndarray, tier: str, crest) -> None:
    """上の帯ののれん。5枚に割り、中央の1枚に役の紋を染め抜く。"""
    body = c("1E2E6E") if tier == "big" else c("33405E")
    ramp = [c("0F173E"), c("162253"), body, c("2E4492") if tier == "big" else c("4A5878")]
    lay = layer()
    # 竿
    pole = m_rect(4, 3, W - 5, 5)
    bevel(lay, pole, WOOD_D[1:])
    n, gap = 5, 3
    pw = (W - 12 - gap * (n - 1)) / n
    for i in range(n):
        x0 = int(6 + i * (pw + gap))
        x1 = int(6 + i * (pw + gap) + pw) - 1
        bottom = 30 if i in (0, n - 1) else 27
        m = m_rect(x0, 6, x1, bottom)
        bevel(lay, m, ramp)
        # 裾の白い線（のれんの縁取り）
        put(lay, m_rect(x0, bottom - 2, x1, bottom - 2), c("C9D2EA") if tier == "big" else c("9AA3B5"))
    outline(lay)
    comp(img, lay)
    # 中央ののれんに紋。白抜きの丸の中に役のもの
    cx = W // 2
    disc = layer()
    put(disc, m_ellipse(cx, 16.5, 9.5, 9.5), c("EDEFF7") if tier == "big" else c("C6CBD6"))
    put(disc, m_ellipse(cx, 16.5, 8.5, 8.5), ramp[1])
    comp(img, disc)
    crest(img, cx, 16)


def lantern(img: np.ndarray, x: int, y: int) -> None:
    """赤ちょうちん。上帯の左右に吊るす。"""
    glow(img, x, y + 10, 22, 20, c("FF7A3A"), (0.08, 0.14, 0.22))
    lay = layer()
    put(lay, m_rect(x - 3, y, x + 3, y + 2), c("2A1A14"))
    ball(lay, x, y + 11, 8, 9.5, [c("7E1420"), c("B5222E"), c("E2413A"), c("FF7A52"), c("FFB58A")])
    for yy in (y + 5, y + 9, y + 13, y + 17):  # 骨
        band = m_ellipse(x, y + 11, 8, 9.5) & (YY == yy)
        put(lay, band, c("8E1A25"))
    put(lay, m_rect(x - 3, y + 20, x + 3, y + 21), c("2A1A14"))
    outline(lay)
    comp(img, lay)


def counter(img: np.ndarray, y0: int) -> None:
    """檜の付け台（カウンター）。木目は横に流す。"""
    lay = layer()
    m = m_rect(0, y0, W - 1, H - 1)
    put(lay, m, WOOD_L[2])
    put(lay, m_rect(0, y0, W - 1, y0), WOOD_L[3])
    put(lay, m_rect(0, y0 + 1, W - 1, y0 + 1), WOOD_L[3])
    put(lay, m_rect(0, y0 + 3, W - 1, y0 + 3), WOOD_L[1])
    rng = np.random.default_rng(7)
    for _ in range(26):
        yy = int(rng.integers(y0 + 5, H - 1))
        x0 = int(rng.integers(-20, W))
        ln = int(rng.integers(14, 46))
        put(lay, m_rect(x0, yy, x0 + ln, yy), WOOD_L[1])
    put(lay, m_rect(0, y0 - 1, W - 1, y0 - 1), OUTLINE)
    comp(img, lay)


def geta(lay: np.ndarray, x0: int, x1: int, y: int) -> None:
    """下駄（握りを載せる板）。y が天板の上面。"""
    top = m_rect(x0, y, x1, y + 4)
    bevel(lay, top, WOOD_D[1:])
    put(lay, m_rect(x0, y, x1, y), WOOD_D[3])
    for lx in (x0 + 5, x1 - 9):
        put(lay, m_rect(lx, y + 5, lx + 4, y + 8), WOOD_D[0])


def rice(lay: np.ndarray, cx: int, y: int, w: int = 22) -> None:
    """シャリ。y が上端、高さは幅の約3割。粒感は暗い点を散らして出す。"""
    h = max(7, round(w * 0.3))
    m = m_ellipse(cx, y + h * 0.55, w / 2, h * 0.55) | m_rect(cx - w // 2 + 1, y + h // 2, cx + w // 2 - 2, y + h)
    bevel(lay, m, RICE)
    rng = np.random.default_rng(cx)
    for _ in range(w):
        px = int(rng.integers(cx - w // 2 + 2, cx + w // 2 - 2))
        py = int(rng.integers(y + 2, y + h))
        if m[py, px] and lay[py, px, 0] > 200:
            lay[py, px] = RICE[1]


def salmon_neta(lay: np.ndarray, cx: int, y: int, w: int = 26) -> None:
    """鮭のネタ。橙の身に白い脂の筋を斜めに。シャリより左右に少しはみ出す。"""
    h = max(9, round(w * 0.32))
    pts = [(cx - w // 2 - 1, y + h * 0.7), (cx - w // 2 + 3, y + 1), (cx + w // 2 - 3, y), (cx + w // 2 + 2, y + h * 0.55),
           (cx + w // 2, y + h), (cx - w // 2 + 1, y + h)]
    m = m_poly(pts)
    bevel(lay, m, [c("A63A1A"), c("E2622A"), c("FF8A48"), c("FFBE88")])
    for k in range(-w // 2 + 3, w // 2, 6):
        stripe = m_line([(cx + k, y + h), (cx + k + 5, y)], 1) & m
        put(lay, stripe, c("FFE2C8"))
        put(lay, shift(stripe, 1, 0) & m & ~stripe, c("FFB27A"))


def nigiri_salmon(lay: np.ndarray, cx: int, y: int, w: int = 26) -> None:
    """y はネタの上端。シャリはネタの下半分に隠れる位置から。"""
    rice(lay, cx, y + round(w * 0.2), w - 2)
    salmon_neta(lay, cx, y, w)


def _rot(cx: float, cy: float, ang: float):
    """回した局所座標 (u: 頭の向き, v: 腹の向き)。"""
    dx, dy = XX + 0.5 - cx, YY + 0.5 - cy
    ca, sa = math.cos(ang), math.sin(ang)
    return dx * ca + dy * sa, -dx * sa + dy * ca


def fish_salmon(lay: np.ndarray, cx: int, cy: int, length: int, flip: bool = False,
                ang: float = 0.0) -> None:
    """鮭の一尾。頭は +u 側。ang で傾ける（跳ねる鮭）。flip で左向き。"""
    if flip:
        ang = math.pi - ang
    u, v = _rot(cx, cy, ang)
    if flip:
        v = -v
    L = length
    body = (u / (L * 0.4)) ** 2 + (v / (L * 0.18)) ** 2 <= 1
    tu = u + L * 0.38
    tail = (tu < 0) & (tu > -L * 0.2) & (np.abs(v) < -tu * 0.95 + 1.5) & (np.abs(v) > -tu * 0.5 - 2.5)
    tail |= (tu <= 0) & (tu > -L * 0.06) & (np.abs(v) < 2.5)
    m = body | tail
    put(lay, m, c("C8603E"))
    put(lay, m & (v < -L * 0.04), c("566078"))  # 背は鈍い青
    put(lay, m & (v < -L * 0.04) & (v > -L * 0.07), c("7A86A0"))
    put(lay, m & (v > L * 0.06), c("F2E0D2"))  # 腹は白
    # 婚姻色の赤い帯（鮭らしさ）
    put(lay, body & (np.abs(v) <= L * 0.03) & (u < L * 0.2), c("E2563A"))
    # 背びれ
    put(lay, (u > -L * 0.05) & (u < L * 0.08) & (v < -L * 0.12) & (v > -L * 0.2) &
        (v > -L * 0.2 + (u + L * 0.05) * 0.6), c("3E4860"))
    # 目とえら
    put(lay, (np.abs(u - L * 0.3) < 0.9) & (np.abs(v + L * 0.02) < 0.9), OUTLINE)
    put(lay, body & (np.abs(u - L * 0.22) < 0.5) & (np.abs(v) < L * 0.09), c("8A3A2A"))


def tarako_pair(lay: np.ndarray, cx: int, y: int, w: int = 34) -> None:
    """たらこ一腹。太い2本の房を斜めにずらして寄り添わせる。粒は白い点。"""
    ramp = [c("8E1E34"), c("C83A50"), c("EE6A7A"), c("FFA6AE")]
    ry = max(4.5, w * 0.13)
    dst = lay
    for dy, dx in ((0, -4), (ry * 1.7, 4)):
        lay = layer()
        m = m_ellipse(cx + dx, y + ry + dy, w / 2, ry)
        bevel(lay, m, ramp)
        rng = np.random.default_rng(int(cx + dy))
        for _ in range(w):
            px = int(rng.integers(cx + dx - w // 2 + 2, cx + dx + w // 2 - 2))
            py = int(rng.integers(int(y + dy + 1), int(y + dy + ry * 2)))
            if m[py, px] and lay[py, px, 0] >= 0xC8:
                lay[py, px] = ramp[3]
        # 膜の筋（房の端を絞る）
        for k in (-w // 2 + 3, w // 2 - 4):
            put(lay, m & (XX == cx + dx + k), ramp[0])
        lay[int(y + dy + ry * 0.5), int(cx + dx - w * 0.15)] = c("FFFFFF")
        outline(lay, c("5A1020"))
        comp(dst, lay)


def shiso(lay: np.ndarray, cx: int, y: int, w: int = 30) -> None:
    m = m_poly([(cx - w // 2, y + 6), (cx - 4, y), (cx + w // 2, y + 3), (cx + 6, y + 11), (cx - 8, y + 11)])
    bevel(lay, m, [c("1F5A2E"), c("2F8443"), c("4FB260"), c("8FDB8C")])
    put(lay, m_line([(cx - w // 2 + 2, y + 6), (cx + w // 2 - 3, y + 4)], 1) & m, c("1F5A2E"))


def gunkan(lay: np.ndarray, cx: int, y: int, topping, w: int = 22) -> None:
    """軍艦巻き。海苔の帯の上に具を盛る。y は具の上端。"""
    hw = w // 2
    nori = m_rect(cx - hw, y + 5, cx + hw - 1, y + 17)
    bevel(lay, nori, [c("080E0A"), c("121C16"), c("1E2E24"), c("34503C")])
    put(lay, nori & (YY == y + 5), c("4A6A52"))
    put(lay, nori & ((XX - cx) % 7 == 3) & (YY > y + 7), c("162A1E"))  # 海苔の継ぎ目
    topping(lay, cx, y, w)


def tarako_bits(lay: np.ndarray, cx: int, y: int, w: int = 22) -> None:
    """ほぐしたたらこを山盛りに。"""
    m = m_ellipse(cx, y + 5, w / 2 - 1, 5)
    put(lay, m, c("E35A6A"))
    put(lay, m & (YY < y + 3), c("F58A96"))
    for px in range(cx - w // 2, cx + w // 2):
        for py in range(y, y + 10):
            if m[py, px] and (px * 3 + py * 5) % 4 == 0:
                lay[py, px] = c("FFB8BC")
            elif m[py, px] and (px + py * 2) % 5 == 0:
                lay[py, px] = c("A8304A")


def shako_neta(lay: np.ndarray, cx: int, y: int, w: int = 26) -> None:
    """しゃこ。茹でた藤色に濃い節の帯、頭側に尾の扇。背の中央に線。"""
    h = max(9, round(w * 0.32))
    m = m_poly([(cx - w // 2, y + h * 0.6), (cx - w // 2 + 3, y + 1), (cx + w // 2 - 4, y), (cx + w // 2 + 1, y + h * 0.45),
                (cx + w // 2 - 1, y + h), (cx - w // 2 + 1, y + h)])
    bevel(lay, m, [c("5A3A5E"), c("8A6292"), c("B88CBC"), c("E2C6E2")])
    for k in range(-w // 2 + 5, w // 2 - 2, 5):
        band = m & (XX >= cx + k) & (XX <= cx + k + 1)
        put(lay, band, c("6E4A74"))
        put(lay, band & (YY < y + 3), c("9C78A0"))
    put(lay, m & (YY == y + h // 2) & (XX > cx - w // 2 + 3), c("D4B0D4"))
    fan = m_poly([(cx - w // 2 + 2, y + h * 0.5), (cx - w // 2 - 7, y - 1), (cx - w // 2 - 9, y + h * 0.5),
                  (cx - w // 2 - 7, y + h + 1)])
    bevel(lay, fan, [c("5A3A5E"), c("8A6292"), c("B88CBC")])
    for d in (-3, 0, 3):
        put(lay, m_line([(cx - w // 2, y + h * 0.5), (cx - w // 2 - 7, y + h * 0.5 + d * 1.5)], 1) & fan, c("5A3A5E"))


def crest_salmon(img, cx, cy):
    lay = layer()
    fish_salmon(lay, cx, cy + 0.5, 17)
    comp(img, lay)


def crest_tarako(img, cx, cy):
    lay = layer()
    for dy, dx in ((-2, -1), (2, 1)):
        put(lay, m_ellipse(cx + dx, cy + dy, 6.5, 2.4), c("F27A86"))
        put(lay, m_ellipse(cx + dx, cy + dy, 6.5, 2.4) & (YY == cy + dy - 1), c("FFB0B4"))
    comp(img, lay)


def crest_shako(img, cx, cy):
    lay = layer()
    m = m_ellipse(cx + 1, cy, 6, 2.5)
    put(lay, m, c("C6A6BE"))
    for k in (-3, 0, 3):
        put(lay, m & (XX == cx + 1 + k), c("8E6C8A"))
    put(lay, m_poly([(cx - 5, cy), (cx - 9, cy - 3), (cx - 9, cy + 3)]), c("9C7896"))
    comp(img, lay)


def scene_food(yaku: str, tier: str) -> np.ndarray:
    img = layer()
    vgrad(img, 0, H - 1, SU_BG)
    seigaiha(img, c("3A4C9A"), 0.35, 34, 112)
    glow(img, W / 2, 72, 110, 60, c("3A4FA8") if tier == "big" else c("454E66"), (0.10, 0.14, 0.18))

    crest = {"shake": crest_salmon, "tarako": crest_tarako, "reg": crest_shako}[yaku]
    noren(img, tier, crest)
    if tier == "big":
        lantern(img, 14, 6)
        lantern(img, W - 15, 6)

    counter(img, 128)
    lay = layer()
    if yaku == "shake":
        # 下駄に握り3貫を大きく。左右の隅から鮭が跳ねる
        geta(lay, 38, 162, 126)
        for x in (58, 100, 142):
            nigiri_salmon(lay, x, 105, 34)
        fl = layer()
        fish_salmon(fl, 22, 114, 44, ang=-1.2)
        fish_salmon(fl, W - 23, 114, 44, flip=True, ang=-1.2)
        outline(fl)
        comp(img, fl)
    elif yaku == "tarako":
        geta(lay, 30, 170, 126)
        shiso(lay, 72, 108, 60)
        tarako_pair(lay, 72, 104, 52)
        gunkan(lay, 128, 106, tarako_bits, 24)
        gunkan(lay, 154, 106, tarako_bits, 24)
    else:  # しゃこ（REG）：小さい下駄に1貫だけ
        geta(lay, 74, 128, 126)
        rice(lay, 101, 114, 36)
        shako_neta(lay, 102, 106, 38)
    outline(lay)
    comp(img, lay)

    if tier == "big":
        sp = layer()
        for x, y, r in ((44, 32, 3), (156, 32, 3), (40, 112, 2), (160, 112, 2), (100, 100, 2)):
            sparkle(sp, x, y, r)
        comp(img, sp)
    else:
        desat(img, 0.45)
    frame(img, tier)
    return img


# ---------------------------------------------------------------- 動詞（hiragana_verb）

TATAMI = [c("5A5A22"), c("8A8A3A"), c("B4B25A"), c("D6D486")]
SKIN = [c("A8604E"), c("D99A86"), c("F4BFA6"), c("FFE3CE")]
GI = [c("1E2C4E"), c("2E4476"), c("4A68A8"), c("7A9AD6")]  # 主人公の作務衣（藍）


def tatami(img: np.ndarray, y0: int) -> None:
    """畳。縁（へり）を黒で横に1本、目は縦の細線。"""
    lay = layer()
    m = m_rect(0, y0, W - 1, H - 1)
    put(lay, m, TATAMI[2])
    for x in range(0, W, 3):
        put(lay, m & (XX == x), TATAMI[1])
    put(lay, m_rect(0, y0, W - 1, y0 + 1), TATAMI[3])
    for x in (66, 133):
        put(lay, m & (XX >= x) & (XX <= x + 2), c("1C1C24"))
    put(lay, m_rect(0, y0 - 1, W - 1, y0 - 1), OUTLINE)
    comp(img, lay)


def window_sky(img: np.ndarray, cols: list[Color], y1: int = 34) -> None:
    """上帯の障子窓。開いた窓から空が見え、両脇に障子。"""
    vgrad(img, 0, y1, cols)
    lay = layer()
    for x0, x1 in ((0, 34), (W - 35, W - 1)):
        m = m_rect(x0, 0, x1, y1)
        put(lay, m, c("E8DEC4"))
        for gx in range(x0 + 2, x1, 8):
            put(lay, m & (XX == gx), c("8A6A44"))
        for gy in range(4, y1, 9):
            put(lay, m & (YY == gy), c("8A6A44"))
        put(lay, m & ((XX == x0) | (XX == x1)), c("5A3E22"))
    put(lay, m_rect(0, y1 + 1, W - 1, y1 + 2), c("5A3E22"))  # 鴨居
    put(lay, m_rect(0, y1 + 1, W - 1, y1 + 1), c("8A6A44"))
    comp(img, lay)


def person(lay: np.ndarray, pose: str, x: int, y: int, s: float = 1.0) -> None:
    """主人公。丸い頭・藍の作務衣・赤い鉢巻。x,y は足元の中央。s は大きさの倍率。

    pose: 'cheer'（両手を上げて立つ）/ 'strain'（腰を落として踏ん張る）
    """
    def P(dx: float, dy: float) -> tuple[float, float]:
        return (x + dx * s, y + dy * s)

    lw = max(3, round(3 * s))
    if pose == "cheer":
        put(lay, m_line([P(-4, -12), P(-6, 0)], lw) | m_line([P(3, -12), P(5, 0)], lw), GI[1])
        bevel(lay, m_poly([P(-7, -21), P(7, -21), P(6, -11), P(-6, -11)]), GI)
        put(lay, m_poly([P(-2, -21), P(2, -21), P(0, -16)]), SKIN[2])  # 襟元
        arm = m_line([P(-6, -19), P(-13, -28), P(-15, -36)], lw) | m_line([P(6, -19), P(13, -28), P(15, -36)], lw)
        put(lay, arm, GI[2])
        put(lay, m_ellipse(*P(-15, -37), 2.6 * s, 2.6 * s) | m_ellipse(*P(15, -37), 2.6 * s, 2.6 * s), SKIN[2])
        put(lay, m_poly([P(-7, -13), P(7, -13), P(7, -11), P(-7, -11)]), c("B5222E"))  # 帯
        head(lay, *P(0, -28), "open", s)
    elif pose == "strain":
        put(lay, m_line([P(-5, -10), P(-12, -7), P(-13, 0)], lw), GI[1])
        put(lay, m_line([P(5, -10), P(12, -7), P(13, 0)], lw), GI[1])
        bevel(lay, m_poly([P(-7, -17), P(7, -17), P(7, -9), P(-7, -9)]), GI)
        put(lay, m_line([P(-7, -15), P(-11, -10), P(-4, -8)], lw), GI[2])
        put(lay, m_line([P(7, -15), P(11, -10), P(4, -8)], lw), GI[2])
        put(lay, m_ellipse(*P(-3, -8), 2.6 * s, 2.6 * s) | m_ellipse(*P(3, -8), 2.6 * s, 2.6 * s), SKIN[2])
        put(lay, m_poly([P(-7, -11), P(7, -11), P(7, -9), P(-7, -9)]), c("B5222E"))
        head(lay, *P(0, -23), "grit", s)


def head(lay: np.ndarray, x: float, y: float, face: str, s: float = 1.0) -> None:
    """頭（半径7×s）。y は頭の中心。鉢巻つき。表情は目と口の形で変える。"""
    x, y = int(round(x)), int(round(y))
    r = 7 * s
    ball(lay, x, y, r, r, SKIN, None)
    put(lay, m_ellipse(x, y - 1, r, r) & (YY <= y - r * 0.55), c("2A2430"))  # 髪
    put(lay, m_ellipse(x, y, r, r) & (YY >= y - r * 0.6) & (YY <= y - r * 0.6 + max(1, round(s * 1.5))), c("D8303C"))
    put(lay, m_line([(x + r - 1, y - r * 0.55), (x + r + 4 * s, y - r * 0.55 - 4 * s)], max(2, round(2 * s))), c("D8303C"))
    k = max(1, round(s))
    if face == "open":  # 目を閉じて笑う（∩）と大きく開いた口
        for ex in (x - round(3 * s), x + round(2 * s)):
            put(lay, m_rect(ex, y - 1, ex + k, y - 1), OUTLINE)
            put(lay, m_rect(ex - 1, y, ex - 1, y) | m_rect(ex + k + 1, y, ex + k + 1, y), OUTLINE)
        put(lay, m_ellipse(x, y + 3.5 * s, 2.6 * s, 2.1 * s), c("93343F"))
        put(lay, m_ellipse(x, y + 4.5 * s, 1.6 * s, 1.0 * s), c("FF8E9C"))
        put(lay, m_ellipse(x - 4.5 * s, y + 1.5 * s, 1.4 * s, 0.9 * s) | m_ellipse(x + 4.5 * s, y + 1.5 * s, 1.4 * s, 0.9 * s), c("FF9A9A"))
    elif face == "grit":  # 力む：＞＜の目と食いしばった歯
        for ex, d in ((x - round(3 * s), 1), (x + round(3 * s), -1)):
            put(lay, m_line([(ex - d * 1.5 * s, y - 1.5 * s), (ex, y), (ex - d * 1.5 * s, y + 1.5 * s)], 1), OUTLINE)
        tw = round(3 * s)
        teeth = m_rect(x - tw, y + round(3 * s), x + tw - 1, y + round(3 * s) + k)
        put(lay, teeth, c("FFFFFF"))
        put(lay, teeth & (XX % 2 == 0), c("C9C4D2"))
        put(lay, (shift(teeth, 0, 1) | shift(teeth, 0, -1)) & ~teeth, OUTLINE)
        put(lay, m_ellipse(x - 4.5 * s, y + 1.5 * s, 1.4 * s, 1.0 * s) | m_ellipse(x + 4.5 * s, y + 1.5 * s, 1.4 * s, 1.0 * s), c("FF6A6A"))
    elif face == "sleep":
        for ex in (x - round(4 * s), x + round(1 * s)):
            put(lay, m_rect(ex, y, ex + round(2 * s), y), OUTLINE)
        put(lay, m_ellipse(x, y + 3.5 * s, 1.2 * s, 1.0 * s), c("93343F"))
        put(lay, m_ellipse(x - 4.5 * s, y + 1.5 * s, 1.4 * s, 0.9 * s) | m_ellipse(x + 4.5 * s, y + 1.5 * s, 1.4 * s, 0.9 * s), c("FF9A9A"))


def sun(img: np.ndarray, x: int, y: int, r: int) -> None:
    glow(img, x, y, r * 4, r * 3.2, c("FFB03A"), (0.10, 0.16, 0.24, 0.32))
    lay = layer()
    for i in range(12):
        a = i * math.pi / 6 + 0.13
        p0 = (x + math.cos(a) * (r + 3), y + math.sin(a) * (r + 3))
        p1 = (x + math.cos(a) * (r + 8), y + math.sin(a) * (r + 8))
        put(lay, m_line([p0, p1], 2), c("FFD45E"))
    ball(lay, x, y, r, r, [c("E0602A"), c("F58A2E"), c("FFB43A"), c("FFD866"), c("FFF2B0")])
    outline(lay)
    comp(img, lay)


def sprout(lay: np.ndarray, x: int, y: int, h: int) -> None:
    """芽。茎と双葉。"""
    put(lay, m_line([(x, y), (x, y - h)], 2), c("3E8A3E"))
    bevel(lay, m_ellipse(x - 4, y - h - 1, 4.5, 2.6), [c("2F6B32"), c("47A04A"), c("7FD06A")])
    bevel(lay, m_ellipse(x + 5, y - h - 2, 4.5, 2.6), [c("2F6B32"), c("47A04A"), c("7FD06A")])


def moon(img: np.ndarray, x: int, y: int, r: int) -> None:
    glow(img, x, y, r * 3.4, r * 2.8, c("9FB4FF"), (0.07, 0.11, 0.16))
    lay = layer()
    full = m_ellipse(x, y, r, r)
    cut = m_ellipse(x + r * 0.55, y - r * 0.3, r * 0.9, r * 0.9)
    m = full & ~cut
    bevel(lay, m, [c("C9A44A"), c("F2D27A"), c("FFF0B8"), c("FFFBE6")])
    outline(lay)
    comp(img, lay)


def zzz(lay: np.ndarray, x: int, y: int, size: int, col: Color) -> None:
    """Z の字をドットで。size は1辺。"""
    put(lay, m_rect(x, y, x + size - 1, y), col)
    put(lay, m_rect(x, y + size - 1, x + size - 1, y + size - 1), col)
    put(lay, m_line([(x + size - 1, y + 1), (x, y + size - 2)], 1), col)


def futon(lay: np.ndarray, x: int, y: int, w: int = 112) -> None:
    """布団で寝る主人公。x,y は布団の左下。掛け布団は体の形にふくらませる。"""
    # 敷布団
    bevel(lay, m_rect(x, y - 7, x + w, y), [c("8A8090"), c("C8C0D0"), c("EEE8F2")])
    put(lay, m_rect(x, y - 3, x + w, y - 3), c("A8A0B4"))
    # 枕（そば殻の俵）
    bevel(lay, m_ellipse(x + 17, y - 11, 12, 4.5), [c("8A7A50"), c("C8B67A"), c("EAD9A0")])
    head(lay, x + 18, y - 19, "sleep", 1.35)
    # 掛け布団（赤地に白の格子）。肩から足へなだらかに下がる
    quilt = m_poly([(x + 28, y - 24), (x + 50, y - 26), (x + 80, y - 22), (x + w - 4, y - 17), (x + w + 2, y - 6), (x + 24, y - 6)])
    quilt |= m_ellipse(x + 46, y - 18, 22, 9) & (YY >= y - 27)
    bevel(lay, quilt, [c("6E1E36"), c("A83250"), c("D85274"), c("F08AA0")], depth=2)
    for gx in range(x + 36, x + w, 12):
        put(lay, quilt & (XX == gx), c("F2C0CC"))
    for gy in (y - 18, y - 11):
        put(lay, quilt & (YY == gy), c("F2C0CC"))
    collar = quilt & (XX <= x + 38)
    bevel(lay, collar, [c("A8A0B4"), c("D8D2E0"), c("F4F0F8")])


def sweat(lay: np.ndarray, x: int, y: int) -> None:
    """汗は塗り詰まった塊（上1ドット・下2×2）。線で描くと＋に見える。"""
    lay[y, x] = c("8EC9F0")
    put(lay, m_rect(x - 1, y + 1, x, y + 2), c("8EC9F0"))
    lay[y + 1, x - 1] = c("E0F2FF")


def scene_verb(yaku: str, tier: str) -> np.ndarray:
    img = layer()
    if yaku == "ikiru":
        sky = [c("2A1440"), c("5A1E4E"), c("A23A4A"), c("E2683E")]
        vgrad(img, 0, H - 1, [c("1E1030"), c("2E1636"), c("3E1C3A"), c("4A2236")])
        glow(img, W / 2, 80, 110, 64, c("FF8A3A"), (0.08, 0.12, 0.16))
        window_sky(img, sky)
        sun(img, W // 2, 26, 10)
    elif yaku == "yasumu":
        sky = [c("060A1E"), c("0C1430"), c("142044"), c("1C2C58")]
        vgrad(img, 0, H - 1, [c("0A0E22"), c("10162E"), c("161E3A"), c("1A2240")])
        glow(img, W / 2, 80, 110, 64, c("4A5AC8"), (0.08, 0.12, 0.16))
        window_sky(img, sky)
        st = layer()
        for x, y in ((48, 6), (60, 22), (80, 10), (118, 26), (140, 8), (150, 20), (98, 4)):
            st[y, x] = c("FFF2C0")
        sparkle(st, 128, 14, 2, SILVER)
        comp(img, st)
        moon(img, 92, 18, 10)
    else:
        sky = [c("2A2E3A"), c("383E4C"), c("464D5C"), c("545C6C")]
        vgrad(img, 0, H - 1, [c("1C1E26"), c("22252E"), c("282B34"), c("2C3038")])
        window_sky(img, sky)
        # 曇天：雲の塊
        cl = layer()
        for x, y, r in ((70, 22, 9), (84, 18, 11), (100, 22, 9), (118, 20, 10), (132, 24, 7)):
            ball(cl, x, y, r * 1.3, r * 0.75, [c("5A6070"), c("767E8E"), c("959CAA")])
        comp(img, cl)

    tatami(img, 122)
    lay = layer()
    if yaku == "ikiru":
        for x, h in ((34, 8), (52, 12), (150, 12), (168, 8)):
            sprout(lay, x, 122, h)
        person(lay, "cheer", W // 2, 141, 1.05)
    elif yaku == "yasumu":
        futon(lay, 44, 138)
    else:
        person(lay, "strain", W // 2, 141, 1.25)
    outline(lay)
    comp(img, lay)

    fx = layer()
    if yaku == "ikiru":
        for x, y, r in ((70, 108, 3), (130, 108, 3), (30, 40, 2), (172, 40, 2), (54, 98, 2), (146, 98, 2)):
            sparkle(fx, x, y, r)
    elif yaku == "yasumu":
        zzz(fx, 30, 108, 6, c("CFE0FF"))
        zzz(fx, 18, 96, 8, c("CFE0FF"))
        zzz(fx, 166, 104, 7, c("CFE0FF"))
    else:
        # 力みの線と汗。顔の外の記号が実寸での差の主役
        # 左右へ飛ぶ力みの線
        for x0, y0, x1, y1 in ((76, 116, 66, 112), (76, 122, 64, 122), (76, 128, 66, 132),
                               (124, 116, 134, 112), (124, 122, 136, 122), (124, 128, 134, 132)):
            put(fx, m_line([(x0, y0), (x1, y1)], 1), c("E8ECF4"))
        sweat(fx, 86, 106)
        sweat(fx, 115, 104)
        sweat(fx, 119, 111)
    outline(fx) if yaku == "yasumu" else None
    comp(img, fx)

    if tier == "reg":
        desat(img, 0.4)
    frame(img, tier)
    return img


# ---------------------------------------------------------------- 動物（katakana_animal）


def bubbles(lay: np.ndarray, pts, col: Color = c("BFEFFF")) -> None:
    for x, y, r in pts:
        ring = m_ellipse(x, y, r + 0.5, r + 0.5) & ~m_ellipse(x, y, r - 0.6, r - 0.6)
        put(lay, ring, col)
        lay[int(y - r * 0.4), int(x - r * 0.4)] = c("FFFFFF")


def reeds(lay: np.ndarray, x: int, y: int, n: int, flip=False) -> None:
    s = -1 if flip else 1
    for i in range(n):
        h = 26 + (i * 7) % 14
        bx = x + s * i * 4
        put(lay, m_line([(bx, y), (bx + s * 3, y - h // 2), (bx + s * 1, y - h)], 2),
            [c("2F6B48"), c("47986A"), c("3A7E52")][i % 3])


def catfish(lay: np.ndarray, cx: int, cy: int, L: int) -> None:
    """ナマズ。平たく幅広の頭・横に裂けた口・長い2対のひげ・腹に沿った長い尻びれ。左向き。"""
    ramp = [c("1E2018"), c("3A3C2A"), c("5A5A3C"), c("7E7A52")]
    headm = m_ellipse(cx - L * 0.27, cy + 1, L * 0.22, L * 0.14)
    body = m_poly([(cx - L * 0.3, cy - L * 0.1), (cx + L * 0.1, cy - L * 0.1), (cx + L * 0.42, cy - L * 0.03),
                   (cx + L * 0.42, cy + L * 0.04), (cx + L * 0.1, cy + L * 0.12), (cx - L * 0.3, cy + L * 0.14)])
    tail = m_poly([(cx + L * 0.4, cy), (cx + L * 0.52, cy - L * 0.09), (cx + L * 0.54, cy + L * 0.02),
                   (cx + L * 0.5, cy + L * 0.1)])
    dorsal = m_poly([(cx - L * 0.1, cy - L * 0.1), (cx - L * 0.05, cy - L * 0.15), (cx, cy - L * 0.1)])
    anal = m_poly([(cx - L * 0.02, cy + L * 0.11), (cx + L * 0.4, cy + L * 0.04), (cx + L * 0.4, cy + L * 0.09),
                   (cx, cy + L * 0.16)])
    pect = m_poly([(cx - L * 0.2, cy + L * 0.08), (cx - L * 0.1, cy + L * 0.17), (cx - L * 0.15, cy + L * 0.09)])
    fins = tail | dorsal | anal | pect
    bevel(lay, fins, [c("1E2018"), c("34362A"), c("4A4A36")])
    m = body | headm
    bevel(lay, m, ramp, depth=2)
    # 腹は細い帯だけ明るく
    put(lay, m & (YY >= cy + L * 0.09) & (XX < cx + L * 0.05), c("A8A07A"))
    # まだら
    rng = np.random.default_rng(5)
    for _ in range(int(L * 0.5)):
        px = int(rng.integers(int(cx - L * 0.4), int(cx + L * 0.4)))
        py = int(rng.integers(int(cy - L * 0.09), int(cy + L * 0.06)))
        if m[py, px]:
            put(lay, m_ellipse(px, py, 1.2, 0.8) & m, ramp[0])
    # 口・目
    mx = int(cx - L * 0.48)
    put(lay, m_line([(mx, cy + 4), (mx + 10, cy + 6)], 1), c("12120C"))
    put(lay, m_line([(mx + 1, cy + 3), (mx + 9, cy + 5)], 1), c("8A845E"))
    ex, ey = int(cx - L * 0.36), int(cy - 2)
    put(lay, m_rect(ex, ey, ex + 1, ey + 1), c("E8E4C8"))
    lay[ey + 1, ex] = OUTLINE
    # ひげ（上あごの長い1対、下あごの短い1対）
    wk = c("34362A")
    put(lay, m_line([(mx + 2, cy + 2), (mx - 8, cy - 6), (mx - 20, cy - 8), (mx - 26, cy - 4)], 1), wk)
    put(lay, m_line([(mx + 3, cy + 4), (mx - 8, cy + 9), (mx - 16, cy + 16)], 1), wk)
    put(lay, m_line([(mx + 5, cy + 6), (mx - 1, cy + 11), (mx - 3, cy + 15)], 1), wk)


def parakeet(lay: np.ndarray, x: int, y: int, body_ramp, face: Color, flip=False, s: float = 1.0) -> None:
    """セキセイインコ。x,y は止まる足元。s は大きさの倍率。"""
    d = -1 if flip else 1

    def P(dx: float, dy: float) -> tuple[float, float]:
        return (x + d * dx * s, y + dy * s)

    tail = m_poly([P(-2, -4), P(-9, 15), P(-5, 16), P(2, -2)])
    bevel(lay, tail, [c("1E3A6E"), c("2E5AA0"), c("4A7ED0")])
    body = m_ellipse(*P(0, -9), 7 * s, 10 * s)
    bevel(lay, body, body_ramp, depth=2)
    hc = P(2, -20)
    headm = m_ellipse(*hc, 6 * s, 6 * s)
    put(lay, headm, face)
    put(lay, headm & (XX * d < (hc[0] + d * 1) * d) & (YY < hc[1] + 2 * s), c(
        "%02X%02X%02X" % tuple(int(v * 0.82) for v in face[:3])))
    # 後頭部の細い横縞
    for k in range(-24, -15, 2):
        put(lay, headm & (YY == round(y + k * s)) & ((XX - hc[0]) * d < -1), c("3A3A30"))
    # 翼（黒の鱗模様）
    wing = m_ellipse(*P(-2.5, -8), 4.5 * s, 7.5 * s)
    put(lay, wing, body_ramp[2])
    put(lay, wing & ((YY + XX * 2) % 4 == 0), c("2A2A22"))
    put(lay, wing & ((YY + XX * 2) % 4 == 1), body_ramp[0])
    # くちばし・鼻（ろう膜）・目
    bx, by = P(7, -19)
    put(lay, m_poly([(bx, by - 1.5 * s), (bx + d * 3 * s, by + 0.5 * s), (bx, by + 2.5 * s)]), c("F2B04A"))
    put(lay, m_ellipse(bx - d * 0.5, by - 2 * s, 1.6 * s, 1.0 * s), c("4A6ED8"))
    ex, ey = P(4, -22)
    put(lay, m_ellipse(ex, ey, 1.3 * s, 1.3 * s), OUTLINE)
    lay[int(ey) - 1, int(ex)] = c("FFFFFF")
    # 喉の黒点
    for dx in (1, 4):
        tx, ty = P(dx, -15)
        put(lay, m_ellipse(tx, ty, 0.9 * s, 0.9 * s), c("1A1A40"))
    # 足
    for dx in (-2, 2):
        fx, fy = P(dx, 0)
        put(lay, m_rect(int(fx) - 1, int(fy) - 1, int(fx), int(fy) + 1), c("D89A86"))


def sea_cucumber(lay: np.ndarray, cx: int, cy: int, L: int) -> None:
    """ナマコ。少し反った太い筒に、背の円錐のいぼを並べる。"""
    ramp = [c("2A1E16"), c("4A3222"), c("6E4A30"), c("926A46")]
    m = np.zeros((H, W), bool)
    for i in range(13):
        t = i / 12
        x = cx - L / 2 + t * L
        y = cy - math.sin(t * math.pi) * 3
        r = L * (0.13 + 0.05 * math.sin(t * math.pi))
        m |= m_ellipse(x, y, r, r * 0.85)
    bevel(lay, m, ramp, depth=2)
    put(lay, m & (YY >= cy + L * 0.08), c("8A6A50"))  # 腹側の足（管足）の帯
    # 背のいぼ（円錐）
    for i in range(9):
        t = (i + 0.5) / 9
        x = cx - L / 2 + t * L
        top = cy - math.sin(t * math.pi) * 3 - L * (0.13 + 0.05 * math.sin(t * math.pi)) * 0.85
        cone = m_poly([(x - 2, top + 3), (x, top - 3), (x + 2, top + 3)])
        put(lay, cone, ramp[2])
        lay[int(top - 2), int(x)] = c("C8A07A")
    for i in range(14):
        px = int(cx - L * 0.42 + i * L * 0.062)
        py = int(cy - 1 + (i % 3) * 2)
        if m[py, px]:
            put(lay, m_ellipse(px, py, 1.1, 1.1) & m, ramp[3])
    # 口の触手
    hx = int(cx + L / 2)
    for dy in (-4, -1, 2):
        put(lay, m_line([(hx - 2, cy - 1), (hx + 4, cy + dy - 2)], 1), c("C8A07A"))


def paw_corners(img: np.ndarray, col: Color) -> None:
    """島の共通意匠：四隅の肉球。図鑑の枠のつもり。"""
    lay = layer()
    for x, y in ((14, 14), (W - 15, 14), (14, H - 15), (W - 15, H - 15)):
        put(lay, m_ellipse(x, y + 2, 3.5, 3), col)
        for dx, dy in ((-4, -3), (-1, -5), (2, -5), (5, -3)):
            put(lay, m_ellipse(x + dx - 0.5, y + dy, 1.4, 1.6), col)
    comp(img, lay)


def scene_animal(yaku: str, tier: str) -> np.ndarray:
    img = layer()
    if yaku == "namazu":
        vgrad(img, 0, H - 1, [c("2E6A72"), c("1E5058"), c("163E48"), c("10303A"), c("0C2630"), c("0A1E28")])
        glow(img, W / 2, 70, 110, 64, c("5AC8C8"), (0.06, 0.10, 0.14))
        # 水面のゆらぎ（上帯）
        sf = layer()
        for i, y in enumerate((3, 8, 14, 21)):
            for x in range(-10, W, 22):
                put(sf, m_rect(x + (i * 7) % 22, y, x + (i * 7) % 22 + 8 + i, y), c("9AE6E0", 200 - i * 40))
        comp(img, sf)
        # 光の柱
        for x0 in (40, 90, 150):
            tint(img, m_poly([(x0, 0), (x0 + 10, 0), (x0 + 30, H), (x0 + 14, H)]), c("9AE6E0"), 0.08)
        # 川底
        bed = layer()
        bevel(bed, m_ellipse(W / 2, H + 12, 130, 30), [c("2A2A1E"), c("4A4630"), c("6A6444")])
        for x, y, r in ((30, 134, 6), (64, 138, 5), (150, 136, 7), (176, 132, 5)):
            ball(bed, x, y, r * 1.4, r, [c("3A3E3A"), c("5A605A"), c("7E847A")])
        comp(img, bed)
        lay = layer()
        reeds(lay, 8, H - 4, 4)
        reeds(lay, W - 9, H - 4, 4, flip=True)
        catfish(lay, 108, 122, 120)
        outline(lay)
        comp(img, lay)
        b = layer()
        bubbles(b, ((40, 112, 2), (36, 102, 1.5), (44, 92, 3), (172, 108, 2), (168, 30, 3), (30, 28, 2)))
        comp(img, b)
    elif yaku == "inko":
        vgrad(img, 0, H - 1, [c("0E2A1A"), c("123422"), c("163E28"), c("12361F"), c("0E2A18")])
        glow(img, W / 2, 70, 110, 64, c("FFE066"), (0.06, 0.10, 0.14))
        # 上帯：垂れ下がる葉
        lv = layer()
        rng = np.random.default_rng(3)
        for i in range(22):
            x = int(rng.integers(0, W))
            ln = int(rng.integers(10, 30))
            if 60 < x < 140:
                ln = min(ln, 22)
            leaf = m_ellipse(x, ln / 2, 4 + (i % 3), ln / 2)
            bevel(lv, leaf, [c("1F5A2E"), c("2F8443"), c("4FB260"), c("8FDB8C")])
            put(lv, leaf & (XX == x), c("1F5A2E"))
        outline(lv)
        comp(img, lv)
        lay = layer()
        # 枝
        branch = m_line([(-2, 134), (60, 130), (120, 132), (202, 126)], 5)
        bevel(lay, branch, [c("3A2414"), c("5E3C20"), c("86582E"), c("A87A44")])
        for x, y in ((34, 128), (162, 124)):
            leaf = m_ellipse(x, y - 2, 6, 3)
            bevel(lay, leaf, [c("1F5A2E"), c("2F8443"), c("4FB260")])
        green = [c("2E7A2A"), c("4EA83A"), c("82D04A"), c("C2EE7A")]
        blue = [c("1E3A8E"), c("2E5AC0"), c("5A8AE8"), c("9ABCFF")]
        parakeet(lay, 78, 129, green, c("FFE45A"), s=1.3)
        parakeet(lay, 124, 129, blue, c("F4F4F4"), flip=True, s=1.3)
        outline(lay)
        comp(img, lay)
        sp = layer()
        # 羽根が舞う
        for x, y, col in ((30, 100, c("82D04A")), (168, 96, c("5A8AE8")), (100, 108, c("FFE45A"))):
            put(sp, m_line([(x, y), (x + 4, y - 3)], 2), col)
            sp[y - 3, x + 4] = c("FFFFFF")
        comp(img, sp)
    else:  # ナマコ（REG）：海底に1匹
        vgrad(img, 0, H - 1, [c("142838"), c("10202E"), c("0C1A26"), c("0A1620"), c("08121A")])
        sand = layer()
        bevel(sand, m_ellipse(W / 2, H + 14, 140, 34), [c("5A5040"), c("7A6E56"), c("9A8E72")])
        for i in range(40):
            x = (i * 37) % W
            y = 128 + (i * 13) % 14
            if sand[y, x, 3]:
                sand[y, x] = c("B0A486")
        comp(img, sand)
        lay = layer()
        rock = layer()
        ball(rock, 164, 128, 14, 9, [c("2A2E34"), c("3E444C"), c("565E68")])
        put(rock, m_line([(30, 134), (26, 120), (32, 108), (28, 98)], 3), c("2F5A40"))
        put(rock, m_line([(38, 134), (40, 122), (36, 112)], 2), c("3E7050"))
        outline(rock)
        comp(img, rock)
        sea_cucumber(lay, 100, 126, 64)
        outline(lay)
        comp(img, lay)
        b = layer()
        bubbles(b, ((136, 108, 1.5), (140, 98, 2)), c("8AA8B8"))
        comp(img, b)

    paw_corners(img, c("FFFFFF", 70) if tier == "big" else c("FFFFFF", 40))
    if tier == "big":
        sp = layer()
        for x, y, r in ((36, 40, 3), (164, 40, 3), (60, 104, 2), (146, 102, 2)):
            sparkle(sp, x, y, r)
        comp(img, sp)
    else:
        desat(img, 0.35)
    frame(img, tier)
    return img


# ---------------------------------------------------------------- セキュリティ（security）

TERM = [c("06100C"), c("0A1A12"), c("0E2418"), c("0A1A12")]


def term_bg(img: np.ndarray, accent: Color, tier: str) -> None:
    """共通の地：暗い端末、方眼、走査線、二進の雨。"""
    vgrad(img, 0, H - 1, TERM)
    tint(img, (XX % 10 == 0) | (YY % 10 == 0), accent, 0.10)
    rng = np.random.default_rng(11)
    rain = layer()
    for col in range(4, W, 8):
        if 30 < col < 170 and rng.random() < 0.6:
            continue
        y0 = int(rng.integers(-20, 60))
        for k in range(int(rng.integers(4, 12))):
            y = y0 + k * 5
            if 0 <= y < H - 4:
                bit = int(rng.integers(0, 2))
                a = 60 + k * 14
                cc = (accent[0], accent[1], accent[2], min(a, 200))
                if bit:
                    put(rain, m_rect(col, y, col, y + 3), cc)
                else:
                    put(rain, (m_rect(col - 1, y, col + 1, y + 3) & ~m_rect(col, y + 1, col, y + 2)), cc)
        comp(img, rain)
        rain = layer()
    tint(img, YY % 2 == 1, c("000000"), 0.18)  # 走査線


def bezel(img: np.ndarray, tier: str) -> None:
    """ブラウン管の角丸。四隅を黒で欠く。"""
    for x, y, sx, sy in ((0, 0, 1, 1), (W - 1, 0, -1, 1), (0, H - 1, 1, -1), (W - 1, H - 1, -1, -1)):
        for k in range(10):
            for j in range(10 - k):
                if k * k + j * j > 0 and (10 - k) ** 2 + (10 - j) ** 2 > 100:
                    img[y + sy * k, x + sx * j] = c("05060A")


def spy(lay: np.ndarray, x: int, y: int, flip=False) -> None:
    """トレンチコートと中折れ帽の影。サングラスだけ光る。x,y は足元。"""
    s = -1 if flip else 1
    coat = [c("0A0A10"), c("1A1A26"), c("2C2C3E"), c("44445E")]
    body = m_poly([(x - 10, y), (x - 8, y - 22), (x - 6, y - 30), (x + 6, y - 30), (x + 8, y - 22), (x + 11, y)])
    bevel(lay, body, coat)
    put(lay, m_line([(x - s * 1, y - 29), (x + s * 3, y - 14)], 1), c("0A0A10"))  # 打ち合わせ
    put(lay, m_rect(x - 9, y - 16, x + 9, y - 15), c("5A4A30"))  # ベルト
    collar = m_poly([(x - 6, y - 30), (x, y - 24), (x + 6, y - 30), (x + 7, y - 33), (x - 7, y - 33)])
    bevel(lay, collar, coat)
    head = m_ellipse(x + s * 1, y - 37, 5.5, 6)
    put(lay, head, c("A8806C"))
    put(lay, head & (XX * s > (x + s * 1) * s), c("7A5A4C"))
    # 帽子
    brim = m_rect(x - 10, y - 42, x + 10, y - 41)
    crown = m_poly([(x - 6, y - 42), (x - 5, y - 49), (x + 5, y - 49), (x + 6, y - 42)])
    bevel(lay, brim | crown, coat)
    put(lay, m_rect(x - 6, y - 44, x + 6, y - 43), c("6E1E26"))  # リボン
    # サングラス
    put(lay, m_rect(x + s * 1 - 5, y - 38, x + s * 1 + 5, y - 37), c("0A0A10"))
    lay[y - 38, x + s * 1 - 3] = c("8AF0FF")
    lay[y - 38, x + s * 1 + 2] = c("8AF0FF")


def searchlight(img: np.ndarray, x0: int, x1: int, ytop: int, col: Color, alpha: float) -> None:
    tint(img, m_poly([(x0 - 3, ytop), (x0 + 3, ytop), (x1 + 22, H), (x1 - 22, H)]), col, alpha)
    tint(img, m_ellipse(x1, H - 6, 26, 6), col, alpha)


def laser(img: np.ndarray, p0, p1, col: Color) -> None:
    put(img, m_line([p0, p1], 1), col)
    tint(img, m_line([p0, p1], 3) & ~m_line([p0, p1], 1), col, 0.35)


def worm(lay: np.ndarray, x: int, y: int, n: int, seg: int, ramp, flip=False) -> None:
    """コンピュータ・ワーム。角ばった節が波打って這う。頭に光る目と大顎。"""
    s = -1 if flip else 1
    pts = []
    for i in range(n):
        px = x - s * i * (seg - 1)
        py = y + round(math.sin(i * 0.9) * 3)
        pts.append((px, py))
    for i, (px, py) in reversed(list(enumerate(pts))):
        r = seg / 2 + (1.5 if i == 0 else 0) - i * 0.12
        m = m_rect(int(px - r), int(py - r), int(px + r), int(py + r))
        bevel(lay, m, ramp)
        # 節の上にビットの刻み
        if i > 0:
            lay[int(py), int(px)] = ramp[3] if i % 2 else ramp[0]
    hx, hy = pts[0]
    r = seg / 2 + 1.5
    put(lay, m_rect(int(hx + s * 1), int(hy - 3), int(hx + s * 3), int(hy - 2)), c("FF3A4A"))
    put(lay, m_rect(int(hx + s * 1), int(hy - 3), int(hx + s * 1), int(hy - 3)), c("FFD0D0"))
    jaw = m_poly([(hx + s * r, hy - 3), (hx + s * (r + 6), hy - 1), (hx + s * r, hy)]) | \
        m_poly([(hx + s * r, hy + 2), (hx + s * (r + 6), hy + 4), (hx + s * r, hy + 5)])
    put(lay, jaw, c("D8F0E0"))


def data_block(lay: np.ndarray, x: int, y: int, eaten: bool, col: Color) -> None:
    m = m_rect(x, y, x + 9, y + 9)
    if eaten:
        m &= ~m_ellipse(x + 10, y + 4, 5, 5)
    bevel(lay, m, [c("1A2A4A"), c("2A4A7A"), col, c("CFE6FF")])
    put(lay, m & ((YY - y) % 3 == 1) & (XX > x + 1) & (XX < x + 8), c("1A2A4A"))


def envelope(lay: np.ndarray, x: int, y: int, w: int, h: int, ramp, mark: Color | None) -> None:
    m = m_rect(x, y, x + w, y + h)
    bevel(lay, m, ramp)
    put(lay, m_line([(x, y), (x + w // 2, y + h * 0.55), (x + w, y)], 1), ramp[0])
    if mark is not None:
        mx, my = x + w - 2, y - 1
        put(lay, m_ellipse(mx, my, 3.5, 3.5), mark)
        put(lay, m_rect(mx, my - 2, mx, my), c("FFFFFF"))
        lay[my + 2, mx] = c("FFFFFF")


def scene_security(yaku: str, tier: str) -> np.ndarray:
    img = layer()
    if yaku == "spy":
        term_bg(img, c("3AFF8A"), tier)
        searchlight(img, 40, 150, 0, c("FFF2B0"), 0.16)
        searchlight(img, 160, 54, 0, c("FFF2B0"), 0.10)
        # 赤外線のセンサー（上帯と下帯だけ）
        for p0, p1 in (((0, 10), (W, 30)), ((0, 30), (W, 12)), ((0, 112), (W, 122))):
            laser(img, p0, p1, c("FF3A4A"))
        lay = layer()
        spy(lay, 150, 141)
        spy(lay, 50, 141, flip=True)
        outline(lay, c("000000"))
        comp(img, lay)
        # 鍵穴（上帯の中央）
        kh = layer()
        put(kh, m_ellipse(W / 2, 14, 7, 7) | m_poly([(W / 2 - 4, 16), (W / 2 + 4, 16), (W / 2 + 7, 33), (W / 2 - 7, 33)]), c("FFE58A"))
        put(kh, m_ellipse(W / 2, 14, 3.6, 3.6) | m_poly([(W / 2 - 1, 16), (W / 2 + 1, 16), (W / 2 + 3, 29), (W / 2 - 3, 29)]), c("06100C"))
        outline(kh)
        comp(img, kh)
    elif yaku == "worm":
        term_bg(img, c("3AFF8A"), tier)
        lay = layer()
        # 食われていくデータの列
        for i, x in enumerate(range(124, 190, 13)):
            data_block(lay, x, 118 + (i % 2) * 3, eaten=(i == 0), col=c("5A9AE8"))
        for x in range(20, 112, 6):  # 食べ跡の欠片
            lay[132 + (x % 3), x] = c("3A6A9A")
        worm(lay, 112, 124, 14, 9, [c("0E4A22"), c("1E8A3E"), c("3AD064"), c("A8FFB8")])
        outline(lay, c("000000"))
        comp(img, lay)
        # 上帯：破れたウィンドウ（警告）
        win = layer()
        for x0, x1, y0 in ((60, 140, 6),):
            box = m_rect(x0, y0, x1, y0 + 22)
            bevel(win, box, [c("2A0A10"), c("4A1220"), c("6A1A2C"), c("8A2A3C")])
            put(win, m_rect(x0, y0, x1, y0 + 4), c("D8303C"))
            for k in range(3):
                put(win, m_rect(x0 + 8 + k * 26, y0 + 9, x0 + 22 + k * 26, y0 + 10), c("FF8A9C"))
                put(win, m_rect(x0 + 8 + k * 26, y0 + 14, x0 + 18 + k * 26, y0 + 15), c("FF8A9C"))
            bite = m_ellipse(x1, y0 + 16, 9, 9) | m_ellipse(x1 - 8, y0 + 22, 6, 6)
            win[bite] = (0, 0, 0, 0)
            put(win, m_rect(x1 - 12, y0 + 1, x1 - 9, y0 + 3), c("FFFFFF"))
        outline(win)
        comp(img, win)
        # 小さなワームが窓をかじる
        sm = layer()
        worm(sm, 152, 22, 6, 5, [c("0E4A22"), c("1E8A3E"), c("3AD064"), c("A8FFB8")], flip=True)
        outline(sm, c("000000"))
        comp(img, sm)
    else:  # スパム（REG）：受信箱に溜まる封筒
        term_bg(img, c("8AA0B0"), tier)
        lay = layer()
        mail = [c("5A6070"), c("9AA0B0"), c("C8CCD8"), c("EEF0F6")]
        for i, (x, y) in enumerate(((70, 126), (90, 128), (110, 126), (80, 118), (100, 117), (90, 110))):
            envelope(lay, x, y, 18, 11, mail, c("D84A4A") if i == 5 else None)
        outline(lay, c("000000"))
        comp(img, lay)
        # 上帯：未読の数
        # 上帯：受信箱のアイコンに未読の赤い「！」
        bd = layer()
        envelope(bd, W // 2 - 14, 8, 28, 18, mail, None)
        put(bd, m_ellipse(W / 2 + 14, 9, 7, 7), c("B03A3A"))
        put(bd, m_rect(W // 2 + 13, 5, W // 2 + 14, 10), c("FFFFFF"))
        put(bd, m_rect(W // 2 + 13, 12, W // 2 + 14, 13), c("FFFFFF"))
        outline(bd)
        comp(img, bd)

    bezel(img, tier)
    if tier == "big":
        sp = layer()
        for x, y, r in ((24, 44, 2), (176, 44, 2), (20, 100, 2), (180, 98, 2)):
            sparkle(sp, x, y, r)
        comp(img, sp)
    else:
        desat(img, 0.5)
    frame(img, tier)
    return img


# ---------------------------------------------------------------- 八百屋（yasai）

CRATE = [c("4A2C14"), c("7A4E26"), c("A8743A"), c("D0A060")]


def awning(img: np.ndarray, tier: str) -> None:
    """八百屋の日除け。縞を縦に、裾を波形に切る。"""
    a, b = (c("2E8A3E"), c("F4F0E2")) if tier == "big" else (c("4E6A54"), c("C8C8C0"))
    lay = layer()
    m = m_rect(0, 0, W - 1, 22)
    for x in range(0, W, 14):
        scal = m_ellipse(x + 7, 22, 7, 5)
        m |= scal
    stripe = ((XX // 14) % 2 == 0)
    put(lay, m & stripe, a)
    put(lay, m & ~stripe, b)
    tint(lay, m & (YY >= 18), c("000000"), 0.22)
    put(lay, m & (YY <= 1), c("FFFFFF"))
    outline(lay)
    comp(img, lay)


def crate(lay: np.ndarray, x0: int, x1: int, y: int) -> None:
    """木箱の前板。y は上端。"""
    m = m_rect(x0, y, x1, H - 1)
    bevel(lay, m, CRATE)
    for yy in range(y + 6, H, 6):
        put(lay, m & (YY == yy), CRATE[0])
    put(lay, m & ((XX == x0 + 2) | (XX == x1 - 2)), CRATE[1])


def pile(lay: np.ndarray, x0: int, x1: int, ybase: int, r: float, fruit, rows=3, seed=0) -> None:
    """果物の山。奥（上段）から描いて手前で重ねる。1個ずつ輪郭を付けて粒を立たせる。"""
    rng = np.random.default_rng(seed)
    for row in range(rows - 1, -1, -1):
        y = ybase - row * r * 1.25
        inset = row * r * 0.9
        x = x0 + inset + r
        while x <= x1 - inset - r + 0.1:
            one = layer()
            fruit(one, x + rng.uniform(-0.6, 0.6), y)
            outline(one)
            comp(lay, one)
            x += r * 1.9


def lychee(lay, x, y, r=7):
    """ライチ。赤い殻に亀甲のいぼ。輪郭も少しぎざぎざに。"""
    m = ball(lay, x, y, r, r * 1.05, [c("5E1018"), c("962030"), c("C83A44"), c("E86A5A")])
    hexes = ((XX % 3 == 0) & (YY % 3 == 0)) | ((XX % 3 == 1) & (YY % 3 == 2))
    put(lay, m & hexes & (lay[..., 0] > 0x90), c("7A1824"))
    put(lay, m & shift(hexes, 1, 1) & (YY < y) & (XX < x), c("FFA08A"))
    edge = m & ~shift(m, 0, -1) & ((XX + YY) % 2 == 0)
    lay[edge] = (0, 0, 0, 0)
    put(lay, m_rect(int(x) - 1, int(y - r) - 1, int(x), int(y - r)), c("4A3018"))  # 軸


def lychee_peeled(lay, x, y, r=8):
    """むいたライチ。半透明の白い実と、下に残る赤い殻。"""
    cup = m_ellipse(x, y + r * 0.35, r + 2, r * 0.8) & (YY > y + 1)
    bevel(lay, cup, [c("5E1018"), c("962030"), c("C83A44")])
    ball(lay, x, y - 1, r, r, [c("B8B4AE"), c("DAD6D0"), c("F2EFEA"), c("FFFFFF")], c("FFFFFF"))
    put(lay, m_ellipse(x + r * 0.3, y + r * 0.2, r * 0.25, r * 0.35), c("C8C2BA"))


def plum(lay, x, y, r=9):
    """プラム。濃い紫の実に縦の溝と白い粉（ブルーム）、上に小さな窪み。"""
    m = ball(lay, x, y, r, r * 0.92, [c("2A0E3A"), c("461A5C"), c("6E2C88"), c("9A4EB0")])
    groove = m_line([(x + 1, y - r + 2), (x + 2, y), (x + 1, y + r - 3)], 1) & m
    put(lay, groove, c("2E1040"))
    put(lay, shift(groove, -1, 0) & m & ~groove, c("A868C0"))
    put(lay, m_ellipse(x - r * 0.45, y - r * 0.35, r * 0.35, r * 0.25), c("C8A8D8"))
    put(lay, m_ellipse(x - r * 0.45, y - r * 0.35, r * 0.35, r * 0.25) & ((XX + YY) % 2 == 0), c("E0CCE8"))
    put(lay, m_rect(int(x), int(y - r * 0.92) - 2, int(x), int(y - r * 0.92)), c("4A3018"))


def lime(lay, x, y, r=6.5):
    ball(lay, x, y, r * 1.1, r, [c("2A5A1A"), c("3E8226"), c("62AA3A"), c("9AD268")])
    lay[int(y), int(x + r)] = c("2A5A1A")


def lime_slice(lay, x, y, r=8):
    put(lay, m_ellipse(x, y, r, r), c("3E8226"))
    put(lay, m_ellipse(x, y, r - 1, r - 1), c("E6F2B0"))
    put(lay, m_ellipse(x, y, r - 2, r - 2), c("A6D24A"))
    for i in range(8):
        a = i * math.pi / 4
        put(lay, m_line([(x, y), (x + math.cos(a) * (r - 2), y + math.sin(a) * (r - 2))], 1), c("E6F2B0"))


def leaf(lay, x, y, ang, L=9):
    tip = (x + math.cos(ang) * L, y + math.sin(ang) * L)
    mid = (x + math.cos(ang) * L / 2, y + math.sin(ang) * L / 2)
    nx, ny = -math.sin(ang) * 3, math.cos(ang) * 3
    m = m_poly([(x, y), (mid[0] + nx, mid[1] + ny), tip, (mid[0] - nx, mid[1] - ny)])
    bevel(lay, m, [c("1F5A2E"), c("2F8443"), c("4FB260"), c("8FDB8C")])


def price_tag(lay, x, y, col: Color):
    m = m_poly([(x, y), (x + 14, y), (x + 14, y + 9), (x, y + 9)])
    bevel(lay, m, [c("8A7A50"), c("E8DEC4"), c("FFF8E6")])
    put(lay, m_rect(x + 3, y + 3, x + 11, y + 4), col)
    put(lay, m_rect(x + 3, y + 6, x + 8, y + 6), col)


def scene_yasai(yaku: str, tier: str) -> np.ndarray:
    img = layer()
    warm = {"raichi": c("FF7A6A"), "puramu": c("C87AE8"), "reg": c("A6D24A")}[yaku]
    vgrad(img, 0, H - 1, [c("201410"), c("2A1A12"), c("321F14"), c("2A1A12")])
    # 店の奥の棚の影（縦板）
    tint(img, (XX % 24 < 2) & (YY > 22), c("000000"), 0.25)
    glow(img, W / 2, 74, 110, 60, warm, (0.06, 0.10, 0.14))
    # 裸電球
    for x in (40, 160) if tier == "big" else (100,):
        glow(img, x, 30, 30, 24, c("FFD27A"), (0.08, 0.14, 0.2))
        bl = layer()
        put(bl, m_rect(x, 22, x, 26), c("2A2A2A"))
        ball(bl, x, 30, 3.5, 4, [c("E0A040"), c("FFD27A"), c("FFF2C0"), c("FFFFFF")])
        outline(bl)
        comp(img, bl)
    awning(img, tier)

    lay = layer()
    if yaku == "raichi":
        crate(lay, 22, 98, 124)
        crate(lay, 102, 178, 124)
        pile(lay, 24, 96, 121, 7, lychee, rows=2, seed=1)
        pile(lay, 104, 176, 121, 7, lychee, rows=2, seed=2)
        lychee_peeled(lay, 100, 114, 9)
        leaf(lay, 30, 112, -2.6)
        leaf(lay, 170, 112, -0.5)
        price_tag(lay, 8, 112, c("D24448"))
        price_tag(lay, 178, 112, c("D24448"))
    elif yaku == "puramu":
        crate(lay, 22, 98, 124)
        crate(lay, 102, 178, 124)
        pile(lay, 24, 96, 120, 9, plum, rows=2, seed=3)
        pile(lay, 104, 176, 120, 9, plum, rows=2, seed=4)
        leaf(lay, 30, 112, -2.6)
        leaf(lay, 170, 112, -0.5)
        price_tag(lay, 8, 112, c("7A3290"))
        price_tag(lay, 178, 112, c("7A3290"))
    else:  # ライム（REG）：ざる1つ
        basket = m_ellipse(100, 134, 30, 10) & (YY >= 128)
        bevel(lay, basket, [c("6E5228"), c("9A7838"), c("C8A458")])
        put(lay, basket & ((XX + YY) % 3 == 0), c("6E5228"))
        pile(lay, 72, 128, 127, 6.5, lime, rows=2, seed=5)
        lime_slice(lay, 140, 124, 9)
        price_tag(lay, 178, 112, c("62AA3A"))
    outline(lay)
    comp(img, lay)

    if tier == "big":
        sp = layer()
        for x, y, r in ((22, 44, 2), (178, 44, 2), (60, 100, 3), (140, 100, 3)):
            sparkle(sp, x, y, r)
        comp(img, sp)
    else:
        desat(img, 0.4)
    frame(img, tier)
    return img


# ---------------------------------------------------------------- 書き出し

ISLANDS = {
    "hiragana_food": (scene_food, [("shake", "big"), ("tarako", "big"), ("reg", "reg")]),
    "hiragana_verb": (scene_verb, [("ikiru", "big"), ("yasumu", "big"), ("reg", "reg")]),
    "katakana_animal": (scene_animal, [("namazu", "big"), ("inko", "big"), ("reg", "reg")]),
    "security": (scene_security, [("spy", "big"), ("worm", "big"), ("reg", "reg")]),
    "yasai": (scene_yasai, [("raichi", "big"), ("puramu", "big"), ("reg", "reg")]),
}


def render(chapter: str, yaku: str) -> Image.Image:
    fn, roles = ISLANDS[chapter]
    tier = dict(roles)[yaku]
    arr = fn(yaku, tier)
    arr[..., 3] = 255
    im = Image.fromarray(arr, "RGBA").convert("RGB")
    return im.resize((W * SCALE, H * SCALE), Image.NEAREST)


WORDS = {
    ("hiragana_food", "shake"): "しゃけ", ("hiragana_food", "tarako"): "たらこ", ("hiragana_food", "reg"): "しゃこ",
    ("hiragana_verb", "ikiru"): "いきる", ("hiragana_verb", "yasumu"): "やすむ", ("hiragana_verb", "reg"): "いきむ",
    ("katakana_animal", "namazu"): "ナマズ", ("katakana_animal", "inko"): "インコ", ("katakana_animal", "reg"): "ナマコ",
    ("security", "spy"): "スパイ", ("security", "worm"): "ワーム", ("security", "reg"): "スパム",
    ("yasai", "raichi"): "ライチ", ("yasai", "puramu"): "プラム", ("yasai", "reg"): "ライム",
}
FONT = "/System/Library/Fonts/ヒラギノ角ゴシック W8.ttc"


def with_text(im: Image.Image, word: str, tier: str) -> Image.Image:
    """確認用。ゲームと同じ位置に見出しと3文字を仮に重ねる（液晶幅600のときの寸法）。

    本物はドット文字だが、ここでは文字の占める面積と、地が読みを邪魔しないかだけ見る。
    3文字の後ろを沈める楕円（.premium-cutin-symbols::before）も同じ形で再現する。
    """
    from PIL import ImageFont

    im = im.convert("RGBA")
    w, h = im.size
    # 見出し 300×~60、間 14、3文字 162×125 を3つ（間24）。縦に積んで中央寄せ
    lab_h, gap, sw, sh, sg = 60, 14, 162, 125, 24
    top = (h - (lab_h + gap + sh)) // 2
    sy = top + lab_h + gap
    total = sw * 3 + sg * 2
    sx = (w - total) // 2
    # 3文字の後ろの暗い楕円
    shade = Image.new("RGBA", im.size, (0, 0, 0, 0))
    ex0, ey0 = sx - total * 0.10, sy - sh * 0.14
    ew, eh = total * 1.2, sh * 1.28
    a = np.zeros((h, w), np.float32)
    yy, xx = np.mgrid[0:h, 0:w]
    r = np.sqrt(((xx - (ex0 + ew / 2)) / (ew * 0.58)) ** 2 + ((yy - (ey0 + eh / 2)) / (eh * 0.62)) ** 2)
    a = np.where(r < 0.52, 0.88 - (0.28 * r / 0.52), np.where(r < 0.78, 0.6 * (0.78 - r) / 0.26, 0))
    shade_arr = np.zeros((h, w, 4), np.uint8)
    shade_arr[..., 3] = (a * 255).astype(np.uint8)
    im.alpha_composite(Image.fromarray(shade_arr, "RGBA"))
    dr = ImageDraw.Draw(im)
    f_sym = ImageFont.truetype(FONT, 110)
    f_lab = ImageFont.truetype(FONT, 44)
    label = "REGULAR!" if tier == "reg" else "PREMIUM!"
    gold = (255, 215, 90) if tier == "big" else (220, 226, 236)
    dr.text((w // 2, top + lab_h // 2), label, font=f_lab, fill=gold, anchor="mm",
            stroke_width=4, stroke_fill=(20, 17, 28))
    for i, ch in enumerate(word):
        cx = sx + i * (sw + sg) + sw // 2
        dr.text((cx, sy + sh // 2), ch, font=f_sym, fill=(255, 255, 255), anchor="mm",
                stroke_width=6, stroke_fill=(20, 17, 28))
    return im.convert("RGB")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="島（章ID）を絞る")
    ap.add_argument("--out", type=pathlib.Path, default=OUT_DIR)
    ap.add_argument("--sheet", type=pathlib.Path, help="確認用：15枚を並べた一覧（文字の位置に枠）")
    ap.add_argument("--text", action="store_true", help="一覧に見出しと3文字を仮に重ねる")
    args = ap.parse_args()

    args.out.mkdir(parents=True, exist_ok=True)
    tiles = []
    for chapter, (_, roles) in ISLANDS.items():
        if args.only and chapter != args.only:
            continue
        for yaku, _ in roles:
            im = render(chapter, yaku)
            path = args.out / f"{chapter}_{yaku}.png"
            im.save(path, optimize=True)
            print(f"→ {path.relative_to(ROOT) if path.is_relative_to(ROOT) else path}")
            tier = dict(roles)[yaku]
            tiles.append(with_text(im, WORDS[(chapter, yaku)], tier) if args.text else im)
    if args.sheet and tiles:
        k = 3 if args.only else 2
        tw, th = W * k, H * k
        cols = 1 if args.only else 3
        rows = (len(tiles) + cols - 1) // cols
        sheet = Image.new("RGB", (cols * (tw + 6) + 6, rows * (th + 6) + 6), (20, 18, 28))
        dr = ImageDraw.Draw(sheet)
        for i, t in enumerate(tiles):
            x = 6 + (i % cols) * (tw + 6)
            y = 6 + (i // cols) * (th + 6)
            sheet.paste(t.resize((tw, th), Image.NEAREST), (x, y))
            if not args.text:
                x0, y0, x1, y1 = TEXT_BOX
                dr.rectangle([x + x0 * k, y + y0 * k, x + x1 * k, y + y1 * k], outline=(255, 0, 255))
        sheet.save(args.sheet)
        print(f"一覧 → {args.sheet}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
