import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  YakuListSchema,
  ReelConfigSchema,
  QuizListSchema,
  StopTableSchema,
  SECOND_STOP_ORDERS,
  THIRD_STOP_FINALS,
  type InternalRoleKind,
  type Yaku,
  type YakuCategory,
} from '../../src/data/schemas';
import { CHAPTERS } from '../../src/data/chapters';
import { ISLANDS } from '../../src/data/machines';
import { QUIZMASTERS } from '../../src/data/quizmasters';
import QUIZMASTER_LINES from '../../data/quizmaster-lines.json';

/**
 * data/ の JSON どうしの参照を一括で検証する。
 *
 * スキーマは1ファイルの形しか見ないので、**ファイルをまたぐ参照**（クイズの答え→役、
 * 停止テーブルの行→内部役、章ID→各ディレクトリのファイル など）はここで見る。
 * 参照先が消えたまま動くと、引けない役が黙って既定制御に落ちたり、出ない問題が残ったりする。
 * 1ファイルの中の参照（displayYakuId・carry）もスキーマと二重に見る——どれが壊れたかを
 * 章と参照元つきで一覧にしたいので。
 */

const DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(DIR, '../..');
const DATA = `${ROOT}/data`;
const readJson = (p: string) => JSON.parse(readFileSync(p, 'utf-8'));

/** 章ごとに data/ の中で1ファイルずつ持つディレクトリ。 */
const PER_CHAPTER_DIRS = ['reels', 'yaku', 'quizzes', 'stops'] as const;

/** 内部役の種別 → displayYakuId が指してよい役の種別。 */
const KIND_CATEGORY: Partial<Record<InternalRoleKind, YakuCategory>> = {
  core: 'core',
  cherry: 'cherry',
  reg: 'bonus',
  big: 'premium',
  chance: 'chance',
};

/** クイズの答え・はずれの選択肢になってよい役（名前のある役。1枚役と目印揃いは除く）。 */
const QUIZ_CATEGORIES: readonly YakuCategory[] = ['core', 'cherry', 'bonus', 'premium'];

const chapterIds = CHAPTERS.map((c) => c.id);

function load(chapter: (typeof CHAPTERS)[number]) {
  return {
    yaku: YakuListSchema.parse(chapter.yakuData),
    reels: ReelConfigSchema.parse(chapter.reelData),
    quizzes: QuizListSchema.parse(chapter.quizData),
    stops: StopTableSchema.parse(readJson(`${DATA}/stops/${chapter.id}.json`)),
  };
}

