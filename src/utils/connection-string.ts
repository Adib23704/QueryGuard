import * as fs from "node:fs";
import * as path from "node:path";

export interface ParsedPostgresUrl {
  protocol: "postgres:" | "postgresql:";
  user: string;
  password?: string | undefined;
  host: string;
  port: number;
  database: string;
  searchPath?: string | undefined;
  sslMode?: string | undefined;
  rawParams: URLSearchParams;
}

export interface ResolvedDatabaseUrl {
  url: string;
  source: "cli" | "env" | "dotenv" | "default";
}

export function parsePostgresUrl(rawUrl: string): ParsedPostgresUrl {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid PostgreSQL connection URL: ${rawUrl}`);
  }

  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error(
      `Invalid PostgreSQL connection URL scheme: '${url.protocol}'. Expected 'postgres:' or 'postgresql:'.`,
    );
  }

  const database = url.pathname.replace(/^\//, "");
  const port = url.port ? Number.parseInt(url.port, 10) : 5432;
  const sslMode = url.searchParams.get("sslmode") ?? undefined;
  const searchPath =
    url.searchParams.get("search_path") ?? url.searchParams.get("schema") ?? undefined;

  return {
    protocol: url.protocol as "postgres:" | "postgresql:",
    user: decodeURIComponent(url.username),
    password: url.password ? decodeURIComponent(url.password) : undefined,
    host: url.hostname || "localhost",
    port: Number.isNaN(port) ? 5432 : port,
    database: decodeURIComponent(database),
    searchPath,
    sslMode,
    rawParams: url.searchParams,
  };
}

export function rewritePostgresUrl(rawUrl: string, newHost: string, newPort: number): string {
  const parsed = parsePostgresUrl(rawUrl);
  const userPass = parsed.password
    ? `${encodeURIComponent(parsed.user)}:${encodeURIComponent(parsed.password)}`
    : encodeURIComponent(parsed.user);

  const authPart = userPass ? `${userPass}@` : "";
  const queryPart = parsed.rawParams.toString();
  const search = queryPart ? `?${queryPart}` : "";
  const dbPart = parsed.database ? `/${encodeURIComponent(parsed.database)}` : "";

  return `${parsed.protocol}//${authPart}${newHost}:${newPort}${dbPart}${search}`;
}

export function loadDatabaseUrl(
  explicitUrl?: string,
  cwd: string = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
): ResolvedDatabaseUrl {
  if (explicitUrl && explicitUrl.trim().length > 0) {
    return { url: explicitUrl.trim(), source: "cli" };
  }

  if (env.DATABASE_URL && env.DATABASE_URL.trim().length > 0) {
    return { url: env.DATABASE_URL.trim(), source: "env" };
  }

  const envFiles = [".env", ".env.local", ".env.development", ".env.test"];
  for (const file of envFiles) {
    const fullPath = path.resolve(cwd, file);
    if (fs.existsSync(fullPath)) {
      try {
        const content = fs.readFileSync(fullPath, "utf8");
        const match = content.match(/^\s*DATABASE_URL\s*=\s*(?:["']?)([^"'\r\n]+)(?:["']?)/m);
        if (match?.[1] && match[1].trim().length > 0) {
          return { url: match[1].trim(), source: "dotenv" };
        }
      } catch {
        // Skip unreadable files
      }
    }
  }

  return {
    url: "postgres://postgres:postgres@localhost:5432/postgres",
    source: "default",
  };
}
