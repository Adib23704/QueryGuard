import type { QueryTrace } from "../proxy/types.js";
import { normalizeSql } from "./normalizer.js";
import type { NPlusOneIssue } from "./types.js";

export interface NPlusOneOptions {
  nPlusOneThreshold?: number | undefined;
}

export function detectNPlusOne(
  traces: QueryTrace[],
  options: NPlusOneOptions = {},
): NPlusOneIssue[] {
  const threshold = options.nPlusOneThreshold ?? 5;
  const issues: NPlusOneIssue[] = [];

  const connectionGroups = new Map<number, QueryTrace[]>();
  for (const trace of traces) {
    const group = connectionGroups.get(trace.connectionId);
    if (group) {
      group.push(trace);
    } else {
      connectionGroups.set(trace.connectionId, [trace]);
    }
  }

  for (const [connectionId, sessionTraces] of connectionGroups.entries()) {
    const fingerprintGroups = new Map<
      string,
      {
        traces: QueryTrace[];
        fingerprintSql: string;
        table?: string | undefined;
      }
    >();

    for (const trace of sessionTraces) {
      const normalized = normalizeSql(trace.sql);
      const existing = fingerprintGroups.get(normalized.hash);
      if (existing) {
        existing.traces.push(trace);
      } else {
        fingerprintGroups.set(normalized.hash, {
          traces: [trace],
          fingerprintSql: normalized.fingerprintSql,
          table: normalized.table,
        });
      }
    }

    for (const [hash, group] of fingerprintGroups.entries()) {
      if (group.traces.length > threshold) {
        const count = group.traces.length;
        const totalDurationMs = group.traces.reduce((acc, t) => acc + t.durationMs, 0);
        const initialDurationMs = group.traces[0]?.durationMs ?? 0;
        const wastedLatencyMs = Math.max(0, totalDurationMs - initialDurationMs);
        const sampleSql = group.traces[0]?.sql ?? group.fingerprintSql;

        issues.push({
          type: "N_PLUS_ONE",
          connectionId,
          hash,
          fingerprintSql: group.fingerprintSql,
          sampleSql,
          table: group.table,
          count,
          totalDurationMs: Math.round(totalDurationMs * 100) / 100,
          wastedLatencyMs: Math.round(wastedLatencyMs * 100) / 100,
          traceIds: group.traces.map((t) => t.id),
        });
      }
    }
  }

  return issues;
}
