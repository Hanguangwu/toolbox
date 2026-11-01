import MiniSearch from 'minisearch';

/**
 * 搜索内核：只依赖数据，不碰 DOM，因此可以在 Node 里直接单测。
 * 中文按 bigram 建索引，英文按单词 + 前缀匹配；不做拼音。
 */

export interface SearchDoc {
  id: string;
  name: string;
  description: string;
  category: string;
  categoryName: string;
  tags: string[];
  tagNames: string[];
  platforms: string[];
  aliases: string[];
  featured: boolean;
}

export interface ToolLike {
  id: string;
  name: string;
  description: string;
  category: string;
  tags: string[];
  platforms?: string[];
  aliases?: string[];
  featured?: boolean;
}

export interface QueryState {
  q: string;
  categories: string[];
  tags: string[];
  platforms: string[];
}

export interface FacetCounts {
  category: Record<string, number>;
  tag: Record<string, number>;
  platform: Record<string, number>;
}

export interface QueryResult {
  ids: string[];
  total: number;
  page: number;
  hasMore: boolean;
  facets: FacetCounts;
  took: number;
}

const CJK_RANGE = '\\u3400-\\u4DBF\\u4E00-\\u9FFF\\uF900-\\uFAFF';
const CJK_START = new RegExp(`[${CJK_RANGE}]`);
const TOKEN_RE = new RegExp(`[${CJK_RANGE}]+|[a-z0-9]+`, 'g');

/**
 * 分词：
 *  - 中文连续片段 → 相邻二字 bigram（单字保留单字，靠 prefix 匹配 bigram 词条）
 *  - 拉丁/数字 → 小写单词（image-compression → image, compression）
 */
export function tokenize(text: unknown): string[] {
  const s = String(text ?? '').toLowerCase();
  const out: string[] = [];
  for (const m of s.matchAll(TOKEN_RE)) {
    const chunk = m[0];
    if (CJK_START.test(chunk[0])) {
      if (chunk.length === 1) {
        out.push(chunk);
      } else {
        for (let i = 0; i < chunk.length - 1; i++) out.push(chunk.slice(i, i + 2));
      }
    } else {
      out.push(chunk);
    }
  }
  return out;
}

export function docsFromTools(
  tools: ToolLike[],
  categoryName: (id: string) => string,
  tagName: (id: string) => string
): SearchDoc[] {
  return tools.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    category: t.category,
    categoryName: categoryName(t.category),
    tags: t.tags,
    tagNames: t.tags.map(tagName),
    platforms: t.platforms ?? [],
    aliases: t.aliases ?? [],
    featured: Boolean(t.featured),
  }));
}

const INDEX_OPTIONS = {
  fields: ['name', 'aliases', 'tagNames', 'tags', 'description', 'categoryName'],
  storeFields: ['id'],
  tokenize,
  searchOptions: {
    boost: { name: 4, aliases: 3, tagNames: 2, tags: 1.5, description: 0.6, categoryName: 0.4 },
    prefix: true,
    fuzzy: false,
    combineWith: 'OR',
  },
};

export function buildIndex(docs: SearchDoc[]): MiniSearch<SearchDoc> {
  const index = new MiniSearch<SearchDoc>(INDEX_OPTIONS as never);
  index.addAll(docs);
  return index;
}

const emptyFacets = (): FacetCounts => ({ category: {}, tag: {}, platform: {} });

const inc = (bag: Record<string, number>, key: string) => {
  bag[key] = (bag[key] ?? 0) + 1;
};

export function runQuery(
  index: MiniSearch<SearchDoc>,
  docs: SearchDoc[],
  state: QueryState,
  page = 1,
  pageSize = 48
): QueryResult {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();

  const byId = new Map(docs.map((d) => [d.id, d]));
  const q = state.q.trim();

  let base: string[];
  if (q) {
    // 先按 AND 求精确，全部词都不命中时再退化为 OR（避免多打一个无关词就零结果）
    const strict = index.search(q, { combineWith: 'AND' }).map((r) => String(r.id));
    base = strict.length ? strict : index.search(q).map((r) => String(r.id));
  } else {
    // 无关键词时保持「精选优先，其余按名称」的稳定顺序
    base = [...docs].sort((a, b) => Number(b.featured) - Number(a.featured)).map((d) => d.id);
  }

  const matches = (
    d: SearchDoc,
    skip: 'category' | 'tag' | 'platform' | null
  ): boolean => {
    if (skip !== 'category' && state.categories.length && !state.categories.includes(d.category)) {
      return false;
    }
    if (skip !== 'tag' && state.tags.length && !state.tags.every((t) => d.tags.includes(t))) {
      return false;
    }
    if (
      skip !== 'platform' &&
      state.platforms.length &&
      !d.platforms.some((p) => state.platforms.includes(p))
    ) {
      return false;
    }
    return true;
  };

  const facets = emptyFacets();
  for (const id of base) {
    const d = byId.get(id);
    if (!d) continue;
    if (matches(d, 'category')) inc(facets.category, d.category);
    if (matches(d, 'tag')) for (const t of d.tags) inc(facets.tag, t);
    if (matches(d, 'platform')) for (const p of d.platforms) inc(facets.platform, p);
  }

  const visible = base.filter((id) => {
    const d = byId.get(id);
    return d ? matches(d, null) : false;
  });

  const total = visible.length;
  const safePage = Math.max(1, Math.floor(page) || 1);
  const start = (safePage - 1) * pageSize;
  const ids = visible.slice(start, start + pageSize);

  const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();

  return {
    ids,
    total,
    page: safePage,
    hasMore: start + ids.length < total,
    facets,
    took: Math.round((t1 - t0) * 10) / 10,
  };
}
