import { describe, it, expect } from 'vitest';
import { encryptCard, decryptCard, CardError } from '../../src/card/CardCodec';
import { CardPayloadSchema } from '../../src/card/cardSchema';
import { mergeRunHistory } from '../../src/card/CardManager';

const samplePayload = {
  schema: 'mojislot.card' as const,
  version: 2,
  createdAt: '2026-06-23T00:00:00.000Z',
  member: { id: 'm-1', name: 'テスト会員' },
  app: { name: 'mojislot-web', buildVer: '0.0.0' },
  storage: {
    'mojislot.stats.v1': '{"spinCount":10}',
    'mojislot.runHistory.v1': '[{"runId":"a","sahmai":100}]',
  },
};

describe('CardCodec', () => {
  it('encrypt → decrypt でラウンドトリップが一致する', async () => {
    const file = await encryptCard(samplePayload);
    expect(file.fmt).toBe('mojicard');
    expect(file.alg).toBe('AES-GCM');
    const back = await decryptCard(file);
    const parsed = CardPayloadSchema.parse(back);
    expect(parsed).toEqual(samplePayload);
  });

  it('暗号文を1byte改ざんすると TAMPERED で復号に失敗する', async () => {
    const file = await encryptCard(samplePayload);
    // data の先頭文字を別の base64url 文字に差し替える
    const flipped = {
      ...file,
      data: (file.data[0] === 'A' ? 'B' : 'A') + file.data.slice(1),
    };
    await expect(decryptCard(flipped)).rejects.toMatchObject({
      name: 'CardError',
      code: 'TAMPERED',
    });
  });

  it('形式が不正なファイルは BAD_FORMAT で弾く', async () => {
    await expect(decryptCard({ nope: true })).rejects.toBeInstanceOf(CardError);
    await expect(decryptCard({ nope: true })).rejects.toMatchObject({
      code: 'BAD_FORMAT',
    });
  });

  it('Zod スキーマが不正ペイロードを弾く', () => {
    expect(CardPayloadSchema.safeParse({ schema: 'wrong' }).success).toBe(false);
    expect(CardPayloadSchema.safeParse(samplePayload).success).toBe(true);
  });
});

describe('mergeRunHistory', () => {
  it('runId で重複排除し local を優先する', () => {
    const local = '[{"runId":"a","sahmai":1},{"runId":"b","sahmai":2}]';
    const incoming = '[{"runId":"b","sahmai":999},{"runId":"c","sahmai":3}]';
    const merged = JSON.parse(mergeRunHistory(local, incoming)) as {
      runId: string;
      sahmai: number;
    }[];
    expect(merged.map((r) => r.runId)).toEqual(['a', 'b', 'c']);
    // b は local 側（sahmai:2）が残る
    expect(merged.find((r) => r.runId === 'b')?.sahmai).toBe(2);
  });

  it('runId の無いレコードや壊れたJSONは除外/無視する', () => {
    expect(mergeRunHistory('not json', undefined)).toBe('[]');
    const merged = JSON.parse(
      mergeRunHistory('[{"sahmai":1},{"runId":"x","sahmai":2}]', undefined),
    ) as unknown[];
    expect(merged).toHaveLength(1);
  });

  it('local が空でも incoming を取り込む', () => {
    const merged = JSON.parse(
      mergeRunHistory(null, '[{"runId":"z","sahmai":5}]'),
    ) as unknown[];
    expect(merged).toHaveLength(1);
  });
});
