# 工具集展示站 · 架构与设计报告

> 版本 v0.2 ｜ 2026-11-01 ｜ 状态：关键决策已确认
> 目标读者：项目所有者、后续接手的 AI Agent、前端实现者
>
> **v0.2 变更**：① 生产站由 GitHub Pages 翻转为 **Vercel**（自定义域名走 Vercel 控制台），Pages 降为镜像/灾备；② **取消拼音搜索**，检索范围锁定"中文字符 + 英文单词"；③ **取消用户提交入口**，Neon 降级为可选增强；④ 数据来源统一为 **GitHub 仓库及其关联官网**；⑤ 1000+ 是未来上限而非当前目标，前期按数百条规模建设并保留迁移路径。

---

## 0. 决策速览（TL;DR）

| # | 决策 | 结论 |
|---|---|---|
| 1 | 内容真源 | **Git 仓库内的 `data/tools/**/*.yaml` 是唯一真源**；Neon 只是派生读模型 |
| 2 | 前端框架 | **Astro**（SSG + 少量 island），不用 Next.js |
| 3 | 搜索 | **客户端为主**：Web Worker 内构建索引，文档 JSON 按分类分片懒加载；支持"中文 + 英文单词"混合查询，**不做拼音**；服务端搜索仅作可选兜底 |
| 4 | 搜索库 | **Orama 或 MiniSearch** + `Intl.Segmenter('zh')` 分词 + bigram 兜底，不用 Pagefind 做主搜索 |
| 5 | 部署分工 | **Vercel = 生产站（绑自定义域名）+ PR 预览 + API**；**GitHub Pages = 自动镜像站（灾备/副入口）**；Neon 故障不影响站点可用性 |
| 6 | 数据粒度 | **一条目一文件**，按分类分目录；天然避免多 Agent 并发写冲突 |
| 7 | 分类/标签 | 分类**封闭枚举**（12 个）；标签**半封闭词表**（约 120 个，新增需说明理由） |
| 8 | LOGO | **构建期下载本地化**，禁止热链；无 LOGO 用"首字母岛屿徽章"降级 |
| 9 | 1000+ 的渲染 | 列表**分页渲染**（48/页）+ 每工具独立静态详情页保证 SEO |
| 10 | 风格实现 | 纯 CSS 变量实现 AC 风格，不引入动画库；背景纹理 ≤20KB |
| 11 | 数据来源 | **仅从 GitHub 仓库及其关联官网抓取**，无用户提交入口；`repo` 字段即去重主键之一 |
| 12 | 无算命名的取舍 | 不引入拼音库、不做拼音索引；靠 `aliases`（英文名/曾用名/中文简称）覆盖召回 |
| 13 | 商业属性 | **非商用** → Vercel Hobby 可用，整套方案落在 $0 免费额度内 |

**一句话架构**：Agent 写 YAML → Actions 校验 → Astro 构建静态站 + 搜索分片 → Vercel 上线（Pages 同步镜像）；同一份清单同步进 Neon，供死链巡检、0 结果词和 Agent 用 SQL 做数据治理。

---

## 1. 需求与约束拆解

### 1.1 明确需求

| 需求 | 隐含工程要求 |
|---|---|
| 卡片展示工具名/描述/链接/可选 LOGO | 字段可空、空态设计、图片失效降级 |
| 每个工具有标签和分类 | 受控词表 + CI 校验，否则 1000 条后必然失控 |
| 高效搜索 | 首字即出结果（<50ms）、支持中文、键盘可达、筛选可组合、状态可分享（URL 同步） |
| 描述由 AI Agent 维护 | 机器可读 schema、幂等写入、去重规则、可回滚、单条改动可 review |
| 上千条规模 | 构建时间、索引体积、DOM 数量、图片流量、Git 冲突 |
| 指定栈 | Actions / Pages / Vercel / Neon 四者都要有合理位置，不能有一个是摆设 |

### 1.2 现状

仓库为空（无提交），仅有 `raw/` 下约 40 篇 Obsidian Web Clipper 剪藏 Markdown，frontmatter 含 `title/source/created/description/tags`，正文为工具介绍。**这批文件是素材，不是数据**——结构不统一、含营销腔、含重复（已见 `DSH-Android` 与 `为什么越来越多人用OpenWiki` 各两份）。

### 1.3 非目标（明确不做）

- 不做用户账号体系、收藏、评论、**提交入口**（已确认：数据只从 GitHub 仓库与官网抓取）
- 不做工具的在线运行/托管（只做索引与跳转）
- 不做服务端渲染的动态页面（除 API）
- **不做拼音/首字母搜索**（已确认：只支持中文字符与英文单词）
- 不做多语言站点（先做 `zh-CN`，但 schema 预留 `aliases` 承载英文名与别名）

---

## 2. 总体架构

```
     GitHub 仓库 / 关联官网（只读抓取）
                    │
                    ▼
  ┌──────────────────────────────────────────┐
  │  data/tools/<category>/<slug>.yaml       │  ← 唯一真源
  │  data/taxonomy.yaml (分类 + 标签词表)     │
  │  AGENTS.md (编辑契约)                     │
  └───────────────┬──────────────────────────┘
                  │ git push / PR
                  ▼
  ┌──────────────────────────────────────────┐
  │ GitHub Actions                           │
  │ ① validate  schema / 词表 / 去重 / 死链   │
  │ ② build     Astro → dist/ + search/*.json│
  │ ③ deploy    → Vercel（生产，--prod）      │
  │ ④ mirror    → GitHub Pages（同一产物）    │
  │ ⑤ sync      → Neon（可选，幂等 upsert）   │
  └───────┬───────────────────────┬──────────┘
          │                       │
┌─────────▼───────────────┐  ┌────▼──────────────────┐
│ Vercel（生产）           │  │ GitHub Pages（镜像）   │
│ · 自定义域名（控制台配置）│  │ · 同一构建产物         │
│ · 静态页 + search 分片    │  │ · 灾备 / 副入口        │
│ · /api/search（可选兜底） │  └───────────────────────┘
│ · PR 预览（自动）         │
└─────────┬───────────────┘
          │ @neondatabase/serverless
          ▼
  ┌──────────────────────────────────────────────┐
  │ Neon Postgres（可选增强，站点不依赖）          │
  │ tools_mirror · link_health · search_queries   │
  └──────────────────────────────────────────────┘
```

### 2.1 职责矩阵（谁负责什么，为什么）

| 组件 | 职责 | 不负责 | 理由 |
|---|---|---|---|
| Git + YAML | 内容真源、版本、评审、回滚 | 运行时查询 | Agent 最擅长改文本；diff 可审；无需凭证 |
| GitHub Actions | 校验、构建、部署 Vercel、镜像 Pages、同步 Neon | 运行时业务逻辑 | 免费额度足够，与仓库天然同源 |
| **Vercel** | 生产托管、自定义域名、缓存/安全响应头、PR 预览、≤2 个 API 路由 | 内容真源、构建（构建在 Actions 完成） | 响应头控制与预览部署是 Pages 给不了的；非商用 → Hobby 合规 |
| **GitHub Pages** | 同一构建产物的镜像站，灾备与副入口 | 动态能力、响应头控制 | 零额外成本；Vercel 配额或项目异常时仍有可访问副本 |
| **Neon** | 写后派生、死链巡检、0 结果词（全部可选） | 内容真源、站点渲染路径 | 站点 100% 静态，DB 故障不影响可用性 |

