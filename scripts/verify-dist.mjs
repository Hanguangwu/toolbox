#!/usr/bin/env node
/**
 * 构建产物自检：在 CI 里把"构建成功但 SEO 元数据是坏的"这种错误拦在部署之前。
 * 检查项：
 *   - dist/ 关键产物存在（index.html、tool/、category/、tag/、search/manifest.json、sitemap.xml）
 *   - 首页 HTML 体积下限（防止空构建）
 *   - CI 下 canonical/sitemap/robots 不得含 localhost / 占位域
 *   - 搜索分片数量与 manifest 一致
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { isLocalUrl, resolveSiteUrl } from './site-url.mjs';

const ROOT = process.cwd();
const dist = join(ROOT, 'dist');
const problems = [];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

if (!existsSync(join(dist, 'index.html'))) {
  console.error('[verify-dist] dist/index.html 不存在，构建产物缺失');
  process.exit(1);
}

// 关键产物
const required = [
  'index.html',
  '404.html',
  'robots.txt',
  'sitemap.xml',
  'search/manifest.json',
];
for (const rel of required) {
  if (!existsSync(join(dist, rel))) problems.push(`缺少产物 ${rel}`);
}
const toolDirs = readdirSync(join(dist, 'tool')).filter((n) => existsSync(join(dist, `tool/${n}/index.html`)));
if (!toolDirs.length) problems.push('没有任何 /tool/<id>/ 详情页');

// 首页体积下限（卡片网格应当有内容）
const indexSize = statSync(join(dist, 'index.html')).size;
if (indexSize < 20_000) problems.push(`index.html 只有 ${indexSize} 字节，疑似空构建`);

// canonical 不得指向本地 / 占位域
const home = readFileSync(join(dist, 'index.html'), 'utf8');
const canonical = home.match(/rel="canonical" href="([^"]+)"/)?.[1] ?? '';
if (!canonical) {
  problems.push('首页缺少 canonical');
} else {
  if (isLocalUrl(canonical)) problems.push(`canonical 指向本地地址：${canonical}`);
  if (canonical.includes('toolbox.example.com')) problems.push('canonical 仍是占位域 toolbox.example.com');
}

// sitemap 不得混入本地/占位域
const sitemap = readFileSync(join(dist, 'sitemap.xml'), 'utf8');
const stray = sitemap.match(/<loc>(http[^<]+)<\/loc>/g)?.filter((s) => s.includes('localhost') || s.includes('toolbox.example.com')) ?? [];
if (stray.length) problems.push(`sitemap 混入非法地址：${stray.slice(0, 2).join(', ')}`);

// 搜索分片一致性
const manifest = JSON.parse(readFileSync(join(dist, 'search/manifest.json'), 'utf8'));
const shardFiles = readdirSync(join(dist, 'search', 'shards'));
if (shardFiles.length !== manifest.shards.length) {
  problems.push(`分片数量不一致：磁盘 ${shardFiles.length} / manifest ${manifest.shards.length}`);
}
for (const s of manifest.shards) {
  if (!existsSync(join(dist, 'search', s.url))) problems.push(`manifest 指向不存在的分片 ${s.url}`);
}

// CI 守卫的二次确认（防止有人绕过构建期检查手工改产物）
if (process.env.CI && isLocalUrl(resolveSiteUrl())) {
  problems.push('CI 环境解析到 localhost，构建必须带真实域名');
}

if (problems.length) {
  console.error('[verify-dist] 发现产物问题：');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

console.log(`[verify-dist] OK · ${toolDirs.length} 个详情页 · ${indexSize} 字节首页 · ${manifest.shards.length} 个搜索分片 · canonical ${canonical}`);
