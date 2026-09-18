import { expect, it, vi } from "vitest";
import { sanitizeDiagnosticText, upstreamDiagnostic } from "../src/diagnostics";
import { callUpstream, GatewayError } from "../src/upstream";

it("retains only bounded error metadata, including nested messages", () => {
  const d = upstreamDiagnostic({ code: 0, status: { code: 8200, message: "授权无效", msg: "detail" },
    message: "outer", msg: "message2", data: { content: "private note" }, auth: "private" }, "secret", 200, "/path");
  expect(d).toMatchObject({ httpStatus: 200, path: "/path", code: "0", statusCode: "8200",
    messages: { message: "outer", msg: "message2", "status.message": "授权无效", "status.msg": "detail" } });
  expect(JSON.stringify(d)).not.toContain("private");
  expect(d.diagnosticId).toMatch(/^[0-9a-f-]{36}$/);
});
it("redacts complete, encoded and partial credential reflections before truncation", () => {
  const token = "S=s1:U=user12345:A=longSecretValue123";
  const text = sanitizeDiagnosticText("x".repeat(990) + token + encodeURIComponent(token) + " longSecretValue123", token);
  expect(text.length).toBeLessThanOrEqual(1000);
  expect(text).not.toContain("S=s1");
  const short = sanitizeDiagnosticText(token + " " + encodeURIComponent(token) + " longSecretValue123", token);
  expect(short).not.toContain("longSecretValue123");
  expect(short).not.toContain("user12345");
  expect(sanitizeDiagnosticText('auth="other-secret" Bearer other-token token: alternate\n', token))
    .not.toMatch(/other-secret|other-token|alternate|\n/);
});
it("8200 remains a failure and shares sanitized metadata between MCP error and log", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    const token = "private-test-token";
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      status: { code: 8200, message: "upstream detail " + token }, data: { content: "never log this" }
    }));
    const error = await callUpstream({ YX_AUTH_TOKEN: token }, "listNotes", {}, fetcher).catch(e => e);
    if (!(error instanceof GatewayError) || !error.upstream) throw new Error("Missing diagnostic");
    expect(error.code).toBe("UPSTREAM_BUSINESS_8200");
    expect(error.outcomeUnknown).toBe(false);
    expect(error.upstream.messages["status.message"]).toBe("upstream detail [REDACTED]");
    const log = JSON.parse(String(warn.mock.calls[0]?.[0]));
    expect(log.diagnosticId).toBe(error.upstream.diagnosticId);
    expect(log.event).toBe("yinxiang_upstream_business_error");
    expect(JSON.stringify(log)).not.toContain(token);
    expect(JSON.stringify(log)).not.toContain("never log this");
  } finally { warn.mockRestore(); }
});
