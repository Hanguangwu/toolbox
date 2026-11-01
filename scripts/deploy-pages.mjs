#!/usr/bin/env node
/**
 * Pages 镜像部署：把 dist 推到一个独立的 <repo>-pages 仓库，
 * GitHub Pages 指向它，镜像站与 Vercel 生产走同一份构建产物。
 *
 * 需要的 secret：PAGES_PAT（classic PAT，仅对 <repo>-pages 仓库授予 contents:write 即可）
 * 环境变量：GH_OWNER / GH_REPO（Actions 注入），PAGES_PAT
 * 副作用：首次运行会自动创建 <repo>-pages 仓库（需要 gh CLI + GH_TOKEN，或仓库已存在）
 */
import { execSync, spawnSync } from 'node:child_process';
import { existsSync, rmSync, cpSync } from 'node:fs';

const PAT = process.env.PAGES_PAT;
if (!PAT) {
  console.error('[deploy-pages] 缺少 PAGES_PAT');
  process.exit(2);
}

const owner = process.env.GH_OWNER;
const repo = process.env.GH_REPO;
if (!owner || !repo) {
  console.error('[deploy-pages] 缺少 GH_OWNER / GH_REPO');
  process.exit(2);
}

const pagesRepo = `${owner}/${repo}-pages`;
const clone = `https://x-access-token:${PAT}@github.com/${pagesRepo}.git`;
const workdir = `${process.cwd()}/pages-workdir`;

const run = (cmd, opts = {}) => execSync(cmd, { stdio: 'inherit', ...opts });

// 1. 克隆（已有则更新）
if (existsSync(workdir)) rmSync(workdir, { recursive: true, force: true });
let cloned = true;
try {
  run(`git clone --depth 1 "${clone}" "${workdir}"`);
} catch {
  // 仓库不存在或为空：本地初始化
  run(`mkdir -p "${workdir}" && git init -b main "${workdir}" && git -C "${workdir}" remote add origin "${clone}"`);
  cloned = false;
}

// 2. 清空并拷入 dist
run(`rm -rf "${workdir}/." && cp -r dist/. "${workdir}/"`);
run(`git -C "${workdir}" add -A`);
run(
  `git -C "${workdir}" -c user.name="ci" -c user.email="ci@users.noreply.github.com" ` +
    `commit -m "pages mirror $(new Date().toISOString())" --allow-empty`
);

// 3. 推送（首次需创建仓库，尝试 gh api 自动建）
try {
  run(`git -C "${workdir}" push -f origin main`);
} catch {
  const gh = spawnSync('gh', ['repo', 'create', pagesRepo, '--private', '--allow-empty'], {
    stdio: 'inherit',
  });
  if (gh.status === 0) {
    run(`git -C "${workdir}" push -f origin main`);
  } else {
    throw new Error('[deploy-pages] 推送失败，且 gh 自动建仓失败');
  }
}

console.log(`[deploy-pages] dist → ${pagesRepo} @ main`);
console.log(`[deploy-pages] Pages 站点请在 Settings → Pages 指向 ${repo}-pages@main`);
