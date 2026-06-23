import { getMemberName, setMemberName } from '../productions/Member';
import {
  downloadCard,
  readCard,
  applyCard,
  summarizeCard,
} from '../card/CardManager';
import { CardError } from '../card/CardCodec';
import type { CardPayload } from '../card/cardSchema';

/**
 * 会員カード画面（#/card）。
 *  - 会員名の編集
 *  - カード作成（現ブラウザの進捗・履歴を .mojicard にDL）
 *  - カード復元（ファイル読込→プレビュー→確認→適用。進捗=置換 / 履歴=マージ）
 * 正直ラベル（難読化+改ざん検知・自分用・持メダル非引継）を明示する（計画 §4.6）。
 */
export interface CardViewCallbacks {
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
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

export function renderCardView(cb: CardViewCallbacks): void {
  const root = document.getElementById('view-card');
  if (!root) return;

  let busy = false;
  let pending: CardPayload | null = null;

  root.innerHTML = `
    <div class="card-view">
      <header class="card-head">
        <button class="setup-back" data-act="back" type="button">← TOP</button>
        <h1 class="card-title" data-view-title>会員カード</h1>
      </header>

      <section class="card-section">
        <h2 class="card-section-title">会員名</h2>
        <div class="card-name-row">
          <input class="card-name-input" type="text" maxlength="16" value="${esc(getMemberName())}" placeholder="ゲスト" aria-label="会員名">
          <button class="card-name-save setup-back" data-act="save-name" type="button">保存</button>
        </div>
        <p class="card-msg" data-name-msg hidden></p>
      </section>

      <section class="card-section">
        <h2 class="card-section-title">カードを作成（バックアップ）</h2>
        <p class="card-note">いまのブラウザの進捗・図鑑・実戦履歴を1つのファイル（.mojicard）に保存します。</p>
        <button class="card-dl-btn setup-launch" data-act="download" type="button">カードをダウンロード</button>
        <p class="card-msg" data-dl-msg hidden></p>
      </section>

      <section class="card-section">
        <h2 class="card-section-title">カードを読み込む（復元）</h2>
        <p class="card-note"><b>進捗（図鑑・統計・ミッション・設定）は上書き</b>され、<b>実戦履歴は統合</b>されます（同じ戦は重複しません）。</p>
        <label class="card-file">
          <input type="file" accept=".mojicard,application/json" data-act="file">
          <span class="card-file-label">ファイルを選択…</span>
        </label>
        <div class="card-preview" data-preview hidden></div>
      </section>

      <div class="card-disclaimer">
        <p>このカードは<b>「難読化 + 改ざん検知」のみ</b>です（暗号で秘匿はされません）。自分用に保管し、他人に渡さないでください。</p>
        <p>第三者が書き換えると壊れて読めなくなりますが、中身は解析できます。順位の不正防止用ではありません。</p>
        <p>※ 持メダル（クレジット）は引き継がれません。</p>
      </div>
    </div>
  `;

  const view = root.querySelector<HTMLElement>('.card-view')!;
  const nameInput = root.querySelector<HTMLInputElement>('.card-name-input')!;
  const nameMsg = root.querySelector<HTMLElement>('[data-name-msg]')!;
  const dlMsg = root.querySelector<HTMLElement>('[data-dl-msg]')!;
  const fileInput = root.querySelector<HTMLInputElement>('[data-act="file"]')!;
  const fileLabel = root.querySelector<HTMLElement>('.card-file-label')!;
  const preview = root.querySelector<HTMLElement>('[data-preview]')!;

  const setBusy = (v: boolean): void => {
    busy = v;
    view.classList.toggle('busy', v);
  };
  const showMsg = (el: HTMLElement, text: string, ok = true): void => {
    el.textContent = text;
    el.classList.toggle('error', !ok);
    el.hidden = false;
  };

  root.querySelector('[data-act="back"]')?.addEventListener('click', cb.onBack);

  root.querySelector('[data-act="save-name"]')?.addEventListener('click', () => {
    setMemberName(nameInput.value);
    nameInput.value = getMemberName();
    showMsg(nameMsg, `会員名を「${getMemberName()}」に保存しました。`);
  });

  root
    .querySelector('[data-act="download"]')
    ?.addEventListener('click', async () => {
      if (busy) return;
      setBusy(true);
      dlMsg.hidden = true;
      try {
        await downloadCard();
        showMsg(dlMsg, 'カードをダウンロードしました。');
      } catch (err) {
        showMsg(dlMsg, 'ダウンロードに失敗しました。', false);
        console.error('downloadCard failed:', err);
      } finally {
        setBusy(false);
      }
    });

  fileInput.addEventListener('change', async () => {
    if (busy) return;
    const file = fileInput.files?.[0];
    if (!file) return;
    fileLabel.textContent = file.name;
    pending = null;
    setBusy(true);
    try {
      const payload = await readCard(file);
      pending = payload;
      renderPreview(payload);
    } catch (err) {
      const msg =
        err instanceof CardError
          ? err.message
          : 'カードを読み込めませんでした。';
      preview.innerHTML = `<p class="card-preview-error">${esc(msg)}</p>`;
      preview.classList.add('error');
      preview.hidden = false;
    } finally {
      setBusy(false);
    }
  });

  function renderPreview(payload: CardPayload): void {
    const s = summarizeCard(payload);
    const sign = s.totalSahmai > 0 ? '+' : '';
    const cls = s.totalSahmai > 0 ? 'num-plus' : s.totalSahmai < 0 ? 'num-minus' : '';
    preview.classList.remove('error');
    preview.innerHTML = `
      <div class="card-preview-grid">
        <div><span class="card-preview-label">会員名</span><span>${esc(s.name)}</span></div>
        <div><span class="card-preview-label">作成日</span><span>${esc(fmtDate(s.createdAt))}</span></div>
        <div><span class="card-preview-label">戦数</span><span>${s.runCount}</span></div>
        <div><span class="card-preview-label">通算差枚</span><span class="${cls}">${sign}${s.totalSahmai}</span></div>
      </div>
      <p class="card-preview-warn">復元すると<b>この端末の進捗は上書き</b>されます（履歴は統合）。よろしいですか？</p>
      <button class="card-confirm-btn setup-launch" data-act="confirm" type="button">このカードで復元する</button>
      <p class="card-msg" data-restore-msg hidden></p>
    `;
    preview.hidden = false;
    preview
      .querySelector('[data-act="confirm"]')
      ?.addEventListener('click', () => {
        if (busy || !pending) return;
        const result = applyCard(pending);
        const restoreMsg = preview.querySelector<HTMLElement>(
          '[data-restore-msg]',
        );
        if (restoreMsg) {
          showMsg(
            restoreMsg,
            `復元しました（進捗 ${result.replacedKeys}項目を上書き・実戦履歴は計 ${result.totalRuns}戦）。ゲームを開くと反映されます。`,
          );
        }
        const confirmBtn = preview.querySelector<HTMLButtonElement>(
          '[data-act="confirm"]',
        );
        if (confirmBtn) confirmBtn.disabled = true;
        pending = null;
      });
  }
}
