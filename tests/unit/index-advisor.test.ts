import { describe, expect, it } from "vitest";
import { analyzePlanTree } from "../../src/analyzer/explain.js";
import { synthesizeIndexDdl } from "../../src/analyzer/index-advisor.js";

describe("Index Advisor & Execution Plan Analyzer", () => {
  it("detects Seq Scan nodes exceeding row threshold and extracts scanned columns from Filter", () => {
    const explainPlan = [
      {
        Plan: {
          "Node Type": "Seq Scan",
          "Parallel Aware": false,
          "Async Capable": false,
          "Relation Name": "orders",
          Alias: "orders",
          "Startup Cost": 0.0,
          "Total Cost": 1850.5,
          "Plan Rows": 12500,
          "Plan Width": 64,
          Filter: "(customer_id = 42 AND status = 'COMPLETED'::text)",
          "Rows Removed by Filter": 8000,
        },
      },
    ];

    const seqScans = analyzePlanTree(explainPlan, { seqScanRowThreshold: 100 });

    expect(seqScans.length).toBe(1);
    const scan = seqScans[0];
    expect(scan?.table).toBe("orders");
    expect(scan?.totalCost).toBe(1850.5);
    expect(scan?.planRows).toBe(12500);
    expect(scan?.columns).toContain("customer_id");
    expect(scan?.columns).toContain("status");
  });

  it("extracts columns from nested sub-plans in complex join queries", () => {
    const complexPlan = [
      {
        Plan: {
          "Node Type": "Hash Join",
          "Startup Cost": 25.0,
          "Total Cost": 500.0,
          "Plan Rows": 300,
          Plans: [
            {
              "Node Type": "Index Scan",
              "Relation Name": "users",
              "Plan Rows": 1,
            },
            {
              "Node Type": "Seq Scan",
              "Relation Name": "audit_events",
              "Total Cost": 340.0,
              "Plan Rows": 5000,
              Filter: "(tenant_id = 99 AND event_type = 'LOGIN')",
            },
          ],
        },
      },
    ];

    const seqScans = analyzePlanTree(complexPlan, { seqScanRowThreshold: 100 });

    expect(seqScans.length).toBe(1);
    expect(seqScans[0]?.table).toBe("audit_events");
    expect(seqScans[0]?.columns).toContain("tenant_id");
    expect(seqScans[0]?.columns).toContain("event_type");
  });

  it("ignores Seq Scan nodes with plan rows below the threshold", () => {
    const smallTablePlan = [
      {
        Plan: {
          "Node Type": "Seq Scan",
          "Relation Name": "constants_table",
          "Total Cost": 1.05,
          "Plan Rows": 12,
          Filter: "(code = 'USD')",
        },
      },
    ];

    const seqScans = analyzePlanTree(smallTablePlan, { seqScanRowThreshold: 100 });
    expect(seqScans.length).toBe(0);
  });

  it("synthesizes valid non-blocking CREATE INDEX CONCURRENTLY DDL statements", () => {
    const recommendation = synthesizeIndexDdl({
      table: "transactions",
      columns: ["merchant_id", "status"],
      reason: "Sequential scan with 45,000 estimated rows and cost 3200",
      estimatedCostReduction: 95.5,
    });

    expect(recommendation.ddl).toBe(
      "CREATE INDEX CONCURRENTLY idx_transactions_merchant_id_status ON transactions (merchant_id, status);",
    );
    expect(recommendation.tableName).toBe("transactions");
    expect(recommendation.columns).toEqual(["merchant_id", "status"]);
  });

  it("handles single-column index DDL synthesis cleanly", () => {
    const recommendation = synthesizeIndexDdl({
      table: "users",
      columns: ["email"],
      reason: "Sequential scan on unindexed email lookup",
    });

    expect(recommendation.ddl).toBe("CREATE INDEX CONCURRENTLY idx_users_email ON users (email);");
  });
});
