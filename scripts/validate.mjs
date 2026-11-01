#!/usr/bin/env node
/**
 * 数据校验：JSON Schema + 分类/标签词表 + 去重 + 路径一致性
 *
 * 用法：
 *   node scripts/validate.mjs          # 人类可读
 *   node scripts/validate.mjs --json   # 机器可读，供 Agent 自我修复
 *
 * 退出码：0 = 通过（可有 warning），1 = 存在 error
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, basename, extname, sep } from 'node:path';
import yaml from 'js-yaml';
import Ajv from 'ajv';

const ROOT = process.cwd();
const JSON_OUT = process.argv.includes('--json');
const problems = [];

const err = (file, field, message) => problems.push({ level: 'error', file, field, message });
const warn = (file, field, message) => problems.push({ level: 'warning', file, field, message });

const rel = (p) => p.slice(ROOT.length + 1).split(sep).join('/');

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

function normalizeUrl(raw) {
  try {
    const u = new URL(raw);
    const host = u.hostname.replace(/^www\./, '').toLowerCase();
    const path = u.pathname.replace(/\/+$/, '');
    const search = [...u.searchParams].filter(([k]) => !/^utm_/i.test(k));
    const qs = search.length ? `?${search.map(([k, v]) => `${k}=${v}`).join('&')}` : '';
    return `${host}${path}${qs}`;
  } catch {
    return raw;
  }
}

function trigrams(s) {
  const norm = `  ${String(s).toLowerCase().replace(/[\s\-_/·]+/g, ' ')}  `;
  const set = new Set();
  for (let i = 0; i < norm.length - 2; i++) set.add(norm.slice(i, i + 3));
  return set;
}

function similarity(a, b) {
  const A = trigrams(a);
  const B = trigrams(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

/* ---------- 词表 ---------- */

const taxonomy = yaml.load(readFileSync(join(ROOT, 'data/taxonomy.yaml'), 'utf8'), {
  schema: yaml.JSON_SCHEMA,
});
const categoryIds = new Set((taxonomy.categories ?? []).map((c) => c.id));
const tagIds = new Set((taxonomy.tags ?? []).map((t) => t.id));
const tagAlias = new Map();
for (const t of taxonomy.tags ?? []) {
  for (const a of t.aliases ?? []) tagAlias.set(String(a).toLowerCase(), t.id);
}

/* ---------- Schema ---------- */

const schema = JSON.parse(readFileSync(join(ROOT, 'schema/tool.schema.json'), 'utf8'));
const ajv = new Ajv({ allErrors: true, strict: false });
const validate = ajv.compile(schema);

/* ---------- 遍历条目 ---------- */

const toolsDir = join(ROOT, 'data', 'tools');
const files = walk(toolsDir).filter((f) => extname(f) === '.yaml');

const byId = new Map();
const byUrl = new Map();
const byRepo = new Map();
const entries = [];

const BANNED_WORDS = ['最强', '神器', '必备', '一站式', '赋能', '颠覆', '完美', '绝对'];

