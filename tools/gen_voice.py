#!/usr/bin/env python3
"""コトハのボイスを VOICEVOX で生成する。

コトハはクイズの出題者（設計: 14章 / 33章）。出題・正解・不正解の3場面で喋る。
台詞は「上達応援型」——落としたのはプレイヤーなので、責めずに一緒に残念がる。

使い方:
    VOICEVOX.app を起動してから
    python3 tools/gen_voice.py            # 生成して public/audio/kotoha/ へ
    python3 tools/gen_voice.py --wav-only # m4a へ変換せず wav のまま残す（音の確認用）

前提:
  - VOICEVOX のローカルAPI（既定 http://127.0.0.1:50021）が生きていること
  - 変換は macOS 標準の afconvert（ffmpeg は入れない）。wav のままだと1本100KB近くあり、
    9本で1MB近い。スロットの初期ロードは5MB以下が目安なので、ここは削っておく。
"""

from __future__ import annotations

import argparse
import json
import pathlib
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request

HOST = "http://127.0.0.1:50021"

# 冥鳴ひまり（ノーマル）。`GET /speakers` の styles[].id が話者ID。
SPEAKER = 14

OUT_DIR = pathlib.Path(__file__).resolve().parent.parent / "public" / "audio" / "kotoha"

# 場面ごとに3パターン。毎回同じだと2回目から耳に障るので振る。
# 出題は問いかけなので語尾を上げる（enable_interrogative_upspeak）。
LINES: dict[str, list[tuple[str, str]]] = {
    "ask": [
        ("ask_1", "問題です！"),
        ("ask_2", "これ、わかるかな？"),
        ("ask_3", "いくよ、集中して！"),
    ],
    "correct": [
        ("correct_1", "正解！さすがだね！"),
        ("correct_2", "やったね！"),
        ("correct_3", "うんうん、その調子！"),
    ],
    "wrong": [
        ("wrong_1", "あー、惜しい！"),
        ("wrong_2", "残念。次いこう！"),
        ("wrong_3", "うーん、おしかったね"),
    ],
}


def post(path: str, params: dict[str, object], body: bytes | None = None) -> bytes:
    url = f"{HOST}{path}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, data=body or b"", method="POST")
    if body is not None:
        req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=60) as res:
        return res.read()


def synth(text: str, *, question: bool) -> bytes:
    """音声クエリ → 合成。クエリを挟むのは速度や抑揚を触れるようにするため。"""
    query = json.loads(post("/audio_query", {"speaker": SPEAKER, "text": text}))
    # 少しゆっくり・気持ち高めにする。液晶の文字を読みながら聞くので、
    # 素の速度だと出題文を読み終える前に喋り終わってしまう。
    query["speedScale"] = 0.95
    query["pitchScale"] = 0.02
    return post(
        "/synthesis",
        {"speaker": SPEAKER, "enable_interrogative_upspeak": str(question).lower()},
        json.dumps(query).encode("utf-8"),
    )


def to_m4a(wav: pathlib.Path, m4a: pathlib.Path) -> None:
    """AAC(m4a)へ。48kbps モノラルで、短い台詞なら1本10KB前後に収まる。"""
    subprocess.run(
        ["afconvert", "-f", "m4af", "-d", "aac", "-b", "48000",
         "--mix", "-c", "1", str(wav), str(m4a)],
        check=True,
        capture_output=True,
    )


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--wav-only", action="store_true", help="m4a へ変換せず wav を残す")
    args = ap.parse_args()

    try:
        with urllib.request.urlopen(f"{HOST}/version", timeout=5) as res:
            version = res.read().decode("utf-8").strip()
    except (urllib.error.URLError, TimeoutError):
        print(f"VOICEVOX に繋がりません（{HOST}）。VOICEVOX.app を起動してください。",
              file=sys.stderr)
        return 1
    print(f"VOICEVOX {version} / speaker={SPEAKER}（冥鳴ひまり）")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    total = 0
    for scene, items in LINES.items():
        for name, text in items:
            wav = OUT_DIR / f"{name}.wav"
            wav.write_bytes(synth(text, question=scene == "ask"))
            if args.wav_only:
                size = wav.stat().st_size
            else:
                m4a = OUT_DIR / f"{name}.m4a"
                to_m4a(wav, m4a)
                wav.unlink()
                size = m4a.stat().st_size
            total += size
            print(f"  {name:<10} {size / 1024:6.1f} KB  「{text}」")
    print(f"合計 {total / 1024:.1f} KB → {OUT_DIR}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
