import type { APIRoute } from 'astro';
import { absolute } from '../lib/url';

export const GET: APIRoute = ({ site }) => {
  const sitemap = absolute('/sitemap.xml', site);

  const body = `User-agent: *
Allow: /

Sitemap: ${sitemap}
`;

  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
