import { readFile } from "node:fs/promises";
import { z } from "zod";
import { config } from "./config.js";
import { RemoteWiki } from "./wiki.js";
import { PostgresStore } from "./store.js";
import { hash } from "./world.js";
const c = config();
if (
  !c.DATABASE_URL ||
  !c.OIDC_ISSUER ||
  !process.env.PROTOTYPE_USERS_FILE ||
  !process.env.KEYCLOAK_ADMIN_PASSWORD
)
  throw new Error(
    "Set DATABASE_URL, OIDC_ISSUER, PROTOTYPE_USERS_FILE, and KEYCLOAK_ADMIN_PASSWORD",
  );
const users = z
  .array(
    z
      .object({
        email: z.string().email(),
        name: z.string().min(1),
        temporaryPassword: z.string().min(12),
      })
      .strict(),
  )
  .min(1)
  .parse(JSON.parse(await readFile(process.env.PROTOTYPE_USERS_FILE, "utf8")));
const origin = new URL(c.OIDC_ISSUER).origin,
  realm = c.OIDC_ISSUER.split("/realms/")[1];
if (!realm) throw new Error("Expected Keycloak realm issuer");
const response = await fetch(
  `${origin}/realms/master/protocol/openid-connect/token`,
  {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "password",
      client_id: "admin-cli",
      username: process.env.KEYCLOAK_ADMIN_USERNAME ?? "admin",
      password: process.env.KEYCLOAK_ADMIN_PASSWORD,
    }),
  },
);
if (!response.ok) throw new Error("Keycloak administrative login failed");
const token = ((await response.json()) as any).access_token;
async function admin(path: string, method = "GET", body?: unknown) {
  const r = await fetch(`${origin}/admin/realms/${realm}/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`Keycloak provisioning failed (${r.status})`);
  return r.status === 204 || r.status === 201 ? null : (r.json() as any);
}
const store = new PostgresStore(c.DATABASE_URL),
  wiki = new RemoteWiki(c);
try {
  await store.migrate();
  await wiki.check();
  for (const input of users) {
    const email = input.email.toLowerCase();
    let keycloakUsers = await admin(
      `users?email=${encodeURIComponent(email)}&exact=true`,
    );
    if (!keycloakUsers.length) {
      await admin("users", "POST", {
        username: email,
        email,
        firstName: input.name,
        enabled: true,
        emailVerified: true,
        credentials: [
          { type: "password", value: input.temporaryPassword, temporary: true },
        ],
      });
      keycloakUsers = await admin(
        `users?email=${encodeURIComponent(email)}&exact=true`,
      );
    }
    const kc = keycloakUsers[0];
    if (!kc?.id || !kc.emailVerified)
      throw new Error("Keycloak account must have a verified email");
    const found = (
      await wiki.query(
        "query($filter:String){users{list(filter:$filter){id email providerKey}}}",
        { filter: email },
      )
    ).users.list.find(
      (u: any) =>
        u.email.toLowerCase() === email &&
        u.providerKey === c.WIKI_AUTH_PROVIDER_KEY,
    );
    if (!found) {
      const result = (
        await wiki.query(
          "mutation($email:String!,$name:String!,$provider:String!){users{create(email:$email,name:$name,providerKey:$provider,groups:[],sendWelcomeEmail:false){responseResult{succeeded message}user{id}}}}",
          { email, name: input.name, provider: c.WIKI_AUTH_PROVIDER_KEY },
        )
      ).users.create;
      if (!result.responseResult.succeeded)
        throw new Error(
          `Wiki provisioning failed: ${result.responseResult.message}`,
        );
    }
    const accountId = hash(`${c.OIDC_ISSUER}:${kc.id}`);
    const account = {
      id: accountId,
      issuer: c.OIDC_ISSUER!,
      subject: kc.id,
      email,
      name: input.name,
    };
    await wiki.ensureAuthor(account);
    await store.transaction((s) => {
      s.accounts[accountId] = { ...s.accounts[accountId], ...account };
    });
    console.log(`Provisioned ${email}`);
  }
} finally {
  await store.close();
}
