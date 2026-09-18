import { findMethod } from "./registry";
import type { Config } from "./env";
import { upstreamDiagnostic, type UpstreamDiagnostic } from "./diagnostics";

export class GatewayError extends Error {
  constructor(public code: string, message: string, public outcomeUnknown = false,
    public upstream?: UpstreamDiagnostic) { super(message); }
}
export function boundedNumber(value: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return value && Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}
export async function readBounded(response: Response, limit: number): Promise<string> {
  if (Number(response.headers.get("content-length")) > limit) {
    await response.body?.cancel();
    throw new GatewayError("RESPONSE_TOO_LARGE", "响应过大，请缩小查询范围。");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > limit) {
        await reader.cancel();
        throw new GatewayError("RESPONSE_TOO_LARGE", "响应过大，请缩小查询范围。");
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    return text + decoder.decode();
  } finally { reader.releaseLock(); }
}
function record(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}
function redact(value: unknown, token: string): unknown {
  if (typeof value === "string") return value.split(token).join("[REDACTED]");
  if (Array.isArray(value)) return value.map(v => redact(v, token));
  if (record(value)) return Object.fromEntries(Object.entries(value)
    .filter(([k]) => !/^(auth|authorization|token|accessToken|refreshToken|authenticationToken|cookie|set-cookie)$/i.test(k))
    .map(([k, v]) => [k, redact(v, token)]));
  return value;
}
export async function callUpstream(env: Config, methodName: string, input: unknown,
  fetcher: typeof fetch = fetch): Promise<unknown> {
  const method = findMethod(methodName);
  const parsed = method.schema.safeParse(input);
  if (!parsed.success) throw new GatewayError("INVALID_ARGUMENTS",
    parsed.error.issues.map(i => i.path.join(".") + ": " + i.message).join("; "));
  const token = env.YX_AUTH_TOKEN?.trim();
  if (!token) throw new GatewayError("TOKEN_NOT_CONFIGURED", "请在 Worker Secret 配置 YX_AUTH_TOKEN。");
  if (/[\r\n]/.test(token)) throw new GatewayError("TOKEN_INVALID", "Token 格式无效，请重新配置 Secret。");
  const body: Record<string, unknown> = { ...parsed.data, source: "skill" };
  delete body.confirmContentReplacement;
  const searching = methodName === "searchNotes" || methodName === "listNotes";
  if (searching || methodName === "getNoteDetail") {
    body.resultSpec = { includeContent: !searching, includeResources: false,
      includeTags: true, includeResourceContent: false };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(),
    boundedNumber(env.UPSTREAM_TIMEOUT_MS, 25000, 1000, 25000));
  let started = false;
  try {
    started = true;
    const response = await fetcher("https://app.yinxiang.com" + method.path, {
      method: "POST", redirect: "manual", signal: controller.signal,
      headers: { auth: token,
        "Content-Type": methodName === "clipUrl" ? "text/plain" : "application/json",
        ...(methodName === "clipUrl" ? { "clipper-c-auth": token } : {}) },
      body: JSON.stringify(body)
    });
    if (response.status === 401 || response.status === 403) {
      await response.body?.cancel();
      throw new GatewayError("UPSTREAM_AUTH_FAILED",
        "印象笔记授权被拒绝，可能已过期或权限不足。请到 https://app.yinxiang.com/third/skills-oauth/ 检查授权并更新 YX_AUTH_TOKEN。");
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new GatewayError("UPSTREAM_HTTP_" + response.status,
        "印象笔记服务暂时无法完成请求。", !method.readOnly);
    }
    const raw = await readBounded(response, boundedNumber(env.MAX_RESPONSE_BYTES, 950000, 1024, 1000000));
    let value: unknown;
    try { value = JSON.parse(raw); } catch {
      throw new GatewayError("UPSTREAM_INVALID_RESPONSE", "印象笔记返回了非 JSON 响应。", !method.readOnly);
    }
    if (!record(value)) throw new GatewayError("UPSTREAM_INVALID_RESPONSE", "印象笔记响应格式异常。", !method.readOnly);
    const status = record(value.status) ? value.status : {};
    const codes = [value.code, status.code].filter(c => c !== undefined && c !== null);
    if (searching && codes.some(c => String(c) === "1107") &&
        codes.every(c => ["0", "1107"].includes(String(c)))) {
      return { total: 0, notes: [] };
    }
    if (!codes.length || codes.some(c => String(c) !== "0") || value.success === false) {
      const code = codes.find(c => String(c) !== "0");
      const safeCode = String(code ?? "UNKNOWN");
      const label = /^\d{1,10}$/.test(safeCode) ? safeCode : "UNKNOWN";
      const diagnostic = upstreamDiagnostic(value, token, response.status, method.path);
      console.warn(JSON.stringify({ event: "yinxiang_upstream_business_error",
        method: methodName, ...diagnostic }));
      throw new GatewayError("UPSTREAM_BUSINESS_" + label,
        "印象笔记返回业务错误，详见 upstream 中脱敏后的上游说明；不能仅凭错误码判断原因。",
        !method.readOnly, diagnostic);
    }
    const clean = redact(value, token) as Record<string, unknown>;
    if (searching) {
      const data = record(clean.data) ? clean.data : {};
      const list = Array.isArray(data.noteDetailList) ? data.noteDetailList : [];
      return { total: typeof data.total === "number" ? data.total : null,
        notes: list.slice(0, 100).filter(record).map(n => ({
          noteGuid: n.noteGuid ?? n.guid ?? n.noteId ?? null,
          title: n.noteTitle ?? n.title ?? null
        })),
        paginationSupported: false,
        ...(typeof data.total === "number" && data.total >= 100 ? {
          notice: "为了避免列表太长影响阅读，最多返回100条笔记。受AI上下文长度限制，建议一次总结不要超过20篇。"
        } : {})
      };
    }
    return clean;
  } catch (error) {
    if (error instanceof GatewayError) {
      if (started && !method.readOnly && error.code === "RESPONSE_TOO_LARGE") error.outcomeUnknown = true;
      throw error;
    }
    throw new GatewayError(controller.signal.aborted ? "UPSTREAM_TIMEOUT" : "UPSTREAM_NETWORK_ERROR",
      "未能取得印象笔记响应。", started && !method.readOnly);
  } finally { clearTimeout(timeout); }
}

export async function clipWithObservation(work: Promise<unknown>, ctx: Pick<ExecutionContext, "waitUntil">) {
  const observed = work.then(result => ({ state: "completed" as const, result }),
    error => ({ state: "failed" as const, error }));
  ctx.waitUntil(observed.then(() => undefined));
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const outcome = await Promise.race([observed, new Promise<{ state: "pending" }>(resolve => {
      timer = setTimeout(() => resolve({ state: "pending" }), 5000);
    })]);
    if (outcome.state === "failed") throw outcome.error;
    if (outcome.state === "completed") return outcome.result;
    return { state: "pending", outcomeUnknown: true,
      message: "剪藏请求已发起，暂未取得完成结果。请稍后到印象笔记查看，不要自动重试。" };
  } finally { if (timer !== undefined) clearTimeout(timer); }
}
