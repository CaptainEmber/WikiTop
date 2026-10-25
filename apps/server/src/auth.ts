import { randomBytes, createHash } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Config } from "./config.js";
import type { Store } from "./store.js";
import { requireThat, DomainError } from "./errors.js";
import { hash, id } from "./world.js";
const random = () => randomBytes(32).toString("base64url");
export function authReturnPath(value: unknown): string {
  return typeof value === "string" &&
    (/^\/(?:contribute|articles)\/[a-zA-Z0-9_-]+(?:\?sessionId=[a-zA-Z0-9_-]+)?$/.test(
      value,
    ) ||
      /^\/\?editArea=[a-zA-Z0-9_-]+$/.test(value))
    ? value
    : "/";
}
export class Auth {
  constructor(
    private store: Store,
    private c: Config,
  ) {}
  async account(request: Pick<FastifyRequest, "cookies">) {
    const token = request.cookies.wt_session;
    requireThat(token, "unauthenticated", "Sign in required", 401);
    const s = await this.store.read(),
      login = s.logins[hash(token)];
    requireThat(
      login && login.expiresAt > Date.now() && s.accounts[login.accountId],
      "unauthenticated",
      "Your session expired",
      401,
    );
    return s.accounts[login.accountId];
  }
  private async issue(accountId: string, reply: any) {
    const token = random();
    const expiresAt = Date.now() + 8 * 60 * 60 * 1000;
    await this.store.transaction((s) => {
      s.logins[hash(token)] = { id: hash(token), accountId, expiresAt };
    });
    reply.setCookie("wt_session", token, {
      httpOnly: true,
      secure: this.c.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 8 * 60 * 60,
    });
  }
  private endpoint(url: string) {
    return this.c.OIDC_INTERNAL_URL && this.c.OIDC_ISSUER
      ? url.replace(this.c.OIDC_ISSUER, this.c.OIDC_INTERNAL_URL)
      : url;
  }
  private async discovery() {
    requireThat(
      this.c.OIDC_ISSUER,
      "auth_unconfigured",
      "Configure OIDC_ISSUER",
      503,
    );
    const response = await fetch(
      `${this.c.OIDC_INTERNAL_URL ?? this.c.OIDC_ISSUER}/.well-known/openid-configuration`,
      { signal: AbortSignal.timeout(10000) },
    );
    requireThat(
      response.ok,
      "identity_unavailable",
      "Identity provider is unavailable",
      503,
    );
    const metadata = (await response.json()) as any;
    requireThat(
      metadata.issuer === this.c.OIDC_ISSUER,
      "identity_mismatch",
      "Identity provider issuer mismatch",
      503,
    );
    return metadata;
  }
  async routes(app: FastifyInstance) {
    app.get("/auth/login", async (req, reply) => {
      const returnTo = authReturnPath((req.query as any)?.returnTo);
      const metadata = await this.discovery(),
        state = random(),
        verifier = random(),
        nonce = random();
      await this.store.transaction((s) => {
        s.authAttempts[hash(state)] = {
          id: hash(state),
          verifier,
          nonce,
          returnTo,
          expiresAt: Date.now() + 600000,
        };
      });
      reply.setCookie("wt_oauth", state, {
        httpOnly: true,
        secure: this.c.NODE_ENV === "production",
        sameSite: "lax",
        path: "/auth",
        maxAge: 600,
      });
      const url = new URL(metadata.authorization_endpoint);
      url.search = new URLSearchParams({
        client_id: this.c.OIDC_CLIENT_ID,
        redirect_uri: `${this.c.APP_URL}/auth/callback`,
        response_type: "code",
        scope: "openid profile email",
        state,
        nonce,
        code_challenge: createHash("sha256")
          .update(verifier)
          .digest("base64url"),
        code_challenge_method: "S256",
      }).toString();
      return reply.redirect(url.href);
    });
    app.get("/auth/callback", async (req, reply) => {
      const q = req.query as Record<string, string>;
      requireThat(
        q.state && q.state === req.cookies.wt_oauth && q.code,
        "invalid_login",
        "Invalid login response",
        400,
      );
      const attempt = await this.store.transaction((s) => {
        const a = s.authAttempts[hash(q.state)];
        requireThat(
          a && a.expiresAt > Date.now(),
          "invalid_login",
          "Login expired",
          400,
        );
        delete s.authAttempts[a.id];
        return a;
      });
      reply.clearCookie("wt_oauth", { path: "/auth" });
      const m = await this.discovery();
      const response = await fetch(this.endpoint(m.token_endpoint), {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: this.c.OIDC_CLIENT_ID,
          client_secret: this.c.OIDC_CLIENT_SECRET ?? "",
          redirect_uri: `${this.c.APP_URL}/auth/callback`,
          code: q.code,
          code_verifier: attempt.verifier,
        }),
        signal: AbortSignal.timeout(15000),
      });
      requireThat(
        response.ok,
        "invalid_login",
        "Identity provider rejected login",
        401,
      );
      const tokens = (await response.json()) as any;
      const { payload } = await jwtVerify(
        tokens.id_token,
        createRemoteJWKSet(new URL(this.endpoint(m.jwks_uri))),
        {
          issuer: this.c.OIDC_ISSUER,
          audience: this.c.OIDC_CLIENT_ID,
          algorithms: ["RS256"],
        },
      );
      requireThat(
        payload.nonce === attempt.nonce &&
          payload.sub &&
          payload.email_verified === true &&
          typeof payload.email === "string",
        "unverified_identity",
        "A verified email account is required",
        403,
      );
      const accountId = hash(`${payload.iss}:${payload.sub}`);
      await this.store.transaction((s) => {
        s.accounts[accountId] = {
          ...s.accounts[accountId],
          id: accountId,
          issuer: payload.iss!,
          subject: payload.sub!,
          email: String(payload.email).toLowerCase(),
          name: String(
            payload.name ?? payload.preferred_username ?? payload.email,
          ),
        };
      });
      await this.issue(accountId, reply);
      return reply.redirect(authReturnPath(attempt.returnTo));
    });
    app.post("/auth/logout", async (req, reply) => {
      if (req.cookies.wt_session)
        await this.store.transaction((s) => {
          delete s.logins[hash(req.cookies.wt_session!)];
        });
      reply.clearCookie("wt_session", { path: "/" });
      return { ok: true };
    });
    if (this.c.DEV_AUTH === "true" && this.c.NODE_ENV !== "production") {
      app.get("/api/dev/accounts", async () =>
        Object.values((await this.store.read()).accounts).map(
          ({ id, name }) => ({ id, name }),
        ),
      );
      app.post("/auth/dev", async (req, reply) => {
        const accountId = (req.body as any)?.accountId;
        const s = await this.store.read();
        requireThat(
          typeof accountId === "string" &&
            s.accounts[accountId]?.issuer === "dev",
          "invalid_account",
          "Unknown development account",
        );
        await this.issue(accountId, reply);
        return { ok: true };
      });
    }
  }
}
