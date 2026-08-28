import type { QueryTrace } from "../proxy/types.js";
import { normalizeSql } from "./normalizer.js";
import type { DuplicateQueryIssue } from "./types.js";

export function detectDuplicates(traces: QueryTrace[]): DuplicateQueryIssue[] {
  const issues: DuplicateQueryIssue[] = [];

  const duplicateGroups = new Map<
    string,
    {
      connectionId: number;
      hash: string;
      sql: string;
      params: unknown[];
      traces: QueryTrace[];
    }
  >();

  for (const trace of traces) {
    const normalized = normalizeSql(trace.sql);
    let serializedParams: string;
    try {
      serializedParams = JSON.stringify(trace.params);
    } catch {
      serializedParams = String(trace.params);
    }

    const key = `${trace.connectionId}:${normalized.hash}:${serializedParams}`;
    const existing = duplicateGroups.get(key);

    if (existing) {
      existing.traces.push(trace);
    } else {
      duplicateGroups.set(key, {
        connectionId: trace.connectionId,
        hash: normalized.hash,
        sql: trace.sql,
        params: trace.params,
        traces: [trace],
      });
    }
  }

  for (const group of duplicateGroups.values()) {
    if (group.traces.length > 1) {
      const totalDurationMs = group.traces.reduce((acc, t) => acc + t.durationMs, 0);
      const firstDurationMs = group.traces[0]?.durationMs ?? 0;
      const wastedLatencyMs = Math.max(0, totalDurationMs - firstDurationMs);

      issues.push({
        type: "DUPLICATE_QUERY",
        connectionId: group.connectionId,
        hash: group.hash,
        sql: group.sql,
        params: group.params,
        count: group.traces.length,
        totalDurationMs: Math.round(totalDurationMs * 100) / 100,
        wastedLatencyMs: Math.round(wastedLatencyMs * 100) / 100,
        traceIds: group.traces.map((t) => t.id),
      });
    }
  }

  return issues;
}
