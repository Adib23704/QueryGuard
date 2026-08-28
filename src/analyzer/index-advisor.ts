import type { IndexRecommendation } from "./types.js";

export interface IndexSynthesisInput {
  table: string;
  columns: string[];
  reason: string;
  estimatedCostReduction?: number | undefined;
}

export function synthesizeIndexDdl(input: IndexSynthesisInput): IndexRecommendation {
  const cleanTable = input.table.replace(/["`]/g, "").trim().toLowerCase();
  const cleanColumns = input.columns.map((c) => c.replace(/["`]/g, "").trim().toLowerCase());

  const colSlug = cleanColumns.join("_");
  const indexName = `idx_${cleanTable}_${colSlug}`;
  const columnsList = cleanColumns.join(", ");

  const ddl = `CREATE INDEX CONCURRENTLY ${indexName} ON ${cleanTable} (${columnsList});`;

  return {
    tableName: cleanTable,
    columns: cleanColumns,
    indexName,
    ddl,
    reason: input.reason,
    estimatedCostReduction: input.estimatedCostReduction,
  };
}
