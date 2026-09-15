import { z } from "zod";

const id = z.string().trim().min(1).max(200);
const name = z.string().trim().min(1).max(1000);
const tags = z.array(name).min(1).max(100);
const search = z.object({
  keyword: z.string().min(1).max(2000).optional(),
  title: name.optional(),
  tagNames: tags.optional(),
  notebookName: name.optional(),
  notebookGuid: id.optional(),
  guids: z.array(id).min(1).max(100).optional(),
  startTime: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
  endTime: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional()
}).strict().refine(a => !(a.notebookName && a.notebookGuid), "Use notebookName or notebookGuid, not both")
  .refine(a => a.startTime === undefined || a.endTime === undefined || a.startTime <= a.endTime,
    "startTime must be <= endTime");
const update = z.object({
  noteGuid: id,
  title: name.optional(),
  content: z.string().max(500000).optional(),
  notebookGuid: id.optional(),
  tagNames: tags.optional(),
  clearTags: z.literal(true).optional(),
  confirmContentReplacement: z.literal(true).optional()
}).strict().refine(a => ["title", "content", "notebookGuid", "tagNames", "clearTags"].some(k => k in a),
  "Provide at least one update field")
  .refine(a => !(a.tagNames && a.clearTags), "tagNames and clearTags are mutually exclusive")
  .refine(a => a.content === undefined || a.confirmContentReplacement === true,
    "Replacing content requires user confirmation and confirmContentReplacement=true");
const publicUrl = z.string().url().max(8000).refine(value => {
  const u = new URL(value);
  const h = u.hostname.toLowerCase();
  return ["https:", "http:"].includes(u.protocol) && !u.username && !u.password &&
    !u.port && h.includes(".") && !h.endsWith(".localhost") && !h.endsWith(".local") &&
    !h.endsWith(".internal") && !h.endsWith(".test") && !/^[\d.]+$/.test(h) &&
    !h.includes(":");
}, "Use a public HTTP(S) website without credentials, IP address or custom port");

const base = "/third/third-party-note-service/restful/v1/";
const queryBase = "/third/ai-chat-note/grpc-api/search/";
export const methods = [
  { name: "createNote", path: base + "createNoteFromMCP", readOnly: false,
    description: "创建 Markdown 笔记；正文必填，未指定笔记本则存入默认笔记本。",
    schema: z.object({ title: name, content: z.string().min(1).max(500000),
      notebookGuid: id.optional(), tagNames: tags.optional() }).strict() },
  { name: "updateNote", path: base + "updateNoteFromMCP", readOnly: false,
    description: "更新或移动笔记。content 完整替换正文，须先告知用户并获得确认后传 confirmContentReplacement=true。标签传最终全集；增删标签先读详情，清空用 clearTags=true。搜索得到的修改对象须经用户确认。",
    schema: update },
  { name: "clipUrl", path: "/third/clipper-gateway/restful/v1/clipAndSaveNote", readOnly: false,
    description: "剪藏公开网页；等待5秒后若未返回，报告结果待确认，请到印象笔记查看，勿自动重试。",
    schema: z.object({ url: publicUrl, notebookGuid: id.optional() }).strict() },
  { name: "listNotes", path: queryBase + "searchNotesByFilter", readOnly: true,
    description: "列出笔记摘要；total 为匹配总数。上游未提供分页参数，最多展示100条，正文另取详情。",
    schema: z.object({}).strict() },
  { name: "searchNotes", path: queryBase + "searchNotesByFilter", readOnly: true,
    description: "按全文、标题、标签、笔记本、GUID、创建时间搜索/计数；不支持更新时间或分页。时间是 UTC 毫秒，先按用户时区解释；最近=过去3天。不要把列表长度当总数。",
    schema: search },
  { name: "listNotebooks", path: queryBase + "listNoteBooks", readOnly: true,
    description: "列出笔记本名称和GUID。", schema: z.object({}).strict() },
  { name: "listTags", path: queryBase + "listTags", readOnly: true,
    description: "列出所有标签。", schema: z.object({}).strict() },
  { name: "createTag", path: base + "createTagFromMCP", readOnly: false,
    description: "创建标签。", schema: z.object({ tagName: name }).strict() },
  { name: "createNotebook", path: base + "createNotebookFromMCP", readOnly: false,
    description: "创建笔记本。", schema: z.object({ bookName: name }).strict() },
  { name: "getNoteDetail", path: queryBase + "getNoteDetail", readOnly: true,
    description: "获取笔记正文和标签；guid 为笔记GUID。", schema: z.object({ guid: id }).strict() }
] as const;
export type Method = typeof methods[number];
export function findMethod(name: string): Method {
  const method = methods.find(m => m.name === name);
  if (!method) throw new Error("METHOD_NOT_ALLOWED");
  return method;
}
export function describeMethod(m: Method) {
  return { name: m.name, description: m.description, readOnly: m.readOnly,
    inputSchema: z.toJSONSchema(m.schema) };
}
