import { afterEach, expect, it, vi } from "vitest";
const auth = vi.hoisted(() => ({ verify: vi.fn() }));
vi.mock("../src/security", () => ({ verifyAccess: auth.verify }));
import worker from "../src/index";

const tasks: Promise<unknown>[] = [];
const ctx = { waitUntil: (p: Promise<unknown>) => { tasks.push(p); }, passThroughOnException() {} } as ExecutionContext;
const env = { YX_AUTH_TOKEN: "test-only" };
afterEach(async () => { await Promise.all(tasks.splice(0)); vi.unstubAllGlobals(); });
async function rpc(method: string, params: unknown = {}) {
  const response = await worker.fetch(new Request("https://worker.example/mcp", {
    method: "POST", headers: { "Content-Type": "application/json",
      Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-03-26" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })
  }), env, ctx);
  const raw = await response.text();
  const data = response.headers.get("content-type")?.includes("text/event-stream")
    ? raw.split("\n").find(l => l.startsWith("data: "))?.slice(6) : raw;
  return { status: response.status, body: JSON.parse(data ?? "{}") };
}
it("denies unauthenticated health and MCP while keeping public metadata minimal", async () => {
  auth.verify.mockRejectedValue(new Error("denied"));
  expect((await rpc("tools/list")).status).toBe(403);
  expect((await worker.fetch(new Request("https://worker.example/health"), env, ctx)).status).toBe(403);
  expect((await worker.fetch(new Request("https://worker.example/"), env, ctx)).status).toBe(200);
});
it("initializes, discovers annotated tools, reads and returns structured tool errors through real MCP transport", async () => {
  auth.verify.mockResolvedValue({ sub: "test" });
  const init = await rpc("initialize", { protocolVersion: "2025-03-26",
    capabilities: {}, clientInfo: { name: "test", version: "1" } });
  expect(init.status).toBe(200);
  expect(init.body.result.serverInfo.name).toBe("yinxiang-skill-mcp");
  const listed = await rpc("tools/list");
  expect(listed.body.result.tools).toHaveLength(3);
  expect(listed.body.result.tools.find((t: {name: string}) => t.name === "yinxiang_read").annotations.readOnlyHint).toBe(true);
  expect(listed.body.result.tools.find((t: {name: string}) => t.name === "yinxiang_execute").annotations.destructiveHint).toBe(true);
  const discovery = await rpc("tools/call", { name: "yinxiang_search_api", arguments: { query: "" } });
  expect(discovery.body.result.structuredContent.data.methods).toHaveLength(10);
  const fetcher = vi.fn().mockImplementation(async () => Response.json({ code: 0, data: { tagList: [] } }));
  vi.stubGlobal("fetch", fetcher);
  const read = await rpc("tools/call", { name: "yinxiang_read", arguments: { method: "listTags", arguments: {} } });
  expect(read.body.result.structuredContent.ok).toBe(true);
  const denied = await rpc("tools/call", { name: "yinxiang_read",
    arguments: { method: "createTag", arguments: { tagName: "x" } } });
  expect(denied.body.error || denied.body.result?.isError).toBeTruthy();
  const invalid = await rpc("tools/call", { name: "yinxiang_execute",
    arguments: { method: "updateNote", arguments: { noteGuid: "x", content: "new" } } });
  expect(invalid.body.result.isError).toBe(true);
  expect(fetcher).toHaveBeenCalledTimes(1);
  fetcher.mockImplementation(async () => Response.json({
    status: { code: 8200, msg: "请求处理成功" },
    data: { total: 1, noteDetailList: [{ noteGuid: "n1", noteTitle: "测试笔记" }] }
  }));
  for (const args of [{ method: "listNotes" }, { method: "listNotes", arguments: {} }]) {
    const business = await rpc("tools/call", { name: "yinxiang_read", arguments: args });
    expect(business.body.result.isError).toBe(false);
    expect(business.body.result.structuredContent).toMatchObject({
      ok: true, method: "listNotes",
      data: { total: 1, notes: [{ noteGuid: "n1", title: "测试笔记" }] }
    });
  }
  expect(fetcher.mock.calls[1]?.[1]?.body).toBe(fetcher.mock.calls[2]?.[1]?.body);
});
