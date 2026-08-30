import * as net from "node:net";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ProxyServer } from "../../src/proxy/server.js";

const { Client } = pg;

// Minimal mock PostgreSQL server speaking wire protocol 3.0
function createMockPostgresServer(port: number): Promise<net.Server> {
  return new Promise((resolve) => {
    const server = net.createServer((socket) => {
      let startupDone = false;

      socket.on("data", (chunk: Buffer) => {
        if (!startupDone) {
          // Check for SSLRequest
          if (chunk.length === 8 && chunk.readInt32BE(4) === 80877103) {
            socket.write(Buffer.from("N", "ascii"));
            return;
          }

          // Startup packet -> reply AuthOk ('R') + ReadyForQuery ('Z')
          startupDone = true;

          // AuthOk message: 'R' (1B) + len 8 (4B) + 0 (4B)
          const authOk = Buffer.alloc(9);
          authOk.write("R", 0, "ascii");
          authOk.writeInt32BE(8, 1);
          authOk.writeInt32BE(0, 5);

          // ParameterStatus 'S' (application_name, server_version, etc.)
          // ReadyForQuery message: 'Z' (1B) + len 5 (4B) + 'I' (1B)
          const ready = Buffer.alloc(6);
          ready.write("Z", 0, "ascii");
          ready.writeInt32BE(5, 1);
          ready.write("I", 5, "ascii");

          socket.write(Buffer.concat([authOk, ready]));
          return;
        }

        // Parse query packets
        const typeChar = String.fromCharCode(chunk[0] ?? 0);

        if (typeChar === "Q") {
          // Simple query -> reply CommandComplete ('C') + ReadyForQuery ('Z')
          const completePayload = Buffer.from("SELECT 1\0", "utf8");
          const complete = Buffer.alloc(5 + completePayload.length);
          complete.write("C", 0, "ascii");
          complete.writeInt32BE(4 + completePayload.length, 1);
          completePayload.copy(complete, 5);

          const ready = Buffer.alloc(6);
          ready.write("Z", 0, "ascii");
          ready.writeInt32BE(5, 1);
          ready.write("I", 5, "ascii");

          socket.write(Buffer.concat([complete, ready]));
        } else if (typeChar === "P" || typeChar === "B" || typeChar === "E" || typeChar === "S") {
          // Extended query protocol
          // ParseComplete ('1'), BindComplete ('2'), CommandComplete ('C'), ReadyForQuery ('Z')
          const parseComplete = Buffer.alloc(5);
          parseComplete.write("1", 0, "ascii");
          parseComplete.writeInt32BE(4, 1);

          const bindComplete = Buffer.alloc(5);
          bindComplete.write("2", 0, "ascii");
          bindComplete.writeInt32BE(4, 1);

          const completePayload = Buffer.from("SELECT 1\0", "utf8");
          const complete = Buffer.alloc(5 + completePayload.length);
          complete.write("C", 0, "ascii");
          complete.writeInt32BE(4 + completePayload.length, 1);
          completePayload.copy(complete, 5);

          const ready = Buffer.alloc(6);
          ready.write("Z", 0, "ascii");
          ready.writeInt32BE(5, 1);
          ready.write("I", 5, "ascii");

          socket.write(Buffer.concat([parseComplete, bindComplete, complete, ready]));
        }
      });
    });

    server.listen(port, "127.0.0.1", () => {
      resolve(server);
    });
  });
}

describe("ProxyServer Live Integration with pg.Client", () => {
  const MOCK_DB_PORT = 54399;
  const PROXY_PORT = 54398;

  let mockDbServer: net.Server;
  let proxy: ProxyServer;

  beforeAll(async () => {
    mockDbServer = await createMockPostgresServer(MOCK_DB_PORT);
    proxy = new ProxyServer({
      targetHost: "127.0.0.1",
      targetPort: MOCK_DB_PORT,
      proxyPort: PROXY_PORT,
      enableSslFallback: true,
    });
    await proxy.start();
  });

  afterAll(async () => {
    await proxy.stop();
    await new Promise<void>((resolve) => {
      mockDbServer.close(() => resolve());
    });
  });

  it("transparently proxies pg.Client queries and captures QueryTrace records", async () => {
    const client = new Client({
      host: "127.0.0.1",
      port: PROXY_PORT,
      user: "test_user",
      database: "test_db",
      ssl: false,
    });

    await client.connect();

    // 1. Simple query
    await client.query("SELECT 1 as num");

    // 2. Parameterized query
    await client.query("SELECT id, name FROM users WHERE id = $1", [42]);

    await client.end();

    const traces = proxy.getTraces();
    expect(traces.length).toBeGreaterThanOrEqual(2);

    const querySqls = traces.map((t) => t.sql);
    expect(querySqls).toContain("SELECT 1 as num");
    expect(querySqls).toContain("SELECT id, name FROM users WHERE id = $1");

    const paramQuery = traces.find((t) => t.sql.includes("FROM users"));
    expect(paramQuery?.params).toEqual(["42"]);
    expect(paramQuery?.durationMs).toBeGreaterThanOrEqual(0);
  });
});
