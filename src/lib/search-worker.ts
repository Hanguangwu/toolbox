/// <reference lib="webworker" />
import { buildIndex, runQuery, type SearchDoc } from './search-core';

type InitMsg = { type: 'init'; manifestUrl: string };
type QueryMsg = {
  type: 'query';
  seq: number;
  q: string;
  categories: string[];
  tags: string[];
  platforms: string[];
  page: number;
  pageSize: number;
};
type InMsg = InitMsg | QueryMsg;

let index = buildIndex([]);
let docs: SearchDoc[] = [];
let ready = false;

self.addEventListener('message', async (event: MessageEvent<InMsg>) => {
  const msg = event.data;

  if (msg.type === 'init') {
    try {
      const manifest = (await fetch(msg.manifestUrl).then((r) => {
        if (!r.ok) throw new Error(`manifest ${r.status}`);
        return r.json();
      })) as { shards: Array<{ url: string }> };

      const shards = await Promise.all(
        manifest.shards.map((s) =>
          fetch(new URL(s.url, msg.manifestUrl).href).then((r) => {
            if (!r.ok) throw new Error(`shard ${r.status}`);
            return r.json() as Promise<SearchDoc[]>;
          })
        )
      );

      docs = shards.flat();
      index = buildIndex(docs);
      ready = true;
      self.postMessage({ type: 'ready', total: docs.length });
    } catch (error) {
      self.postMessage({ type: 'error', message: String(error) });
    }
    return;
  }

  if (msg.type === 'query') {
    if (!ready) {
      self.postMessage({ type: 'error', message: 'index not ready' });
      return;
    }
    const result = runQuery(index, docs, msg, msg.page, msg.pageSize);
    self.postMessage({ type: 'results', seq: msg.seq, ...result });
  }
});