describe('data/ の参照', () => {
  it('章IDと data/ の各ディレクトリのファイルが一対一', () => {
    for (const dir of PER_CHAPTER_DIRS) {
      const files = readdirSync(`${DATA}/${dir}`)
        .filter((f) => f.endsWith('.json'))
        .map((f) => f.replace(/\.json$/, ''))
        .sort();
      expect(files, `data/${dir}`).toEqual([...chapterIds].sort());
    }
    expect(new Set(chapterIds).size, '章IDの重複').toBe(chapterIds.length);
  });

  it('出題者・台詞・島の章IDが実在する', () => {
    const lineKeys = Object.keys(QUIZMASTER_LINES).filter((k) => k !== 'dataVersion');
    expect(lineKeys.sort(), 'quizmaster-lines.json の章').toEqual([...chapterIds].sort());
    for (const id of Object.keys(QUIZMASTERS)) {
      expect(chapterIds, `出題者 ${id}`).toContain(id);
    }
    for (const island of ISLANDS) {
      for (const id of [...island.chapterIds, island.artChapterId]) {
        expect(chapterIds, `島 ${island.id} の章`).toContain(id);
      }
    }
  });

  for (const chapter of CHAPTERS) {
    // 1ファイルの形が壊れていると参照は見られないので、その章はスキーマの失敗だけを出す
    // （ここで投げるとファイル全体が読み込めず、どの章が壊れたか分からなくなる）。
    let loaded: ReturnType<typeof load> | Error;
    try {
      loaded = load(chapter);
    } catch (e) {
      loaded = e instanceof Error ? e : new Error(String(e));
    }
    describe(chapter.id, () => {
      it('各ファイルがスキーマを通る', () => {
        if (loaded instanceof Error) throw loaded;
      });
      if (loaded instanceof Error) return;
      const { yaku, reels, quizzes, stops } = loaded;
      const all: Yaku[] = [
        ...yaku.coreYaku,
        ...yaku.premiumYaku,
        ...yaku.bonusYaku,
        ...yaku.cherryYaku,
        ...yaku.singleYaku,
        ...yaku.chanceYaku,
      ];
      const byId = new Map(all.map((y) => [y.id, y]));
      const roleIds = yaku.internalRoles.map((r) => r.id);

      it('各ファイルの mode が章ID', () => {
        expect(yaku.mode).toBe(chapter.id);
        expect(reels.mode).toBe(chapter.id);
        expect(quizzes.mode).toBe(chapter.id);
        expect(stops.mode).toBe(chapter.id);
      });

      it('役IDと内部役IDが重複しない', () => {
        expect(byId.size, '役ID').toBe(all.length);
        expect(new Set(roleIds).size, '内部役ID').toBe(roleIds.length);
      });

      it('内部役の displayYakuId・carry が種別に合う役を指す', () => {
        const bad: string[] = [];
        for (const role of yaku.internalRoles) {
          const want = KIND_CATEGORY[role.kind];
          const shown = role.displayYakuId ? byId.get(role.displayYakuId) : undefined;
          if (want && shown?.category !== want) {
            bad.push(`${role.id}: displayYakuId ${role.displayYakuId} は ${want} の役でない`);
          }
          if (!want && role.displayYakuId !== null) {
            bad.push(`${role.id}: ${role.kind} は displayYakuId を持たない`);
          }
          if (role.carry !== null) {
            const c = byId.get(role.carry)?.category;
            if (c !== 'bonus' && c !== 'premium') bad.push(`${role.id}: carry ${role.carry} がボーナスの役でない`);
          }
        }
        expect(bad).toEqual([]);
      });

      it('役の図柄がそのリールの配列にあり、目印が全リールにある', () => {
        const bad: string[] = [];
        for (const y of all) {
          y.symbols.forEach((sym, i) => {
            if (!reels.reels[i]?.cells.includes(sym)) bad.push(`${y.id}: リール${i}に「${sym}」が無い`);
          });
        }
        if (reels.landmark !== undefined) {
          reels.reels.forEach((r, i) => {
            if (!r.cells.includes(reels.landmark!)) bad.push(`目印「${reels.landmark}」がリール${i}に無い`);
          });
        }
        expect(bad).toEqual([]);
      });

      it('cutinArt の絵が public/art にある', () => {
        const missing = all
          .filter((y) => y.cutinArt !== undefined)
          .filter((y) => !existsSync(`${ROOT}/public/art/${y.cutinArt}`))
          .map((y) => `${y.id}: ${y.cutinArt}`);
        expect(missing).toEqual([]);
      });

      it('クイズの答えと選択肢が実在する役を指す', () => {
        const bad: string[] = [];
        const qids = quizzes.quizzes.map((q) => q.id);
        if (new Set(qids).size !== qids.length) bad.push('クイズIDの重複');
        for (const q of quizzes.quizzes) {
          for (const id of [q.answerYakuId, ...q.decoyYakuIds]) {
            const c = byId.get(id)?.category;
            if (!c || !QUIZ_CATEGORIES.includes(c)) bad.push(`${q.id}: ${id} が答えにできる役でない`);
          }
          const choices = new Set([q.answerYakuId, ...q.decoyYakuIds]);
          if (choices.size !== 4) bad.push(`${q.id}: 選択肢が重複している`);
        }
        expect(bad).toEqual([]);
      });

      it('停止テーブルの行が内部役と一対一', () => {
        const sorted = [...roleIds].sort();
        expect(Object.keys(stops.firstStop).sort(), 'firstStop').toEqual(sorted);
        for (const [name, t] of [
          ['secondStop', stops.secondStop],
          ['bonusSecondStop', stops.bonusSecondStop],
        ] as const) {
          for (const key of SECOND_STOP_ORDERS) {
            expect(Object.keys(t?.[key] ?? {}).sort(), `${name}.${key}`).toEqual(sorted);
          }
        }
        for (const [name, t] of [
          ['thirdStop', stops.thirdStop],
          ['bonusThirdStop', stops.bonusThirdStop],
        ] as const) {
          for (const key of THIRD_STOP_FINALS) {
            expect(Object.keys(t?.[key] ?? {}).sort(), `${name}.${key}`).toEqual(sorted);
          }
        }
      });
    });
  }
});
