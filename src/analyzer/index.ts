import type { ConnectionSession, QueryTrace } from "../proxy/types.js";
import { detectDuplicates } from "./duplicates.js";
import { analyzePlanTree, runActiveExplain } from "./explain.js";
import { normalizeSql } from "./normalizer.js";
import { detectNPlusOne } from "./nplusone.js";
import type {
  AnalysisResult,
  AnalysisSummary,
  AnalyzerOptions,
  DiagnosticIssue,
  IndexRecommendation,
  SeqScanIssue,
} from "./types.js";

export * from "./duplicates.js";
export * from "./explain.js";
export * from "./index-advisor.js";
export * from "./normalizer.js";
export * from "./nplusone.js";
export * from "./types.js";

export async function analyzeTraces(
  traces: QueryTrace[],
  sessions: ConnectionSession[] = [],
  options: AnalyzerOptions = {},
): Promise<AnalysisResult> {
  const nPlusOneIssues = detectNPlusOne(traces, {
    nPlusOneThreshold: options.nPlusOneThreshold,
  });

  const duplicateIssues = detectDuplicates(traces);

  const seqScanIssues: SeqScanIssue[] = [];
  const recommendations: IndexRecommendation[] = [];

  if (options.enableExplain && options.dbUrl) {
    const uniqueFingerprints = new Map<string, { sql: string; hash: string }>();
    for (const trace of traces) {
      const norm = normalizeSql(trace.sql);
      if (!uniqueFingerprints.has(norm.hash) && norm.command === "SELECT") {
        uniqueFingerprints.set(norm.hash, { sql: trace.sql, hash: norm.hash });
      }
    }

    for (const { sql, hash } of uniqueFingerprints.values()) {
      const plan = await runActiveExplain(sql, options.dbUrl);
      if (plan) {
        const foundSeqScans = analyzePlanTree(plan, {
          seqScanRowThreshold: options.seqScanRowThreshold,
          queryHash: hash,
        });

        for (const scan of foundSeqScans) {
          seqScanIssues.push(scan);
          if (scan.recommendation) {
            recommendations.push(scan.recommendation);
          }
        }
      }
    }
  }

  const seenIndexes = new Set<string>();
  const uniqueRecommendations: IndexRecommendation[] = [];
  for (const rec of recommendations) {
    if (!seenIndexes.has(rec.indexName)) {
      seenIndexes.add(rec.indexName);
      uniqueRecommendations.push(rec);
    }
  }

  const allIssues: DiagnosticIssue[] = [...nPlusOneIssues, ...duplicateIssues, ...seqScanIssues];

  const uniqueQueryHashes = new Set(traces.map((t) => normalizeSql(t.sql).hash));
  const totalDurationMs = traces.reduce((acc, t) => acc + t.durationMs, 0);
  const wastedDurationMs = allIssues.reduce((acc, issue) => {
    if ("wastedLatencyMs" in issue) {
      return acc + issue.wastedLatencyMs;
    }
    return acc;
  }, 0);

  const summary: AnalysisSummary = {
    totalQueries: traces.length,
    uniqueQueries: uniqueQueryHashes.size,
    totalDurationMs: Math.round(totalDurationMs * 100) / 100,
    wastedDurationMs: Math.round(wastedDurationMs * 100) / 100,
    nPlusOneCount: nPlusOneIssues.length,
    duplicateCount: duplicateIssues.length,
    seqScanCount: seqScanIssues.length,
  };

  return {
    summary,
    issues: allIssues,
    recommendations: uniqueRecommendations,
    traces,
    sessions,
  };
}
