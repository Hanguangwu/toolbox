/**
 * 站点绝对地址的唯一来源。
 *
 * 优先级（从高到低）：
 *   1. SITE_URL                        —— 显式覆盖（本地验证、Pages 镜像、预览环境）
 *   2. VERCEL_PROJECT_PRODUCTION_URL   —— Vercel 项目设置里的生产域名；
 *                                         在 Vercel 控制台绑定自定义域名后会变成该域名，
 *                                         因此"域名只在 Vercel 改一处"
 *   3. VERCEL_URL                     —— 当前部署地址（没有生产域名时兜底）
 *   4. http://localhost:4321           —— 本地开发
 *
 * 所有派生地址（canonical / og:url / sitemap / robots）都只读这一处，避免多处硬编码漂移。
 */

const LOCAL = 'http://localhost:4321';

/** 补协议、去掉尾部斜杠；保留子路径（Pages 镜像可能部署在 /repo 下） */
export function normalizeSiteUrl(raw) {
  const value = String(raw ?? '').trim();
  if (!value) return '';

  let withProtocol = value;
  if (!/^https?:\/\//i.test(withProtocol)) withProtocol = `https://${withProtocol}`;

  try {
    const url = new URL(withProtocol);
    const path = url.pathname.replace(/\/+$/, '');
    return `${url.protocol}//${url.host}${path}`;
  } catch {
    return '';
  }
}

export function resolveSiteUrl(env = process.env) {
  const chain = [
    ['SITE_URL', env.SITE_URL],
    ['VERCEL_PROJECT_PRODUCTION_URL', env.VERCEL_PROJECT_PRODUCTION_URL],
    ['VERCEL_URL', env.VERCEL_URL],
  ];

  for (const [, raw] of chain) {
    const url = normalizeSiteUrl(raw);
    if (url) return url;
  }

  return LOCAL;
}

/** 是否落在本地回环地址（用于阻止"带着 localhost 上线"） */
export function isLocalUrl(url) {
  try {
    const { hostname } = new URL(url);
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
  } catch {
    return false;
  }
}

/**
 * 给 astro.config 用：解析 + 在 CI 里拒绝 localhost，避免 sitemap/canonical 带着本地地址发布。
 * 抛错比静默产出坏 SEO 更安全。
 */
export function resolveSiteUrlForBuild(env = process.env) {
  const url = resolveSiteUrl(env);

  if (isLocalUrl(url) && env.CI) {
    throw new Error(
      '[site-url] 在 CI 中解析到 localhost。请设置 SITE_URL，或确保 VERCEL_PROJECT_PRODUCTION_URL / VERCEL_URL 已注入。'
    );
  }

  if (!env.CI && isLocalUrl(url)) {
    console.warn(
      '[site-url] 使用本地地址 http://localhost:4321 构建；canonical 与 sitemap 仅适合本地预览。'
    );
  }

  return url;
}
