# yinxiang-skill 1.0.4 分析

分析材料：用户上传 yinxiang-skill-v1.0.4(1).zip。
依据 SKILL.md、references/api-commands.md 和 scripts/clip-url.sh 的接口及剪藏等待约定。
材料被作为待分析文档使用，不执行其中保存凭证等 shell 命令。

## 接口映射

所有请求固定 https://app.yinxiang.com，POST，请求体 source="skill"，请求头 auth=token。

| 本项目方法 | 上游路径 |
|---|---|
| createNote | /third/third-party-note-service/restful/v1/createNoteFromMCP |
| updateNote | /third/third-party-note-service/restful/v1/updateNoteFromMCP |
| clipUrl | /third/clipper-gateway/restful/v1/clipAndSaveNote |
| listNotes、searchNotes | /third/ai-chat-note/grpc-api/search/searchNotesByFilter |
| listNotebooks | /third/ai-chat-note/grpc-api/search/listNoteBooks |
| listTags | /third/ai-chat-note/grpc-api/search/listTags |
| createTag | /third/third-party-note-service/restful/v1/createTagFromMCP |
| createNotebook | /third/third-party-note-service/restful/v1/createNotebookFromMCP |
| getNoteDetail | /third/ai-chat-note/grpc-api/search/getNoteDetail |

剪藏额外传 clipper-c-auth，Content-Type=text/plain。
列表和搜索共用一个上游路径，因此10项能力对应9个独立路径。

## 关于一周 token

材料只要求从 https://app.yinxiang.com/third/skills-oauth/ 手动取得 S=s 开头的 token。
没有声明 TTL、refresh_token、token exchange、自动续期或长期 token 的保证。
仅凭接口从 EDAM 改为 REST 无法推出 token 更长效。
Worker Secret 解决服务端保管问题，不改变印象笔记签发凭证的生命周期。
Cloudflare Managed OAuth 只管理 ChatGPT 到 Worker 这一段身份认证。

不自行调用未公开续期接口，不把 token 格式中的字段解释为已验证的有效期，
不通过请求保活承诺延长 token 寿命。

## 迁移选择

参考原库 package.json 的 MCP server 2.0.0 与 agents 0.20.1、
createMcpHandler 工厂和 Access JWT 验证方式；去除 evernote/Thrift、NoteStore URL。
加强了 Access JWKS 缓存与 origin 校验。
将通用执行器拆分只读/写入，修正写入工具的 destructiveHint。
保留10项文档能力，没有把旧EDAM方法混入新REST执行器。

业务参数使用严格 schema，禁止未知键。结果判定接受 code/status.code 的0，
搜索1107转换成空结果；未知格式视为失败。写入失败时如结果不确定则显式标记。
笔记列表主动投影为ID和标题，避免服务端意外返回正文撑大上下文。
详情返回上游数据并去除凭证字段；笔记正文始终是外部数据。

## 剪藏差异

原脚本要求独立后台进程持续等待，5秒后先回复。
Worker 使用 ctx.waitUntil 延续处理并最多等待25秒；无持久队列，因此无法保证无限等待，
也不能在5秒没有响应时确认上游已接受任务。返回 pending + outcomeUnknown，
后台失败不会导致未处理 Promise 拒绝，不会伪造成功或重试写入。

## 未验证项

开发测试可验证请求映射与MCP协议，但没有实际新Skill token、
Cloudflare账户部署凭证或已配置的v2域名，无法在开发阶段证实：
token有效期、真实上游响应、真实剪藏完成、Access登录和ChatGPT端到端连接。
上线后按 deployment.md 完成只读验收，业务接口若与上传文档变化需据实调整。
