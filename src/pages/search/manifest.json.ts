import type { APIRoute } from 'astro';
import { tools, categoryCounts } from '../../lib/tools';

/**
 * 搜索索引清单：worker 先取这份清单，再按分片懒加载。
 * 分片按分类切分，单分片随分类规模增长，热度高的分类可单独预取。
 */
export const GET: APIRoute = () => {
  // 数据指纹：任一 entries 变化都会改变 version，便于 worker/客户端缓存失效
  const version = tools
    .map((t) => `${t.id}:${t.updated_at}`)
    .sort()
    .join('|')
    .split('')
    .reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 0xffffffff, 7)
    .toString(36);

  const body = {
    version,
    total: tools.length,
    shards: categoryCounts.map((c) => ({
      category: c.id,
      // 相对清单 URL 解析，天然兼容子路径部署
      url: `shards/${c.id}.json`,
      count: c.count,
    })),
  };

  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
};
