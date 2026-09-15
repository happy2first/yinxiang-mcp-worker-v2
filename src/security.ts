import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Config } from "./env";

let cachedIssuer: string | undefined;
let cachedKeys: ReturnType<typeof createRemoteJWKSet> | undefined;

export function normalizeTeamDomain(value?: string): string {
  if (!value) throw new Error("Access configuration missing");
  const url = new URL(value);
  if (url.protocol !== "https:" || !url.hostname.endsWith(".cloudflareaccess.com") ||
      url.pathname !== "/" || url.port || url.username || url.password || url.search || url.hash) {
    throw new Error("Invalid Access team origin");
  }
  return url.origin;
}

export async function verifyAccess(request: Request, env: Config) {
  const issuer = normalizeTeamDomain(env.TEAM_DOMAIN);
  if (!env.POLICY_AUD) throw new Error("Access audience missing");
  const token = request.headers.get("cf-access-jwt-assertion");
  if (!token) throw new Error("Access assertion missing");
  if (cachedIssuer !== issuer || !cachedKeys) {
    cachedKeys = createRemoteJWKSet(new URL(issuer + "/cdn-cgi/access/certs"));
    cachedIssuer = issuer;
  }
  return (await jwtVerify(token, cachedKeys, {
    issuer, audience: env.POLICY_AUD, algorithms: ["RS256"]
  })).payload;
}
