#!/usr/bin/env python3
"""出題者5人のボイスを VOICEVOX で生成する。

使い方:
    VOICEVOX.app を起動してから
    python3 tools/gen_voice.py                 # 全員ぶん生成
    python3 tools/gen_voice.py hiragana_food   # 1人だけ
    python3 tools/gen_voice.py --wav-only      # m4a へ変換せず wav で残す（音の確認用）

**台詞は `data/quizmaster-lines.json` を読む**。ゲーム側（`src/data/quizmasters.ts`）が
同じファイルを読むので、字幕と声がずれない。ここに台詞を直書きしてはいけない。

出力は `public/audio/quizmaster/<章ID>/<場面>_<添字>.m4a`。添字は JSON の配列の位置と
そろえてある——ゲームは台詞を選んだ添字でそのままファイルを引く。

## 声の割り当て

人ごとに話者を変える（島ごとに別人なので声も別人）。**場面ごとにスタイルも変える**——
同じ話者の喜び・悲しみを使うと、声の同一性を保ったまま感情が乗る。
スタイルが1つしかない話者はそのまま使う。

前提:
  - VOICEVOX のローカルAPI（既定 http://127.0.0.1:50021）が生きていること
  - 変換は macOS 標準の afconvert（ffmpeg は入れない）。wav のままだと1本100KB近い
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
ROOT = pathlib.Path(__file__).resolve().parent.parent
LINES_JSON = ROOT / "data" / "quizmaster-lines.json"
OUT_ROOT = ROOT / "public" / "audio" / "quizmaster"

SCENES = ("ask", "correct", "wrong", "near")

# 章ID → (話者の名前, {場面: スタイルID})。IDは `GET /speakers` の styles[].id。
VOICES: dict[str, tuple[str, dict[str, int]]] = {
    # 寿司屋の大将（50代・威勢がいい）。豪快な低音。スタイルは1つ
    "hiragana_food": ("麒ヶ島宗麟", {"ask": 53, "correct": 53, "wrong": 53, "near": 53}),
    # 動物園の飼育員（20代・快活）。喜び／悲しみが揃っている
    "katakana_animal": ("玄野武宏", {"ask": 11, "correct": 39, "wrong": 41, "near": 41}),
    # 国語の教師（30代女性・丁寧）。落ち着いた成人女性
    "hiragana_verb": ("WhiteCUL", {"ask": 23, "correct": 24, "wrong": 25, "near": 25}),
    # 八百屋の店主（40代・声が大きい）。出題から熱血で押す
    "yasai": ("青山龍星", {"ask": 81, "correct": 83, "wrong": 85, "near": 85}),
    # セキュリティエンジニア（30代・ぼそぼそ）。抑えた低音。スタイルは1つ
    "security": ("雀松朱司", {"ask": 52, "correct": 52, "wrong": 52, "near": 52}),
}


def post(path: str, params: dict[str, object], body: bytes | None = None) -> bytes:
    url = f"{HOST}{path}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, data=body or b"", method="POST")
    if body is not None:
        req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=60) as res:
        return res.read()


def synth(text: str, speaker: int, *, question: bool) -> bytes:
    """音声クエリ → 合成。クエリを挟むのは速度や抑揚を触れるようにするため。"""
    query = json.loads(post("/audio_query", {"speaker": speaker, "text": text}))
    # 少しゆっくりにする。液晶の文字を読みながら聞くので、素の速度だと
    # 読み終える前に喋り終わってしまう。
    query["speedScale"] = 0.95
    return post(
        "/synthesis",
        {"speaker": speaker, "enable_interrogative_upspeak": str(question).lower()},
        json.dumps(query).encode("utf-8"),
    )


def to_m4a(wav: pathlib.Path, m4a: pathlib.Path) -> None:
    """AAC(m4a)へ。48kbps モノラルで、短い台詞なら1本15KB前後に収まる。"""
    subprocess.run(
        ["afconvert", "-f", "m4af", "-d", "aac", "-b", "48000",
         "--mix", "-c", "1", str(wav), str(m4a)],
        check=True,
        capture_output=True,
    )


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("chapters", nargs="*", help="生成する章ID（既定は全員）")
    ap.add_argument("--wav-only", action="store_true", help="m4a へ変換せず wav を残す")
    args = ap.parse_args()

    try:
        with urllib.request.urlopen(f"{HOST}/version", timeout=5) as res:
            version = res.read().decode("utf-8").strip()
    except (urllib.error.URLError, TimeoutError):
        print(f"VOICEVOX に繋がりません（{HOST}）。VOICEVOX.app を起動してください。",
              file=sys.stderr)
        return 1
    print(f"VOICEVOX {version}")

    all_lines = json.loads(LINES_JSON.read_text(encoding="utf-8"))
    targets = args.chapters or list(VOICES)
    total = 0
    for chapter in targets:
        if chapter not in VOICES:
            raise SystemExit(f"{chapter} の声が未割り当て（{', '.join(VOICES)}）")
        name, styles = VOICES[chapter]
        out_dir = OUT_ROOT / chapter
        out_dir.mkdir(parents=True, exist_ok=True)
        print(f"{chapter}（{name}）")
        for scene in SCENES:
            for i, text in enumerate(all_lines[chapter][scene]):
                wav = out_dir / f"{scene}_{i}.wav"
                wav.write_bytes(synth(text, styles[scene], question=scene == "ask"))
                if args.wav_only:
                    size = wav.stat().st_size
                else:
                    m4a = out_dir / f"{scene}_{i}.m4a"
                    to_m4a(wav, m4a)
                    wav.unlink()
                    size = m4a.stat().st_size
                total += size
                print(f"  {scene}_{i}  {size / 1024:6.1f} KB  「{text}」")
    print(f"合計 {total / 1024:.1f} KB → {OUT_ROOT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
