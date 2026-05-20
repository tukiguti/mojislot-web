/**
 * 章（モード）の定義。
 * 各章は独自の reel/yaku/quiz データを持つ。
 * localStorage で現在の章を保存し、起動時に該当章のデータを読み込む。
 */

import hiraganaFoodReel from '../../data/reels/hiragana_food.json';
import hiraganaFoodYaku from '../../data/yaku/hiragana_food.json';
import hiraganaFoodQuiz from '../../data/quizzes/hiragana_food.json';
import katakanaAnimalReel from '../../data/reels/katakana_animal.json';
import katakanaAnimalYaku from '../../data/yaku/katakana_animal.json';
import katakanaAnimalQuiz from '../../data/quizzes/katakana_animal.json';

export interface ChapterBundle {
  id: string;
  name: string;
  description: string;
  reelData: unknown;
  yakuData: unknown;
  quizData: unknown;
}

export const CHAPTERS: readonly ChapterBundle[] = [
  {
    id: 'hiragana_food',
    name: 'ひらがな食べ物',
    description: 'いちご・みかん・お寿司など。プレミアムは「すしや」',
    reelData: hiraganaFoodReel,
    yakuData: hiraganaFoodYaku,
    quizData: hiraganaFoodQuiz,
  },
  {
    id: 'katakana_animal',
    name: 'カタカナ動物',
    description: 'コアラ・キリン・パンダなど。プレミアムは「ドラゴン」',
    reelData: katakanaAnimalReel,
    yakuData: katakanaAnimalYaku,
    quizData: katakanaAnimalQuiz,
  },
];

const STORAGE_KEY = 'mojislot.chapter.v1';

export function getCurrentChapterId(): string {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && CHAPTERS.some((c) => c.id === stored)) return stored;
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
