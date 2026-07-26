/**
 * ビルド時に vite.config.ts の `define` が差し替える定数。
 * コミットSHA（未コミットの変更があれば `+dirty` 付き）。
 * package.json の version と違い**ビルドごとに変わる**ので、戦績から
 * 「どのコードで出した記録か」を一意に辿れる。
 */
declare const __BUILD_ID__: string;
