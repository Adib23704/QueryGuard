import { randomUUID } from "node:crypto";
import type {
  PendingExecution,
  Portal,
  PreparedStatement,
  QueryTrace,
  QueryTraceCallback,
} from "./types.js";

export interface WireParserOptions {
  connectionId: number;
  onQueryTrace: QueryTraceCallback;
  onLog?: ((level: "debug" | "warn" | "error", msg: string) => void) | undefined;
}

export class WireParser {
  public readonly connectionId: number;
  private readonly onQueryTrace: QueryTraceCallback;
  private readonly onLog?: ((level: "debug" | "warn" | "error", msg: string) => void) | undefined;

  private clientBuffer = Buffer.alloc(0);
  private serverBuffer = Buffer.alloc(0);

  private preparedStatements = new Map<string, PreparedStatement>();
  private portals = new Map<string, Portal>();
  private pendingExecutions: PendingExecution[] = [];
  private pendingSimpleQueries: PendingExecution[] = [];

  constructor(options: WireParserOptions) {
    this.connectionId = options.connectionId;
    this.onQueryTrace = options.onQueryTrace;
    this.onLog = options.onLog;
  }

  public static isSslRequest(data: Buffer): boolean {
    if (data.length < 8) return false;
    const len = data.readInt32BE(0);
    const code = data.readInt32BE(4);
    return len === 8 && code === 80877103;
  }

  public handleClientData(chunk: Buffer): void {
    this.clientBuffer = Buffer.concat([this.clientBuffer, chunk]);

    if (this.clientBuffer.length >= 8 && WireParser.isSslRequest(this.clientBuffer)) {
      this.clientBuffer = this.clientBuffer.subarray(8);
      return;
    }

    while (this.clientBuffer.length >= 5) {
      const typeChar = String.fromCharCode(this.clientBuffer[0] ?? 0);
      const msgLen = this.clientBuffer.readInt32BE(1);

      if (msgLen < 4 || msgLen > 64 * 1024 * 1024) {
        this.clientBuffer = this.clientBuffer.subarray(1);
        continue;
      }

      const totalFrameLen = msgLen + 1;
      if (this.clientBuffer.length < totalFrameLen) {
        break;
      }

      const frame = this.clientBuffer.subarray(0, totalFrameLen);
      this.clientBuffer = this.clientBuffer.subarray(totalFrameLen);

      try {
        this.parseClientMessage(typeChar, frame.subarray(5));
      } catch (err) {
        this.onLog?.("debug", `Non-fatal client frame parse error: ${err}`);
      }
    }
  }

  public handleServerData(chunk: Buffer): void {
    this.serverBuffer = Buffer.concat([this.serverBuffer, chunk]);

    while (this.serverBuffer.length >= 5) {
      const typeChar = String.fromCharCode(this.serverBuffer[0] ?? 0);
      const msgLen = this.serverBuffer.readInt32BE(1);

      if (msgLen < 4 || msgLen > 64 * 1024 * 1024) {
        this.serverBuffer = this.serverBuffer.subarray(1);
        continue;
      }

      const totalFrameLen = msgLen + 1;
      if (this.serverBuffer.length < totalFrameLen) {
        break;
      }

      const frame = this.serverBuffer.subarray(0, totalFrameLen);
      this.serverBuffer = this.serverBuffer.subarray(totalFrameLen);

      try {
        this.parseServerMessage(typeChar, frame.subarray(5));
      } catch (err) {
        this.onLog?.("debug", `Non-fatal server frame parse error: ${err}`);
      }
    }
  }

