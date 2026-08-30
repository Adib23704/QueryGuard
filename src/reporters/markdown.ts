import type { AnalysisResult } from "../analyzer/types.js";

export function renderMarkdownReport(result: AnalysisResult): string {
  const { summary, issues, recommendations } = result;
  const lines: string[] = [];

  lines.push("## 🛡️ QueryGuard Database Performance Report");
  lines.push("");

  const statusBadge =
    summary.nPlusOneCount === 0 && summary.seqScanCount === 0
      ? "✅ **All checks passed**"
      : "⚠️ **Performance regressions detected**";

  lines.push(
    `> **Status:** ${statusBadge} | **Total Captured Queries:** ${summary.totalQueries} | **Wasted Latency:** ~${summary.wastedDurationMs.toFixed(1)} ms`,
  );
  lines.push("");

  lines.push("| Metric | Value | Status |");
  lines.push("| :--- | :--- | :--- |");
  lines.push(`| **Total Queries** | \`${summary.totalQueries}\` | ℹ️ Captured |`);
  lines.push(`| **Unique Signatures** | \`${summary.uniqueQueries}\` | ℹ️ Distinct |`);
  lines.push(
    `| **Total Query Time** | \`${summary.totalDurationMs.toFixed(1)} ms\` | ⏱️ Cumulative |`,
  );
  lines.push(
    `| **Wasted Latency** | \`${summary.wastedDurationMs.toFixed(1)} ms\` | ${
      summary.wastedDurationMs > 0 ? "⚠️ Optimizable" : "✅ Optimal"
    } |`,
  );
  lines.push(
    `| **N+1 Query Cascades** | \`${summary.nPlusOneCount}\` | ${
      summary.nPlusOneCount > 0 ? "🚨 Action Required" : "✅ Passed"
    } |`,
  );
  lines.push(
    `| **Duplicate Queries** | \`${summary.duplicateCount}\` | ${
      summary.duplicateCount > 0 ? "⚠️ Redundant" : "✅ Passed"
    } |`,
  );
  lines.push(
    `| **Unindexed Scans** | \`${summary.seqScanCount}\` | ${
      summary.seqScanCount > 0 ? "🚨 High Cost" : "✅ Passed"
    } |`,
  );
  lines.push("");

  const nPlusOneIssues = issues.filter((i) => i.type === "N_PLUS_ONE");
  if (nPlusOneIssues.length > 0) {
    lines.push("### N+1 Query Cascades");
    lines.push("");
    for (const issue of nPlusOneIssues) {
      lines.push(
        `<details><summary><b>Table <code>${issue.table ?? "unknown"}</code></b> - Executed ${
          issue.count
        }x (Wasting ~${issue.wastedLatencyMs.toFixed(1)} ms)</summary>`,
      );
      lines.push("");
      lines.push("**Sample Query:**");
      lines.push("```sql");
      lines.push(issue.sampleSql);
      lines.push("```");
      lines.push("");
      lines.push("**Normalized Fingerprint:**");
      lines.push("```sql");
      lines.push(issue.fingerprintSql);
      lines.push("```");
      lines.push("");
      lines.push(`- **Connection ID:** \`#${issue.connectionId}\``);
      lines.push(`- **Execution Count:** \`${issue.count}\``);
      lines.push(`- **Total Latency:** \`${issue.totalDurationMs.toFixed(1)} ms\``);
      lines.push(`- **Wasted Latency:** \`${issue.wastedLatencyMs.toFixed(1)} ms\``);
      lines.push("");
      lines.push("</details>");
      lines.push("");
    }
  }

  const duplicateIssues = issues.filter((i) => i.type === "DUPLICATE_QUERY");
  if (duplicateIssues.length > 0) {
    lines.push("### Redundant Duplicate Queries");
    lines.push("");
    for (const issue of duplicateIssues) {
      lines.push(
        `<details><summary><b>Duplicate Query</b> - Executed ${
          issue.count
        }x with identical parameters (Wasting ~${issue.wastedLatencyMs.toFixed(1)} ms)</summary>`,
      );
      lines.push("");
      lines.push("```sql");
      lines.push(issue.sql);
      lines.push("```");
      lines.push("");
      if (issue.params.length > 0) {
        lines.push(`**Parameters:** \`${JSON.stringify(issue.params)}\``);
        lines.push("");
      }
      lines.push(`- **Connection ID:** \`#${issue.connectionId}\``);
      lines.push(`- **Total Latency:** \`${issue.totalDurationMs.toFixed(1)} ms\``);
      lines.push(`- **Wasted Latency:** \`${issue.wastedLatencyMs.toFixed(1)} ms\``);
      lines.push("");
      lines.push("</details>");
      lines.push("");
    }
  }

  const seqScanIssues = issues.filter((i) => i.type === "SEQ_SCAN");
  if (seqScanIssues.length > 0) {
    lines.push("### Unindexed Sequential Scans");
    lines.push("");
    for (const issue of seqScanIssues) {
      lines.push(
        `<details><summary><b>Table <code>${issue.table}</code></b> - Sequential Scan (~${issue.planRows.toLocaleString()} rows, Cost: ${issue.totalCost.toFixed(
          1,
        )})</summary>`,
      );
      lines.push("");
      if (issue.filter) {
        lines.push(`**Filter Clause:** \`${issue.filter}\``);
        lines.push("");
      }
      if (issue.recommendation) {
        lines.push("**Suggested Index (Non-blocking):**");
        lines.push("```sql");
        lines.push(issue.recommendation.ddl);
        lines.push("```");
        lines.push(`*${issue.recommendation.reason}*`);
        lines.push("");
      }
      lines.push("</details>");
      lines.push("");
    }
  }

  if (recommendations.length > 0) {
    lines.push("### Recommended Index Additions");
    lines.push("");
    lines.push(
      "Run the following non-blocking DDL statements in your production database migration:",
    );
    lines.push("");
    lines.push("```sql");
    for (const rec of recommendations) {
      lines.push(`-- ${rec.reason}`);
      lines.push(rec.ddl);
      lines.push("");
    }
    lines.push("```");
    lines.push("");
  }

  lines.push("---");
  lines.push(
    "*Generated by [QueryGuard](https://github.com/Adib23704/QueryGuard) - PostgreSQL Zero-Code-Change Performance Gate*",
  );

  return lines.join("\n");
}