> **为什么生产放在 Vercel 而不是 Pages**（推翻了 v0.1）：① 用户明确要在 Vercel 控制台配置自定义域名；② Pages 无法设置 `Cache-Control`/`Content-Security-Policy` 等响应头，而 Vercel 用 `vercel.json` 一行搞定；③ 未来兜底搜索 API 与静态站同域，省一次跨域与 CORS 配置。
> **为什么仍保留 Pages**：同一个 `dist/` 多跑一个 `deploy-pages`，成本约 30 秒，换来一个独立域名的只读副本——这是最便宜的灾备。

**关键设计原则：单向数据流。** Neon 永远不写回 Git。所有内容变更必须经过 PR，否则 Agent 的修改会失去可审性和可回滚性。

---

## 3. 技术选型

### 3.1 Astro vs Next.js vs Vite+React

| 维度 | Astro（推荐） | Next.js | Vite + React |
|---|---|---|---|
| 1000+ 静态页构建 | 快（~10–40s 量级） | 中等，`output:'export'` 后优势尽失 | 需自建路由/SSG |
| 客户端 JS | 默认 0，按需 island | 较大 baseline | 全量 SPA |
| 图片优化 | `astro:assets` 构建期处理 | `export` 模式下不可用 | 需自建 |
| SEO / sitemap | 一等公民 | 好 | 需插件 |
| Pages 部署 | 纯静态，完美 | 纯静态可行但更重 | 需配置 |
| 后续加 API | 交给 Vercel 独立函数 | 内建 | 内建 |

**结论：Astro。** 这是一个"内容目录 + 一个搜索 island"的站点，Next 的 SSR/ISR/RSC 全部用不上，而 `output: 'export'` 会阉割 Image Optimization——选它等于付了成本拿不到收益。

### 3.2 目录结构

```
toolbox/
├─ AGENTS.md                  # Agent 编辑契约（≤250 行，正文精髓）
├─ README.md
├─ astro.config.mjs
├─ vercel.json                # 缓存头 / 安全头 / 构建配置
├─ package.json
├─ data/
│  ├─ taxonomy.yaml           # 分类枚举 + 标签词表 + 同义词映射
│  └─ tools/
│     ├─ ai/
│     │  ├─ cyberchef.yaml
│     │  └─ ...
│     ├─ dev/
│     └─ ...
├─ schema/
│  └─ tool.schema.json        # JSON Schema，CI 与编辑器共用
├─ src/
│  ├─ pages/
│  │  ├─ index.astro          # 搜索主舞台
│  │  ├─ category/[slug].astro
│  │  ├─ tag/[slug].astro     # 仅生成条目数 ≥3 的标签
│  │  ├─ tool/[slug].astro
│  │  └─ 404.astro
│  ├─ components/  Card.astro SearchIsland.tsx Facets.astro Badge.astro
│  ├─ layouts/     Base.astro
│  ├─ lib/         load-tools.ts  build-index.ts  slug.ts
│  └─ styles/      tokens.css  card.css
├─ public/
│  ├─ logos/                  # 构建期本地化的 LOGO（WebP，≤8KB/个）
│  └─ textures/paper.webp
├─ scripts/
│  ├─ validate.mjs            # schema + 词表 + 去重 + URL 规范化
│  ├─ check-links.mjs         # 死链巡检（cron）
│  ├─ sync-neon.mjs           # 增量同步
│  ├─ import-github.mjs       # GitHub REST 抓取 → 生成候选 YAML
│  ├─ import-raw.mjs          # raw/ 剪藏 → data/tools/ 半自动导入
├─ .github/workflows/
│  ├─ ci.yml  deploy.yml  sync-neon.yml  link-check.yml
└─ raw/                       # .gitignore，仅本地 Agent 输入工作区
```

> `raw/` 建议加入 `.gitignore`：当前 40 篇已占数百 KB～MB 级，扩到上千篇会显著拖慢 clone，且它是中间产物而非资产。若需归档，放 `archive/` 并设置大小上限、排除出构建。

---

## 4. 数据模型与内容管线

### 4.1 字段 Schema

| 字段 | 必填 | 类型 | 约束 | 说明 |
|---|---|---|---|---|
| `id` | ✅ | string | `^[a-z0-9][a-z0-9-]{1,63}$`，**发布后不可变** | 同时作为 slug 与主键 |
| `name` | ✅ | string | ≤60 字符 | 官方名称原文，保留英文大小写 |
| `description` | ✅ | string | 30–90 个汉字（或 ≤160 字符） | 句式：做什么 + 给谁 + 关键差异 |
| `url` | ✅ | string(uri) | https，构建前 200/301 校验 | 官方入口 |
| `category` | ✅ | enum | 必须命中 `taxonomy.yaml` | 单选 |
| `tags` | ✅ | string[] | 1–5 个，词表内 | 小写 kebab-case |
| `logo` | ⬜ | string(uri) | 构建期下载到 `public/logos/<id>.webp` | 原始外链只存 `logo_source` |
| `aliases` | ⬜ | string[] | ≤5 | 搜索用：英文名/曾用名/中文简称（**不含拼音**） |
| `platforms` | ⬜ | enum[] | `web, windows, macos, linux, android, ios, cli, docker` | 可筛选 |
| `open_source` | ⬜ | boolean | | 卡片打标 |
| `pricing` | ⬜ | enum | `free, freemium, paid, open-source` | 默认 `free` |
| `status` | ✅ | enum | `draft, published, deprecated` | 只有 `published` 进列表 |
| `source` | ⬜ | string(uri) | 描述的事实来源 | **反幻觉关键字段** |
| `repo` | ⬜ | string | `<owner>/<repo>` | **去重主键**；脚本从 GitHub API 自动填充 |
| `stars` | ⬜ | integer | 抓取时快照 | 仅用于默认排序与"热门"标记 |
| `license` | ⬜ | string | SPDX 标识或原文 | 详情页展示 |
| `added_at` / `updated_at` | ✅ | date | `YYYY-MM-DD` | CI 校验更新 |

**刻意保持字段精简**：每多一个可选字段，1000 条数据里就多一份不一致。`logo` 之外不要存颜色、不要存自定义排序权重（用 `featured` 布尔代替）。`repo` / `stars` / `license` 由脚本从 GitHub API 写入，**Agent 不手写这三个字段**——避免它们与真实仓库状态漂移。

### 4.2 示例条目

```yaml
# data/tools/security/cyberchef.yaml
id: cyberchef
name: CyberChef
description: 在浏览器本地完成编码解码、加解密与数据分析的拖拽式数据处理工作台，适合安全分析与 CTF 解题。
url: https://gchq.github.io/CyberChef/
category: security
tags: [encoding, crypto, offline, ctf]
aliases: [网络瑞士军刀, 编码解码]
platforms: [web]
open_source: true
pricing: open-source
status: published
repo: gchq/CyberChef
source: https://github.com/gchq/CyberChef
added_at: 2026-11-01
updated_at: 2026-11-01
```

