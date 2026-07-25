import { describe, expect, it } from 'vitest';
import { EffectEligibility } from '../../src/productions/EffectEligibility';
import type { Quiz, ShisaTier, YakuList } from '../../src/data/schemas';

/**
 * 演出は必ず本当に当たっている内部役を指す、という約束の検証。
 *
 * 示唆の色も吹き出しの候補役も当選役から逆算して出しているので、
 * 「派手なのに最初から当たっていない」ガセが構造的に起きない。
 * ここが壊れると、当たり得ない役が候補に並ぶ／指せない役に演出が付く、
 * といった静かに信頼を削る壊れ方をする。
 */

const yaku = (id: string, category: string, symbols: string[]) => ({
  id,
  name: id,
  symbols,
  category,
});

const role = (
  id: string,
  displayYakuId: string | null,
  rate: { default: number; bonus: number; rescue: number },
) => ({ id, displayYakuId, rate });

const YAKU: YakuList = {
  coreYaku: [
    yaku('grape', 'core', ['ぶ', 'ど', 'う']),
    yaku('tofu', 'core', ['と', 'う', 'ふ']),
  ],
  premiumYaku: [yaku('sushiya', 'premium', ['す', 'し', 'や'])],
  bonusYaku: [yaku('sushida', 'bonus', ['す', 'し', 'だ'])],
  cherryYaku: [yaku('momo', 'cherry', ['も', 'も'])],
  singleYaku: [yaku('one', 'single', ['と', 'ふ', 'ん'])],
  internalRoles: [
    role('r_grape', 'grape', { default: 1, bonus: 1, rescue: 1 }),
    // 通常時だけ出る役。ボーナス中の候補には並んではいけない。
    role('r_tofu', 'tofu', { default: 1, bonus: 0, rescue: 1 }),
    role('r_sushiya', 'sushiya', { default: 1, bonus: 1, rescue: 1 }),
    role('r_momo', 'momo', { default: 1, bonus: 1, rescue: 1 }),
    // 表示役を持たない内部役（1枚役のこぼし等）は候補にならない。
    role('r_miss', null, { default: 1, bonus: 1, rescue: 1 }),
  ],
} as unknown as YakuList;

const TIERS: ShisaTier[] = [
  { color: 'blue', weight: 3, targets: ['core', 'cherry'] },
  { color: 'gold', weight: 1, targets: ['premium'] },
];

const QUIZZES: Quiz[] = [
  { id: 'q1', question: 'ぶどう?', answerYakuId: 'grape' },
] as unknown as Quiz[];

const el = new EffectEligibility({
  yakuList: YAKU,
  quizzes: QUIZZES,
  shisaTiers: TIERS,
  reelCount: 3,
});

const find = (id: string) =>
  [
    ...YAKU.coreYaku,
    ...YAKU.premiumYaku,
    ...YAKU.bonusYaku,
    ...YAKU.cherryYaku,
    ...YAKU.singleYaku,
  ].find((y) => y.id === id)!;

describe('EffectEligibility', () => {
  it('示唆の色はその役のカテゴリを含む tier だけ', () => {
    expect(el.tiersFor(find('grape')).map((t) => t.color)).toEqual(['blue']);
    expect(el.tiersFor(find('sushiya')).map((t) => t.color)).toEqual(['gold']);
    // どの tier の targets にも入っていないカテゴリ（bonus）は示唆で指せない
    expect(el.tiersFor(find('sushida'))).toEqual([]);
  });

  it('クイズは答えがその役になる問題がある時だけ出せる', () => {
    expect(el.canRepresent('quiz', find('grape'))).toBe(true);
    expect(el.canRepresent('quiz', find('tofu'))).toBe(false);
  });

  it('「狙え」は3文字揃いの役だけ指せる', () => {
    expect(el.canRepresent('aim', find('grape'))).toBe(true);
    // チェリー（2文字役）は狙えで指せない
    expect(el.canRepresent('aim', find('momo'))).toBe(false);
  });

  it('表現できる演出が無い役では演出を出さない（空配列）', () => {
    // すしだ: 示唆の色なし・クイズなし・3文字なので狙えのみ
    expect(el.eligibleEffects(find('sushida'))).toEqual(['aim']);
    // もも: 示唆(blue)は出せるが、クイズも狙えも不可
    expect(el.eligibleEffects(find('momo'))).toEqual(['shisa']);
  });

  it('候補役はその色で当たりうるものだけを並べる', () => {
    const blue = el.candidatesFor(TIERS[0], 'default').map((y) => y.id);
    // core と cherry だけ。premium(gold) は混ざらない
    expect(blue.sort()).toEqual(['grape', 'momo', 'tofu']);

    const gold = el.candidatesFor(TIERS[1], 'default').map((y) => y.id);
    expect(gold).toEqual(['sushiya']);
  });

  it('今の状態でレートが0の役は候補に並べない', () => {
    // ボーナス中は tofu のレートが0＝当たり得ないので候補から外れる
    const blue = el.candidatesFor(TIERS[0], 'bonus').map((y) => y.id);
    expect(blue.sort()).toEqual(['grape', 'momo']);
  });

  it('表示役を持たない内部役は候補に混ざらない', () => {
    const all = [
      ...el.candidatesFor(TIERS[0], 'default'),
      ...el.candidatesFor(TIERS[1], 'default'),
    ];
    expect(all.every((y) => y.id !== 'r_miss')).toBe(true);
  });

  it('色の抽選は weight に従い、指せる色が無ければ null', () => {
    // grape は blue のみ＝乱数によらず blue
    expect(el.pickTier(find('grape'), () => 0.99)?.color).toBe('blue');
    // 指せる色が無い役では示唆を出さない
    expect(el.pickTier(find('sushida'), () => 0.5)).toBeNull();
  });
});
