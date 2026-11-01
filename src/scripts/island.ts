/**
 * 搜索 island：主线程控制器
 *  - worker 未就绪 / 失败时用 DOM data 属性做本地子串匹配（首字即时反馈）
 *  - worker 就绪后升级为 bigram 索引 + 字段加权 + 分面计数
 *  - 复用 SSR 卡片 DOM：只切 hidden 与 CSS order，不重建节点
 */
import type { QueryResult } from '../lib/search-core';

const PAGE_SIZE = 48;

const input = document.getElementById('q') as HTMLInputElement | null;
const grid = document.getElementById('grid');
const items = Array.from(document.querySelectorAll<HTMLElement>('.grid__item'));
const resultNum = document.getElementById('result-num');
const empty = document.getElementById('empty');
const clearBtn = document.getElementById('clear');
const clearEmpty = document.getElementById('clear-empty');
const loadmore = document.getElementById('loadmore');
const loadmoreBtn = document.getElementById('loadmore-btn');
const loadmoreN = document.getElementById('loadmore-n');
const chips = Array.from(document.querySelectorAll<HTMLButtonElement>('.chipbtn[data-facet]'));

if (input && grid && items.length) {
  const state = {
    q: '',
    categories: [] as string[],
    tags: [] as string[],
    platforms: [] as string[],
  };

  let page = 1;
  let seq = 0;
  let shown: string[] = [];
  let worker: Worker | null = null;
  let workerReady = false;

  const splitList = (v: string | undefined) => (v ?? '').split(',').filter(Boolean);

  const isActive = (facet: string, value: string): boolean => {
    if (facet === 'category') return state.categories.includes(value);
    if (facet === 'tag') return state.tags.includes(value);
    return state.platforms.includes(value);
  };

  const dirty = () => state.q !== '' || state.categories.length > 0 || state.tags.length > 0 || state.platforms.length > 0;

  const toggle = (list: string[], value: string) =>
    list.includes(value) ? list.filter((x) => x !== value) : [...list, value];

  /* ---------- 渲染 ---------- */

  const applyOrder = (ids: string[]) => {
    const set = new Set(ids);
    let order = 0;
    for (const el of items) {
      const visible = set.has(el.dataset.id ?? '');
      el.hidden = !visible;
      if (visible) el.style.order = String(order++);
    }
  };

  const ESCAPES: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);

  /** 在原文上定位后再分别转义，避免对已转义串做偏移匹配 */
  const mark = (raw: string, q: string): string => {
    const needle = q.trim();
    if (needle.length < 2) return esc(raw);
    const hay = raw.toLowerCase();
    const n = needle.toLowerCase();
    let i = hay.indexOf(n);
    if (i < 0) return esc(raw);
    let out = '';
    let last = 0;
    while (i >= 0) {
      out += esc(raw.slice(last, i)) + '<mark>' + esc(raw.slice(i, i + n.length)) + '</mark>';
      last = i + n.length;
      i = hay.indexOf(n, last);
    }
    return out + esc(raw.slice(last));
  };

  const paint = (q: string) => {
    for (const el of items) {
      if (el.hidden) continue;
      const nameEl = el.querySelector<HTMLElement>('.card__name a');
      const descEl = el.querySelector<HTMLElement>('.card__desc');
      if (nameEl && el.dataset.name) nameEl.innerHTML = mark(el.dataset.name, q);
      if (descEl && el.dataset.desc) descEl.innerHTML = mark(el.dataset.desc, q);
    }
  };

  const syncChips = () => {
    for (const chip of chips) {
      const facet = chip.dataset.facet ?? '';
      const value = chip.dataset.value ?? '';
      if (facet === 'category' && value === 'all') {
        chip.setAttribute('aria-pressed', String(state.categories.length === 0));
        continue;
      }
      chip.setAttribute('aria-pressed', String(isActive(facet, value)));
    }
  };

  const updateFacets = (facets: QueryResult['facets']) => {
    const bags: Record<string, Record<string, number>> = {
      category: facets.category,
      tag: facets.tag,
      platform: facets.platform,
    };
    for (const chip of chips) {
      const facet = chip.dataset.facet ?? '';
      const value = chip.dataset.value ?? '';
      if (value === 'all' || !bags[facet]) continue;
      const count = bags[facet][value] ?? 0;
      const span = chip.querySelector<HTMLElement>('.chipbtn__count');
      if (span) span.textContent = String(count);
      chip.disabled = count === 0 && !isActive(facet, value);
    }
  };

  const syncUrl = () => {
    const p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    if (state.categories[0]) p.set('cat', state.categories[0]);
    if (state.tags.length) p.set('tags', state.tags.join(','));
    if (state.platforms.length) p.set('platforms', state.platforms.join(','));
    const qs = p.toString();
    history.replaceState(null, '', qs ? `?${qs}` : location.pathname);
  };

  const render = (
    ids: string[],
    total: number,
    facets: QueryResult['facets'] | null,
    reset: boolean
  ) => {
    if (reset) shown = [];
    const seen = new Set(shown);
    for (const id of ids) if (!seen.has(id)) shown.push(id);

    applyOrder(shown);

    if (resultNum) resultNum.textContent = String(total);
    if (empty) empty.hidden = total !== 0;
    grid.hidden = total === 0;
    if (clearBtn) clearBtn.hidden = !dirty();
    if (loadmore) loadmore.hidden = total === 0 || shown.length >= total;
    if (loadmoreN) loadmoreN.textContent = String(Math.max(0, total - shown.length));
    if (facets) updateFacets(facets);

    paint(state.q);
    syncUrl();
  };

  /* ---------- 本地兜底 ---------- */

  const localIds = (): string[] => {
    const q = state.q.trim().toLowerCase();
    return items
      .filter((el) => {
        if (state.categories.length && !state.categories.includes(el.dataset.cat ?? '')) return false;
        const tags = splitList(el.dataset.tags);
        if (state.tags.length && !state.tags.every((t) => tags.includes(t))) return false;
        const plats = splitList(el.dataset.platforms);
        if (state.platforms.length && !plats.some((p) => state.platforms.includes(p))) return false;
        if (q && !(el.dataset.s ?? '').includes(q)) return false;
        return true;
      })
      .map((el) => el.dataset.id ?? '');
  };

  const runLocal = () => {
    const ids = localIds();
    render(ids, ids.length, null, true);
  };

  /* ---------- worker ---------- */

  const askWorker = (reset: boolean) => {
    if (!worker || !workerReady) return;
    if (reset) {
      page = 1;
      shown = [];
    }
    seq += 1;
    worker.postMessage({
      type: 'query',
      seq,
      q: state.q,
      categories: state.categories,
      tags: state.tags,
      platforms: state.platforms,
      page,
      pageSize: PAGE_SIZE,
    });
  };

  const startWorker = () => {
    try {
      const base = import.meta.env.BASE_URL || '/';
      const manifestUrl = new URL(`${base}search/manifest.json`.replace(/\/{2,}/g, '/'), location.origin).href;

      worker = new Worker(new URL('../lib/search-worker.ts', import.meta.url), { type: 'module' });

      worker.addEventListener('message', (event: MessageEvent) => {
        const msg = event.data as { type: string; seq?: number } & Partial<QueryResult>;
        if (msg.type === 'ready') {
          workerReady = true;
          askWorker(true);
          return;
        }
        if (msg.type === 'results') {
          if (msg.seq !== seq) return; // 丢弃过期响应
          render(msg.ids ?? [], msg.total ?? 0, msg.facets ?? null, false);
          return;
        }
        if (msg.type === 'error') {
          runLocal();
        }
      });

      worker.addEventListener('error', () => {
        workerReady = false;
        runLocal();
      });

      worker.postMessage({ type: 'init', manifestUrl });
    } catch {
      runLocal();
    }
  };

  /* ---------- 事件 ---------- */

  let timer: number | undefined;

  input.addEventListener('input', () => {
    state.q = input.value;
    if (workerReady) {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => askWorker(true), 60);
    } else {
      runLocal();
    }
  });

  for (const chip of chips) {
    chip.addEventListener('click', () => {
      const facet = chip.dataset.facet ?? '';
      const value = chip.dataset.value ?? '';
      if (!value) return;

      if (facet === 'category') {
        state.categories = value === 'all' ? [] : state.categories.includes(value) ? [] : [value];
      } else if (facet === 'tag') {
        state.tags = toggle(state.tags, value);
      } else if (facet === 'platform') {
        state.platforms = toggle(state.platforms, value);
      }

      syncChips();
      if (workerReady) askWorker(true);
      else runLocal();
    });
  }

  // 首屏「热门标签」只是搜索快捷方式，不参与分面状态
  for (const pill of document.querySelectorAll<HTMLButtonElement>('.tagpill[data-q]')) {
    pill.addEventListener('click', () => {
      input.value = pill.dataset.q ?? '';
      state.q = input.value;
      if (workerReady) askWorker(true);
      else runLocal();
      input.focus();
    });
  }

  const clearAll = () => {
    input.value = '';
    state.q = '';
    state.categories = [];
    state.tags = [];
    state.platforms = [];
    syncChips();
    if (workerReady) askWorker(true);
    else runLocal();
    input.focus();
  };

  clearBtn?.addEventListener('click', clearAll);
  clearEmpty?.addEventListener('click', clearAll);

  loadmoreBtn?.addEventListener('click', () => {
    if (!workerReady) return;
    page += 1;
    askWorker(false);
  });

  const visibleLinks = () =>
    items
      .filter((el) => !el.hidden)
      .map((el) => el.querySelector<HTMLAnchorElement>('.card__name a'))
      .filter((a): a is HTMLAnchorElement => Boolean(a));

  document.addEventListener('keydown', (event) => {
    const target = event.target as HTMLElement;
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);

    if (event.key === '/' && !typing) {
      event.preventDefault();
      input.focus();
      input.select();
      return;
    }

    if (event.key === 'Escape' && document.activeElement === input && input.value) {
      input.value = '';
      state.q = '';
      if (workerReady) askWorker(true);
      else runLocal();
      return;
    }

    if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && (typing || target.closest('.grid'))) {
      const links = visibleLinks();
      if (!links.length) return;
      event.preventDefault();
      const current = links.indexOf(document.activeElement as HTMLAnchorElement);
      if (current === -1) {
        links[0].focus();
        return;
      }
      const next =
        event.key === 'ArrowDown'
          ? Math.min(links.length - 1, current + 1)
          : Math.max(0, current - 1);
      links[next].focus();
    }
  });

  /* ---------- 启动 ---------- */

  const params = new URLSearchParams(location.search);
  state.q = params.get('q') ?? '';
  if (state.q) input.value = state.q;
  const cat = params.get('cat');
  if (cat) state.categories = [cat];
  state.tags = splitList(params.get('tags') ?? undefined);
  state.platforms = splitList(params.get('platforms') ?? undefined);

  syncChips();
  runLocal(); // 先出一版结果，worker 就绪后自动升级为加权排序
  startWorker();
}
