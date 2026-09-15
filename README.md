# 印象笔记 Skill MCP · Cloudflare Worker v2

基于上传的 **yinxiang-skill 1.0.4** REST 接口开发，参考
[yinxiang-mcp-worker](https://github.com/happy2first/yinxiang-mcp-worker) 的 Worker、MCP 和 Cloudflare Access 架构。
用于个人自托管，通过 **Cloudflare Access Managed OAuth + MCP Streamable HTTP** 供 ChatGPT 等客户端连接。

## 与旧库的区别

| 项目 | v1 | v2 |
|---|---|---|
| 上游 | EDAM/Thrift NoteStore | Skill REST |
| 凭证 | Developer Token + NoteStore URL | YX_AUTH_TOKEN |
| 授权入口 | 开发者入口 | https://app.yinxiang.com/third/skills-oauth/ |
| 正文 | ENML/EDAM | Markdown，由印象笔记转换 |
| 能力 | EDAM 白名单 | Skill 文档的10项能力 |
| 部署 | Worker | Worker，无数据库/DO/KV绑定 |
| ChatGPT 身份验证 | Cloudflare Access | 同样使用 Access Managed OAuth |

**新授权 token 的有效期尚未得到证实。** 上传文档没有有效期承诺，也没有 refresh token、
自动续期或后台换取 token 的接口。本项目不会把刷新 ChatGPT 的 Access OAuth token
当作刷新印象笔记 token；二者是不同的凭证。授权到期时需要重新授权并更新 Worker Secret。

## 能力

| 方法 | 功能 | 工具 |
|---|---|---|
| listNotes / searchNotes | 列表、搜索、匹配总数 | yinxiang_read |
| listNotebooks / listTags | 笔记本、标签列表 | yinxiang_read |
| getNoteDetail | 正文及标签详情 | yinxiang_read |
| createNote / updateNote | Markdown 创建、修改、移动、标签调整 | yinxiang_execute |
| createNotebook / createTag | 创建笔记本、标签 | yinxiang_execute |
| clipUrl | 网页剪藏 | yinxiang_execute |

先调用 **yinxiang_search_api** 查询方法说明和完整参数 JSON Schema，再调用读或写工具。
相对原库多一个只读执行器，使 ChatGPT 能区分查询和写入。每个工具都有 annotations 和 outputSchema。

搜索只支持文档列明的字段；不支持分页和更新时间筛选。“最近”按过去3天创建时间理解。
搜索结果只返回笔记ID、标题和真实 total，不返回正文。缺失 total 时返回 null，不用条数代替。
不会提供删除笔记、附件读写、共享管理或未声明接口。

## Cloudflare 部署

建议创建**独立 Worker**，不改原库和原 Worker。详细步骤见 [部署说明](docs/deployment.md)。

在 Workers & Pages 创建项目并连接本仓库：

- Worker 名称：yinxiang-mcp-worker-v2
- 生产分支：main
- 根目录：仓库根目录
- 构建命令：npm run check
- 部署命令：npx wrangler deploy

Wrangler 设置 keep_vars=true，配置不包含个人域名、AUD、token 或绑定。业务不需要新增绑定。
不要添加旧库的 YINXIANG_NOTESTORE_URL 或 YINXIANG_DEVELOPER_TOKEN。

| 名称 | 类型 | 值 |
|---|---|---|
| YX_AUTH_TOKEN | Secret，必填 | 新授权页面取得的完整 token |
| TEAM_DOMAIN | Variable，必填 | 例如 https://example.cloudflareaccess.com |
| POLICY_AUD | Variable，必填 | 新 Access Application 的 Audience Tag |
| UPSTREAM_TIMEOUT_MS | Variable，可选 | 默认25000，允许1000–25000毫秒 |
| MAX_RESPONSE_BYTES | Variable，可选 | 默认950000，允许1024–1000000字节 |

在 Worker 的**运行时变量和机密**中配置，不要只放在构建变量中。
不要把 token 发到聊天、提交到 Git 或填入 MCP 工具参数。

命令行部署：

```bash
npm ci
npm run check
npx wrangler login
npx wrangler secret put YX_AUTH_TOKEN
npm run deploy
```

TEAM_DOMAIN 和 POLICY_AUD 可在部署后由 Cloudflare Dashboard 设置。
没有这两个配置时 /mcp 和 /health 默认拒绝访问。

## HTTP 与 ChatGPT 接入

- GET /：公共服务元信息。
- GET /health：必须通过 Access；只检查配置存在，不代表上游授权有效。
- /mcp：标准 MCP Streamable HTTP，由官方 MCP SDK / Cloudflare agents 处理协议。

在独立自定义域名上配置 Access Self-hosted Application，限制允许登录的身份，
开启 Managed OAuth，然后把 **https://你的域名/mcp** 填入 ChatGPT 的远程 MCP 配置，使用 OAuth。
OAuth discovery、登录和 token 续期由 Cloudflare Access 边缘提供，Worker 本身不实现 OAuth 服务。
仅部署 workers.dev 地址并不会自动得到 OAuth 登录。
不要对 /mcp 设置 Bypass 或允许所有人；不要靠手工添加身份头替代 JWT 验签。

所有获准访问这个应用的人都会使用同一个 YX_AUTH_TOKEN 对应的印象笔记账户。
这不是多用户账户隔离服务。

## 写入语义与错误

- updateNote.content 是整篇替换。告知用户并得到确认后传 confirmContentReplacement=true；
  该参数只用于本地校验，不发给印象笔记。
- tagNames 是最终完整集合。增删单个标签先取详情，再计算全集；
  清空用 clearTags=true，禁止空 tagNames 或两者同时传入。
- 网络错误、超时或大响应可能发生在写入已完成之后。outcomeUnknown=true 时先查看笔记，
  不自动重试创建/修改/剪藏。
- clipUrl 最多等待5秒；后台通过 waitUntil 继续等待上游，整个请求仍受25秒超时限制。
  pending 仅表示结果待确认，不等于上游接受或保存成功。这不是持久任务队列；
  后台最终结果不会存储，需要到印象笔记核查。
- ok=true 表示工具正常处理请求；剪藏还必须查看 data.state 和 outcomeUnknown。
- 上游认证失败返回 UPSTREAM_AUTH_FAILED；其他业务错误保留非敏感数字错误码，
  不原样返回可能包含凭证的错误正文。
- 上游地址固定、禁止跟随重定向，不接受调用者自定义 auth/source/resultSpec/上游URL。

## 验证范围

npm run check 包括生成 Worker 类型、TypeScript、Vitest 和 Wrangler dry-run。
测试覆盖真实 MCP transport 的握手/工具发现/调用、JWT 签名/受众/过期校验、
参数白名单、标签语义、凭证脱敏、超时和剪藏后台等待。
测试中的印象笔记响应是模拟数据；上线后仍须用实际授权完成只读联调。

## 来源与限制

见 [Skill 分析](docs/skill-analysis.md)。原库 MIT License 保留；
上传压缩包未提供独立开源许可证，因此不将其整包重新分发到仓库。
本项目非印象笔记官方 MCP 服务，上游接口以用户提供的文档为依据。
