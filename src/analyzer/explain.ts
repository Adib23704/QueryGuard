import pg from "pg";
import { logger } from "../utils/logger.js";
import { synthesizeIndexDdl } from "./index-advisor.js";
import type { SeqScanIssue } from "./types.js";

const { Client } = pg;

export interface ExplainNode {
  "Node Type": string;
  "Relation Name"?: string | undefined;
  Alias?: string | undefined;
  "Startup Cost"?: number | undefined;
  "Total Cost"?: number | undefined;
  "Plan Rows"?: number | undefined;
  "Plan Width"?: number | undefined;
  Filter?: string | undefined;
  "Rows Removed by Filter"?: number | undefined;
  "Sort Key"?: string[] | string | undefined;
  Plans?: ExplainNode[] | undefined;
  Plan?: ExplainNode | undefined;
  [key: string]: unknown;
}

export interface ExplainResultWrapper {
  Plan: ExplainNode;
}

export interface PlanAnalysisOptions {
  seqScanRowThreshold?: number | undefined;
  queryHash?: string | undefined;
}

const RESERVED_EXCLUDE_COLUMNS = new Set([
  "null",
  "true",
  "false",
  "text",
  "integer",
  "bigint",
  "boolean",
  "timestamp",
  "timestamptz",
  "varchar",
  "numeric",
  "now",
  "current_timestamp",
  "and",
  "or",
  "not",
  "is",
]);

export function analyzePlanTree(
  planOutput: ExplainResultWrapper[] | ExplainNode[] | ExplainNode,
  options: PlanAnalysisOptions = {},
): SeqScanIssue[] {
  const threshold = options.seqScanRowThreshold ?? 100;
  const issues: SeqScanIssue[] = [];

  function traverse(node: ExplainNode | undefined): void {
    if (!node) return;

    if (node.Plan) {
      traverse(node.Plan);
      return;
    }

    const nodeType = node["Node Type"];
    if (nodeType === "Seq Scan") {
      const planRows = Number(node["Plan Rows"] ?? 0);
      const totalCost = Number(node["Total Cost"] ?? 0);
      const tableName = node["Relation Name"] ?? node.Alias ?? "unknown_table";

      if (planRows >= threshold) {
        const columns = extractColumnsFromNode(node);
        const filter = node.Filter ?? undefined;

        let recommendation: import("./types.js").IndexRecommendation | undefined;
        if (columns.length > 0) {
          recommendation = synthesizeIndexDdl({
            table: tableName,
            columns,
            reason: `Sequential scan on table '${tableName}' with estimated ${planRows.toLocaleString()} rows and cost ${totalCost.toFixed(1)}`,
          });
        }

        issues.push({
          type: "SEQ_SCAN",
          hash: options.queryHash,
          table: tableName,
          columns,
          planRows,
          totalCost,
          filter,
          recommendation,
        });
      }
    }

    if (Array.isArray(node.Plans)) {
      for (const child of node.Plans) {
        traverse(child);
      }
    }
  }

  if (Array.isArray(planOutput)) {
    for (const item of planOutput) {
      if ("Plan" in item && item.Plan) {
        traverse(item.Plan);
      } else {
        traverse(item as ExplainNode);
      }
    }
  } else {
    traverse(planOutput);
  }

  return issues;
}

function extractColumnsFromNode(node: ExplainNode): string[] {
  const columnSet = new Set<string>();

  if (node.Filter) {
    const regex = /\b([a-zA-Z_][a-zA-Z0-9_]*)\s*(?:=|<>|!=|<|>|<=|>=|LIKE|ILIKE|IN|IS|\)|\s)/gi;
    let match: RegExpExecArray | null = null;

    while (true) {
      match = regex.exec(node.Filter);
      if (!match) break;
      const col = match[1]?.toLowerCase();
      if (col && !RESERVED_EXCLUDE_COLUMNS.has(col) && !col.startsWith("$")) {
        columnSet.add(col);
      }
    }
  }

  if (node["Sort Key"]) {
    const keys = Array.isArray(node["Sort Key"]) ? node["Sort Key"] : [node["Sort Key"]];
    for (const key of keys) {
      if (typeof key === "string") {
        const cleanKey = key
          .replace(/\b(ASC|DESC|NULLS|FIRST|LAST)\b/gi, "")
          .trim()
          .toLowerCase();
        if (cleanKey && !RESERVED_EXCLUDE_COLUMNS.has(cleanKey)) {
          columnSet.add(cleanKey);
        }
      }
    }
  }

  return Array.from(columnSet);
}

export async function runActiveExplain(
  sql: string,
  dbUrl: string,
): Promise<ExplainResultWrapper[] | null> {
  const client = new Client({ connectionString: dbUrl });

  try {
    await client.connect();
    const explainSql = `EXPLAIN (FORMAT JSON) ${sql}`;
    const result = await client.query(explainSql);
    const planJson = result.rows[0]?.["QUERY PLAN"] ?? result.rows[0]?.Plan ?? result.rows[0];
    return Array.isArray(planJson) ? planJson : [planJson];
  } catch (err) {
    logger.debug(`Active EXPLAIN failed for query: ${sql}. Error: ${err}`);
    return null;
  } finally {
    try {
      await client.end();
    } catch {
      // Ignore disconnect errors
    }
  }
}
