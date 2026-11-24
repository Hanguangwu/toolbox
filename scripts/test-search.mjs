#!/usr/bin/env node
/**
 * 搜索内核单测（不依赖浏览器、不依赖 Astro）
 * 直接读取 data/ 下的 YAML 构建索引，验证分词、召回、分面与分页。
 *
 * 用法：node scripts/test-search.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import yaml from 'js-yaml';
import { tokenize, buildIndex, runQuery, docsFromTools } from '../src/lib/search-core.ts';

const ROOT = process.cwd();

let pass = 0;
const failures = [];

function check(name, fn) {
  try {
    fn();
    pass++;
    console.log(`  ok   ${name}`);
  } catch (e) {
    failures.push({ name, message: e.message });
    console.log(`  FAIL ${name}`);
    console.log(`       ${e.message.split('\n')[0]}`);
  }
}

function eq(actual, expected, label = 'value') {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${label}: 期望 ${b}，实际 ${a}`);
}

function ok(cond, message) {
  if (!cond) throw new Error(message);
}

/* ---------- 数据 ---------- */

const taxonomy = yaml.load(readFileSync(join(ROOT, 'data/taxonomy.yaml'), 'utf8'), {
  schema: yaml.JSON_SCHEMA,
});
const categoryName = (id) => (taxonomy.categories ?? []).find((c) => c.id === id)?.name ?? id;
const tagName = (id) => (taxonomy.tags ?? []).find((t) => t.id === id)?.name ?? id;

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return walk(p);
    return extname(p) === '.yaml' ? [p] : [];
  });
}

const tools = walk(join(ROOT, 'data', 'tools'))
  .map((f) => yaml.load(readFileSync(f, 'utf8'), { schema: yaml.JSON_SCHEMA }))
  .filter((t) => t?.status === 'published');

const docs = docsFromTools(tools, categoryName, tagName);
const index = buildIndex(docs);

const ids = (state, page = 1, pageSize = 48) => runQuery(index, docs, state, page, pageSize).ids;
const empty = (extra = {}) => ({ q: '', categories: [], tags: [], platforms: [], ...extra });
const has = (list, id) => list.includes(id);

/* ---------- 分词 ---------- */

console.log('\n分词');

check('中文连续片段 → 相邻二字 bigram', () => {
  eq(tokenize('图片压缩'), ['图片', '片压', '压缩']);
});

check('英文连字符 → 独立小写单词', () => {
  eq(tokenize('image-compression'), ['image', 'compression']);
});

check('中英混排各自成词', () => {
  eq(tokenize('PicLite 图轻'), ['piclite', '图轻']);
});

check('单字中文保留为单字（靠前缀匹配 bigram 词条）', () => {
  eq(tokenize('图 压'), ['图', '压']);
});

check('大小写与标点被归一', () => {
  eq(tokenize('CyberChef!'), ['cyberchef']);
});

/* ---------- 召回 ---------- */

console.log('\n召回');

check('「压缩」命中 PicLite', () => {
  ok(has(ids(empty({ q: '压缩' })), 'piclite'), '未命中 piclite');
});

check('「image compress」前缀命中 PicLite', () => {
  ok(has(ids(empty({ q: 'image compress' })), 'piclite'), '未命中 piclite');
});

check('「piclite 压缩」组合命中', () => {
  const list = ids(empty({ q: 'piclite 压缩' }));
  ok(has(list, 'piclite'), '未命中 piclite');
  eq(list[0], 'piclite', 'piclite 未排首位');
});

check('多词默认 AND：无关词不放大结果', () => {
  const and = ids(empty({ q: 'image compress' }));
  ok(and.length > 0, 'AND 无结果');
  eq(and[0], 'piclite', `首位是 ${and[0]}`);
});

check('AND 全部落空时退化为 OR', () => {
  const list = ids(empty({ q: '压缩 zzqqxv' }));
  ok(has(list, 'piclite'), '退化 OR 后未命中 piclite');
});

check('「编码」命中 CyberChef', () => {
  ok(has(ids(empty({ q: '编码' })), 'cyberchef'), '未命中 cyberchef');
});

check('「图 压」单字组合命中 PicLite（验收口径）', () => {
  ok(has(ids(empty({ q: '图 压' })), 'piclite'), '未命中 piclite');
});

check('别名可召回（「网络瑞士军刀」→ CyberChef）', () => {
  ok(has(ids(empty({ q: '瑞士军刀' })), 'cyberchef'), '未命中 cyberchef');
});

check('无相关关键词时返回空', () => {
  eq(ids(empty({ q: 'qqzzxx-vvbbnn' })).length, 0);
});

check('实现方式（how）字段可召回', () => {
  // "Marlin 算子" 只出现在 ktransformers 的 how 字段
  const list = ids(empty({ q: 'Marlin' }));
  ok(has(list, 'ktransformers'), 'how 字段未被检索');
  // "WebDAV" 只出现在 tgfs 的 how 字段
  const wd = ids(empty({ q: 'WebDAV' }));
  ok(has(wd, 'tgfs'), 'how 字段未被检索（WebDAV）');
});

