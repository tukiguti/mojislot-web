import { CHAPTERS } from '../data/chapters';

/**
 * 会員カードがスナップショット/復元する localStorage キーの集約（SSoT）。
 * 各キーの正本は元のモジュール（PlayStats/ZukanState/Challenges/Member 等）にあるが、
 * カードのバックアップ対象を一望できるようここに列挙する。値は変更しない。
 */

/** 章別 zukan キー以外の固定キー。 */
export const FIXED_KEYS = {
  stats: 'mojislot.stats.v1',
  bita: 'mojislot.bita.v1',
  challenges: 'mojislot.challenges.v1',
  challengesEnabled: 'mojislot.challengesEnabled.v1',
  chapter: 'mojislot.chapter.v1',
  secretUnlocked: 'mojislot.secretUnlocked.v1',
  reelGlyphs: 'reelShowGlyphs',
  zukanMissionsCollapsed: 'mojislot.zukanMissionsCollapsed.v1',
  memberId: 'mojislot.memberId.v1',
  memberName: 'mojislot.memberName.v1',
  runHistory: 'mojislot.runHistory.v1',
} as const;

/** runHistory はマージ対象なので「置換」キー集合からは除外する。 */
export const RUN_HISTORY_KEY = FIXED_KEYS.runHistory;

/** 章別図鑑キー（`mojislot.zukan.v1.{chapterId}`）。隠し章含む全章を対象にする。 */
export function zukanKeys(): string[] {
  return CHAPTERS.map((c) => `mojislot.zukan.v1.${c.id}`);
}

/** カードが対象とする全 localStorage キー（固定 + 章別 zukan）。 */
export function allCardKeys(): string[] {
  return [...Object.values(FIXED_KEYS), ...zukanKeys()];
}
