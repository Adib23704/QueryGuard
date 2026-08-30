import { Command } from "commander";
import { analyzeFile } from "./analyze.js";
import { executeCommand } from "./exec.js";

export function parseCliArgs(argv: string[] = process.argv): Command {
  const program = new Command();

  program
    .name("queryguard")
    .description(
      "PostgreSQL wire-protocol proxy, N+1 query cascade detector, and automated index advisor",
    )
    .version("1.0.0");

  program
    .command("exec", { isDefault: true })
    .description("Launch transparent proxy, run test suite, and analyze query traffic")
    .argument("[command...]", "Command and arguments to run (e.g. -- pnpm test)")
    .option("-p, --port <number>", "Port for local proxy to listen on", "5433")
    .option("--db-url <url>", "Target PostgreSQL database connection string")
    .option("--fail-on-n-plus-one", "Exit with code 1 if N+1 query cascades are detected", false)
    .option(
      "--fail-on-seq-scan",
      "Exit with code 1 if sequential scans on large tables are detected",
      false,
    )
    .option("--n-plus-one-threshold <number>", "Query count threshold to flag N+1 cascade", "5")
    .option(
      "--seq-scan-threshold <number>",
      "Estimated row threshold to flag sequential scans",
      "100",
    )
    .option("--html-report <path>", "File path to write standalone HTML report")
    .option("--markdown-report <path>", "File path to write GitHub PR comment markdown report")
    .option("--json-report <path>", "File path to export JSON analysis report")
    .option("--silent", "Suppress terminal summary table output", false)
    .option("--verbose", "Enable detailed proxy diagnostic logging", false)
    .action(async (commandArgs: string[], options) => {
      const exitCode = await executeCommand(commandArgs, options);
      process.exit(exitCode);
    });

  program
    .command("analyze")
    .description("Perform offline diagnostic analysis on a saved JSON trace export")
    .requiredOption("-f, --file <path>", "Path to captured trace JSON file")
    .option("--db-url <url>", "PostgreSQL URL for active EXPLAIN index analysis")
    .option("--fail-on-n-plus-one", "Exit with code 1 if N+1 query cascades are detected", false)
    .option(
      "--fail-on-seq-scan",
      "Exit with code 1 if sequential scans on large tables are detected",
      false,
    )
    .option("--n-plus-one-threshold <number>", "Query count threshold to flag N+1 cascade", "5")
    .option(
      "--seq-scan-threshold <number>",
      "Estimated row threshold to flag sequential scans",
      "100",
    )
    .option("--html-report <path>", "File path to write standalone HTML report")
    .option("--markdown-report <path>", "File path to write GitHub PR comment markdown report")
    .option("--json-report <path>", "File path to export JSON analysis report")
    .option("--silent", "Suppress terminal summary table output", false)
    .action(async (options) => {
      const exitCode = await analyzeFile(options);
      process.exit(exitCode);
    });

  return program.parse(argv);
}

export function runCli(argv = process.argv): void {
  parseCliArgs(argv);
}

if (
  process.argv[1]?.endsWith("queryguard.js") ||
  process.argv[1]?.endsWith("index.ts") ||
  process.argv[1]?.includes("queryguard")
) {
  runCli();
}
