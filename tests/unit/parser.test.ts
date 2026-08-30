import { describe, expect, it } from "vitest";
import { WireParser } from "../../src/proxy/parser.js";
import type { QueryTrace } from "../../src/proxy/types.js";

// Helper to construct a simple PostgreSQL wire message: [Type (1B)][Length (4B)][Payload]
function buildPgMessage(type: string, payload: Buffer): Buffer {
  const typeBuf = Buffer.from(type, "ascii");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeInt32BE(payload.length + 4, 0);
  return Buffer.concat([typeBuf, lenBuf, payload]);
}

// Helper to build null-terminated string buffer
function buildCString(str: string): Buffer {
  return Buffer.concat([Buffer.from(str, "utf8"), Buffer.from([0])]);
}

// Helper to construct 'Q' (Simple Query) message
function buildQueryMessage(sql: string): Buffer {
  return buildPgMessage("Q", buildCString(sql));
}

// Helper to construct 'P' (Parse) message: statementName\0, query\0, numParams (Int16), paramOIDs...
function buildParseMessage(statementName: string, sql: string, paramOids: number[] = []): Buffer {
  const stmtBuf = buildCString(statementName);
  const sqlBuf = buildCString(sql);
  const numParamsBuf = Buffer.alloc(2);
  numParamsBuf.writeInt16BE(paramOids.length, 0);

  const oidsBuf = Buffer.alloc(paramOids.length * 4);
  paramOids.forEach((oid, idx) => {
    oidsBuf.writeInt32BE(oid, idx * 4);
  });

  return buildPgMessage("P", Buffer.concat([stmtBuf, sqlBuf, numParamsBuf, oidsBuf]));
}

// Helper to construct 'B' (Bind) message
function buildBindMessage(
  portalName: string,
  statementName: string,
  params: (string | null)[] = [],
): Buffer {
  const portalBuf = buildCString(portalName);
  const stmtBuf = buildCString(statementName);

  // Format codes count = 0 (all text)
  const formatCodesCount = Buffer.alloc(2);
  formatCodesCount.writeInt16BE(0, 0);

  // Num params
  const numParamsBuf = Buffer.alloc(2);
  numParamsBuf.writeInt16BE(params.length, 0);

  const paramBuffers: Buffer[] = [];
  for (const param of params) {
    if (param === null) {
      const lenBuf = Buffer.alloc(4);
      lenBuf.writeInt32BE(-1, 0);
      paramBuffers.push(lenBuf);
    } else {
      const valBuf = Buffer.from(param, "utf8");
      const lenBuf = Buffer.alloc(4);
      lenBuf.writeInt32BE(valBuf.length, 0);
      paramBuffers.push(lenBuf, valBuf);
    }
  }

  // Result format codes count = 0
  const resultFormatCodes = Buffer.alloc(2);
  resultFormatCodes.writeInt16BE(0, 0);

  return buildPgMessage(
    "B",
    Buffer.concat([
      portalBuf,
      stmtBuf,
      formatCodesCount,
      numParamsBuf,
      ...paramBuffers,
      resultFormatCodes,
    ]),
  );
}

// Helper to construct 'E' (Execute) message
function buildExecuteMessage(portalName: string, maxRows = 0): Buffer {
  const portalBuf = buildCString(portalName);
  const maxRowsBuf = Buffer.alloc(4);
  maxRowsBuf.writeInt32BE(maxRows, 0);
  return buildPgMessage("E", Buffer.concat([portalBuf, maxRowsBuf]));
}

// Helper to construct 'C' (CommandComplete) message
function buildCommandCompleteMessage(tag: string): Buffer {
  return buildPgMessage("C", buildCString(tag));
}

// Helper to construct 'Z' (ReadyForQuery) message: status ('I' | 'T' | 'E')
function buildReadyForQueryMessage(status = "I"): Buffer {
  return buildPgMessage("Z", Buffer.from(status, "ascii"));
}

// Helper to construct SSLRequest packet (8 bytes: [8 (Int32)][80877103 (Int32)])
function buildSslRequestMessage(): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeInt32BE(8, 0);
  buf.writeInt32BE(80877103, 4);
  return buf;
}

