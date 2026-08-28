export interface QueryTrace {
  id: string;
  connectionId: number;
  sql: string;
  params: unknown[];
  startTime: number;
  endTime: number;
  durationMs: number;
}

export interface PreparedStatement {
  name: string;
  sql: string;
  paramOids: number[];
}

export interface Portal {
  name: string;
  statementName: string;
  params: unknown[];
}

export interface PendingExecution {
  sql: string;
  params: unknown[];
  startTime: number;
}

export interface ConnectionSession {
  id: number;
  clientAddress: string;
  connectedAt: number;
  closedAt?: number | undefined;
  queryCount: number;
}

export interface ProxyConfig {
  targetHost: string;
  targetPort: number;
  proxyPort: number;
  proxyHost?: string | undefined;
  enableSslFallback?: boolean | undefined;
  verbose?: boolean | undefined;
}

export type QueryTraceCallback = (trace: QueryTrace) => void;
