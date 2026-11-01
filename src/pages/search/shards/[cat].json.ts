import type { APIRoute } from 'astro';
import { tools, categoryCounts, categoryName, tagName } from '../../../lib/tools';
import { docsFromTools } from '../../../lib/search-core';

export function getStaticPaths() {
  return categoryCounts.map((c) => ({ params: { cat: c.id } }));
}

export const GET: APIRoute = ({ params }) => {
  const cat = params.cat ?? '';
  const docs = docsFromTools(
    tools.filter((t) => t.category === cat),
    categoryName,
    tagName
  );

  return new Response(JSON.stringify(docs), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
    },
  });
};
