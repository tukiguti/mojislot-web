/**
 * hash ベースの軽量ルータ。
 * GitHub Pages はサーバ側リライト不可のため、hash(`#/play` 等)でディープリンク/リロード404を回避する。
 * ビューは `#view-{route}` を `hidden` トグルで出し分ける。
 */
export type Route = 'top' | 'play' | 'game' | 'ranking' | 'card';

const ROUTES: Route[] = ['top', 'play', 'game', 'ranking', 'card'];

export function parseRoute(hash: string): Route {
  const r = hash.replace(/^#\/?/, '');
  return (ROUTES as string[]).includes(r) ? (r as Route) : 'top';
}

/** 全ビューを hidden にし、route のビューだけ表示。先頭見出しへフォーカス移動(最低限のa11y)。 */
export function showView(route: Route): void {
  for (const r of ROUTES) {
    const el = document.getElementById(`view-${r}`);
    if (el) el.toggleAttribute('hidden', r !== route);
  }
  const active = document.getElementById(`view-${route}`);
  const heading = active?.querySelector<HTMLElement>('[data-view-title], h1, h2');
  if (heading) {
    heading.setAttribute('tabindex', '-1');
    heading.focus({ preventScroll: false });
  }
}

export class Router {
  private currentRoute: Route | null = null;

  constructor(private readonly onEnter: (route: Route, prev: Route | null) => void) {}

  start(): void {
    window.addEventListener('hashchange', () => this.resolve());
    this.resolve();
  }

  current(): Route | null {
    return this.currentRoute;
  }

  /** hash → route を解決して onEnter を呼ぶ。 */
  private resolve(): void {
    const next = parseRoute(location.hash);
    const prev = this.currentRoute;
    this.currentRoute = next;
    this.onEnter(next, prev);
  }

  /** route へ遷移。同一 hash でも再解決する(初期遷移用)。 */
  navigate(route: Route): void {
    const target = `#/${route}`;
    if (location.hash === target) {
      this.resolve();
    } else {
      location.hash = target;
    }
  }
}
