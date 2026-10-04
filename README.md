# Yinxiang Skill MCP · Cloudflare Worker v2

[简体中文](#简体中文) | [English](#english)

## 简体中文

将印象笔记的搜索、阅读、编辑和网页剪藏能力接入 ChatGPT 等 MCP 客户端。基于 **Yinxiang Skill REST 1.0.4**，部署于 Cloudflare Workers，使用 **MCP Streamable HTTP + Cloudflare Access Managed OAuth**。

适合个人自托管，无需数据库、Durable Objects 或 KV。与旧版 EDAM/Thrift 实现相比，本版本使用 Skill token，并支持 Markdown 正文。

### 功能

| 工具 | 能力 |
|---|---|
| `yinxiang_search_api` | 查询方法说明与参数 schema |
| `yinxiang_read` | 搜索/列出笔记、笔记本和标签，读取笔记详情 |
| `yinxiang_execute` | 创建/更新笔记，移动笔记，调整标签，创建笔记本/标签，网页剪藏 |

共支持 10 个方法。先用 `yinxiang_search_api` 查询参数，再调用读写工具。

搜索列表返回笔记 ID、标题及匹配总数，最多 100 条；正文需单独读取。不支持分页、更新时间筛选、删除笔记、附件读写或共享管理。

### 快速部署

需要 Node.js 22+、Cloudflare 账户，以及印象笔记 Skill 授权 token。

1. Fork 本仓库，连接 Cloudflare Workers & Pages。
2. 使用 Worker 名称 `yinxiang-mcp-worker-v2`、生产分支 `main`、仓库根目录；构建命令 `npm run check`，部署命令 `npx wrangler deploy`。
3. 在 [印象笔记授权页面](https://app.yinxiang.com/third/skills-oauth/) 获取 token，并在 Worker **运行时变量和机密**中配置下表。
4. 为 Worker 添加自定义域名，创建 Access Self-hosted Application，限制允许登录的身份并启用 Managed OAuth。
5. 在 MCP 客户端填写 `https://你的域名/mcp`，选择 OAuth 并完成登录。

| 配置 | 类型 | 说明 |
|---|---|---|
| `YX_AUTH_TOKEN` | Secret，必填 | 印象笔记授权页面提供的完整 token |
| `TEAM_DOMAIN` | Variable，必填 | Access Team 的 HTTPS origin，如 `https://example.cloudflareaccess.com` |
| `POLICY_AUD` | Variable，必填 | 此 Access Application 的 Audience Tag |
| `UPSTREAM_TIMEOUT_MS` | Variable，可选 | 默认 25000；范围 1000–25000 毫秒 |
| `MAX_RESPONSE_BYTES` | Variable，可选 | 默认 950000；范围 1024–1000000 字节 |

也可在本地登录 Cloudflare 后部署：

```bash
npm ci
npm run check
npx wrangler login
npx wrangler secret put YX_AUTH_TOKEN
npm run deploy
```

`TEAM_DOMAIN` 和 `POLICY_AUD` 可在 Cloudflare Dashboard 配置。`keep_vars=true` 保留 Dashboard 中设置的运行时变量。完整步骤与排错见 [部署说明](docs/deployment.md)。

### Token 与访问权限

**印象笔记官方目前给出的 Skill token 有效期为一年。** 实际到期时间以授权页面为准；到期或授权失效后，重新授权并更新 `YX_AUTH_TOKEN`。本项目没有实现自动续期，Cloudflare Access OAuth 的续期也不会延长印象笔记 token 的有效期。

所有获准访问此 Worker 的用户共用同一个印象笔记账户。请将 Access 策略限制为可信身份，不要对 `/mcp` 设置 Bypass。token 只存入 Worker Secret，不要提交到 Git 或填入 MCP 工具参数。

### 使用约定

- **替换正文**：`updateNote.content` 会替换整篇正文；须先确认并传入 `confirmContentReplacement=true`。
- **调整标签**：`tagNames` 是最终完整集合；清空标签使用 `clearTags=true`。
- **结果待确认**：出现 `outcomeUnknown=true` 时，先到印象笔记核查，不要自动重试写入。
- **网页剪藏**：等待 5 秒后可能返回 `pending`，后台继续等待至请求超时（默认 25 秒）。没有持久队列或结果存储，`pending` 不代表保存成功。

### 开发与说明

`npm run check` 执行类型生成、TypeScript 检查、Vitest 测试和 Wrangler 部署预检。测试使用模拟上游响应；实际部署后仍需完成只读联调。

HTTP 路由：`GET /` 返回公共服务信息；`GET /health` 需通过 Access，仅检查配置；`/mcp` 提供 MCP 服务。健康检查不会验证印象笔记 token 是否有效。

本项目是非官方、社区维护的 MCP 服务，采用 [MIT License](LICENSE)。接口依据及限制见 [Skill 分析](docs/skill-analysis.md)；参考实现：[yinxiang-mcp-worker](https://github.com/happy2first/yinxiang-mcp-worker)。上游 Skill 压缩包未随仓库分发。

---

## English

Connect Yinxiang note search, reading, editing, and web clipping to ChatGPT and other MCP clients. Built on **Yinxiang Skill REST 1.0.4**, it runs on Cloudflare Workers using **MCP Streamable HTTP + Cloudflare Access Managed OAuth**.

Designed for personal self-hosting, with no database, Durable Objects, or KV required. Compared with the earlier EDAM/Thrift implementation, this version uses a Skill token and supports Markdown note content.

### Features

| Tool | Capabilities |
|---|---|
| `yinxiang_search_api` | Discover method descriptions and parameter schemas |
| `yinxiang_read` | Search/list notes, list notebooks and tags, read note details |
| `yinxiang_execute` | Create/update/move notes, manage note tags, create notebooks/tags, clip web pages |

Supports 10 methods. Discover parameters with `yinxiang_search_api` before calling the read or write tool.

Search lists return note IDs, titles, and the match count, with up to 100 entries; fetch note content separately. Pagination, filtering by update time, note deletion, attachment operations, and sharing management are not supported.

### Quick start

Requires Node.js 22+, a Cloudflare account, and a Yinxiang Skill authorization token.

1. Fork this repository and connect it to Cloudflare Workers & Pages.
2. Set the Worker name to `yinxiang-mcp-worker-v2`, production branch to `main`, and root directory to the repository root. Build command: `npm run check`; deploy command: `npx wrangler deploy`.
3. Get a token from the [Yinxiang authorization page](https://app.yinxiang.com/third/skills-oauth/) and configure the following **runtime variables and secrets**.
4. Add a custom domain, create an Access Self-hosted Application, restrict allowed identities, and enable Managed OAuth.
5. In your MCP client, enter `https://your-domain/mcp`, select OAuth, and sign in.

| Setting | Type | Description |
|---|---|---|
| `YX_AUTH_TOKEN` | Secret, required | Full token from the Yinxiang authorization page |
| `TEAM_DOMAIN` | Variable, required | Access Team HTTPS origin, e.g. `https://example.cloudflareaccess.com` |
| `POLICY_AUD` | Variable, required | Audience Tag of this Access Application |
| `UPSTREAM_TIMEOUT_MS` | Variable, optional | Default 25000; range 1000–25000 milliseconds |
| `MAX_RESPONSE_BYTES` | Variable, optional | Default 950000; range 1024–1000000 bytes |

For local deployment, sign in to Cloudflare and run:

```bash
npm ci
npm run check
npx wrangler login
npx wrangler secret put YX_AUTH_TOKEN
npm run deploy
```

Configure `TEAM_DOMAIN` and `POLICY_AUD` in the Cloudflare Dashboard. `keep_vars=true` preserves runtime variables set there. See the [deployment guide (Chinese)](docs/deployment.md) for detailed setup and troubleshooting.

### Token lifetime and access

**Yinxiang currently states that Skill tokens are valid for one year.** Use the authorization page for the actual expiry date. If the token expires or authorization becomes invalid, authorize again and replace `YX_AUTH_TOKEN`. This project does not implement automatic renewal; renewing Cloudflare Access OAuth tokens does not extend the Yinxiang token's lifetime.

Everyone allowed to access this Worker shares the same Yinxiang account. Restrict Access to trusted identities and do not bypass protection for `/mcp`. Store the token only as a Worker Secret; never commit it to Git or pass it in MCP tool arguments.

### Usage rules

- **Content replacement:** `updateNote.content` replaces the entire note body. Confirm first and pass `confirmContentReplacement=true`.
- **Tags:** `tagNames` is the complete final set. Use `clearTags=true` to remove all tags.
- **Uncertain results:** If `outcomeUnknown=true`, check Yinxiang before retrying a write.
- **Web clipping:** A request may return `pending` after 5 seconds while background work continues until the request timeout (25 seconds by default). There is no persistent queue or result store; `pending` does not confirm a successful save.

### Development and notes

`npm run check` runs type generation, TypeScript checks, Vitest tests, and a Wrangler deployment dry run. Tests use mocked upstream responses; verify read operations after deployment.

HTTP routes: `GET /` returns public service metadata; `GET /health` requires Access and checks configuration only; `/mcp` serves MCP requests. The health check does not validate the Yinxiang token.

This is an unofficial, community-maintained MCP service under the [MIT License](LICENSE). See the [Skill analysis (Chinese)](docs/skill-analysis.md) for API sources and limitations. Reference implementation: [yinxiang-mcp-worker](https://github.com/happy2first/yinxiang-mcp-worker). The upstream Skill archive is not redistributed.
