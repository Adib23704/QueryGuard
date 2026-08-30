import Table from "cli-table3";
import pc from "picocolors";
import type { AnalysisResult } from "../analyzer/types.js";

export function renderTerminalReport(result: AnalysisResult): string {
  const { summary, issues, recommendations } = result;
  const lines: string[] = [];

  lines.push("");
  lines.push(pc.bold(pc.bgCyan(pc.black(" 🛡️  QueryGuard Performance Analysis "))));
  lines.push("");

  const table = new Table({
    head: [pc.cyan("Metric"), pc.cyan("Value"), pc.cyan("Assessment")],
    colWidths: [28, 16, 26],
    style: { head: [], border: [] },
  });

  const isHealthy = summary.nPlusOneCount === 0 && summary.seqScanCount === 0;

  table.push(
    ["Total Queries", summary.totalQueries.toString(), pc.gray("Captured")],
    ["Unique Fingerprints", summary.uniqueQueries.toString(), pc.gray("Signatures")],
    ["Total Execution Time", `${summary.totalDurationMs.toFixed(1)} ms`, pc.gray("Cumulative")],
    [
      "Wasted Latency",
      `${summary.wastedDurationMs.toFixed(1)} ms`,
      summary.wastedDurationMs > 0 ? pc.yellow("Optimizable") : pc.green("Optimal"),
    ],
    [
      "N+1 Query Cascades",
      summary.nPlusOneCount.toString(),
      summary.nPlusOneCount > 0 ? pc.red("⚠️ Action Needed") : pc.green("✓ Clean"),
    ],
    [
      "Duplicate Exact Queries",
      summary.duplicateCount.toString(),
      summary.duplicateCount > 0 ? pc.yellow("⚠️ Redundant") : pc.green("✓ None"),
    ],
    [
      "Unindexed Table Scans",
      summary.seqScanCount.toString(),
      summary.seqScanCount > 0 ? pc.red("⚠️ High Cost") : pc.green("✓ Indexed"),
    ],
  );

  lines.push(table.toString());
  lines.push("");

  if (issues.length > 0) {
    lines.push(pc.bold(pc.yellow("🚨 Detected Performance Issues:")));
    lines.push("");

    for (const issue of issues) {
      if (issue.type === "N_PLUS_ONE") {
        lines.push(
          pc.red(`  • [N+1 Cascade Detected] `) +
            pc.bold(`Table: ${issue.table ?? "unknown"}`) +
            pc.gray(` (Executed ${issue.count}x across connection #${issue.connectionId})`),
        );
        lines.push(
          pc.gray(`    Wasted Latency: `) + pc.yellow(`~${issue.wastedLatencyMs.toFixed(1)} ms`),
        );
        lines.push(pc.gray(`    Fingerprint:    `) + pc.cyan(issue.fingerprintSql));
        lines.push(pc.gray(`    Sample SQL:     `) + pc.white(issue.sampleSql));
        lines.push("");
      } else if (issue.type === "DUPLICATE_QUERY") {
        lines.push(
          pc.yellow(`  • [Duplicate Query] `) +
            pc.bold(`Executed ${issue.count}x with identical parameters`),
        );
        lines.push(
          pc.gray(`    Wasted Latency: `) + pc.yellow(`~${issue.wastedLatencyMs.toFixed(1)} ms`),
        );
        lines.push(pc.gray(`    SQL:            `) + pc.cyan(issue.sql));
        if (issue.params.length > 0) {
          lines.push(pc.gray(`    Params:         `) + pc.white(JSON.stringify(issue.params)));
        }
        lines.push("");
      } else if (issue.type === "SEQ_SCAN") {
        lines.push(
          pc.red(`  • [Unindexed Sequential Scan] `) +
            pc.bold(`Table: ${issue.table}`) +
            pc.gray(
              ` (Est. ${issue.planRows.toLocaleString()} rows, Cost: ${issue.totalCost.toFixed(1)})`,
            ),
        );
        if (issue.filter) {
          lines.push(pc.gray(`    Filter Clause:  `) + pc.yellow(issue.filter));
        }
        lines.push("");
      }
    }
  }

  if (recommendations.length > 0) {
    lines.push(pc.bold(pc.green("💡 Automated Index Recommendations:")));
    lines.push("");

    for (const rec of recommendations) {
      lines.push(pc.green(`  CREATE INDEX (Non-blocking):`));
      lines.push(pc.bold(pc.cyan(`  ${rec.ddl}`)));
      lines.push(pc.gray(`  Rationale: ${rec.reason}`));
      lines.push("");
    }
  }

  if (isHealthy && summary.duplicateCount === 0) {
    lines.push(
      pc.green(pc.bold("✓ All queries within performance budget. Zero anomalies detected.")),
    );
  } else {
    lines.push(
      pc.yellow(
        pc.bold(
          `Found ${issues.length} potential performance regression(s) totaling ~${summary.wastedDurationMs.toFixed(1)} ms wasted latency.`,
        ),
      ),
    );
  }
  lines.push("");

  return lines.join("\n");
}
