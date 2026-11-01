/**
 * 站内路径与绝对地址的唯一出口。
 *
 * SITE_URL 带子路径时（GitHub Pages 镜像 `https://<user>.github.io/<repo>`），
 * Astro 的 base 只会改写打包资源，不会改写字面量 href，所以所有站内链接都要过 withBase()。
 * 生产（Vercel + 自定义域名）base 为空，withBase 是恒等函数。
 */

const RAW_BASE = import.meta.env.BASE_URL || '/';

/** '' 或 '/toolbox'（不含尾部斜杠） */
export const BASE = RAW_BASE.replace(/\/+$/, '');

/** 把站内绝对路径加上 base */
export function withBase(path: string): string {
  if (!path.startsWith('/')) return path;
  if (!BASE) return path;
  return path === '/' ? `${BASE}/` : `${BASE}${path}`;
}

/** 站内路径的绝对地址（canonical / og:url / sitemap） */
export function absolute(path: string, site: URL | undefined): string {
  const origin = site ?? new URL('http://localhost:4321');
  return new URL(withBase(path), origin).href;
}
