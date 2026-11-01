import { defineConfig } from 'astro/config';
import { resolveSiteUrlForBuild } from './scripts/site-url.mjs';

// 站点绝对地址只有一个来源：见 scripts/site-url.mjs 的优先级链。
// Vercel 上绑定自定义域名后，VERCEL_PROJECT_PRODUCTION_URL 会自动变成该域名，无需改代码。
const site = resolveSiteUrlForBuild();

// SITE_URL 带子路径时（Pages 镜像）把该路径作为 base，让 _astro 资源与站内链接都落在子路径下。
// 生产（Vercel 自定义域名）没有子路径，base 不生效。
const basePath = new URL(site).pathname.replace(/\/+$/, '');

export default defineConfig({
  site,
  base: basePath || undefined,
  build: { format: 'directory' },
  devToolbar: { enabled: false },
});
