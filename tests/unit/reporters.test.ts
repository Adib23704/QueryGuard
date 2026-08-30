import { describe, expect, it } from "vitest";
import type { AnalysisResult } from "../../src/analyzer/types.js";
import { renderHtmlReport } from "../../src/reporters/html.js";
import { renderJsonReport } from "../../src/reporters/json.js";
import { renderMarkdownReport } from "../../src/reporters/markdown.js";
import { renderTerminalReport } from "../../src/reporters/terminal.js";

const mockAnalysisResult: AnalysisResult = {
  summary: {
    totalQueries: 12,
    uniqueQueries: 4,
    totalDurationMs: 145.5,
    wastedDurationMs: 85.2,
    nPlusOneCount: 1,
    duplicateCount: 1,
    seqScanCount: 1,
  },
  issues: [
    {
      type: "N_PLUS_ONE",
      connectionId: 1,
      hash: "abc123hash",
      fingerprintSql: "SELECT * FROM BOOKS WHERE AUTHOR_ID = $?",
      sampleSql: "SELECT * FROM books WHERE author_id = 42",
      table: "books",
      count: 7,
      totalDurationMs: 42.0,
      wastedLatencyMs: 36.0,
      traceIds: ["t1", "t2", "t3", "t4", "t5", "t6", "t7"],
    },
    {
      type: "DUPLICATE_QUERY",
      connectionId: 1,
      hash: "dup456hash",
      sql: "SELECT * FROM settings WHERE key = 'site_name'",
      params: ["site_name"],
      count: 3,
      totalDurationMs: 9.0,
      wastedLatencyMs: 6.0,
      traceIds: ["t8", "t9", "t10"],
    },
    {
      type: "SEQ_SCAN",
      hash: "seq789hash",
      table: "orders",
      columns: ["customer_id", "status"],
      planRows: 15000,
      totalCost: 2450.0,
      filter: "(customer_id = 100 AND status = 'ACTIVE')",
      recommendation: {
        tableName: "orders",
        columns: ["customer_id", "status"],
        indexName: "idx_orders_customer_id_status",
        ddl: "CREATE INDEX CONCURRENTLY idx_orders_customer_id_status ON orders (customer_id, status);",
        reason: "Sequential scan with 15,000 estimated rows and cost 2450.0",
      },
    },
  ],
  recommendations: [
    {
      tableName: "orders",
      columns: ["customer_id", "status"],
      indexName: "idx_orders_customer_id_status",
      ddl: "CREATE INDEX CONCURRENTLY idx_orders_customer_id_status ON orders (customer_id, status);",
      reason: "Sequential scan with 15,000 estimated rows and cost 2450.0",
    },
  ],
  traces: [
    {
      id: "t1",
      connectionId: 1,
      sql: "SELECT * FROM books WHERE author_id = 1",
      params: [1],
      startTime: 1000,
      endTime: 1006,
      durationMs: 6.0,
    },
    {
      id: "t2",
      connectionId: 1,
      sql: "SELECT * FROM books WHERE author_id = 2",
      params: [2],
      startTime: 1010,
      endTime: 1016,
      durationMs: 6.0,
    },
  ],
  sessions: [
    {
      id: 1,
      clientAddress: "127.0.0.1:5433",
      connectedAt: 990,
      closedAt: 1200,
      queryCount: 12,
    },
  ],
};

describe("Terminal Reporter", () => {
  it("renders colorized terminal table with summary and alerts", () => {
    const output = renderTerminalReport(mockAnalysisResult);

    expect(output).toContain("QueryGuard Performance Analysis");
    expect(output).toContain("Total Queries");
    expect(output).toContain("12");
    expect(output).toContain("Wasted Latency");
    expect(output).toContain("N+1 Cascade Detected");
    expect(output).toContain("CREATE INDEX CONCURRENTLY idx_orders_customer_id_status");
  });
});

describe("Markdown Reporter (GitHub PR Comment)", () => {
  it("renders GitHub PR markdown with summary badges, tables, and collapsible details", () => {
    const md = renderMarkdownReport(mockAnalysisResult);

    expect(md).toContain("## 🛡️ QueryGuard Database Performance Report");
    expect(md).toContain("| Metric | Value | Status |");
    expect(md).toContain("<details>");
    expect(md).toContain("<summary>");
    expect(md).toContain("SELECT * FROM books WHERE author_id = 42");
    expect(md).toContain("```sql");
    expect(md).toContain("CREATE INDEX CONCURRENTLY idx_orders_customer_id_status");
  });
});

describe("JSON Reporter", () => {
  it("exports valid JSON representation with complete metadata", () => {
    const jsonStr = renderJsonReport(mockAnalysisResult);
    const parsed = JSON.parse(jsonStr);

    expect(parsed.summary.totalQueries).toBe(12);
    expect(parsed.issues.length).toBe(3);
    expect(parsed.recommendations.length).toBe(1);
    expect(parsed.traces.length).toBe(2);
  });
});

describe("HTML Waterfall Reporter", () => {
  it("generates standalone zero-external-dependency HTML document", () => {
    const html = renderHtmlReport(mockAnalysisResult);

    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<title>QueryGuard Performance Report</title>");
    expect(html).toContain("<style>");
    expect(html).toContain("<script>");
    // Verify no external script/link tags
    expect(html).not.toMatch(/<script\s+src=/i);
    expect(html).not.toMatch(/<link\s+[^>]*href=["']https?:\/\//i);
    // Verify data is embedded
    expect(html).toContain("idx_orders_customer_id_status");
  });
});
