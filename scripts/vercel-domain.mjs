#!/usr/bin/env node
/**
 * 从 Vercel 拉取项目的生产域名，输出给构建注入 SITE_URL。
 *
 * 为什么需要它：Vercel 注入 VERCEL_PROJECT_PRODUCTION_URL 只在 Vercel 自己的构建里；
 * 本仓库的设计是"Actions 构建静态产物 → vercel deploy --prebuilt 推上去"，
 * 预构建走的是 Actions，拿不到 Vercel 系统变量。这里用 token 主动查一次，
 * 让 SITE_URL 真正统一由 Vercel 自定义域名管理（换域名只需在 Vercel 控制台改一处）。
 *
 * 读法：GET /v10/projects/{id} → domains[].url
 *   - url === '<org>.vercel.app'  → 平台临时域名（自定义域名还在解析中）
 *   - 否则                        → 已在 Vercel 绑定的自定义域名
 * 选取顺序：非平台临时域名的自定义域名（按域名排序取第一个，保证跨 run 稳定）→ 平台临时域名兜底。
 *
 * 环境变量：VERCEL_TOKEN（必需）、VERCEL_PROJECT_ID（可选，缺省取 VERCEL_ORG_ID 下的默认项目）
 * 输出：STDOUT 一行域名（如 tools.example.com），由 CI 捕获后作为 SITE_URL 传给构建。
 */
import { execFileSync } from 'node:child_process';

const TOKEN = process.env.VERCEL_TOKEN;
if (!TOKEN) {
  console.error('[vercel-domain] 缺少 VERCEL_TOKEN');
  process.exit(2);
}

function vercel(args) {
  return execFileSync(process.execPath, args, { encoding: 'utf8' }).trim();
}

const apiBase = 'https://api.vercel.com/v10';

let projectId = process.env.VERCEL_PROJECT_ID;
if (!projectId) {
  // 未显式指定项目：列出 org 下项目并按 VERCEL_ORG_ID 选第一个（约定一 repo 一项目）
  const teamId = process.env.VERCEL_ORG_ID;
  const list = JSON.parse(
    vercel([
      'node_modules/vercel/dist/cli/index.js',
      'project',
      'list',
      teamId ? `--team=${teamId}` : '',
      '--json',
    ].filter(Boolean))
  );
  projectId = Array.isArray(list) ? list[0]?.id : list?.[0]?.id;
}

if (!projectId) {
  console.error('[vercel-domain] 无法定位 Vercel 项目，请设置 VERCEL_PROJECT_ID');
  process.exit(2);
}

const projectUrl = `${apiBase}/projects/${projectId}`;
const raw = vercel([
  'node_modules/vercel/dist/cli/index.js',
  'api',
  projectUrl,
  `--token=${TOKEN}`,
]);

// CLI 可能直接打印 JSON body；失败时 body 是 { error }
const body = JSON.parse(raw);
const domains = body?.domains ?? [];

// 自定义域名优先：排除 <subdomain>.vercel.app 平台临时域
const custom = domains
  .map((d) => d.url ?? d.domain ?? d.name)
  .filter((u) => u && !/\.vercel\.app$/.test(u));

const fallback = domains.map((d) => d.url ?? d.domain ?? d.name).find(Boolean);
const chosen = custom.sort()[0] ?? fallback;

if (!chosen) {
  console.error(`[vercel-domain] 项目 ${projectId} 没有任何域名（domains=${JSON.stringify(domains)})`);
  process.exit(3);
}

console.log(chosen);
