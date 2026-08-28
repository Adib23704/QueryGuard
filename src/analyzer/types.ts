import type { ConnectionSession, QueryTrace } from "../proxy/types.js";

export type SqlCommand = "SELECT" | "INSERT" | "UPDATE" | "DELETE" | "OTHER";

export interface NormalizedQuery {
  originalSql: string;
  fingerprintSql: string;
  hash: string;
  command: SqlCommand;
  table?: string | undefined;
}

export type DiagnosticIssueType = "N_PLUS_ONE" | "DUPLICATE_QUERY" | "SEQ_SCAN" | "SLOW_QUERY";

export interface NPlusOneIssue {
  type: "N_PLUS_ONE";
  connectionId: number;
  hash: string;
  fingerprintSql: string;
  sampleSql: string;
  table?: string | undefined;
  count: number;
  totalDurationMs: number;
  wastedLatencyMs: number;
  traceIds: string[];
}

export interface DuplicateQueryIssue {
  type: "DUPLICATE_QUERY";
  connectionId: number;
  hash: string;
  sql: string;
  params: unknown[];
  count: number;
  totalDurationMs: number;
  wastedLatencyMs: number;
  traceIds: string[];
}

export interface IndexRecommendation {
  tableName: string;
  columns: string[];
  indexName: string;
  ddl: string;
  reason: string;
  estimatedCostReduction?: number | undefined;
}

export interface SeqScanIssue {
  type: "SEQ_SCAN";
  hash?: string | undefined;
  table: string;
  columns: string[];
  planRows: number;
  totalCost: number;
  filter?: string | undefined;
  recommendation?: IndexRecommendation | undefined;
}

export type DiagnosticIssue = NPlusOneIssue | DuplicateQueryIssue | SeqScanIssue;

export interface AnalysisSummary {
  totalQueries: number;
  uniqueQueries: number;
  totalDurationMs: number;
  wastedDurationMs: number;
  nPlusOneCount: number;
  duplicateCount: number;
  seqScanCount: number;
}

export interface AnalysisResult {
  summary: AnalysisSummary;
  issues: DiagnosticIssue[];
  recommendations: IndexRecommendation[];
  traces: QueryTrace[];
  sessions: ConnectionSession[];
}

export interface AnalyzerOptions {
  nPlusOneThreshold?: number | undefined;
  seqScanRowThreshold?: number | undefined;
  dbUrl?: string | undefined;
  enableExplain?: boolean | undefined;
}