```yaml
# data/tools/media/piclite.yaml
id: piclite
name: PicLite 图轻
description: 本地批量压缩图片与 GIF 的桌面工作台，支持格式转换、水印与目标体积控制，文件不上传。
url: https://amiaoapp.github.io/PicLite/
logo_source: https://github.com/amiaoapp.png
category: media
tags: [image-compression, gif, batch, privacy]
platforms: [web, windows, macos, linux, docker]
open_source: true
pricing: open-source
status: published
repo: amiaoapp/PicLite
source: https://github.com/amiaoapp/PicLite
added_at: 2026-11-01
updated_at: 2026-11-01
```

### 4.3 数据获取流程（GitHub 仓库 + 关联官网）

数据只从 GitHub 仓库及其 README 中声明的官网抓取，**没有用户提交入口**。

```
输入：GitHub repo URL（人工或 Agent 给出，可批量）
  ① 抓取  GET /repos/{owner}/{repo}
          → name, description, homepage, topics[], license, stargazers_count,
            owner.avatar_url, archived, default_branch
          GET /repos/{owner}/{repo}/readme   (Accept: application/vnd.github.raw)
  ② 定入口 homepage 为空 → 取 repo 的 GitHub Pages 地址；仍为空 → 只保留开源仓库本身
  ③ 归一化 Agent 依 README 写 description（30–90 汉字），topics → 候选标签（受词表约束）
  ④ 查重  repo 全名相同 = 重复；名称 trigram ≥0.85 或同 owner + 同名 = 疑似合并
  ⑤ 落盘  data/tools/<category>/<slug>.yaml
  ⑥ 校验  pnpm validate（0 error 才可提交）
```

**抓取工程细节**

- 速率限制：未认证 60 次/小时，认证后 5000 次/小时。Actions 里的 `GITHUB_TOKEN` 额度较低（约 1000 次/小时/仓库），批量导入应使用独立的 PAT 并分片限流。
- 缓存：抓取结果写入 `data/.cache/github/<owner>__<repo>.json`（**gitignore**），重跑命中缓存不重复请求。
- 归档仓库（`archived: true`）默认不入库，或入 `status: deprecated`。
- 官网可达性：抓取时顺带 `HEAD homepage`，失败则回退为 repo 地址并记录，不阻断导入。
- **AI 只做改写与分类，不做事实生成**：`description` 中的功能断言必须能在 README 里找到对应句子；找不到就不写。

### 4.4 分类与标签治理

**分类（12 个，封闭）**：`ai` `dev` `design` `media` `security` `data` `productivity` `writing` `learning` `system` `web` `life`。

- 分类是**一级导航**，必须稳定。新增分类需人工批准，且该分类下已有 ≥30 条才立项。
- 不要为"看起来更丰富"拆分类（`ai-writing` 与 `ai` 并存 = 灾难）。

**标签（半封闭，目标 100–150 个）**：

- 小写 kebab-case，单数，禁止同义并存（`image-compress` / `image-compression` 只留一个）。
- `taxonomy.yaml` 维护 `canonical + aliases` 映射，CI 自动把别名改写成 canonical。
- 硬约束：**单条目 ≤5 个标签**；**单标签条目数 ≥3 才生成标签页**（否则是薄页面，伤 SEO）。
- 超过 150 个时触发"标签通胀"告警，进入合并流程。

---

## 5. 搜索方案（核心）

### 5.1 先算清楚数据量

1000 条 ×（名称 24B + 描述 270B + 标签 30B + 分类 10B）≈ **350KB 原始 JSON**；5000 条 ≈ 1.7MB。**整个语料小到可以完整放进浏览器**——这是本方案最重要的判断，它直接决定了"不需要服务端搜索"。

| 规模 | 文档 JSON（gzip） | 预建倒排索引（估算） | 客户端建索引耗时 | 检索延迟 |
|---|---|---|---|---|
| 1,000 | ~110KB | ~600KB | 80–200ms | <5ms |
| 5,000 | ~520KB | ~3MB | 300–700ms | <15ms |
| 10,000 | ~1MB | ~6MB | 0.8–1.5s | <30ms |

> 索引体积估算基于 CJK bigram 倒排的经验值，实施时用真实语料实测一次并写回本表。

### 5.2 方案对比

| 方案 | 1k | 5k | 10k | 中文 | 实现复杂度 | 成本 |
|---|---|---|---|---|---|---|
| **A. 客户端文档 + Worker 建索引**（推荐） | 极佳 | 佳 | 可用 | 需自定分词 | 低 | $0 |
| B. 预建索引分片（Pagefind 式） | 佳 | 佳 | 极佳 | 扩展版支持分词 | 中（多一条 HTML 索引管线） | $0 |
| C. 单 JSON + Fuse.js 模糊匹配 | 佳 | 一般（全表扫描） | 差 | 弱 | 极低 | $0 |
| D. Vercel Function + Neon FTS | 佳 | 佳 | 佳 | **需自行做 bigram 列** | 高 | 近 $0，但引入冷启动 200–500ms |

### 5.3 推荐方案：分层客户端搜索 + 服务端兜底

**分层加载**

1. **L0 首屏**：内联"轻索引"——仅 `id + name + aliases + tags`（约 60B/条，1000 条 ≈ 60KB / gzip ~20KB）。保证输入第一个字就有结果。
2. **L1 空闲**：`requestIdleCallback` 触发，按分类分片拉取完整文档（`/search/docs/<category>.json`），在 **Web Worker** 中构建 Orama/MiniSearch 索引。
3. **L2 兜底**：当语料 >10k 或 L1 加载失败，`/api/search`（Vercel Function + Neon）接管，前端无感切换。

**中文分词**

```ts
// Intl.Segmenter 在现代浏览器可用，直接做中文词切分
const seg = new Intl.Segmenter('zh-CN', { granularity: 'word' });
function tokenize(text: string): string[] {
  const words = [...seg.segment(text)]
    .filter(s => s.isWordLike)
    .map(s => s.segment.toLowerCase());
  // 补 bigram，解决"图片压缩" vs "图片 压缩" 及分词粒度不一致
  const bigrams = [];
  const han = text.replace(/[^\u4e00-\u9fa5a-z0-9]/gi, '');
  for (let i = 0; i < han.length - 1; i++) bigrams.push(han.slice(i, i + 2));
  return [...new Set([...words, ...bigrams])];
}
```

- `Intl.Segmenter` 不可用时（Safari 老版本）降级为纯 bigram——中文子串召回依然可靠，只是索引略大。
- **检索范围（已确认）**：中文按字/词，英文按单词（小写 + 前缀匹配）。**不做拼音、不引拼音库**；`aliases` 用来兜底召回（`PicLite` / `图轻` / `pic lite`），不承担拼音职责。
- 混合查询必须命中：`压缩`、`image compress`、`piclite 压缩`、`图 压` 四种输入都应返回合理结果。

**排序公式**