describe("WireParser - PostgreSQL Wire Protocol Interception", () => {
  it("intercepts simple query ('Q') and completes on ReadyForQuery ('Z')", () => {
    const traces: QueryTrace[] = [];
    const parser = new WireParser({
      connectionId: 1,
      onQueryTrace: (trace) => traces.push(trace),
    });

    const clientQuery = buildQueryMessage("SELECT * FROM users WHERE active = true");
    const serverComplete = buildCommandCompleteMessage("SELECT 10");
    const serverReady = buildReadyForQueryMessage("I");

    parser.handleClientData(clientQuery);
    expect(traces.length).toBe(0);

    parser.handleServerData(serverComplete);
    parser.handleServerData(serverReady);

    expect(traces.length).toBe(1);
    expect(traces[0]?.connectionId).toBe(1);
    expect(traces[0]?.sql).toBe("SELECT * FROM users WHERE active = true");
    expect(traces[0]?.params).toEqual([]);
    expect(traces[0]?.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("intercepts extended query protocol (Parse 'P' -> Bind 'B' -> Execute 'E' -> Complete 'C')", () => {
    const traces: QueryTrace[] = [];
    const parser = new WireParser({
      connectionId: 42,
      onQueryTrace: (trace) => traces.push(trace),
    });

    const parse = buildParseMessage(
      "stmt_1",
      "SELECT id, name FROM accounts WHERE id = $1 AND role = $2",
      [23, 25],
    );
    const bind = buildBindMessage("portal_1", "stmt_1", ["1001", "admin"]);
    const execute = buildExecuteMessage("portal_1");
    const complete = buildCommandCompleteMessage("SELECT 1");
    const ready = buildReadyForQueryMessage("I");

    parser.handleClientData(parse);
    parser.handleClientData(bind);
    parser.handleClientData(execute);
    expect(traces.length).toBe(0);

    parser.handleServerData(complete);
    parser.handleServerData(ready);

    expect(traces.length).toBe(1);
    expect(traces[0]?.connectionId).toBe(42);
    expect(traces[0]?.sql).toBe("SELECT id, name FROM accounts WHERE id = $1 AND role = $2");
    expect(traces[0]?.params).toEqual(["1001", "admin"]);
  });

  it("handles unnamed prepared statement and unnamed portal (default query mode for pg driver)", () => {
    const traces: QueryTrace[] = [];
    const parser = new WireParser({
      connectionId: 7,
      onQueryTrace: (trace) => traces.push(trace),
    });

    const parse = buildParseMessage("", "SELECT * FROM orders WHERE user_id = $1");
    const bind = buildBindMessage("", "", ["555"]);
    const execute = buildExecuteMessage("");
    const complete = buildCommandCompleteMessage("SELECT 5");

    parser.handleClientData(parse);
    parser.handleClientData(bind);
    parser.handleClientData(execute);
    parser.handleServerData(complete);

    expect(traces.length).toBe(1);
    expect(traces[0]?.sql).toBe("SELECT * FROM orders WHERE user_id = $1");
    expect(traces[0]?.params).toEqual(["555"]);
  });

  it("detects SSLRequest packet correctly", () => {
    const sslPacket = buildSslRequestMessage();
    expect(WireParser.isSslRequest(sslPacket)).toBe(true);

    const normalQuery = buildQueryMessage("SELECT 1");
    expect(WireParser.isSslRequest(normalQuery)).toBe(false);
  });

  it("handles TCP stream chunking: message split across multiple chunks", () => {
    const traces: QueryTrace[] = [];
    const parser = new WireParser({
      connectionId: 1,
      onQueryTrace: (trace) => traces.push(trace),
    });

    const fullClientQuery = buildQueryMessage(
      "SELECT extremely_long_column_name_that_crosses_chunk_boundaries FROM table_name",
    );

    // Split into 2 chunks
    const chunk1 = fullClientQuery.subarray(0, 15);
    const chunk2 = fullClientQuery.subarray(15);

    parser.handleClientData(chunk1);
    expect(traces.length).toBe(0);

    parser.handleClientData(chunk2);
    parser.handleServerData(buildCommandCompleteMessage("SELECT 1"));

    expect(traces.length).toBe(1);
    expect(traces[0]?.sql).toBe(
      "SELECT extremely_long_column_name_that_crosses_chunk_boundaries FROM table_name",
    );
  });

  it("handles multiple coalesced messages in a single TCP chunk", () => {
    const traces: QueryTrace[] = [];
    const parser = new WireParser({
      connectionId: 1,
      onQueryTrace: (trace) => traces.push(trace),
    });

    const parse = buildParseMessage("stmt_coalesced", "SELECT 1");
    const bind = buildBindMessage("portal_coalesced", "stmt_coalesced", []);
    const execute = buildExecuteMessage("portal_coalesced");

    // All 3 messages in one single Buffer
    const coalescedClientChunk = Buffer.concat([parse, bind, execute]);
    parser.handleClientData(coalescedClientChunk);

    parser.handleServerData(buildCommandCompleteMessage("SELECT 1"));

    expect(traces.length).toBe(1);
    expect(traces[0]?.sql).toBe("SELECT 1");
  });

  it("does not throw on unrecognized or malformed bytes (fail-safe passthrough)", () => {
    const parser = new WireParser({
      connectionId: 1,
      onQueryTrace: () => {},
    });

    const garbageBuffer = Buffer.from([0xff, 0xfe, 0x00, 0x01, 0x02, 0x03]);
    expect(() => {
      parser.handleClientData(garbageBuffer);
      parser.handleServerData(garbageBuffer);
    }).not.toThrow();
  });
});
