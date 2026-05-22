import { defineConfig } from 'vite';

/**
 * GitHub Pages 公開時、URL は https://tukiguti.github.io/mojislot-web/ になるため
 * base をリポジトリ名に合わせる。dev/preview 時もこの base が使われる。
 */
export default defineConfig({
  base: '/mojislot-web/',
});