check('how 字段进入索引文档', () => {
  const d = docs.find((x) => x.id === 'colibri');
  ok(typeof d.how === 'string' && d.how.length > 0, 'colibri 缺少 how');
});

/* ---------- 分面 ---------- */

console.log('\n分面');

check('标签为 AND 语义', () => {
  const both = ids(empty({ tags: ['offline', 'crypto'] }));
  ok(both.length > 0, '组合标签无结果');
  for (const id of both) {
    const d = docs.find((x) => x.id === id);
    ok(d.tags.includes('offline') && d.tags.includes('crypto'), `${id} 不满足 AND`);
  }
  const single = ids(empty({ tags: ['offline'] }));
  ok(single.length > both.length, '单标签结果应多于双标签');
});

check('平台为 OR 语义', () => {
  const list = ids(empty({ platforms: ['docker', 'android'] }));
  ok(list.length > 0, '平台筛选无结果');
  for (const id of list) {
    const d = docs.find((x) => x.id === id);
    ok(
      d.platforms.includes('docker') || d.platforms.includes('android'),
      `${id} 不属于任一平台`
    );
  }
  ok(has(list, 'romm') && has(list, 'dsh-android'), '缺少预期条目');
});

check('分类筛选收窄结果', () => {
  const all = ids(empty()).length;
  const media = ids(empty({ categories: ['media'] }));
  ok(media.length > 0 && media.length < all, '分类未生效');
  for (const id of media) eq(docs.find((d) => d.id === id).category, 'media', id);
});

check('分面计数忽略自身维度，受其他维度约束', () => {
  const r = runQuery(index, docs, empty({ q: '压缩' }), 1, 48);
  ok(r.facets.category.media >= 1, 'media 分面计数缺失');
  ok(
    Object.keys(r.facets.category).every((c) => r.facets.category[c] > 0),
    '分类分面出现 0 计数'
  );

  // 选中 category=media 后：分类分面应忽略自身维度（仍能看到切到别的分类有多少条）
  const narrowed = runQuery(index, docs, empty({ categories: ['media'] }), 1, 48);
  ok(
    Object.keys(narrowed.facets.category).some((c) => c !== 'media'),
    '分类分面被自身维度错误收窄'
  );
  for (const id of narrowed.ids) eq(docs.find((d) => d.id === id).category, 'media', id);

  // 标签分面则必须被分类条件收窄：只统计当前分类下的标签
  const mediaTags = new Set(
    docs.filter((d) => d.category === 'media').flatMap((d) => d.tags)
  );
  for (const tag of Object.keys(narrowed.facets.tag)) {
    ok(mediaTags.has(tag), `标签分面混入了非 media 条目的标签：${tag}`);
  }
});

check('分面标签计数不超过结果数', () => {
  const r = runQuery(index, docs, empty({ q: '开源' }), 1, 48);
  for (const [tag, n] of Object.entries(r.facets.tag)) {
    ok(n <= r.total, `标签 ${tag} 计数 ${n} 超过总数 ${r.total}`);
  }
});

/* ---------- 分页 ---------- */

console.log('\n分页');

check('分页不重叠且按序衔接', () => {
  const size = 5;
  const p1 = runQuery(index, docs, empty(), 1, size);
  const p2 = runQuery(index, docs, empty(), 2, size);
  const p3 = runQuery(index, docs, empty(), 3, size);

  eq(p1.ids.length, size);
  eq(p1.page, 1);
  ok(p1.hasMore, '第一页应还有更多');
  ok(p2.hasMore, '第二页应还有更多');

  const seen = new Set();
  for (const id of [...p1.ids, ...p2.ids, ...p3.ids]) {
    ok(!seen.has(id), `分页重复：${id}`);
    seen.add(id);
  }
  eq(seen.size, size * 3);
});

check('最后一页 hasMore=false 且总数守恒', () => {
  const size = 5;
  const total = runQuery(index, docs, empty(), 1, size).total;
  const lastPage = Math.ceil(total / size);
  const last = runQuery(index, docs, empty(), lastPage, size);
  eq(last.hasMore, false);
  const collected = new Set();
  for (let p = 1; p <= lastPage; p++) {
    for (const id of runQuery(index, docs, empty(), p, size).ids) collected.add(id);
  }
  eq(collected.size, total, '全量分页收集数');
});

check('越界页返回空但保留 hasMore=false', () => {
  const r = runQuery(index, docs, empty(), 999, 5);
  eq(r.ids.length, 0);
  eq(r.hasMore, false);
});

/* ---------- 汇总 ---------- */

console.log(`\n${failures.length ? '❌' : '✅'} ${pass} 通过 / ${failures.length} 失败 · ${docs.length} 条文档\n`);
if (failures.length) {
  for (const f of failures) console.log(`- ${f.name}\n  ${f.message}`);
  process.exit(1);
}