```
score = 4.0 × exactName
      + 3.0 × namePrefix
      + 2.0 × aliasMatch
      + 1.5 × tagExact
      + 1.0 × categoryMatch
      + 0.6 × descriptionMatch
      + 0.4 × fuzzy(编辑距离≤2)
      + 0.3 × featured
```

标题命中权重远高于描述，避免"描述里提了一嘴"的工具挤掉真正叫这个名字的工具。

**分面与组合逻辑**

- 维度：`q`（关键词）、`category`（单选）、`tags`（多选 AND）、`platform`（多选 OR）、`pricing`（单选）。
- 每个分面 chip 显示**在当前其他条件下**的命中计数（facet count），为 0 的置灰不可点——这是"结果太多等于没有结果"的主要解法。
- 条件全部写入 URL：`/?q=压缩&category=media&tags=gif,batch`，支持刷新、分享、前进后退。
- 默认排序 `relevance`，可切 `name` / `recent`。
- 空搜索态：按分类展示 Top 精选（每类 6 条）+ 热门标签，而不是给一片空白。

**渲染策略**

- 一次只渲染 48 张卡片 + "加载更多"（或 IntersectionObserver 无限加载）。
- 1000 张卡片全量进 DOM ≈ 数万节点，首屏内存与样式计算都会崩——必须分页。
- 卡片网格使用 `content-visibility: auto` + `contain-intrinsic-size`，滚动时跳过屏外布局。

**为什么不用 Pagefind 做主场**

Pagefind 很优秀（2496 页 → 27 个索引分片，~2.3s 建完），但它是**为"整页文档检索"设计**的：它索引渲染后的 HTML，不理解"这是工具名/这是标签/这是分类"，做字段加权和分面计数要绕。我们的数据本来就是结构化的，用同一份 JSON 同时驱动渲染和检索更直接、更可控。**保留 Pagefind 作为备选**：如果未来每个工具都长出长文文档/教程，再用它做"全文搜索"第二入口。

### 5.4 服务端搜索（Phase 3）

当语料 >10k 或需要跨端搜索历史时启用：

```sql
-- Neon 上 zhparser/pg_jieba 一般不可装，走 bigram 列 + pg_trgm
ALTER TABLE tools_mirror
  ADD COLUMN search_bigrams text,          -- 同步时由脚本生成：中文 bigram + 英文词干
  ADD COLUMN search_tsv tsvector;          -- 仅英文/数字部分用 to_tsvector('simple', ...)

CREATE INDEX tools_bigrams_trgm ON tools_mirror USING gin (search_bigrams gin_trgm_ops);
CREATE INDEX tools_tsv_idx      ON tools_mirror USING gin (search_tsv);

-- 查询：中文子串 + 英文全文 两路召回后合并
SELECT id, name, similarity(search_bigrams, $1) AS sim
FROM tools_mirror
WHERE search_bigrams ILIKE '%' || $1 || '%' OR search_tsv @@ websearch_to_tsquery('simple', $1)
ORDER BY sim DESC LIMIT 30;
```

> 已验证：Neon Free 计划 100 CU-hours/项目、1GB 存储、闲置 5 分钟 scale-to-zero、唤醒"typically within a few hundred milliseconds"。因此服务端搜索必须假设**每次冷启动都有几百毫秒惩罚**，只能做兜底，不能做默认路径。

---

## 6. Neon 的定位与结构（可选增强）

### 6.1 该存什么

| 表 | 用途 | 写入方 | 读取方 |
|---|---|---|---|
| `tools_mirror` | 内容派生镜像，供 SQL 治理 | sync workflow | Agent、搜索兜底 API |
| `link_health` | 每日死链巡检结果 | link-check workflow | 站点"链接可能失效"角标 |
| `search_queries` | 搜索词 + 结果数（含 0 结果）｜**可选** | `/api/telemetry` 匿名 beacon | Agent 找内容缺口 |
| `tool_clicks` | 外链点击（聚合，不存 PII）｜**可选** | `/api/telemetry` | 排序调优 |

**已确认取消**：`submissions` 表与 `/api/submit` 接口——数据只从 GitHub 抓取，不接收用户提交。

### 6.2 为什么仍然保留 Neon

如果只做静态展示，Neon 确实可以完全省掉。保留它的三个真实理由：

1. **Agent 用 SQL 做数据治理**远快于解析上千个 YAML：找近重复（trigram 相似度）、找空分类、找标签孤岛、算分类条目占比，一条 SQL 搞定。这是**唯一随规模增长而价值上升**的用途。
2. **死链巡检每天写**，写进 Git 会污染提交历史；落库则站点只读、CI 只写。
3. **0 结果搜索词是"该补什么工具"的唯一客观信号**——在没有提交入口的前提下，这是内容增长的方向盘。代价是需要一个匿名 beacon（不存 IP/UA），若你不接受遥测，此表直接跳过，前两项仍成立。

**不保留的东西**：不做登录、不做用户表、不做内容写回。

### 6.3 DDL 草案

```sql
CREATE TABLE tools_mirror (
  id            text PRIMARY KEY,
  name          text NOT NULL,
  description   text NOT NULL,
  url           text NOT NULL,
  category      text NOT NULL,
  tags          text[] NOT NULL DEFAULT '{}',
  platforms     text[] NOT NULL DEFAULT '{}',
  pricing       text,
  open_source   boolean,
  status        text NOT NULL,
  repo          text,
  stars         int,
  logo_path     text,
  content_hash  text NOT NULL,           -- 跳过未变更行
  search_bigrams text,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);
CREATE INDEX ON tools_mirror (category) WHERE deleted_at IS NULL;
CREATE INDEX ON tools_mirror USING gin (tags);
CREATE INDEX ON tools_mirror USING gin (search_bigrams gin_trgm_ops);

CREATE TABLE link_health (
  tool_id     text PRIMARY KEY,
  http_status int,
  final_url   text,
  ok          boolean NOT NULL,
  checked_at  timestamptz NOT NULL DEFAULT now(),
  fail_count  int NOT NULL DEFAULT 0
);

-- 可选：仅在接受匿名 beacon 时启用
CREATE TABLE search_queries (
  id         bigserial PRIMARY KEY,
  q          text NOT NULL,
  result_cnt int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON search_queries (created_at);
```

### 6.4 同步与降级

- 触发：`push` 到 `main`（仅 `data/**` 变更）+ 每日 03:00 兜底。
- 幂等：`INSERT ... ON CONFLICT (id) DO UPDATE SET ... WHERE tools_mirror.content_hash <> EXCLUDED.content_hash`。
- 缺失条目：置 `deleted_at`，不物理删除（保留外键与历史）。
- 连接：`@neondatabase/serverless` 的 HTTP driver（无需连接池管理，冷启动友好）。
- **降级契约**：站点任何页面都不得在渲染期查询 Neon。DB 不可用 = 遥测与死链角标失效，主站照常。
- **可整体移除**：这三张表都不参与构建，因此 Neon 是可插拔的。若某天觉得维护成本不值，删掉 `sync-neon.yml` 与 `DATABASE_URL` 即可，站点零改动。

---

## 7. GitHub Actions 设计

