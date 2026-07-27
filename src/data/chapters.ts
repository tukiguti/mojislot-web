/**
 * 章（モード）の定義。
 * 各章は独自の reel/yaku/quiz データを持つ。
 * localStorage で現在の章を保存し、起動時に該当章のデータを読み込む。
 *
 * 隠し章（hidden: true）は通常の設定画面では非表示。
 * 解除フラグ（unlockSecret）が立つと表示されるようになる。
 */

import hiraganaFoodReel from '../../data/reels/hiragana_food.json';
import hiraganaFoodYaku from '../../data/yaku/hiragana_food.json';
import hiraganaFoodQuiz from '../../data/quizzes/hiragana_food.json';
import hiraganaFoodStops from '../../data/stops/hiragana_food.json';
import hiraganaFoodReach from '../../data/reach/hiragana_food.json';
import katakanaAnimalReel from '../../data/reels/katakana_animal.json';
import katakanaAnimalYaku from '../../data/yaku/katakana_animal.json';
import katakanaAnimalQuiz from '../../data/quizzes/katakana_animal.json';
import katakanaAnimalStops from '../../data/stops/katakana_animal.json';
import katakanaAnimalReach from '../../data/reach/katakana_animal.json';
import hiraganaVerbReel from '../../data/reels/hiragana_verb.json';
import hiraganaVerbYaku from '../../data/yaku/hiragana_verb.json';
import hiraganaVerbQuiz from '../../data/quizzes/hiragana_verb.json';
import hiraganaVerbStops from '../../data/stops/hiragana_verb.json';
import hiraganaVerbReach from '../../data/reach/hiragana_verb.json';
import yasaiReel from '../../data/reels/yasai.json';
import yasaiYaku from '../../data/yaku/yasai.json';
import yasaiQuiz from '../../data/quizzes/yasai.json';
import yasaiStops from '../../data/stops/yasai.json';
import yasaiReach from '../../data/reach/yasai.json';
import securityReel from '../../data/reels/security.json';
import securityYaku from '../../data/yaku/security.json';
import securityQuiz from '../../data/quizzes/security.json';
import securityStops from '../../data/stops/security.json';
import securityReach from '../../data/reach/security.json';

export interface ChapterBundle {
  id: string;
  name: string;
  description: string;
  reelData: unknown;
  yakuData: unknown;
  quizData: unknown;
  /** 停止テーブル（第1停止）。実機のリール制御表に相当。 */
  stopData: unknown;
  /** リーチ目表（ボーナスフラグでしか出ない出目）。 */
  reachData: unknown;
  /** true の章は、解除フラグが立つまで設定画面で非表示 */
  hidden?: boolean;
}

export const CHAPTERS: readonly ChapterBundle[] = [
  {
    id: 'hiragana_food',
    name: 'ひらがな食べ物',
    description: 'ぶどう・とうふ・だんごなど。チェリーは「もも」、REGは「いなご」、BIGは「いなり」「まぐろ」',
    reelData: hiraganaFoodReel,
    yakuData: hiraganaFoodYaku,
    quizData: hiraganaFoodQuiz,
    stopData: hiraganaFoodStops,
    reachData: hiraganaFoodReach,
  },
  {
    id: 'katakana_animal',
    name: 'カタカナ動物',
    description: 'ウサギ・キリン・タヌキなど。チェリーは「サイ」、REGは「ナマコ」、BIGは「ナマズ」「インコ」',
    reelData: katakanaAnimalReel,
    yakuData: katakanaAnimalYaku,
    quizData: katakanaAnimalQuiz,
    stopData: katakanaAnimalStops,
    reachData: katakanaAnimalReach,
  },
  {
    id: 'hiragana_verb',
    name: 'ひらがな動詞',
    description: 'うたう・あそぶ・およぐなど。チェリーは「ねる」、REGは「いきむ」、BIGは「いきる」「やすむ」',
    reelData: hiraganaVerbReel,
    yakuData: hiraganaVerbYaku,
    quizData: hiraganaVerbQuiz,
    stopData: hiraganaVerbStops,
    reachData: hiraganaVerbReach,
  },
  {
    id: 'yasai',
    name: 'カタカナ八百屋',
    description: 'オクラ・モヤシ・セロリなど。チェリーは「ナス」、REGは「ライム」、BIGは「ライチ」「プラム」',
    reelData: yasaiReel,
    yakuData: yasaiYaku,
    quizData: yasaiQuiz,
    stopData: yasaiStops,
    reachData: yasaiReach,
  },
  {
    id: 'security',
    name: 'セキュリティ',
    description: 'ハック・ソルト・ダンプなど。チェリーは「バグ」、REGは「スパム」、BIGは「スパイ」「ワーム」',
    reelData: securityReel,
    yakuData: securityYaku,
    quizData: securityQuiz,
    stopData: securityStops,
    reachData: securityReach,
  },
];

const STORAGE_KEY = 'mojislot.chapter.v1';
const SECRET_UNLOCK_KEY = 'mojislot.secretUnlocked.v1';

export function getCurrentChapterId(): string {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && CHAPTERS.some((c) => c.id === stored)) {
      // 隠し章だった場合、解除されていなければデフォルトに戻す
      const ch = CHAPTERS.find((c) => c.id === stored);
      if (ch?.hidden && !isSecretUnlocked()) return CHAPTERS[0].id;
      return stored;
    }
  } catch {
    /* ignore */
  }
  return CHAPTERS[0].id;
}

export function setCurrentChapterId(id: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* ignore */
  }
}

export function getCurrentChapter(): ChapterBundle {
  const id = getCurrentChapterId();
  return CHAPTERS.find((c) => c.id === id) ?? CHAPTERS[0];
}

// === 隠し章の解除フラグ ===

export function isSecretUnlocked(): boolean {
  try {
    return localStorage.getItem(SECRET_UNLOCK_KEY) === '1';
  } catch {
    return false;
  }
}

export function setSecretUnlocked(v: boolean): void {
  try {
    if (v) localStorage.setItem(SECRET_UNLOCK_KEY, '1');
    else localStorage.removeItem(SECRET_UNLOCK_KEY);
  } catch {
    /* ignore */
  }
}

/** 設定画面に表示可能な章一覧（隠し章は解除時のみ含まれる） */
export function getVisibleChapters(): readonly ChapterBundle[] {
  const unlocked = isSecretUnlocked();
  return CHAPTERS.filter((c) => !c.hidden || unlocked);
}
