import { describe, expect, it } from "vitest";
import { detectDuplicates } from "../../src/analyzer/duplicates.js";
import { detectNPlusOne } from "../../src/analyzer/nplusone.js";
import type { QueryTrace } from "../../src/proxy/types.js";

function createTrace(
  id: string,
  connectionId: number,
  sql: string,
  params: unknown[],
  durationMs: number,
  startTime = 1000,
): QueryTrace {
  return {
    id,
    connectionId,
    sql,
    params,
    startTime,
    endTime: startTime + durationMs,
    durationMs,
  };
}

describe("N+1 Cascade Detector", () => {
  it("detects N+1 cascade when repetitive queries exceed threshold within a connection session", () => {
    const traces: QueryTrace[] = [
      createTrace("t0", 1, "SELECT * FROM authors WHERE id = 1", [1], 15.0, 1000),
      createTrace("t1", 1, "SELECT * FROM books WHERE author_id = 1", [1], 4.0, 1020),
      createTrace("t2", 1, "SELECT * FROM books WHERE author_id = 2", [2], 5.0, 1030),
      createTrace("t3", 1, "SELECT * FROM books WHERE author_id = 3", [3], 4.5, 1040),
      createTrace("t4", 1, "SELECT * FROM books WHERE author_id = 4", [4], 6.0, 1050),
      createTrace("t5", 1, "SELECT * FROM books WHERE author_id = 5", [5], 5.5, 1060),
      createTrace("t6", 1, "SELECT * FROM books WHERE author_id = 6", [6], 4.0, 1070),
    ];

    const issues = detectNPlusOne(traces, { nPlusOneThreshold: 5 });

    expect(issues.length).toBe(1);
    const issue = issues[0];
    expect(issue).toBeDefined();
    expect(issue?.type).toBe("N_PLUS_ONE");
    expect(issue?.connectionId).toBe(1);
    expect(issue?.count).toBe(6);
    expect(issue?.table).toBe("books");
    expect(issue?.fingerprintSql).toBe("SELECT * FROM BOOKS WHERE AUTHOR_ID = $?");
    // Wasted latency = total duration - first query duration: (4+5+4.5+6+5.5+4) - 4 = 25.0ms
    expect(issue?.wastedLatencyMs).toBeCloseTo(25.0, 1);
  });

  it("isolates query counts by connection session (no false positives across separate connections)", () => {
    const traces: QueryTrace[] = [
      // 3 in connection 1
      createTrace("t1", 1, "SELECT * FROM items WHERE category = 'A'", ["A"], 2.0),
      createTrace("t2", 1, "SELECT * FROM items WHERE category = 'B'", ["B"], 2.0),
      createTrace("t3", 1, "SELECT * FROM items WHERE category = 'C'", ["C"], 2.0),
      // 3 in connection 2
      createTrace("t4", 2, "SELECT * FROM items WHERE category = 'D'", ["D"], 2.0),
      createTrace("t5", 2, "SELECT * FROM items WHERE category = 'E'", ["E"], 2.0),
      createTrace("t6", 2, "SELECT * FROM items WHERE category = 'F'", ["F"], 2.0),
    ];

    const issues = detectNPlusOne(traces, { nPlusOneThreshold: 5 });
    expect(issues.length).toBe(0);
  });

  it("does not flag queries under threshold", () => {
    const traces: QueryTrace[] = [
      createTrace("t1", 1, "SELECT * FROM tags WHERE id = 1", [1], 1.0),
      createTrace("t2", 1, "SELECT * FROM tags WHERE id = 2", [2], 1.0),
      createTrace("t3", 1, "SELECT * FROM tags WHERE id = 3", [3], 1.0),
    ];

    const issues = detectNPlusOne(traces, { nPlusOneThreshold: 5 });
    expect(issues.length).toBe(0);
  });
});

describe("Duplicate Query Detector", () => {
  it("detects exact duplicate queries with identical fingerprints and identical parameters in same connection", () => {
    const traces: QueryTrace[] = [
      createTrace("t1", 1, "SELECT * FROM settings WHERE key = 'theme'", ["theme"], 3.0),
      createTrace("t2", 1, "SELECT * FROM settings WHERE key = 'theme'", ["theme"], 2.5),
      createTrace("t3", 1, "SELECT * FROM settings WHERE key = 'theme'", ["theme"], 3.5),
    ];

    const duplicates = detectDuplicates(traces);

    expect(duplicates.length).toBe(1);
    const dup = duplicates[0];
    expect(dup?.type).toBe("DUPLICATE_QUERY");
    expect(dup?.count).toBe(3);
    expect(dup?.wastedLatencyMs).toBeCloseTo(6.0, 1);
  });

  it("does not flag queries with different parameter values as exact duplicates", () => {
    const traces: QueryTrace[] = [
      createTrace("t1", 1, "SELECT * FROM settings WHERE key = 'theme'", ["theme"], 3.0),
      createTrace("t2", 1, "SELECT * FROM settings WHERE key = 'lang'", ["lang"], 2.5),
    ];

    const duplicates = detectDuplicates(traces);
    expect(duplicates.length).toBe(0);
  });
});
