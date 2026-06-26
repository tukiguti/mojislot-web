# mojislot-web

3文字の日本語（ひらがな/カタカナ/漢字）を作り出すパチスロ風ゲームの **Web プロトタイプ**。ビタ押し（既定 ±12ms・`data/tuning` で調整可）で役を狙う、技術介入が主軸のゲーム。

## 特徴

- ひらがな/カタカナ/漢字/下ネタ（h_adult）など複数の章（モード）
- 役駆動設計：1章あたり コア4役＋チェリー＋RB＋プレミアム（7揃い／バー揃い）
- **BIG/REG 二段ボーナス**（実機ジャグラーのオマージュ）。出玉の山はボーナス中の **コンボ（連チャン）** に寄せ、目押し成功で連を伸ばす設計
- 演出：突入の **溜め** ／ **フリーズ**（倍速回転→順次7揃い）／ **確定告知ランプ**（点灯=ボーナス確定・種別は伏せて目押し回収）／ **連チャン昇格**（2/5/8/12連で段階昇格）／ 狙え・クイズ（ビタ押し権）
- 出現確率・演出レート・目押し補助・フリーズ・確定ランプ等の調整値は **`data/tuning/default.json`** に集約（データ駆動で調整容易）
- パチスロ実機相当のビタ押し判定（既定 ±12ms）

## 技術スタック

- **Vite** + **TypeScript**
- **Pixi.js v8**（ゲーム画面のレンダリング）
- **DOM + CSS**（UI レイヤ・演出オーバーレイ）
- **Zod**（JSONスキーマバリデーション）
- **LocalStorage**（セーブ／カード）
- **Vitest**（ユニットテスト）

## 開発

```bash
npm install
npm run dev      # 開発サーバ
npm run build    # 本番ビルド（tsc + vite）
npm run preview  # ビルド成果物のローカル確認
npm test         # Vitest によるユニットテスト
```

## ディレクトリ構成

```
src/
├── main.ts          # エントリーポイント（Pixi 初期化 + DOM 接続・ゲーム進行）
├── core/            # 描画非依存のゲームロジック（ReelEngine/YakuJudge/PayoutCalc/Paylines）
├── productions/     # 演出ロジック（EffectScheduler/BonusZone/SlipResolver/TenpaiDetector 等）
├── render/          # Pixi 描画層（ReelView/EffectVisual/JinView 等）
├── ui/              # DOM UI 層（Effects/SettingsOverlay/QuizOverlay 等）
├── card/            # 図鑑・統計・セーブ（カード）のコーデック/管理
├── audio/           # 効果音・BGM（Web Audio 合成）
├── router/          # 画面ルーティング
├── data/            # JSON ロード + Zod 検証（schemas/chapters）
└── lib/             # 汎用ユーティリティ（Observable 等）

data/                # ゲームデータ（JSON・Zod 検証）
├── reels/           # 章ごとのリール配列（21コマ×3）
├── yaku/            # 章ごとの役定義
├── quizzes/         # 章ごとのクイズ
├── payouts/         # 配当（default.json）
└── tuning/          # 演出レート・補助・フリーズ・確定ランプ等の調整値（default.json）

public/art/          # 画像（カットイン・図柄・狙え等の webp）
tests/               # Vitest によるユニットテスト
```

## 企画ドキュメント

詳細な設計は `zikken/playground/mojislot-plan/` で管理：
https://github.com/tukiguti/zikken/tree/main/playground/mojislot-plan

## ライセンス

未定（リリース時に決定）
