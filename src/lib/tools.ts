import yaml from 'js-yaml';
import taxonomyRaw from '../../data/taxonomy.yaml?raw';

export interface Category {
  id: string;
  name: string;
  hint?: string;
}

export interface Tag {
  id: string;
  name: string;
  aliases?: string[];
}

export interface Tool {
  id: string;
  name: string;
  description: string;
  url: string;
  logo?: string;
  logo_source?: string;
  category: string;
  tags: string[];
  aliases?: string[];
  platforms?: string[];
  open_source?: boolean;
  featured?: boolean;
  pricing?: 'free' | 'freemium' | 'paid' | 'open-source';
  status: 'draft' | 'published' | 'deprecated';
  repo?: string;
  stars?: number;
  license?: string;
  source?: string;
  added_at: string;
  updated_at: string;
}

const taxonomy = yaml.load(taxonomyRaw, { schema: yaml.JSON_SCHEMA }) as {
  categories: Category[];
  tags: Tag[];
};

export const categories: Category[] = taxonomy.categories ?? [];
export const tags: Tag[] = taxonomy.tags ?? [];

const CATEGORY_NAME = new Map(categories.map((c) => [c.id, c.name]));
const TAG_NAME = new Map(tags.map((t) => [t.id, t.name]));

export const categoryName = (id: string): string => CATEGORY_NAME.get(id) ?? id;
export const tagName = (id: string): string => TAG_NAME.get(id) ?? id;

/* Vite 在构建期把 YAML 原文注入，运行时只解析一次 */
const rawFiles = import.meta.glob('../../data/tools/**/*.yaml', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>;

const parsed = Object.values(rawFiles)
  .map((raw) => yaml.load(raw, { schema: yaml.JSON_SCHEMA }) as Tool)
  .filter((t) => t && t.id);

export const tools: Tool[] = parsed
  .filter((t) => t.status === 'published')
  .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));

export const toolById = new Map(tools.map((t) => [t.id, t]));

export const categoryCounts = categories
  .map((c) => ({ ...c, count: tools.filter((t) => t.category === c.id).length }))
  .filter((c) => c.count > 0);

const tagUsage = new Map<string, number>();
for (const t of tools) for (const tag of t.tags) tagUsage.set(tag, (tagUsage.get(tag) ?? 0) + 1);

export const tagCounts = [...tagUsage.entries()]
  .map(([id, count]) => ({ id, name: tagName(id), count }))
  .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-Hans-CN'));

/** 由名称派生稳定的徽章色相，避免同一工具每次渲染变颜色 */
export function hueOf(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}

/** 无 LOGO 时的降级首字母：优先取拉丁字母，其次取首字 */
export function initialOf(name: string): string {
  const latin = name.match(/[A-Za-z0-9]/);
  return (latin ? latin[0] : (name.trim()[0] ?? '?')).toUpperCase();
}

/** 客户端搜索用的扁平串：名称、别名、分类名、标签中英文、描述 */
export function searchBlob(t: Tool): string {
  return [
    t.name,
    ...(t.aliases ?? []),
    categoryName(t.category),
    ...t.tags,
    ...t.tags.map(tagName),
    t.description,
  ]
    .join(' ')
    .toLowerCase();
}