for (const file of files) {
  const path = rel(file);
  const dirCategory = rel(file).split('/')[2];

  let doc;
  try {
    doc = yaml.load(readFileSync(file, 'utf8'), { schema: yaml.JSON_SCHEMA });
  } catch (e) {
    err(path, 'yaml', `YAML 解析失败：${e.message.split('\n')[0]}`);
    continue;
  }

  if (!doc || typeof doc !== 'object') {
    err(path, 'root', '文件内容必须是一个对象');
    continue;
  }

  // 1. Schema
  if (!validate(doc)) {
    for (const e of validate.errors ?? []) {
      const field = (e.instancePath || '').replace(/^\//, '').replace(/\//g, '.') || 'root';
      err(path, field, `${e.message}${e.params ? ` (${JSON.stringify(e.params)})` : ''}`);
    }
  }

  // 2. 文件名 / 目录一致性
  const fileId = basename(file, '.yaml');
  if (doc.id && doc.id !== fileId) {
    err(path, 'id', `id "${doc.id}" 必须与文件名 "${fileId}" 一致`);
  }
  if (doc.category && doc.category !== dirCategory) {
    err(path, 'category', `category "${doc.category}" 与所在目录 "${dirCategory}" 不一致`);
  }
  if (doc.category && !categoryIds.has(doc.category)) {
    err(path, 'category', `未知分类 "${doc.category}"，可选：${[...categoryIds].join(', ')}`);
  }

  // 3. 标签词表
  for (const tag of doc.tags ?? []) {
    if (tagIds.has(tag)) continue;
    const canonical = tagAlias.get(String(tag).toLowerCase());
    err(
      path,
      'tags',
      canonical
        ? `"${tag}" 是别名，请改用 canonical 形式 "${canonical}"`
        : `未知标签 "${tag}"。若确需新增，先在 data/taxonomy.yaml 中登记并说明理由`
    );
  }

  // 4. 时间
  if (doc.added_at && doc.updated_at && doc.updated_at < doc.added_at) {
    err(path, 'updated_at', 'updated_at 早于 added_at');
  }

  // 5. 文案
  for (const w of BANNED_WORDS) {
    if (typeof doc.description === 'string' && doc.description.includes(w)) {
      warn(path, 'description', `描述包含营销词「${w}」，建议改成可验证的事实`);
    }
  }
  if (doc.status === 'published' && !doc.source) {
    warn(path, 'source', 'published 条目建议填写 source，便于反查事实来源');
  }

  // 6. 重复
  if (doc.id) {
    if (byId.has(doc.id)) err(path, 'id', `id "${doc.id}" 与 ${byId.get(doc.id)} 重复`);
    else byId.set(doc.id, path);
  }
  if (doc.url) {
    const n = normalizeUrl(doc.url);
    if (byUrl.has(n)) err(path, 'url', `URL 归一化后与 ${byUrl.get(n)} 重复 (${n})`);
    else byUrl.set(n, path);
  }
  if (doc.repo) {
    const n = doc.repo.toLowerCase();
    if (byRepo.has(n)) err(path, 'repo', `repo "${doc.repo}" 与 ${byRepo.get(n)} 重复`);
    else byRepo.set(n, path);
  }

  entries.push({ path, doc });
}

/* ---------- 名称相似度（疑似重复） ---------- */

for (let i = 0; i < entries.length; i++) {
  for (let j = i + 1; j < entries.length; j++) {
    const a = entries[i];
    const b = entries[j];
    if (!a.doc.name || !b.doc.name) continue;
    if (a.doc.id === b.doc.id) continue;
    const sim = similarity(a.doc.name, b.doc.name);
    if (sim >= 0.85) {
      warn(a.path, 'name', `与 ${b.path} 名称高度相似 (${(sim * 100).toFixed(0)}%)，确认是否应合并`);
    }
  }
}

/* ---------- 汇总 ---------- */

const errors = problems.filter((p) => p.level === 'error');
const warnings = problems.filter((p) => p.level === 'warning');

const byCategory = {};
const byStatus = {};
const tagUsage = {};
for (const { doc } of entries) {
  byCategory[doc.category] = (byCategory[doc.category] ?? 0) + 1;
  byStatus[doc.status] = (byStatus[doc.status] ?? 0) + 1;
  for (const t of doc.tags ?? []) tagUsage[t] = (tagUsage[t] ?? 0) + 1;
}
const unusedCategories = [...categoryIds].filter((c) => !byCategory[c]);
const unusedTags = [...tagIds].filter((t) => !tagUsage[t]);

const stats = {
  files: files.length,
  entries: entries.length,
  byCategory,
  byStatus,
  unusedCategories,
  unusedTags: unusedTags.length,
  tagCount: Object.keys(tagUsage).length,
};

if (JSON_OUT) {
  console.log(JSON.stringify({ ok: errors.length === 0, errors, warnings, stats }, null, 2));
} else {
  for (const p of problems) {
    const tag = p.level === 'error' ? 'ERROR' : 'WARN ';
    console.log(`${tag} ${p.file} [${p.field}] ${p.message}`);
  }
  if (problems.length) console.log('');

  console.log(`条目：${stats.entries} 个文件 / ${stats.files} 个 YAML`);
  console.log(
    `分类分布：${Object.entries(byCategory)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k}=${v}`)
      .join('  ')}`
  );
  console.log(`状态：${Object.entries(byStatus).map(([k, v]) => `${k}=${v}`).join('  ')}`);
  console.log(`标签使用：${stats.tagCount} 个已用 / ${tagIds.size} 个词表`);
  if (unusedCategories.length) console.log(`空分类：${unusedCategories.join(', ')}`);
  console.log(`\n结果：${errors.length} error / ${warnings.length} warning`);
}

process.exit(errors.length ? 1 : 0);
