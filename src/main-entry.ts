import { Router, showView } from './router/Router';
import type { Route } from './router/Router';
import { bootstrap } from './main';
import { mountHallView } from './ui/HallView';
import { renderCounterRanking } from './ui/CounterRanking';
import { renderCounterCard } from './ui/CounterCard';

/**
 * アプリ起点。hash ルータでビューを出し分ける。
 * - **起点はホールの入口**。独立したTOPメニューは置かない（遊ぶ・会員カード・
 *   ランキングの3導線はすべて入口に出ているので、手前にもう1枚挟む意味が無い）。
 * - 非ゲームビュー（ホール/ランキング/会員カード）は reload なしの DOM 切替。
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
  // 景品カウンターの2画面は、表示のたびに最新の履歴・会員名で描き直す。
  // 「戻る」は入口ではなくカウンター前（＝寄っていた場所の引きの絵）へ返す。
  if (route === 'ranking') {
    renderCounterRanking({
      onBack: () => {
        hall.showCounter('rank');
        router.navigate('play');
      },
      onPlay: () => router.navigate('play'),
    });
  }
  if (route === 'card') {
    renderCounterCard({
      onBack: () => {
        hall.showCounter('card');
        router.navigate('play');
      },
    });
  }
  showView(route);
}

const router = new Router(enter);

// enter() から showCounter を呼ぶので参照を持っておく。
// enter() が実際に走るのは router.start() 以降なので、この時点で未初期化にはならない。
const hall = mountHallView({
  onLaunch: () => {
    // PLAY→GAME は素の状態から bootstrap したいので reload 起動
    location.hash = '#/game';
    location.reload();
  },
  onCard: () => router.navigate('card'),
  onRanking: () => router.navigate('ranking'),
});

// ゲーム内「ホールへ」: gameStarted=true なので enter() が reload で破棄して戻す
document
  .getElementById('home-btn')
  ?.addEventListener('click', () => router.navigate('play'));

router.start();
