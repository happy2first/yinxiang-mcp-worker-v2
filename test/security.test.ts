import { expect, it, vi, beforeAll } from "vitest";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("jose", async importOriginal => {
  const actual = await importOriginal<typeof import("jose")>();
  return { ...actual, createRemoteJWKSet: (url: URL) =>
    actual.createRemoteJWKSet(url, { [actual.customFetch]: mocks.fetch }) };
});
import { normalizeTeamDomain, verifyAccess } from "../src/security";
const issuer = "https://example.cloudflareaccess.com";
let keys: Awaited<ReturnType<typeof generateKeyPair>>;
beforeAll(async () => {
  keys = await generateKeyPair("RS256");
  mocks.fetch.mockImplementation(async () => Response.json({
    keys: [{ ...await exportJWK(keys.publicKey), kid: "test", alg: "RS256", use: "sig" }]
  }));
});
async function request(aud: string, exp = "2h", signingKey = keys.privateKey) {
  const token = await new SignJWT({ email: "test@example.com" })
    .setProtectedHeader({ alg: "RS256", kid: "test" }).setIssuer(issuer)
    .setAudience(aud).setExpirationTime(exp).sign(signingKey);
  return new Request("https://worker.example/mcp", { headers: { "cf-access-jwt-assertion": token } });
}
it("validates signature, audience and expiry; caches JWKS", async () => {
  const env = { TEAM_DOMAIN: issuer, POLICY_AUD: "expected" };
  expect((await verifyAccess(await request("expected"), env)).email).toBe("test@example.com");
  await expect(verifyAccess(await request("wrong"), env)).rejects.toThrow();
  await expect(verifyAccess(await request("expected", "-2h"), env)).rejects.toThrow();
  const other = await generateKeyPair("RS256");
  await expect(verifyAccess(await request("expected", "2h", other.privateKey), env)).rejects.toThrow();
  expect(mocks.fetch).toHaveBeenCalledTimes(1);
});
it("rejects missing assertion/configuration and unsafe JWKS origins", async () => {
  await expect(verifyAccess(new Request("https://worker.example/mcp"), {
    TEAM_DOMAIN: issuer, POLICY_AUD: "a" })).rejects.toThrow();
  for (const value of ["http://example.cloudflareaccess.com", "https://example.com",
    issuer + "/path", issuer + "?q=x", "https://user@example.cloudflareaccess.com",
    "https://example.cloudflareaccess.com:8443"]) expect(() => normalizeTeamDomain(value)).toThrow();
});
