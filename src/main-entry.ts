import { Router, showView } from './router/Router';
import type { Route } from './router/Router';
import { bootstrap } from './main';
import { mountTopView } from './ui/TopView';
import { mountPlaySetup } from './ui/PlaySetup';
import { renderRankingView } from './ui/RankingView';
import { renderCardView } from './ui/CardView';

/**
 * アプリ起点。hash ルータでビューを出し分ける。
 * - 非ゲームビュー（TOP/遊ぶ/ランキング/会員カード）は reload なしの DOM 切替。
 * - ゲームは「台選択後に1回だけ bootstrap()」。Pixi 起動済みで非ゲームへ移る時は
 *   teardown を自前実装せず location.reload で安全に破棄する（計画 §2）。
 */
let gameStarted = false;

function enter(route: Route): void {
  if (route === 'game') {
    showView('game');
    if (!gameStarted) {
      gameStarted = true;
      bootstrap().catch((err) => console.error('bootstrap failed:', err));
    }
    return;
  }
  // Pixi 起動済みで非ゲームへ → クリーンに戻すため reload（hash は設定済み）
  if (gameStarted) {
    location.reload();
    return;
  }
  // ランキングは表示のたびに最新の runHistory を読み直して再描画する
  if (route === 'ranking') {
    renderRankingView({
      onBack: () => router.navigate('top'),
      onPlay: () => router.navigate('play'),
    });
  }
  // 会員カードも表示のたびに現在の会員名で再描画する
  if (route === 'card') {
    renderCardView({ onBack: () => router.navigate('top') });
  }
  showView(route);
}

const router = new Router(enter);

mountTopView({
  onPlay: () => router.navigate('play'),
  onCard: () => router.navigate('card'),
  onRanking: () => router.navigate('ranking'),
});

mountPlaySetup({
  onLaunch: () => {
    // PLAY→GAME は素の状態から bootstrap したいので reload 起動
    location.hash = '#/game';
    location.reload();
  },
  onBack: () => router.navigate('top'),
});

// ゲーム内「TOPへ」: gameStarted=true なので enter() が reload で破棄して戻す
document
  .getElementById('home-btn')
  ?.addEventListener('click', () => router.navigate('top'));

router.start();
