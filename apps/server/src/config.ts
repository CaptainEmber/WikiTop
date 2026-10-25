import { z } from "zod";
const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default("127.0.0.1"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  DATABASE_URL: z.string().optional(),
  WIKI_URL: z.string().url().default("http://localhost:3001"),
  WIKI_INTERNAL_URL: z.string().url().optional(),
  WIKI_API_KEY: z.string().optional(),
  WIKI_AUTH_PROVIDER_KEY: z.string().default("oidc"),
  WIKI_MODE: z.enum(["remote", "memory"]).default("remote"),
  OIDC_ISSUER: z.string().url().optional(),
  OIDC_INTERNAL_URL: z.string().url().optional(),
  OIDC_CLIENT_ID: z.string().default("wikitop"),
  OIDC_CLIENT_SECRET: z.string().optional(),
  S3_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z.string().default("wikitop"),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),
  DEV_AUTH: z.enum(["true", "false"]).default("false"),
});
export type Config = z.infer<typeof schema>;
export function config(env = process.env): Config {
  const c = schema.parse(env);
  if (c.NODE_ENV === "production") {
    if (c.DEV_AUTH === "true" || c.WIKI_MODE === "memory")
      throw new Error("Production forbids development auth and memory wiki");
    for (const k of [
      "DATABASE_URL",
      "WIKI_API_KEY",
      "OIDC_ISSUER",
      "OIDC_CLIENT_SECRET",
      "S3_ENDPOINT",
      "S3_ACCESS_KEY",
      "S3_SECRET_KEY",
    ] as const)
      if (!c[k] || c[k]!.startsWith("replace"))
        throw new Error(`Configure ${k} before starting production`);
    if (
      !c.APP_URL.startsWith("https://") ||
      !c.WIKI_URL.startsWith("https://") ||
      !c.OIDC_ISSUER!.startsWith("https://")
    )
      throw new Error("Production public URLs must use HTTPS");
  }
  return c;
}
