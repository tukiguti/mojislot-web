#!/usr/bin/env python3
"""作成した音源（FLAC）を配信用の m4a へ変換して public/audio/ に置く。

    python3 tools/convert_sounds.py ~/Downloads/mojislot-sounds

**元素材の FLAC はリポジトリに入れない**（20本で 39MB あり、Git には重すぎる）。
変換後は 2.8MB 前後に収まる。素材そのものは別途保管しておくこと——ここにあるのは
配信用の劣化コピーで、作り直しには元の FLAC が要る。

変換は macOS 標準の afconvert（gen_voice.py と同じく ffmpeg は入れない）。
BGM はステレオのまま 128kbps、SE も 128kbps。ボイス（48kbps モノラル）より
高いのは、SE の立ち上がりと BGM の帯域を潰すと安っぽくなるため。

**BGM は頭と尻の無音がゼロで作られている**（ループ用）。AAC はエンコーダ遅延で
先頭に無音が入るが、再生側（BgmEngine）がデコード後のバッファから実データ範囲を
検出して loopStart/loopEnd に入れるので、つなぎ目は残らない。
"""

from __future__ import annotations

import pathlib
import subprocess
import sys

# 元のファイル名（日本語）→ 出力先。URL に日本語を載せないためスラッグへ変える。
BGM: dict[str, str] = {
    "BGMチルい1": "chill",
    "BGMノリチル1": "norichill",
    "BGM爽やか": "fresh",
    "BGMノリノリ明るい": "bright",
    "BGMサイバーノリノリ": "cyber",
}

SFX: dict[str, str] = {
    "レバーオン": "lever",
    "ウェイト": "wait",
    "コイン1枚獲得": "coin",
    "計数": "count",
    "演出発生弱": "start_weak",
    "演出発生弱1": "start_weak2",
    "演出発生強": "start_strong",
    "演出クリア弱": "clear_weak",
    "演出クリア強": "clear_strong",
    "演出クリア強2": "clear_strong2",
    "演出失敗": "fail",
    "ビッグボーナス": "big",
    "ビッグボーナス2": "big2",
    "REGボーナス": "reg",
    "フリーズ発生": "freeze",
}

BITRATE = 128000


def convert(src: pathlib.Path, dst: pathlib.Path) -> int:
    dst.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        ["afconvert", "-f", "m4af", "-d", "aac", "-b", str(BITRATE), str(src), str(dst)],
        check=True,
    )
    return dst.stat().st_size


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 1
    src_dir = pathlib.Path(sys.argv[1]).expanduser()
    out = pathlib.Path(__file__).resolve().parent.parent / "public" / "audio"

    total = 0
    missing: list[str] = []
    for kind, table in (("bgm", BGM), ("sfx", SFX)):
        for name, slug in table.items():
            src = src_dir / f"{name}.flac"
            if not src.exists():
                missing.append(name)
                continue
            size = convert(src, out / kind / f"{slug}.m4a")
            total += size
            print(f"  {kind}/{slug}.m4a  {size / 1024:6.1f} KB  <- {name}.flac")

    print(f"合計 {total / 1024 / 1024:.2f} MB")
    if missing:
        print("見つからなかった素材: " + ", ".join(missing))
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