  private parseClientMessage(type: string, payload: Buffer): void {
    switch (type) {
      case "Q": {
        const sql = this.readCString(payload, 0).str;
        if (sql.trim().length > 0) {
          this.pendingSimpleQueries.push({
            sql,
            params: [],
            startTime: performance.now(),
          });
        }
        break;
      }

      case "P": {
        let offset = 0;
        const { str: statementName, nextOffset: off1 } = this.readCString(payload, offset);
        offset = off1;

        const { str: sql, nextOffset: off2 } = this.readCString(payload, offset);
        offset = off2;

        const paramOids: number[] = [];
        if (offset + 2 <= payload.length) {
          const numParams = payload.readInt16BE(offset);
          offset += 2;
          for (let i = 0; i < numParams && offset + 4 <= payload.length; i++) {
            paramOids.push(payload.readInt32BE(offset));
            offset += 4;
          }
        }

        this.preparedStatements.set(statementName, {
          name: statementName,
          sql,
          paramOids,
        });
        break;
      }

      case "B": {
        let offset = 0;
        const { str: portalName, nextOffset: off1 } = this.readCString(payload, offset);
        offset = off1;

        const { str: statementName, nextOffset: off2 } = this.readCString(payload, offset);
        offset = off2;

        if (offset + 2 > payload.length) break;
        const formatCodesCount = payload.readInt16BE(offset);
        offset += 2;
        const formatCodes: number[] = [];
        for (let i = 0; i < formatCodesCount && offset + 2 <= payload.length; i++) {
          formatCodes.push(payload.readInt16BE(offset));
          offset += 2;
        }

        if (offset + 2 > payload.length) break;
        const numParams = payload.readInt16BE(offset);
        offset += 2;

        const params: unknown[] = [];
        for (let i = 0; i < numParams && offset + 4 <= payload.length; i++) {
          const paramLen = payload.readInt32BE(offset);
          offset += 4;

          if (paramLen === -1) {
            params.push(null);
          } else if (paramLen >= 0 && offset + paramLen <= payload.length) {
            const valBuf = payload.subarray(offset, offset + paramLen);
            offset += paramLen;
            const isBinary = (formatCodes.length === 1 ? formatCodes[0] : formatCodes[i]) === 1;
            if (isBinary) {
              params.push(valBuf);
            } else {
              params.push(valBuf.toString("utf8"));
            }
          }
        }

        this.portals.set(portalName, {
          name: portalName,
          statementName,
          params,
        });
        break;
      }

      case "E": {
        const { str: portalName } = this.readCString(payload, 0);
        const portal = this.portals.get(portalName);
        const stmt = portal ? this.preparedStatements.get(portal.statementName) : undefined;

        if (stmt && stmt.sql.trim().length > 0) {
          this.pendingExecutions.push({
            sql: stmt.sql,
            params: portal ? portal.params : [],
            startTime: performance.now(),
          });
        }
        break;
      }

      case "C": {
        if (payload.length > 1) {
          const closeType = String.fromCharCode(payload[0] ?? 0);
          const { str: name } = this.readCString(payload, 1);
          if (closeType === "S") {
            this.preparedStatements.delete(name);
          } else if (closeType === "P") {
            this.portals.delete(name);
          }
        }
        break;
      }

      case "X": {
        this.preparedStatements.clear();
        this.portals.clear();
        break;
      }
    }
  }

  private parseServerMessage(type: string, _payload: Buffer): void {
    if (type === "C" || type === "Z" || type === "E") {
      const now = performance.now();

      if (this.pendingExecutions.length > 0) {
        const execution = this.pendingExecutions.shift();
        if (execution) {
          this.emitTrace(execution, now);
        }
      } else if (this.pendingSimpleQueries.length > 0) {
        const simple = this.pendingSimpleQueries.shift();
        if (simple) {
          this.emitTrace(simple, now);
        }
      }
    }
  }

  private emitTrace(execution: PendingExecution, endTime: number): void {
    const durationMs = Math.max(0, Math.round((endTime - execution.startTime) * 100) / 100);
    const trace: QueryTrace = {
      id: randomUUID(),
      connectionId: this.connectionId,
      sql: execution.sql,
      params: execution.params,
      startTime: execution.startTime,
      endTime,
      durationMs,
    };
    this.onQueryTrace(trace);
  }

  private readCString(buf: Buffer, startOffset: number): { str: string; nextOffset: number } {
    const nullIdx = buf.indexOf(0, startOffset);
    if (nullIdx === -1) {
      return {
        str: buf.subarray(startOffset).toString("utf8"),
        nextOffset: buf.length,
      };
    }
    return {
      str: buf.subarray(startOffset, nullIdx).toString("utf8"),
      nextOffset: nullIdx + 1,
    };
  }
}