| Workflow | 触发 | 关键步骤 | 失败策略 |
|---|---|---|---|
| `ci.yml` | PR（`data/**`, `src/**`） | install(cache) → `pnpm validate` → `astro check` → `astro build` → `pnpm test:search` | 阻断合并 |
| `deploy.yml` | push `main` | build → `vercel deploy --prebuilt --prod` → `upload-pages-artifact` → `deploy-pages`（镜像） | Vercel 失败则回滚到上次成功版本；**Pages 镜像失败不阻断** |
| `import-github.yml` | 手动 dispatch / 每周 | 输入 repo 列表 → `import-github.mjs`（限流分片）→ 自动开 PR | 不开 PR，输出失败清单 |
| `link-check.yml` | 每日 cron | 并发 HEAD 检查（≤50 并发）→ 写 `link_health` | 仅产出报告 |
| `sync-neon.yml` | push `main`（`data/**`）/ 每日 | `sync-neon.mjs` → 行数差异 >2% 则告警 | 不回滚站点 |

**PR 预览不需要 workflow**：Vercel 的 Git 集成会自动为每个 PR 生成预览 URL 并回帖评论，比 Actions 里手搓更可靠。

需要的 Secrets：`VERCEL_TOKEN`、`VERCEL_ORG_ID`、`VERCEL_PROJECT_ID`、`DATABASE_URL`（可选）、`GH_PAT`（批量抓取用，避免 `GITHUB_TOKEN` 低额度）。

关键工程细节：

- `permissions:` 最小化——deploy 需要 `pages: write, id-token: write, contents: read`；link-check 只需 `contents: read`。
- `concurrency: { group: deploy-${{ github.ref }}, cancel-in-progress: true }`，避免重复部署互相覆盖。
- 缓存 `~/.pnpm-store` 与 `node_modules/.astro`，数百条规模构建稳定在 1 分钟内。
- **把"校验"和"构建"拆成两个 job**：校验失败应在 30 秒内给 Agent 明确报错，而不是等构建完才失败。
- 校验脚本输出**机器可读错误**（JSON: `{file, field, message}`），Agent 才能自我修复。

```yaml
# .github/workflows/ci.yml 骨架
name: ci
on:
  pull_request:
    paths: ['data/**', 'src/**', 'schema/**', 'scripts/**']
permissions: { contents: read }
concurrency: { group: ci-${{ github.ref }}, cancel-in-progress: true }
jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm validate          # schema + 词表 + 去重 + URL 规范化
      - run: pnpm build             # 含搜索分片生成
```

---

## 8. 视觉与交互设计（动物森友会风格）

### 8.1 设计原则

1. **岛屿是容器，工具是住户**——背景给氛围，卡片给信息，两者不能抢。背景纹理必须低对比（≤8% 不透明度），否则 1000 张卡片会变成噪音。
2. **圆润但不幼稚**——24px 圆角 + 2px 手绘描边 + 4px 偏移"贴纸阴影"就够；不要给每张卡片加装饰插画。
3. **信息密度优先**——AC 风格最大的陷阱是"可爱=低密度"。解法：可爱只出现在**框架**（边框、背景、徽章、空态），**正文区域保持中性排版**。
4. **动效克制**——≤200ms，只做位移与阴影，不做弹跳循环（1000 张卡片同时弹跳会晕）。
5. **版权安全**——不使用任天堂角色图、截图、官方字体、音效。仅借鉴"温暖纸质 + 圆角 + 自然色"的风格语言。

### 8.2 设计 Token

```css
:root {
  /* 自然层（仅作背景/装饰，禁止用于正文） */
  --ac-sky:        #BFE3F2;
  --ac-sky-deep:   #8FC9E0;
  --ac-grass:      #8CC96B;
  --ac-grass-deep: #63A94A;
  --ac-sand:       #F3E3C3;

  /* 表面层 */
  --ac-paper:      #FFFDF6;   /* 页面底 */
  --ac-card:       #FFF9EC;   /* 卡片底 */
  --ac-card-alt:   #FFF4DE;   /* hover */
  --ac-wood:       #C89B6A;
  --ac-wood-deep:  #A87B4F;

  /* 文本（对比度按 WCAG AA 校验） */
  --ac-ink:        #4A4034;   /* on --ac-paper ≈ 10.4:1  ✅ */
  --ac-ink-soft:   #6E6257;   /* on --ac-paper ≈ 5.6:1   ✅ */
  --ac-ink-faint:  #948A7E;   /* 仅用于 ≥16px 次要信息，≈3.2:1 ⚠ 不用于正文 */

  /* 强调与语义 */
  --ac-accent:     #E8A33D;   /* 木质黄，按钮/高亮 */
  --ac-leaf:       #4C9A5B;   /* 品牌绿，成功/开源标记 */
  --ac-info:       #3F7FC1;
  --ac-warn:       #C9762B;
  --ac-danger:     #C4472F;

  /* 形状 */
  --ac-radius-sm: 10px;
  --ac-radius:    16px;
  --ac-radius-lg: 24px;
  --ac-border:    2px solid rgba(74, 64, 52, .16);
  --ac-shadow-sticker: 0 4px 0 rgba(74, 64, 52, .14);
  --ac-shadow-lift:    0 4px 0 rgba(74, 64, 52, .14), 0 12px 28px rgba(74, 64, 52, .10);

  /* 间距（4px 基准） */
  --sp-1: 4px; --sp-2: 8px; --sp-3: 12px; --sp-4: 16px;
  --sp-5: 24px; --sp-6: 32px; --sp-7: 48px; --sp-8: 64px;

  /* 字体阶梯 */
  --fs-xs: .75rem;  --lh-xs: 1.5;
  --fs-sm: .875rem; --lh-sm: 1.6;
  --fs-md: 1rem;    --lh-md: 1.75;
  --fs-lg: 1.25rem; --lh-lg: 1.4;
  --fs-xl: 1.75rem; --lh-xl: 1.3;

  /* 动效 */
  --ease-island: cubic-bezier(.2, .8, .2, 1);
  --dur-fast: 120ms;
  --dur: 160ms;
  --dur-slow: 200ms;
}
```

**对比度红线**：`--ac-sky` `--ac-grass` `--ac-sand` 这些马卡龙色**只能做背景/色块**，不得用于任何字号 <24px 的文字。所有正文用 `--ac-ink`。

### 8.3 字体

```css
:root {
  /* 展示层：仅用于站点标题、分类名、空态文案 —— 子集化后 ≤80KB */
  --font-display: "Resource Han Rounded CN", "LXGW WenKai", "Baloo 2",
                  system-ui, sans-serif;
  /* 正文层：系统字体，零下载成本，中文渲染最稳 */
  --font-body: -apple-system, BlinkMacSystemFont, "Segoe UI",
               "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei",
               "Noto Sans SC", sans-serif;
  /* 等宽：URL、版本号、快捷键 */
  --font-mono: "JetBrains Mono", ui-monospace, SFMono-Regular, Consolas, monospace;
}
```

