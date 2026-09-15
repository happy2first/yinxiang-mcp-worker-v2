import { createMcpHandler } from "agents/mcp/server";
import { createServer } from "./server";
import { verifyAccess } from "./security";
import type { Config } from "./env";

export default {
  async fetch(request: Request, env: Config, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const headers = { "Cache-Control": "no-store" };
    if (url.pathname === "/" && request.method === "GET") {
      return Response.json({ service: "yinxiang-mcp-worker-v2", version: "2.0.0", mcp: "/mcp" }, { headers });
    }
    if (!["/mcp", "/health"].includes(url.pathname)) return new Response("Not Found", { status: 404 });
    try { await verifyAccess(request, env); } catch {
      return Response.json({ error: "access_denied" }, { status: 403, headers });
    }
    if (url.pathname === "/health") {
      if (request.method !== "GET") return new Response(null, { status: 405, headers: { Allow: "GET" } });
      return Response.json({ service: "yinxiang-mcp-worker-v2", version: "2.0.0",
        configured: { skillToken: Boolean(env.YX_AUTH_TOKEN?.trim()), cloudflareAccess: true },
        upstreamVerified: false, tokenLifetime: "unknown", refreshSupported: false
      }, { headers });
    }
    // Cloudflare Access Managed OAuth supplies the verified assertion at the edge.
    // This Worker does not mint OAuth tokens or accept unverified identity headers.
    return createMcpHandler(() => createServer(env, ctx))(request, env, ctx);
  }
} satisfies ExportedHandler<Config>;
