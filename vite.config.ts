/// <reference types="vitest/config" />
import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';

/**
 * ビルドを一意に識別するID。package.json の version は手で上げない限り変わらず、
 * 「どのビルドで出した記録か」を戦績から追えないため、コミットSHAを埋め込む。
 * 未コミットの変更がある状態でビルドしたら `+dirty` を付けて区別する
 * （手元ビルドの記録が本番の記録に混ざっても見分けられるように）。
 * Git が無い環境（配布物からの再ビルド等）では 'unknown' になる。
 */
function resolveBuildId(): string {
  try {
    const sha = execSync('git rev-parse --short HEAD', {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
    const dirty =
      execSync('git status --porcelain', {
        stdio: ['ignore', 'pipe', 'ignore'],
      })
        .toString()
        .trim().length > 0;
    return dirty ? `${sha}+dirty` : sha;
  } catch {
    return 'unknown';
  }
}

/**
 * 公開先が2系統あるため base を環境で切り替える:
 * - Cloudflare Pages (slot.tukiguti.com): ルート配信なので '/'（CF_PAGES はビルド環境に自動設定される）
 * - GitHub Pages (https://tukiguti.github.io/mojislot-web/): リポジトリ名がパスに入るため '/mojislot-web/'
 * dev/preview 時も GitHub Pages 側の base が使われる。
 *
 * build.rollupOptions.output.manualChunks で pixi.js を別チャンクに分離し、
 * アプリ本体の差分更新時にキャッシュが効くようにする。
 *
 * test: 会員カードのコーデック/マージ等の単体テスト（node 環境・Web Crypto はグローバル）。
 */
export default defineConfig({
  base: process.env.CF_PAGES ? '/' : '/mojislot-web/',
  define: {
    __BUILD_ID__: JSON.stringify(resolveBuildId()),
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
  build: {
    // pixi 単体で 500KB を超えるため警告閾値を引き上げる
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/pixi.js') || id.includes('node_modules/@pixi/')) {
            return 'pixi';
          }
        },
      },
    },
  },
});
