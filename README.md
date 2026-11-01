# 工具岛 · Toolbox

一个卡片式的工具集展示站：每个工具一条结构化数据，带分类与标签，支持中英文即时搜索。

- 设计报告：[`docs/design-report.md`](docs/design-report.md)
- 内容真源：`data/tools/<category>/<slug>.yaml`（一条目一文件）
- 词表：`data/taxonomy.yaml`（分类封闭、标签半封闭）
- 契约：`schema/tool.schema.json`（JSON Schema）

## 技术栈

Astro（静态构建） + 原生 CSS 变量 + 无依赖客户端筛选。生产部署目标为 Vercel，GitHub Pages 作为镜像。

## 命令

```bash
pnpm install
pnpm dev          # 本地开发 http://localhost:4321
pnpm build        # 构建到 dist/
pnpm preview      # 预览构建产物
pnpm validate     # 校验数据：schema + 词表 + 去重 + 路径一致性
pnpm test:search  # 搜索内核单测（分词/召回/分面/分页）
```

`pnpm validate` 失败会以非零退出码结束，CI 中用于阻断合并。加 `--json` 输出机器可读错误，便于 Agent 自我修复：

```bash
node scripts/validate.mjs --json
```

## 目录

```
data/tools/<category>/<slug>.yaml   # 工具条目（唯一真源）
data/taxonomy.yaml                  # 分类与标签词表
schema/tool.schema.json             # 字段契约
scripts/validate.mjs                # 数据校验
scripts/test-search.mjs             # 搜索内核单测
src/lib/tools.ts                    # 构建期加载与派生（分类/标签/平台计数、搜索串）
src/lib/search-core.ts              # 搜索内核：bigram 分词 + 索引 + 分面/分页（可被 Node 直接测试）
src/lib/search-worker.ts            # Web Worker：拉清单与分片、建索引、响应查询
src/scripts/island.ts               # 主线程：本地兜底 → worker 升级、高亮、分面、URL 同步
src/components/Card.astro           # 工具卡片（含无 LOGO 降级徽章）
src/pages/index.astro               # 搜索主舞台
src/pages/tool/[slug].astro         # 工具详情（静态生成）
src/pages/category/[slug].astro     # 分类页
src/pages/tag/[slug].astro          # 标签页（仅生成条目数 ≥ 3 的标签）
src/pages/search/manifest.json.ts   # 索引清单（数据指纹 + 分片列表）
src/pages/search/shards/[cat].json.ts # 按分类切分的搜索文档
src/pages/sitemap.xml.ts            # sitemap
src/styles/tokens.css               # 设计 Token
src/styles/site.css                 # 布局与组件样式
raw/                                # 剪藏素材（gitignore，不进构建）
```

## 搜索怎么工作

1. 页面 HTML 里已带 `data-s`（扁平搜索串）与 `data-tags/platforms`，首字输入即用本地子串匹配出结果，不需要等 JS 索引；
2. 同页启动 Web Worker，拉 `/search/manifest.json` 与各分类分片（`docsFromTools` 产物），用 MiniSearch 建索引；
3. 索引就绪后自动"升级"：分词为中文相邻二字 bigram + 拉丁小写单词，多词先 AND、全落空再退化 OR；
4. 分面计数来自当前查询结果（分类忽略自身维度、标签 AND、平台 OR），零结果的分面自动置灰；
5. 结果分页 48/页，DOM 节点复用，只切 `hidden` 与 `order`，不重建卡片。

## 新增一个工具

1. 选定 `category` 与 1–5 个 `taxonomy.yaml` 中已有的标签；
2. 按 `schema/tool.schema.json` 创建 `data/tools/<category>/<id>.yaml`；
3. `id` 必须与文件名一致，`category` 必须与目录一致；
4. 跑 `pnpm validate`，0 error 后提交。

批次维护规则（去重、文案、标签治理）将在 P2 写入 `AGENTS.md`。

## 当前进度

- [x] **P0** 骨架：schema、词表、校验器、23 条种子数据、卡片网格、详情页、即时筛选
- [x] **P1** 搜索 island（Worker 索引 + 分面 + 分页 + 高亮）、分类页/标签页、sitemap/robots、搜索单测
- [ ] **P2** Vercel 生产 + Pages 镜像、CI、`AGENTS.md`、GitHub 批量导入
- [ ] **P3** Neon（可选）：数据治理镜像、死链巡检、0 结果词
- [ ] **待补** 展示字体子集化（当前用系统字体栈，零字体请求）
