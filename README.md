# mojislot-web

3文字の日本語（ひらがな/カタカナ/漢字）を作り出すパチスロ風ゲームの **Web プロトタイプ**。ビタ押し（±33ms）で役を狙う技術主軸ゲーム。

## 特徴

- ひらがな/カタカナ/漢字/下ネタなど複数モード
- 役駆動設計：1モード10〜30役 + プレミアム1役
- ジャグラー風ボーナス：プレミアム成立 → 特定役連鎖
- パチスロ実機相当の±33ms ビタ押し判定

## 技術スタック

- **Vite** + **TypeScript**
- **Pixi.js v8**（ゲーム画面のレンダリング）
- **DOM + CSS**（UI レイヤ）
- **Zod**（JSONスキーマバリデーション）
- **LocalStorage**（セーブ）
- **Vitest**（ユニットテスト）

## 開発

```bash
npm install
npm run dev      # 開発サーバ
npm run build    # 本番ビルド
npm run preview  # ビルド成果物のローカル確認
npm test         # Vitest によるユニットテスト
```

## ディレクトリ構成

```
src/
├── main.ts          # エントリーポイント（Pixi 初期化 + DOM 接続）
├── core/            # 描画非依存のゲームロジック（Phase 5 で C# に移植）
├── productions/     # 演出スケジューラ（描画非依存）
├── render/          # Pixi 描画層
├── ui/              # DOM UI 層
├── meta/            # 図鑑・解放・セーブ
├── data/            # JSON ロード + Zod 検証
└── lib/             # 汎用ユーティリティ

data/                # ゲームデータ（JSON）★mojislot-unity と同期
assets/              # 画像・音声・動画
tests/               # Vitest によるユニットテスト
```

## 関連リポジトリ

- **`mojislot-unity`**: 同ゲームの Unity 移植版（Phase 5 で作成予定）
- データ同期: `data/` 配下の JSON は `mojislot-unity/Assets/Data/` と手動コピーで同期

## 企画ドキュメント

詳細な設計は `zikken/playground/japanese-slot-plan/` で管理：
https://github.com/tukiguti/zikken/tree/main/playground/japanese-slot-plan

## ライセンス

未定（リリース時に決定）
