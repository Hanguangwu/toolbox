import type { APIRoute } from 'astro';
import { tools, categoryCounts, tagCounts, TAG_MIN_FOR_PAGE } from '../lib/tools';
import { absolute } from '../lib/url';

const escape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const GET: APIRoute = ({ site }) => {
  const abs = (path: string) => absolute(path, site);

  const urls: Array<{ loc: string; changefreq: string; priority: string; lastmod?: string }> = [
    { loc: abs('/'), changefreq: 'daily', priority: '1.0' },
  ];

  for (const c of categoryCounts) {
    urls.push({ loc: abs(`/category/${c.id}/`), changefreq: 'weekly', priority: '0.8' });
  }

  for (const t of tagCounts.filter((t) => t.count >= TAG_MIN_FOR_PAGE)) {
    urls.push({ loc: abs(`/tag/${t.id}/`), changefreq: 'weekly', priority: '0.5' });
  }

  for (const t of tools) {
    urls.push({
      loc: abs(`/tool/${t.id}/`),
      changefreq: 'monthly',
      priority: '0.6',
      lastmod: t.updated_at,
    });
  }

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (u) =>
      `  <url><loc>${escape(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}<changefreq>${u.changefreq}</changefreq><priority>${u.priority}</priority></url>`
  )
  .join('\n')}
</urlset>
`;

  return new Response(body, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
};