- **不要全量引入中文字体**（一个完整中文圆体 3–8MB，直接毁掉首屏）。
- 展示字体**只子集化固定 UI 文案**（导航、12 个分类名、按钮、空态共约 100–300 字形），产出 30–80KB WOFF2；正文用系统栈。
- 中英混排：中文行高取 `1.75`（英文 1.5 会显得挤）；中西文之间用 `、`/空格自然分隔，不做额外 `letter-spacing`（中文加字距会破坏方块感）。
- 备选：`LXGW WenKai`（OFL，可商用）做引用/空态点缀。

### 8.4 布局

| 断点 | 容器宽 | 卡片列数 | 卡片最小宽 | 搜索框 |
|---|---|---|---|---|
| <640px | 100% − 32px | 1 | 100% | 全宽，吸顶 |
| 640–1023px | 720px | 2 | 300px | 全宽 |
| 1024–1439px | 1100px | 3 | 300px | 640px 居中 |
| ≥1440px | 1280px | 4 | 288px | 720px 居中 |

页面骨架：

```
┌─ 天空渐变 + 云层（纯 CSS，高度 220px，向下渐隐）─────┐
│   H1「工具岛」 一句话副标题                          │
│   ┌── 木牌搜索框 ────────────────── [⌘K] ──┐        │
│   └────────────────────────────────────────┘        │
│   热门标签： [压缩] [离线] [开源] [CLI] …            │
└──────────────────────────────────────────────────────┘
┌─ 筛选条（sticky）：分类 ▾ ｜ 平台 ▾ ｜ 排序 ▾ ｜ 已选 3 个 ✕ ─┐
└──────────────────────────────────────────────────────────────┘
┌─ 卡片网格 ──────────────────────────────────────────────────┐
│  [卡片] [卡片] [卡片] [卡片]                                │
│  [卡片] [卡片] [卡片] [卡片]                                │
│                    「加载更多（还有 812 个）」               │
└─────────────────────────────────────────────────────────────┘
```

### 8.5 工具卡片

**规格**：最小宽 288px｜内边距 18px 20px 16px｜圆角 20px｜描边 2px｜贴纸阴影 4px 无模糊。

**信息层级（自上而下）**：

```
┌──────────────────────────────────┐
│ [LOGO 40×40]  CyberChef      ↗   │  ← 名称 16px/600，链接箭头 hover 才显形
│                                  │
│ 在浏览器本地完成编码解码、加解密… │  ← 描述 14px/400，2 行截断
│                                  │
│ [安全] [编码] [离线] [CTF]       │  ← 分类徽章 + 标签 chip
└──────────────────────────────────┘
```

**无 LOGO 降级**：首字母 + 名称哈希配色（保证同一工具颜色稳定），形状为圆角方块，内嵌 1px 白色描边模拟"贴纸"。

```css
.card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
  min-width: 0;
  padding: 18px 20px 16px;
  background: linear-gradient(180deg, var(--ac-card) 0%, #FFF6E6 100%);
  border: var(--ac-border);
  border-radius: 20px;
  box-shadow: var(--ac-shadow-sticker);
  transition: transform var(--dur) var(--ease-island),
              box-shadow var(--dur) var(--ease-island);
  content-visibility: auto;
  contain-intrinsic-size: 180px;
}
.card:hover,
.card:focus-within {
  transform: translateY(-3px);
  box-shadow: var(--ac-shadow-lift);
}
.card:focus-visible {
  outline: 3px solid var(--ac-info);
  outline-offset: 2px;
}

.card__head { display: flex; align-items: center; gap: 12px; }

.card__logo,
.card__badge {
  flex: none;
  width: 40px; height: 40px;
  border-radius: 12px;
  border: 2px solid rgba(74, 64, 52, .10);
  object-fit: contain;
  background: #fff;
}
.card__badge {
  display: grid; place-items: center;
  font: 700 18px/1 var(--font-display);
  color: #fff;
  /* --h 由 JS 依名称哈希写入：hsl(var(--h) 42% 52%) */
  background: hsl(var(--h) 42% 52%);
  text-shadow: 0 1px 0 rgba(0, 0, 0, .18);
}

.card__name {
  flex: 1; min-width: 0;
  font-size: var(--fs-md); font-weight: 600; color: var(--ac-ink);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

.card__desc {
  font-size: var(--fs-sm); line-height: var(--lh-sm);
  color: var(--ac-ink-soft);
  display: -webkit-box; -webkit-box-orient: vertical;
  -webkit-line-clamp: 2; overflow: hidden;
  margin: 0;
}
.card__desc mark { background: #FFE9A8; color: inherit; border-radius: 3px; padding: 0 2px; }

.card__meta { display: flex; flex-wrap: wrap; gap: 6px; margin-top: auto; }

.chip {
  font-size: var(--fs-xs); line-height: 1.4;
  padding: 2px 9px; border-radius: 999px;
  background: #F0F6EC; color: #3C6B48;
  border: 1px solid rgba(60, 107, 72, .18);
}
.chip--category {
  background: #FBEFD8; color: #8A5A1E;
  border-color: rgba(138, 90, 30, .18); font-weight: 600;
}
```

> 为什么是"上-中-下"三段：名称与分类在**首次扫视（F 型）**的顶部横线上，描述承担**二次判定**，标签承担**三次过滤**。链接箭头只在 hover 出现，避免 1000 个 ↗ 图标形成视觉噪点。

### 8.6 搜索框（"木牌"）

```css
.search {
  display: flex; align-items: center; gap: 10px;
  width: min(720px, 100%);
  padding: 12px 16px;
  background: var(--ac-paper);
  border: 3px solid var(--ac-wood);
  border-radius: var(--ac-radius);
  box-shadow: inset 0 2px 0 rgba(255,255,255,.9),
              0 4px 0 rgba(168, 123, 79, .35);
  transition: border-color var(--dur) var(--ease-island),
              box-shadow var(--dur) var(--ease-island);
}
.search:focus-within {
  border-color: var(--ac-accent);
  box-shadow: inset 0 2px 0 rgba(255,255,255,.9),
              0 4px 0 rgba(232, 163, 61, .45),
              0 0 0 4px rgba(232, 163, 61, .18);
}
.search input {
  flex: 1; min-width: 0; border: 0; outline: 0; background: transparent;
  font: 400 16px/1.5 var(--font-body); color: var(--ac-ink);
}
.search input::placeholder { color: var(--ac-ink-faint); }

.kbd {
  font: 500 11px/1 var(--font-mono);
  padding: 3px 6px; border-radius: 6px;
  background: #EFE7D8; color: var(--ac-ink-soft);
  border: 1px solid rgba(74,64,52,.14);
  box-shadow: 0 1px 0 rgba(74,64,52,.14);
}
```

**交互规格**

| 行为 | 规格 |
|---|---|
| 聚焦 | `/` 或 `⌘/Ctrl + K` 聚焦并全选；`Esc` 清空并失焦 |
| 输入 | 防抖 80ms（本地索引下可直接同步计算，防抖只为合并渲染） |
| 结果更新 | 保持滚动位置；结果数用 `aria-live="polite"` 播报"找到 42 个工具" |
| 高亮 | 命中词在名称/描述中 `<mark>`；标签命中整块 chip 变为强调色 |
| 键盘 | `↑↓` 移动虚拟焦点（不是 tab 焦点），`Enter` 打开详情，`⌘/Ctrl+Enter` 直达官网 |
| 无结果 | 文案"这座岛上还没有这个工具 🏝" + 三个动作：清空筛选 / 看热门分类 / 提交这个工具 |
| 加载中 | 骨架卡片 6 张（不做 spinner，避免布局跳动） |
| 出错 | "搜索暂时迷路了" + 重试按钮 + 分类浏览兜底链接 |

