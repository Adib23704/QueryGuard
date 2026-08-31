import { describe, expect, it } from "vitest";
import { parsePostgresUrl, rewritePostgresUrl } from "../../src/utils/connection-string.js";

describe("connection-string parser & rewriter", () => {
  it("parses standard postgres connection url", () => {
    const parsed = parsePostgresUrl(
      "postgres://app_user:secret_pass@localhost:5432/production_db?sslmode=require&schema=public",
    );

    expect(parsed.user).toBe("app_user");
    expect(parsed.password).toBe("secret_pass");
    expect(parsed.host).toBe("localhost");
    expect(parsed.port).toBe(5432);
    expect(parsed.database).toBe("production_db");
    expect(parsed.sslMode).toBe("require");
  });

  it("handles postgresql:// scheme and default port 5432", () => {
    const parsed = parsePostgresUrl("postgresql://postgres@db.internal/analytics");

    expect(parsed.user).toBe("postgres");
    expect(parsed.password).toBeUndefined();
    expect(parsed.host).toBe("db.internal");
    expect(parsed.port).toBe(5432);
    expect(parsed.database).toBe("analytics");
  });

  it("rewrites connection url to point to local proxy while preserving credentials, db, and params", () => {
    const original =
      "postgresql://myuser:mypass@db.host.cloud.io:5432/orders_db?sslmode=disable&application_name=testrunner";
    const rewritten = rewritePostgresUrl(original, "127.0.0.1", 5433);

    expect(rewritten).toBe(
      "postgresql://myuser:mypass@127.0.0.1:5433/orders_db?sslmode=disable&application_name=testrunner",
    );
  });

  it("throws descriptive error for invalid connection string", () => {
    expect(() => parsePostgresUrl("http://invalid.url")).toThrow(
      /Invalid PostgreSQL connection URL/,
    );
  });

  it("loads database URL from explicit arg, env, or dotenv file", async () => {
    const { loadDatabaseUrl } = await import("../../src/utils/connection-string.js");

    // 1. Explicit arg has highest precedence
    const explicit = loadDatabaseUrl("postgres://explicit:5432/db", "/non/existent/path", {
      DATABASE_URL: "postgres://from-env:5432/db",
    });
    expect(explicit.url).toBe("postgres://explicit:5432/db");
    expect(explicit.source).toBe("cli");

    // 2. Env variable has second precedence
    const fromEnv = loadDatabaseUrl(undefined, "/non/existent/path", {
      DATABASE_URL: "postgres://from-env:5432/db",
    });
    expect(fromEnv.url).toBe("postgres://from-env:5432/db");
    expect(fromEnv.source).toBe("env");

    // 3. Default fallback when no explicit arg, no env, and no file
    const fallback = loadDatabaseUrl(undefined, "/non/existent/path", {});
    expect(fallback.source).toBe("default");
    expect(fallback.url).toContain("5432");
  });
});
