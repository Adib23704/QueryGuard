import * as fs from "node:fs";
import * as path from "node:path";
import spawn from "cross-spawn";
import { analyzeTraces } from "../analyzer/index.js";
import type { AnalysisResult } from "../analyzer/types.js";
import { ProxyServer } from "../proxy/server.js";
import { renderHtmlReport } from "../reporters/html.js";
import { renderJsonReport } from "../reporters/json.js";
import { renderMarkdownReport } from "../reporters/markdown.js";
import { renderTerminalReport } from "../reporters/terminal.js";
import {
  loadDatabaseUrl,
  parsePostgresUrl,
  rewritePostgresUrl,
} from "../utils/connection-string.js";
import { logger } from "../utils/logger.js";

export interface ExecCommandOptions {
  port?: string | number | undefined;
  dbUrl?: string | undefined;
  failOnNPlusOne?: boolean | undefined;
  failOnSeqScan?: boolean | undefined;
  nPlusOneThreshold?: string | number | undefined;
  seqScanThreshold?: string | number | undefined;
  htmlReport?: string | undefined;
  markdownReport?: string | undefined;
  jsonReport?: string | undefined;
  silent?: boolean | undefined;
  verbose?: boolean | undefined;
}

export function evaluateExitCode(
  childExitCode: number | null,
  result: AnalysisResult,
  options: ExecCommandOptions,
): number {
  if (childExitCode !== null && childExitCode !== 0) {
    return childExitCode;
  }

  if (options.failOnNPlusOne && result.summary.nPlusOneCount > 0) {
    return 1;
  }

  if (options.failOnSeqScan && result.summary.seqScanCount > 0) {
    return 1;
  }

  return 0;
}

export async function executeCommand(
  commandArgs: string[],
  options: ExecCommandOptions = {},
): Promise<number> {
  if (commandArgs.length === 0) {
    logger.error("No command specified. Usage: queryguard exec [options] -- <command...>");
    return 1;
  }

  const resolved = loadDatabaseUrl(typeof options.dbUrl === "string" ? options.dbUrl : undefined);
  const rawDbUrl = resolved.url;

  let targetHost = "localhost";
  let targetPort = 5432;

  try {
    const parsed = parsePostgresUrl(rawDbUrl);
    targetHost = parsed.host;
    targetPort = parsed.port;
    if (resolved.source === "dotenv") {
      logger.info(`Discovered DATABASE_URL from .env -> Target: ${targetHost}:${targetPort}`);
    } else if (resolved.source === "cli" || resolved.source === "env") {
      logger.info(`Target database: ${targetHost}:${targetPort}`);
    }
  } catch (err) {
    logger.warn(`Could not parse database URL: ${err}. Defaulting proxy target to localhost:5432.`);
  }

  const proxyPort = options.port ? Number(options.port) : 5433;

  const proxy = new ProxyServer({
    targetHost,
    targetPort,
    proxyPort,
    verbose: options.verbose,
  });

  try {
    await proxy.start();
  } catch (err) {
    logger.error(`Failed to start QueryGuard proxy on port ${proxyPort}: ${err}`);
    return 1;
  }

  const actualPort = proxy.getPort();
  let rewrittenUrl = `postgres://127.0.0.1:${actualPort}/postgres`;
  try {
    rewrittenUrl = rewritePostgresUrl(rawDbUrl, "127.0.0.1", actualPort);
  } catch {
    // Fallback if raw URL had non-standard format
  }

  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_URL: rewrittenUrl,
    PGHOST: "127.0.0.1",
    PGPORT: actualPort.toString(),
  };

  const [cmd, ...cmdRest] = commandArgs;
  if (!cmd) return 1;

  let childExitCode: number | null = 0;

  try {
    childExitCode = await new Promise<number | null>((resolve) => {
      const child = spawn(cmd, cmdRest, {
        stdio: "inherit",
        env: childEnv,
      });

      const forwardSignal = (sig: NodeJS.Signals) => {
        if (!child.killed) {
          child.kill(sig);
        }
      };

      process.on("SIGINT", () => forwardSignal("SIGINT"));
      process.on("SIGTERM", () => forwardSignal("SIGTERM"));

      child.on("error", (err) => {
        logger.error(`Child process error: ${err.message}`);
        resolve(1);
      });

      child.on("close", (code) => {
        resolve(code);
      });
    });
  } finally {
    await proxy.stop();
  }

  const nPlusOneThreshold = options.nPlusOneThreshold ? Number(options.nPlusOneThreshold) : 5;
  const seqScanRowThreshold = options.seqScanThreshold ? Number(options.seqScanThreshold) : 100;

  const result = await analyzeTraces(proxy.getTraces(), proxy.getSessions(), {
    nPlusOneThreshold,
    seqScanRowThreshold,
    dbUrl: rawDbUrl,
    enableExplain: Boolean(options.dbUrl || process.env.DATABASE_URL),
  });

  if (!options.silent) {
    console.log(renderTerminalReport(result));
  }

  if (options.htmlReport) {
    writeReportFile(options.htmlReport, renderHtmlReport(result));
  }
  if (options.markdownReport) {
    writeReportFile(options.markdownReport, renderMarkdownReport(result));
  }
  if (options.jsonReport) {
    writeReportFile(options.jsonReport, renderJsonReport(result));
  }

  return evaluateExitCode(childExitCode, result, options);
}

function writeReportFile(filePath: string, content: string): void {
  try {
    const fullPath = path.resolve(process.cwd(), filePath);
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(fullPath, content, "utf8");
    logger.info(`Report saved to ${filePath}`);
  } catch (err) {
    logger.error(`Failed to write report to ${filePath}: ${err}`);
  }
}
