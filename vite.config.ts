/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

/**
 * GitHub Pages 公開時、URL は https://tukiguti.github.io/mojislot-web/ になるため
 * base をリポジトリ名に合わせる。dev/preview 時もこの base が使われる。
 *
 * build.rollupOptions.output.manualChunks で pixi.js を別チャンクに分離し、
 * アプリ本体の差分更新時にキャッシュが効くようにする。
 *
 * test: 会員カードのコーデック/マージ等の単体テスト（node 環境・Web Crypto はグローバル）。
 */
export default defineConfig({
  base: '/mojislot-web/',
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
