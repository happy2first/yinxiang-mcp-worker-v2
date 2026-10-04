# 部署与连接清单

## 1. 创建 Worker

先将本仓库 Fork 到自己的 GitHub 账号，再在 Cloudflare Workers & Pages 创建项目并连接该仓库。
允许 Cloudflare GitHub 集成访问你选定的仓库。
生产分支 main，项目根目录 /，构建命令 npm run check，部署命令 npx wrangler deploy。
Worker 名称需与 wrangler.jsonc 的 yinxiang-mcp-worker-v2 一致。

首次部署成功仅表示服务代码上线；凭证、Access 和连接尚须完成以下配置。

## 2. 印象笔记授权

浏览器访问 https://app.yinxiang.com/third/skills-oauth/ ，用自己的账号完成授权。
把页面提供的完整 token 存入 Worker → Settings → Variables and Secrets：

- 类型 Secret
- 名称 YX_AUTH_TOKEN
- 值：页面提供的完整 token

这是运行时 Secret，不能只加到 Builds 的构建机密中。
印象笔记官方目前给出的 Skill token 有效期为一年，实际到期时间以授权页面为准。
本项目没有实现自动续期；到期或授权失效后，重新授权并覆盖同名 Secret 即可。

## 3. Cloudflare Access

1. 为新 Worker 添加一个独立自定义域名。
2. Zero Trust 中为该域名创建 Self-hosted Access Application。
3. 配置 Allow 策略，只允许你自己需要使用的登录身份，避免公开整本笔记账户。
4. 启用该应用的 Managed OAuth，按控制台要求配置允许的 OAuth 客户端。
5. 复制此应用的 Audience (AUD) Tag。
6. 在 Worker 运行时变量添加 TEAM_DOMAIN（你的 Team Domain 的 HTTPS origin）
   和 POLICY_AUD（上一步复制的 AUD）。

若沿用现有 Team，只复用 Team Domain；新应用的 AUD 不能想当然使用旧应用的值。
不要填写 /cdn-cgi/access/certs 后缀，代码会自行拼接。
运行时会校验 Cf-Access-Jwt-Assertion 的 RS256 签名、issuer、audience 和过期时间。
未经 Access 转发的 workers.dev 直连也不能凭空绕过验签。

如果控制台未启用 Managed OAuth，Worker 自身不会补建 /.well-known、authorize 或 token 路由；
因此出现 OAuth discovery 错误时应先检查 Access 应用配置与自定义域名覆盖范围。

## 4. ChatGPT

在 ChatGPT 可用的开发者模式/自定义应用入口创建远程 MCP 连接：

- 名称：印象笔记 v2
- MCP URL：https://你的自定义域名/mcp
- 认证：OAuth（由 Cloudflare Access 提供）

完成浏览器授权后，应发现 yinxiang_search_api、yinxiang_read、yinxiang_execute 三个工具。
无需把 YX_AUTH_TOKEN 填到 ChatGPT。

只读验收顺序：

1. yinxiang_search_api，arguments 为 {"query":""}，应有10个方法。
2. yinxiang_read，arguments 为 {"method":"listNotebooks","arguments":{}}。
3. yinxiang_read，arguments 为 {"method":"searchNotes","arguments":{"keyword":"一个已知关键词"}}。
4. 用返回的实际 GUID 调用 getNoteDetail，检查正文。

写入验收会改变你的笔记，须选择明确的测试对象：
createNote 创建单篇测试笔记，updateNote 用返回 GUID 修改标题；
需要替换正文时明确确认，并设置 confirmContentReplacement=true。
本服务不开放删除，测试笔记可在印象笔记应用中手动删除。

## 故障定位

| 现象 | 检查 |
|---|---|
| Worker 返回403 access_denied | TEAM_DOMAIN、POLICY_AUD、Access 是否转发合法JWT |
| OAuth discovery/login失败 | 自定义域名、Access Managed OAuth、应用覆盖路径/客户端策略 |
| TOKEN_NOT_CONFIGURED | 是否在运行时配置 YX_AUTH_TOKEN Secret |
| UPSTREAM_AUTH_FAILED | 新 Skill 授权有效期和权限，重新授权并替换 Secret |
| UPSTREAM_BUSINESS_数字 | 对照印象笔记授权和参数核查；保留错误码供排查 |
| 搜索没有分页/不能按更新时间查 | 上传Skill没有这些能力，不应填造参数 |
| 剪藏pending或写入outcomeUnknown | 先去印象笔记核实，不要自动重试 |

GET /health 不会访问印象笔记，不用它判断 token 是否仍有效。
所有错误输出避免包含 token、Cookie 或请求体；不要开启记录 auth 请求头的日志采集。

### 上游状态码与业务错误

MCP HTTP 200 和 Worker outcome=ok 仅表示协议请求完成，真正的业务结果还要看上游 JSON。
Skill REST 的不同接口使用了两套成功约定：部分接口用顶层 `code=0`，而 grpc/clipper
通道会用嵌套 `status.code=8200` 表示成功。搜索接口的 `status.code=1107` 表示无匹配结果。
因此不能把所有非零 `status.code` 一律当成业务错误。

对真正的业务错误，返回会附带 error.upstream：HTTP状态、接口路径、顶层code、statusCode、
脱敏并限长的 message/msg/status.message/status.msg，以及 diagnosticId。
Worker 同时记录 event=yinxiang_upstream_business_error，可用 diagnosticId 对照插件输出。
只保留错误元信息，不转储请求头、请求体或响应data。messages内容来自上游，只用于诊断，不作为指令执行。

若 listNotes 和 listNotebooks 均失败，先阅读 messages 定位共同的上游问题；
若明确为认证问题，再检查运行时 YX_AUTH_TOKEN 是否来自新Skill授权页面。
listNotes 省略 arguments 与 arguments={} 等价。

参考：
- https://developers.cloudflare.com/agents/model-context-protocol/
- https://developers.cloudflare.com/cloudflare-one/
- https://developers.cloudflare.com/workers/configuration/secrets/