**组合筛选的可视化**：已选条件以 chip 形式排在结果数左侧（`分类：媒体 ✕`），右侧一个"清空全部"。任何筛选变化都同步 URL。

### 8.7 动效

| 场景 | 参数 |
|---|---|
| 卡片 hover | `translateY(-3px)`，`160ms` `--ease-island` |
| 卡片入场（首屏） | `opacity 0→1` + `translateY(8px→0)`，`200ms`，按 index 递增 `20ms` 延迟，**仅前 24 张** |
| 筛选切换 | 结果区 `opacity` 交叉淡入 `120ms`，不重排动画 |
| 搜索框聚焦 | 描边色 + 外发光，`160ms` |
| `prefers-reduced-motion` | 全部 `transition/animation: none`，入场不位移 |

**音效**：**默认关闭**。可提供"岛屿音效"开关（点击/筛选的极轻木质咔哒声），但必须用户主动开启并持久化偏好；这是 AC 的味道来源之一，但默认开启会被认为是有害设计。

### 8.8 无障碍与性能预算

- 焦点环：`3px solid var(--ac-info)` + `offset 2px`，全站统一，禁止 `outline: none`。
- 搜索为 `role="combobox"` + `aria-expanded` + `aria-activedescendant`，结果列表 `role="listbox"`。
- 对比度：正文 ≥4.5:1；大字号（≥24px 或 ≥18.66px bold）≥3:1。已按此选色。
- 图片：`width/height` 显式声明，`loading="lazy"` `decoding="async"`；LOGO 统一转 WebP，单张 ≤8KB。
- 背景纹理：一张 512×512 可平铺 WebP ≤20KB，或纯 CSS 渐变 + 内联 SVG 噪点（0 请求）。
- JS 预算：主包 ≤60KB gzip，搜索 island 懒加载 ≤40KB gzip，Worker 索引构建不阻塞主线程。
- 字体预算：展示字体子集 ≤80KB，正文系统字体 0KB。

---

## 9. AGENTS.md 设计

AGENTS.md 是**给 Agent 看的运维手册**，不是给人看的项目介绍。核心要求：短（≤250 行，每次任务都要读）、硬（规则可判定）、可引用（细节指向 schema 文件）。

### 9.1 章节骨架

```markdown
# AGENTS.md

## 1. 这个仓库是什么 / 不是什么
## 2. 数据契约
   - 2.1 字段表（指向 schema/tool.schema.json）
   - 2.2 枚举与词表（指向 data/taxonomy.yaml）
   - 2.3 id 与文件路径规则
## 3. 新增一个工具（标准流程，5 步）
## 4. 去重与合并规则
## 5. 描述文案规范（句式、长度、禁用词）
## 6. LOGO 规则
## 7. 分类与标签治理
## 8. 必须运行的命令
## 9. 提交与 PR 规范
## 10. 禁止事项（硬红线）
## 11. 不确定时怎么办
## 12. 周期性维护任务
```

### 9.2 各节要点（可直接落地）

**§1 定位**：一句话说明"这是一个工具目录，不是文章站、不是 Awesome List"。明确非目标（不收教程、不收聚合站、不收需登录才能用的服务）。

**§2 数据契约**：只放字段表（字段/必填/类型/约束），细节指向 `schema/tool.schema.json`；枚举指向 `data/taxonomy.yaml`。**不要在 AGENTS.md 里重复枚举值**——两处维护必然漂移。

**§3 新增流程**：
1. 读 `data/taxonomy.yaml`，选定 `category` 与 1–5 个已有标签；
2. 跑 `pnpm dedupe --url <url> --name "<name>"`，阅读 Top5 相似结果；
3. 若确认为新条目，创建 `data/tools/<category>/<slug>.yaml`；
4. 跑 `pnpm validate`，必须 0 error；
5. 一个 PR 只做一件事，批量导入 ≤50 条。

**§4 去重**：给出判定表——URL 规范化后相同 = 重复；同 owner/repo = 重复；名称相似度 ≥0.85 = 疑似（默认合并）。合并时保留旧 `id` 进 `aliases`，**禁止直接删除文件**。

**§5 文案**：
- 30–90 汉字，一句话，句末不加感叹号。
- 结构：`做什么` + `给谁/什么场景` + `关键差异`。
- 禁用词：最强、神器、必备、一站式、赋能、颠覆、完美、绝对。
- 不写未在 `source` 中出现的能力、价格、平台。
- 英文专有名词保留原文（`CyberChef` 不译作"网络大厨"）。

**§6 LOGO**：优先 `github.com/<owner>.png` 或官方 og:image；写入 `logo_source` 而非 `logo`；构建期脚本下载并转 WebP；**禁止直接外链**（第三方可随时 403）。无源则不填，交给首字母徽章。

**§7 治理**：分类封闭，新增需人工批准；标签必须复用词表中的 canonical 形式；同义词写进 `aliases` 由 CI 自动改写；单条 ≤5 个标签。

**§8 命令**：

```bash
pnpm validate        # schema + 词表 + 去重 + URL 规范化（必须 0 error）
pnpm build           # 构建（验证搜索分片能生成）
pnpm test:search     # 搜索回归用例（20 条固定查询断言）
pnpm dedupe --url ... --name "..."
```

**§9 PR**：标题 `feat(tools): add <name>` / `fix(tools): <what>`；描述必须包含"来源链接"与"为什么不是重复"；单 PR ≤50 条新增。

**§10 红线**：
- ❌ 修改 `schema/` 或 `taxonomy.yaml` 的枚举值而不更新本文件
- ❌ 删除任何条目（只能标 `deprecated`）
- ❌ 写入未经校验的外链
- ❌ 编造价格、功能、平台支持
- ❌ 在同一个 PR 里既改结构又批量加数据

**§11 不确定时**：在 PR 描述里列 `## Open questions`，给条目打 `needs-human` 标签，**不要猜**。

**§12 周期任务**：每周——补 0 结果搜索词对应的工具；处理 `link_health.fail_count ≥3` 的条目；合并同义标签；检查分类条目数是否失衡（单类 >40% 需拆分或复核）。

---

## 10. 规模化风险与缓解

