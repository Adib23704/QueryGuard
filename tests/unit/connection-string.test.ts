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
});
