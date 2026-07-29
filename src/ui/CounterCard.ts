import { getMemberId, getMemberName, getMemberSince, setMemberName } from '../productions/Member';
import { applyCard, downloadCard, readCard, summarizeCard } from '../card/CardManager';
import { CardError } from '../card/CardCodec';
import type { CardPayload } from '../card/cardSchema';
import './counter.css';

/**
 * 会員カード（景品カウンターの受付に寄った画面）。
 *
 * このゲームには進捗を保存するサーバーが無く、すべてブラウザの localStorage にある。
 * 会員カードはそれを1ファイル（.mojicard）に書き出して持ち歩き、別の端末で読み戻す仕組み。
 * ホールのカウンターで会員証を発行してもらう、という見立てで作ってある。
 *
 * 中身の正本は `card/CardManager`（符号化・スナップショット・マージ）と
 * `productions/Member`（会員ID・表示名・発行日）。デザインは見た目だけを持ってくる。
 *
 * 正直ラベル（難読化＋改ざん検知のみ・自分用・持メダル非引継）はカウンターの掲示として出す。
 */
export interface CounterCardCallbacks {
  /** カウンター前へ戻る。 */
  onBack: () => void;
}

const esc = (s: string): string =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ] ?? c,
  );

const fmtDate = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())}`;
};

/** 会員IDを券面の会員番号らしく整形する（4桁ずつ・16桁まで）。 */
const memberNo = (id: string): string => {
  const compact = id.replace(/-/g, '').slice(0, 16).toUpperCase();
  return compact.replace(/(.{4})/g, '$1 ').trim() || '— — — —';
};

type MsgKind = 'saved' | 'issued' | 'restored' | 'error';

const MESSAGES: Record<MsgKind, { text: string; tone: 'ok' | 'ng' }> = {
  saved: { text: '会員名を保存しました。', tone: 'ok' },
  issued: { text: 'カードを発行しました（ダウンロード）。', tone: 'ok' },
  restored: { text: '', tone: 'ok' }, // 復元は件数を添えるので都度組み立てる
  error: { text: 'カードを読み込めませんでした。', tone: 'ng' },
};

export function renderCounterCard(cb: CounterCardCallbacks): void {
  const root = document.getElementById('view-card');
  if (!root) return;

  let busy = false;
  let pending: CardPayload | null = null;

  const since = getMemberSince();

  root.innerHTML = `
    <div class="ctr-card">
      <span class="ctr-floor"></span>
      <div class="ctr-back" data-act="back" role="button" tabindex="0">
        <span>←</span><span>カウンター前に戻る（Esc）</span>
      </div>

      <div class="ctr-card-body">
        <div class="ctr-card-main">
          <div class="ctr-desk">
            <div class="ctr-face">
              <span class="ctr-face-shine"></span>
              <div class="ctr-face-head">
                <span class="ctr-face-brand">MOJISLOT MEMBER</span>
                <span class="ctr-face-kind">会員証</span>
              </div>
              <div class="ctr-face-name">
                <span class="ctr-face-label">会員名（16文字まで）</span>
                <div class="ctr-face-namerow">
                  <input class="ctr-name-input" type="text" maxlength="16"
                         placeholder="ゲスト" value="${esc(getMemberName())}" aria-label="会員名">
                  <button class="ctr-name-save" data-act="save-name" type="button">保存</button>
                </div>
              </div>
              <div class="ctr-face-meta">
                <div>
                  <span class="ctr-face-label">会員番号</span>
                  <span class="ctr-face-value">${esc(memberNo(getMemberId()))}</span>
                </div>
                <div>
                  <span class="ctr-face-label">発行日</span>
                  <span class="ctr-face-value">${since ? esc(fmtDate(since)) : '—'}</span>
                </div>
              </div>
              <span class="ctr-face-stripe"></span>
            </div>

            <div class="ctr-readercol">
              <label class="ctr-reader">
                <span class="ctr-reader-slot"></span>
                <span class="ctr-reader-label">INSERT</span>
                <span class="ctr-reader-lamps">
                  <span class="on"></span><span></span><span></span>
                </span>
                <span class="ctr-reader-text">カードを<br>読み込む</span>
                <span class="ctr-reader-ext">.mojicard</span>
                <input type="file" accept=".mojicard,application/json" data-act="file">
              </label>
              <div class="ctr-preview" data-preview hidden></div>
            </div>

            <div class="ctr-busy" data-busy hidden><span>処 理 中 …</span></div>
          </div>

          <button class="ctr-issue" data-act="issue" type="button">カードを作成（発行）</button>
          <span class="ctr-issue-note">いまのブラウザの進捗（図鑑・統計・ミッション・設定）と実戦履歴を1つのファイルにまとめて発行します。読み込みは右のリーダーから。</span>

          <div class="ctr-msg" data-msg hidden><span class="ctr-msg-dot"></span><span data-msg-text></span></div>
        </div>

        <div class="ctr-notice">
          <span class="ctr-notice-badge">ご 注 意</span>
          <span class="ctr-notice-title">会員カードのお取り扱いについて</span>
          <div class="ctr-notice-list">
            <span>・このファイルは難読化と改ざん検知のみで、中身は秘匿されません。</span>
            <span>・自分用の控えとして保管し、他人にお渡しにならないでください。</span>
            <span>・順位の不正防止を目的とした仕組みではありません。</span>
            <span>・持メダル（クレジット）は引き継がれません。</span>
          </div>
          <span class="ctr-notice-foot">MOJISLOT 景品カウンター</span>
        </div>
      </div>
    </div>
  `;

  const nameInput = root.querySelector<HTMLInputElement>('.ctr-name-input')!;
  const fileInput = root.querySelector<HTMLInputElement>('[data-act="file"]')!;
  const preview = root.querySelector<HTMLElement>('[data-preview]')!;
  const busyEl = root.querySelector<HTMLElement>('[data-busy]')!;
  const msgEl = root.querySelector<HTMLElement>('[data-msg]')!;
  const msgText = root.querySelector<HTMLElement>('[data-msg-text]')!;

  const setBusy = (v: boolean): void => {
    busy = v;
    busyEl.hidden = !v;
  };

  const showMsg = (text: string, tone: 'ok' | 'ng'): void => {
    msgText.textContent = text;
    msgEl.classList.toggle('ng', tone === 'ng');
    msgEl.hidden = false;
  };

  const say = (kind: MsgKind): void => {
    const m = MESSAGES[kind];
    showMsg(m.text, m.tone);
  };

  root.querySelector('[data-act="back"]')?.addEventListener('click', cb.onBack);

  root.querySelector('[data-act="save-name"]')?.addEventListener('click', () => {
    setMemberName(nameInput.value);
    nameInput.value = getMemberName();
    say('saved');
  });

  root.querySelector('[data-act="issue"]')?.addEventListener('click', async () => {
    if (busy) return;
    setBusy(true);
    msgEl.hidden = true;
    try {
      await downloadCard();
      say('issued');
    } catch (err) {
      showMsg('発行に失敗しました。', 'ng');
      console.error('downloadCard failed:', err);
    } finally {
      setBusy(false);
    }
  });

  fileInput.addEventListener('change', async () => {
    if (busy) return;
    const file = fileInput.files?.[0];
    if (!file) return;
    pending = null;
    setBusy(true);
    msgEl.hidden = true;
    try {
      const payload = await readCard(file);
      pending = payload;
      renderPreview(payload);
    } catch (err) {
      preview.hidden = true;
      showMsg(
        err instanceof CardError ? err.message : MESSAGES.error.text,
        'ng',
      );
    } finally {
      setBusy(false);
      fileInput.value = '';
    }
  });

  /** 読めたカードの中身を、カウンターに置かれたレシートとして見せてから確認を取る。 */
  function renderPreview(payload: CardPayload): void {
    const s = summarizeCard(payload);
    const sign = s.totalSahmai > 0 ? '+' : s.totalSahmai < 0 ? '−' : '±';
    preview.innerHTML = `
      <span class="ctr-preview-head">- CARD READ -</span>
      <div class="ctr-preview-row"><span>会員名</span><b>${esc(s.name)}</b></div>
      <div class="ctr-preview-row"><span>作成日</span><b>${esc(fmtDate(s.createdAt))}</b></div>
      <div class="ctr-preview-row"><span>戦数</span><b>${s.runCount} 戦</b></div>
      <div class="ctr-preview-row"><span>通算差枚</span><b class="${s.totalSahmai >= 0 ? 'plus' : 'minus'}">${sign}${Math.abs(s.totalSahmai)}</b></div>
      <p class="ctr-preview-warn">復元すると<b>この端末の進捗は上書き</b>されます（実戦履歴は統合）。</p>
      <div class="ctr-preview-actions">
        <button class="ctr-preview-ok" data-act="confirm" type="button">復元する</button>
        <button class="ctr-preview-no" data-act="cancel" type="button">やめる</button>
      </div>`;
    preview.hidden = false;

    preview.querySelector('[data-act="cancel"]')?.addEventListener('click', () => {
      pending = null;
      preview.hidden = true;
    });
    preview.querySelector('[data-act="confirm"]')?.addEventListener('click', () => {
      if (busy || !pending) return;
      const result = applyCard(pending);
      pending = null;
      preview.hidden = true;
      showMsg(
        `復元しました（進捗 ${result.replacedKeys}項目を上書き・実戦履歴は計 ${result.totalRuns}戦）。ゲームを開くと反映されます。`,
        'ok',
      );
      // 券面の名前も復元後のものへ差し替える（読んだカードの会員になる）
      nameInput.value = getMemberName();
    });
  }
}