| # | 风险 | 触发信号 | 缓解 |
|---|---|---|---|
| 1 | 标签通胀 | 标签数 >150，或单条均标签 >4.5 | 封闭词表 + CI 拦截新标签 + 每季度合并同义词 |
| 2 | 重复条目 | 同一 URL 出现 2 次；名称相似度高 | `dedupe` 命令前置 + PR 模板强制填写查重结果 |
| 3 | 分类失衡 | 某类 >40%，`other` >5% | 分类容量看板（Neon SQL）+ 新增分类需 ≥30 条 |
| 4 | LOGO 外链失效 | 卡片出现破图 | 构建期本地化 + `onerror` 降级到首字母徽章 |
| 5 | 死链堆积 | `link_health.fail_count` 上升 | 每日 cron + 卡片角标"链接可能失效" + 自动开 issue |
| 6 | AI 幻觉描述 | 描述与 `source` 不符 | `source` 必填 + 抽样人工复核 + 禁用绝对化措辞 |
| 7 | 构建变慢 | build >5min | 校验/构建拆 job、缓存依赖、限制每工具详情页的额外查询 |
| 8 | 首屏变重 | LCP >2.5s | 分页渲染、`content-visibility`、字体子集、LOGO ≤8KB |

---

## 11. 成本

| 项 | 用量假设 | 结论 |
|---|---|---|
| GitHub Actions | 公开仓库标准 runner 免费；月构建 ≈ 200 次 | $0 |
| GitHub Pages | 镜像站，同一产物 <100MB，月流量 <100GB 软限 | $0 |
| Vercel | 生产站 + 自定义域名 + PR 预览 + ≤2 个 API 路由（非商用已确认） | $0（Hobby 合规） |
| Neon Free | 100 CU-hours/项目、1GB 存储、5GB egress、闲置 5 分钟挂起 | $0 |

> 唯一需要留意的隐性成本：Pages 的 100GB/月带宽是**软限制**，若某天被社交平台引爆，图片会成为主要流量。因此 LOGO 必须本地化且压到 ≤8KB，并优先走 WebP。

---

## 12. 实施路线

| 阶段 | 内容 | 交付物 | 验收标准 | 估时 |
|---|---|---|---|---|
| **P0 骨架** | 仓库结构、schema、taxonomy、20 条种子数据（从 raw/ 提炼）、`pnpm validate`、本地 Astro 卡片网格 | 能 `pnpm dev` 看到 20 张卡片 | validate 0 error；Lighthouse Perf ≥90 | 0.5–1 天 |
| **P1 搜索与风格** | 搜索 island（Worker + 中英分词 + 分面 + URL 同步）、AC 设计 token、详情页/分类页/标签页、sitemap | 完整可用的静态站 | 数百条压测：首字出结果 <50ms，输入不卡顿；`压缩`/`image compress`/`piclite 压缩` 均命中 | 1.5–2 天 |
| **P2 上线与自动化** | Vercel 生产 + 自定义域名、Pages 镜像、CI、AGENTS.md、GitHub 批量导入到 300+ 条 | 线上可用站点 | 死链 0；CI 阻断率 <10% | 1–1.5 天 |
| **P3 数据闭环（可选）** | Neon schema、sync workflow、死链 cron、0 结果词遥测 | 数据看板 | 0 结果词每周产出 ≥5 条新增候选 | 0.5–1 天 |
| **P4 规模化** | 导入至 1000+、标签合并、OG 图、搜索调优、可选服务端兜底 | 稳定运营 | 构建 <3min；索引 <1MB gzip | 持续 |

**P0/P1 是必须的，P2 让站点"活"，P3 让 Agent"越用越准"。** 不建议跳过 P2 直接堆数据——没有 CI 的 1000 条 YAML 会在两周内变成不可维护的垃圾场。

---

## 13. ADR 摘要

| # | 决策 | 理由 | 代价 |
|---|---|---|---|
| ADR-1 | Git 为内容 SSOT，Neon 为派生 | 可 diff、可回滚、Agent 无需凭证即可改内容 | 每次变更走 PR，不适合高频运行时写入 |
| ADR-2 | Astro 而非 Next.js | 纯静态站，Next 的 SSR/ISR 全部用不上且 export 阉割图片优化 | 生态组件比 React 少，动态交互需 island |
| ADR-3 | 客户端搜索为主 | 10k 条语料仅 ~1MB，本地检索 <30ms，零成本零冷启动 | 需自行处理中文分词与索引构建 |
| ADR-4 | 一条目一文件 | 多 Agent/多分支并发写不冲突，review 粒度小 | 文件数达 1000+，需按分类分目录 |
| ADR-5 | **Vercel 生产 + Pages 镜像** | 自定义域名在 Vercel 控制台配置；Vercel 能设响应头/缓存策略、内置 PR 预览，Pages 都做不到；镜像保留灾备 | 两套部署配置；需分别管理域名解析 |
| ADR-6 | 分类封闭、标签半封闭 | 1000 条后分类/标签是唯一会失控的维度 | 新增分类需人工决策，牺牲一点灵活性 |
| ADR-7 | LOGO 构建期本地化 | 外链会 403/防盗链，破图率随条目数线性上升 | 构建需网络；需处理版权与体积 |
| ADR-8 | 列表分页渲染 | 1000 卡全量 DOM 会拖垮首屏 | 需处理"加载更多"与滚动的交互细节 |
| ADR-9 | **数据只从 GitHub 仓库/官网抓取** | 无提交入口 → 无审核积压、无垃圾数据；来源天然可溯（`repo` + `source`） | 非 GitHub 托管的工具需人工补录 |
| ADR-10 | **不做拼音搜索** | 拼音需词典 + 别名生成链路，维护成本高于收益；中文 bigram 已能覆盖误输 | 用户输拼音搜不到，只能靠英文名/别名兜底 |

---

## 14. 决策确认与剩余待定

### 14.1 已确认（v0.2 锁定）

| 问题 | 结论 | 对方案的影响 |
|---|---|---|
| 是否商用 | **非商用** | Vercel Hobby 合规，全栈落在 $0 |
| 自定义域名 | **要，后续在 Vercel 控制台配置** | 生产站必须是 Vercel；Pages 降为镜像（见 ADR-5） |
| 数据规模 | **1000+ 只是未来可能的上限** | 前期按数百条建设：不做过度分片、不做虚拟滚动、不做服务端搜索；但 schema、目录分片、分页渲染保留扩展位 |
| 拼音搜索 | **不需要** | 去掉拼音库与别名生成；分词只做中文 bigram + 英文单词（ADR-10） |
| 用户提交入口 | **不需要** | 删除 `submissions` 表与 `/api/submit`；Neon 降级为可选增强（§6） |
| 数据来源 | **GitHub 仓库及其关联官网** | 新增 `repo` 字段与 `import-github.mjs`；`repo` 成为去重主键（ADR-9） |

### 14.2 剩余待定（不阻塞 P0）

1. **域名与仓库归属**：域名具体值、GitHub 仓库是个人号还是组织号——影响 Pages 的 `<owner>.github.io/<repo>` 路径与 `base` 配置。
2. **是否接受"0 结果搜索词"匿名上报**：接受则保留 `search_queries` 表与一个极简 beacon；不接受则 Neon 只剩数据治理与死链巡检两项用途（仍然成立）。
3. **卡片是否展示 star 数**：展示会引入"以热度压过适用性"的偏差，且 `stars` 是抓取快照会过期。建议**只在详情页展示**，列表页不展示。
4. **首批条目规模**：P0 用 20 条种子验证管线，P2 批量到 300 条左右即可验证"数百条"下的搜索与构建表现，之后再按需扩到 1000+。
