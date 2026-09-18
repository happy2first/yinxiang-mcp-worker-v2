export interface UpstreamDiagnostic {
  diagnosticId: string;
  httpStatus: number;
  path: string;
  code?: string;
  statusCode?: string;
  messages: Record<string, string>;
}

// Only allow documented error metadata, never dump data, headers or request bodies.
export function upstreamDiagnostic(value: Record<string, unknown>, token: string,
  httpStatus: number, path: string): UpstreamDiagnostic {
  const status = value.status && typeof value.status === "object" && !Array.isArray(value.status)
    ? value.status as Record<string, unknown> : {};
  const safeCode = (v: unknown) => (typeof v === "string" || typeof v === "number") &&
    /^-?\d{1,10}$/.test(String(v)) ? String(v) : undefined;
  const code = safeCode(value.code);
  const statusCode = safeCode(status.code);
  const messages: Record<string, string> = {};
  for (const [key, v] of Object.entries({
    message: value.message, msg: value.msg, "status.message": status.message, "status.msg": status.msg
  })) {
    if (typeof v === "string" && v.trim()) messages[key] = sanitizeDiagnosticText(v, token);
  }
  return { diagnosticId: crypto.randomUUID(), httpStatus, path,
    ...(code !== undefined ? { code } : {}), ...(statusCode !== undefined ? { statusCode } : {}), messages };
}

export function sanitizeDiagnosticText(value: string, token: string): string {
  let text = value;
  // Redact before truncating so a token straddling the length limit cannot leak.
  const secrets = new Set([token, encodeURIComponent(token), JSON.stringify(token).slice(1, -1)]);
  for (const part of token.split(":")) {
    const v = part.slice(part.indexOf("=") + 1);
    if (v.length >= 8) { secrets.add(v); secrets.add(encodeURIComponent(v)); }
  }
  for (const secret of [...secrets].sort((a, b) => b.length - a.length)) {
    if (secret) text = text.split(secret).join("[REDACTED]");
  }
  return text
    .replace(/S=s[^\s"'<>]*/gi, "[REDACTED]")
    .replace(/Bearer\s+[^\s"',;}]+/gi, "Bearer [REDACTED]")
    .replace(/((?:auth|authorization|token|access[_-]?token|refresh[_-]?token|cookie|password)["']?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;}]+)/gi, "$1[REDACTED]")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .slice(0, 1000);
}
