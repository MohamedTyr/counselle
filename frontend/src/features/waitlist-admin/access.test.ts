import { createHmac } from "node:crypto";
import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
  type JWTPayload,
} from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import {
  authorize,
  makeVerify,
  type Env,
} from "../../../functions/admin/_middleware";

// The admin gate is the only thing between a pages.dev host and the whole
// list, so this runs the real jose options against locally minted tokens.

const TEAM = "https://acceptra.cloudflareaccess.com";
const AUD = "aud-of-the-admin-app";
const ADMIN = "founder@acceptra.ai";
const PROD = new URL("https://acceptra.ai/admin/api/waitlist");

const env: Env = {
  DB: {} as D1Database,
  ASSETS: {} as Fetcher,
  ACCESS_TEAM_DOMAIN: TEAM,
  ACCESS_AUD: AUD,
  ADMIN_EMAILS: ` ${ADMIN} , other@acceptra.ai`,
};

let privateKey: CryptoKey;
let keys: ReturnType<typeof createLocalJWKSet>;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey;
  const jwk = await exportJWK(pair.publicKey);
  keys = createLocalJWKSet({ keys: [{ ...jwk, kid: "k1", alg: "RS256" }] });
});

async function token(
  claims: JWTPayload = { email: ADMIN },
  { iss = TEAM, aud = AUD, exp = "5m" } = {},
): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuer(iss)
    .setAudience(aud)
    .setIssuedAt()
    .setExpirationTime(exp)
    .sign(privateKey);
}

function headers(jwt?: string): Headers {
  return new Headers(jwt ? { "Cf-Access-Jwt-Assertion": jwt } : {});
}

function run(url: URL, jwt: string | undefined, overrides: Partial<Env> = {}) {
  const merged = { ...env, ...overrides };
  return authorize(url, headers(jwt), merged, makeVerify(merged, keys));
}

const denied = (reason: string) => ({ ok: false, reason });
const encode = (part: object) =>
  Buffer.from(JSON.stringify(part)).toString("base64url");
const claims = () => ({
  email: ADMIN,
  iss: TEAM,
  aud: AUD,
  exp: Date.now() / 1000 + 300,
});

describe("allowed", () => {
  it("lets a listed founder in on acceptra.ai", async () => {
    expect(await run(PROD, await token())).toEqual({ ok: true, email: ADMIN });
  });

  it("matches the email regardless of case", async () => {
    const jwt = await token({ email: "Founder@Acceptra.AI" });
    expect(await run(PROD, jwt)).toEqual({ ok: true, email: ADMIN });
  });

  it("lets the dev email in on localhost only", async () => {
    const local = new URL("http://localhost:8788/admin/");
    expect(
      await run(local, undefined, { ADMIN_DEV_EMAIL: "dev@example.com" }),
    ).toEqual({ ok: true, email: "dev@example.com" });
  });
});

describe("denied", () => {
  it("without a token", async () => {
    expect(await run(PROD, undefined)).toEqual(denied("token"));
  });

  it("with a bad signature", async () => {
    const other = await generateKeyPair("RS256");
    const jwt = await new SignJWT({ email: ADMIN })
      .setProtectedHeader({ alg: "RS256", kid: "k1" })
      .setIssuer(TEAM)
      .setAudience(AUD)
      .setExpirationTime("5m")
      .sign(other.privateKey);
    expect(await run(PROD, jwt)).toEqual(denied("jwt"));
  });

  it("with another Access app's audience", async () => {
    const jwt = await token(undefined, { aud: "some-other-app" });
    expect(await run(PROD, jwt)).toEqual(denied("jwt"));
  });

  it("with the wrong issuer", async () => {
    const jwt = await token(undefined, {
      iss: "https://evil.cloudflareaccess.com",
    });
    expect(await run(PROD, jwt)).toEqual(denied("jwt"));
  });

  it("with an expired token", async () => {
    const jwt = await token(undefined, { exp: "-1m" });
    expect(await run(PROD, jwt)).toEqual(denied("jwt"));
  });

  it("with alg none", async () => {
    const jwt = `${encode({ alg: "none", kid: "k1" })}.${encode(claims())}.`;
    expect(await run(PROD, jwt)).toEqual(denied("jwt"));
  });

  it("with an HS256 token", async () => {
    // Minted by hand: jose's own HS256 signing trips on jsdom's Uint8Array.
    const unsigned = `${encode({ alg: "HS256", kid: "k1" })}.${encode(claims())}`;
    const signature = createHmac("sha256", "a-shared-secret")
      .update(unsigned)
      .digest("base64url");
    const jwt = `${unsigned}.${signature}`;
    expect(await run(PROD, jwt)).toEqual(denied("jwt"));
  });

  it("with no email claim, as a service token has", async () => {
    const jwt = await token({ common_name: "svc.access" });
    expect(await run(PROD, jwt)).toEqual(denied("email"));
  });

  it("with an unlisted email", async () => {
    const jwt = await token({ email: "stranger@acceptra.ai" });
    expect(await run(PROD, jwt)).toEqual(denied("email"));
  });

  it.each([
    "https://acceptra.pages.dev/admin/",
    "https://x.acceptra.pages.dev/admin/api/waitlist",
  ])("on %s, even with a valid token", async (href) => {
    expect(await run(new URL(href), await token())).toEqual(denied("host"));
  });

  it.each([
    ["an empty ACCESS_AUD", { ACCESS_AUD: "" }],
    [
      "a team domain without https",
      { ACCESS_TEAM_DOMAIN: "acceptra.cloudflareaccess.com" },
    ],
    ["an empty ADMIN_EMAILS", { ADMIN_EMAILS: " , " }],
  ])("with %s, before verifying anything", async (_, overrides) => {
    let verified = false;
    const merged = { ...env, ...overrides };
    const decision = await authorize(
      PROD,
      headers(await token()),
      merged,
      async () => {
        verified = true;
        return {};
      },
    );
    expect(decision).toEqual(denied("config"));
    expect(verified).toBe(false);
  });

  it("on localhost without the dev email", async () => {
    const local = new URL("http://localhost:8788/admin/");
    expect(await run(local, await token())).toEqual(denied("host"));
  });

  it("on acceptra.ai with the dev email set and no token", async () => {
    expect(
      await run(PROD, undefined, { ADMIN_DEV_EMAIL: "dev@example.com" }),
    ).toEqual(denied("token"));
  });
});
