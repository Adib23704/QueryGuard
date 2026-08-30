import * as fs from "node:fs";
import * as path from "node:path";
import { analyzeTraces } from "../analyzer/index.js";
import type { ConnectionSession, QueryTrace } from "../proxy/types.js";
import { renderHtmlReport } from "../reporters/html.js";
import { renderJsonReport } from "../reporters/json.js";
import { renderMarkdownReport } from "../reporters/markdown.js";
import { renderTerminalReport } from "../reporters/terminal.js";
import { logger } from "../utils/logger.js";
import { type ExecCommandOptions, evaluateExitCode } from "./exec.js";

export interface AnalyzeCommandOptions extends ExecCommandOptions {
  file: string;
}

export async function analyzeFile(options: AnalyzeCommandOptions): Promise<number> {
  if (!options.file) {
    logger.error("No trace file specified. Usage: queryguard analyze --file <trace.json>");
    return 1;
  }

  const filePath = path.resolve(process.cwd(), options.file);
  if (!fs.existsSync(filePath)) {
    logger.error(`Trace file not found: ${options.file}`);
    return 1;
  }

  let traces: QueryTrace[] = [];
  let sessions: ConnectionSession[] = [];

  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      traces = parsed;
    } else if (parsed && typeof parsed === "object") {
      traces = Array.isArray(parsed.traces) ? parsed.traces : [];
      sessions = Array.isArray(parsed.sessions) ? parsed.sessions : [];
    }
  } catch (err) {
    logger.error(`Failed to parse trace JSON file: ${err}`);
    return 1;
  }

  const nPlusOneThreshold = options.nPlusOneThreshold ? Number(options.nPlusOneThreshold) : 5;
  const seqScanRowThreshold = options.seqScanThreshold ? Number(options.seqScanThreshold) : 100;

  const result = await analyzeTraces(traces, sessions, {
    nPlusOneThreshold,
    seqScanRowThreshold,
    dbUrl: options.dbUrl || process.env.DATABASE_URL,
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

  return evaluateExitCode(0, result, options);
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
