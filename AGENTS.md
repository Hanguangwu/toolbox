# AGENTS.md — Agent 维护守则

> 本仓库的内容真源是 `data/tools/<category>/<slug>.yaml`。
> Agent 负责批量收录、去重、文案治理；**数据与代码的边界不可逾越**。

## 角色分工

| 层 | 谁负责 | 边界 |
|---|---|---|
| 数据 | Agent | 只改 `data/tools/` 与 `data/taxonomy.yaml`（新增标签需说明理由） |
| 站点代码 | Agent | 改 `src/`、`scripts/`、`schema/` 需过三道闸 + 产物自检 |
| 部署 | CI | 人工配置 secret 后全自动；Agent 不碰 `vercel deploy` 与 secret |

## 新增 / 修改一个工具

1. 选定 `category` 与 1–5 个 `data/taxonomy.yaml` 中已有的标签；
2. 按 `schema/tool.schema.json` 创建 `data/tools/<category>/<id>.yaml`；
3. `id` 必须与文件名一致，`category` 必须与目录一致；
4. `description` 一句话，禁营销词（校验器会告警）；`how` 实现方式一句话（语言/架构/机制/协议，20–300 字，非必填但实现清晰的工具建议填，会进搜索索引）；`source` 填事实来源 URL（published 条目必填）；
5. 跑 `pnpm validate`，0 error 后提交。

**批次维护规则**：
- 去重主键：`repo`（GitHub 仓库全名）与归一化 `url` 唯一；
- 同一工具只进一个分类，禁止跨目录复制文件；
- 新增标签前先用 taxonomy 里已有标签；确需新增时在 PR 描述里说明"为什么现有标签不够"。

## 三道闸 + 产物自检

CI 顺序（`.github/workflows/ci.yml`）：

1. `pnpm validate` — schema / 词表 / 去重 / 路径一致性；
2. `pnpm test` — 搜索内核单测 + 站点地址解析单测；
3. `pnpm build`（带 `SITE_URL`）+ `pnpm verify:dist` — 产物存在性、canonical 不得是 localhost/占位域、分片一致性。

## 域名 / SITE_URL

- 唯一来源：`scripts/site-url.mjs` 优先级链 `SITE_URL > VERCEL_PROJECT_PRODUCTION_URL > VERCEL_URL > GITHUB_PAGES_URL > localhost`；
- **生产**：Vercel 控制台绑定自定义域名后，`vercel-domain.mjs` 从 Vercel API 拉出该域名注入构建；换域名不改代码；
- **Pages 镜像**：`GITHUB_PAGES_URL`（`<owner>.github.io/<repo>`）兜底；
- `CI=1` 且解析到 localhost → 构建直接失败（守卫）；
- canonical / og:url / sitemap / robots 全部派生自 `Astro.site`，禁止在别处硬编码。

## 需要人工提供的 secret

| Secret | 用途 | 权限 |
|---|---|---|
| `VERCEL_TOKEN` | `vercel deploy --prebuilt` | 项目部署 |
| `VERCEL_ORG_ID` | 多 org 账号定位 | 只读 |
| `VERCEL_PROJECT_ID` | 显式指定项目（推荐） | 只读 |
| `PAGES_PAT` | Pages 镜像推送到 `<repo>-pages` | 仅该仓库 `contents:write` |

## 禁止事项

- 不把 `raw/`（剪藏素材）提交进仓库；
- 不把 LOGO 外链写进 YAML（`logo` 字段必须是 `/logos/` 站内路径，`logo_source` 保留原始出处）；
- 不删 `data/.cache/` 之外的真实数据；
- 不在 `data/tools/` 之外复制条目（一个工具只进一个分类）。
