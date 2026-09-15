import { afterEach, describe, expect, it, vi } from "vitest";
import { callUpstream, clipWithObservation } from "../src/upstream";
import { findMethod } from "../src/registry";

const env = { YX_AUTH_TOKEN: "test-secret-not-a-real-token" };
const mockResponse = (v: unknown, status = 200) => vi.fn<typeof fetch>()
  .mockImplementation(async () => Response.json(v, { status }));
afterEach(() => vi.useRealTimers());
describe("Skill REST contract and failure boundaries", () => {
  it("injects source/auth and requests only search metadata, preserving the real total", async () => {
    const f = mockResponse({ status: { code: 0 }, data: { total: 180,
      noteDetailList: [{ noteGuid: "a", noteTitle: "标题", content: "private body" }] } });
    const r = await callUpstream(env, "searchNotes", { keyword: "智慧统计", startTime: 1, endTime: 2 }, f);
    expect(f.mock.calls[0]?.[0]).toBe("https://app.yinxiang.com/third/ai-chat-note/grpc-api/search/searchNotesByFilter");
    const init = f.mock.calls[0]?.[1];
    expect(init?.redirect).toBe("manual");
    expect(init?.headers).toMatchObject({ auth: env.YX_AUTH_TOKEN });
    expect(JSON.parse(String(init?.body))).toMatchObject({ source: "skill", keyword: "智慧统计",
      resultSpec: { includeContent: false, includeResources: false, includeResourceContent: false } });
    expect(r).toMatchObject({ total: 180, notes: [{ noteGuid: "a", title: "标题" }], paginationSupported: false });
    expect(JSON.stringify(r)).not.toContain("private body");
  });
  it("returns no matches for 1107 without inventing success for other errors", async () => {
    expect(await callUpstream(env, "searchNotes", {}, mockResponse({ status: { code: 1107 } })))
      .toEqual({ total: 0, notes: [] });
    await expect(callUpstream(env, "searchNotes", {}, mockResponse({ code: 500, status: { code: 1107 } })))
      .rejects.toMatchObject({ code: "UPSTREAM_BUSINESS_500" });
  });
  it("rejects unknown methods and undeclared input before making a request", async () => {
    const f = mockResponse({ code: 0 });
    for (const args of [{ source: "other" }, { auth: "override" }, { page: 2 },
      { startTime: 3, endTime: 2 }, { notebookName: "a", notebookGuid: "b" }]) {
      await expect(callUpstream(env, "searchNotes", args, f)).rejects.toThrow();
    }
    await expect(callUpstream(env, "deleteNote", {}, f)).rejects.toThrow("METHOD_NOT_ALLOWED");
    expect(f).not.toHaveBeenCalled();
  });
  it("guards replacement and ambiguous tags; strips local confirmation from upstream", async () => {
    const f = mockResponse({ code: 0, noteGuid: "a" });
    for (const args of [{ noteGuid: "a" }, { noteGuid: "a", content: "new" },
      { noteGuid: "a", tagNames: [] }, { noteGuid: "a", clearTags: true, tagNames: ["a"] }]) {
      await expect(callUpstream(env, "updateNote", args, f)).rejects.toMatchObject({ code: "INVALID_ARGUMENTS" });
    }
    expect(f).not.toHaveBeenCalled();
    await callUpstream(env, "updateNote", { noteGuid: "a", content: "new", confirmContentReplacement: true }, f);
    expect(JSON.parse(String(f.mock.calls[0]?.[1]?.body))).toEqual({ noteGuid: "a", content: "new", source: "skill" });
  });
  it("sends clearTags=true and sends both required clip headers", async () => {
    const f = mockResponse({ code: 0 });
    await callUpstream(env, "updateNote", { noteGuid: "a", clearTags: true }, f);
    expect(JSON.parse(String(f.mock.calls[0]?.[1]?.body))).toEqual({ noteGuid: "a", clearTags: true, source: "skill" });
    await callUpstream(env, "clipUrl", { url: "https://example.com/article" }, f);
    expect(f.mock.calls[1]?.[1]?.headers).toMatchObject({
      auth: env.YX_AUTH_TOKEN, "clipper-c-auth": env.YX_AUTH_TOKEN, "Content-Type": "text/plain" });
  });
  it.each(["http://127.0.0.1/", "http://2130706433/", "http://[::1]/", "http://host.local/",
    "https://user:pass@example.com/", "file:///etc/passwd"])("rejects unsafe clip URL %s", async url => {
    expect(findMethod("clipUrl").schema.safeParse({ url }).success).toBe(false);
  });
  it("redacts token reflections and credential fields in successful data", async () => {
    const r = await callUpstream(env, "getNoteDetail", { guid: "a" }, mockResponse({
      code: 0, data: { auth: env.YX_AUTH_TOKEN, nested: { token: "other" }, content: "echo " + env.YX_AUTH_TOKEN }
    }));
    expect(JSON.stringify(r)).not.toContain(env.YX_AUTH_TOKEN);
    expect(JSON.stringify(r)).not.toContain("other");
  });
  it("does not expose an upstream error body or retry a write", async () => {
    const f = mockResponse({ error: env.YX_AUTH_TOKEN }, 502);
    await expect(callUpstream(env, "createTag", { tagName: "a" }, f))
      .rejects.toMatchObject({ code: "UPSTREAM_HTTP_502", outcomeUnknown: true });
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("recognizes expired/denied credentials", async () => {
    await expect(callUpstream(env, "listTags", {}, mockResponse({}, 401)))
      .rejects.toMatchObject({ code: "UPSTREAM_AUTH_FAILED" });
  });
  it("rejects malformed JSON and bounded streaming responses", async () => {
    const f = vi.fn<typeof fetch>().mockResolvedValue(new Response("<html>login</html>"));
    await expect(callUpstream(env, "listTags", {}, f)).rejects.toMatchObject({ code: "UPSTREAM_INVALID_RESPONSE" });
    const huge = vi.fn<typeof fetch>().mockResolvedValue(new Response("x".repeat(2000)));
    await expect(callUpstream({ ...env, MAX_RESPONSE_BYTES: "1024" }, "listTags", {}, huge))
      .rejects.toMatchObject({ code: "RESPONSE_TOO_LARGE" });
  });
  it("aborts timed-out writes once and marks the outcome unknown", async () => {
    vi.useFakeTimers();
    const f = vi.fn<typeof fetch>().mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
    }));
    const result = callUpstream({ ...env, UPSTREAM_TIMEOUT_MS: "1000" }, "createTag", { tagName: "a" }, f)
      .catch(e => e);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await result).toMatchObject({ code: "UPSTREAM_TIMEOUT", outcomeUnknown: true });
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("observes clipping for 5 seconds while retaining background work, including later failures", async () => {
    vi.useFakeTimers();
    let reject!: (reason: unknown) => void;
    const work = new Promise((_resolve, rej) => { reject = rej; });
    const tasks: Promise<unknown>[] = [];
    const result = clipWithObservation(work, { waitUntil: p => { tasks.push(p); } });
    await vi.advanceTimersByTimeAsync(5000);
    expect(await result).toMatchObject({ state: "pending", outcomeUnknown: true });
    reject(new Error("later failure"));
    await expect(Promise.all(tasks)).resolves.toEqual([undefined]);
  });
});
