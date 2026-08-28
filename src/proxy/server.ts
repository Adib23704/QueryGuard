import { EventEmitter } from "node:events";
import * as net from "node:net";
import { logger } from "../utils/logger.js";
import { ProxyConnection } from "./connection.js";
import type { ConnectionSession, ProxyConfig, QueryTrace, QueryTraceCallback } from "./types.js";

export class ProxyServer extends EventEmitter {
  private readonly config: ProxyConfig;
  private server: net.Server | null = null;
  private activeConnections = new Map<number, ProxyConnection>();
  private traces: QueryTrace[] = [];
  private sessions: ConnectionSession[] = [];
  private nextConnectionId = 1;
  private isRunning = false;

  constructor(config: ProxyConfig) {
    super();
    this.config = {
      ...config,
      proxyHost: config.proxyHost ?? "127.0.0.1",
      enableSslFallback: config.enableSslFallback ?? true,
    };
  }

  public async start(): Promise<void> {
    if (this.isRunning) return;

    return new Promise((resolve, reject) => {
      this.server = net.createServer((clientSocket: net.Socket) => {
        const connId = this.nextConnectionId++;
        const conn = new ProxyConnection({
          connectionId: connId,
          clientSocket,
          config: this.config,
          onQueryTrace: (trace) => {
            this.traces.push(trace);
            this.emit("trace", trace);
          },
          onClose: (id) => {
            this.activeConnections.delete(id);
          },
        });

        this.activeConnections.set(connId, conn);
        this.sessions.push(conn.session);
      });

      this.server.on("error", (err: Error) => {
        logger.error(`Proxy server error: ${err.message}`);
        this.emit("error", err);
        reject(err);
      });

      this.server.listen(this.config.proxyPort, this.config.proxyHost ?? "127.0.0.1", () => {
        this.isRunning = true;
        const address = this.server?.address();
        const boundPort =
          typeof address === "object" && address ? address.port : this.config.proxyPort;
        if (this.config.verbose) {
          logger.info(
            `Proxy listening on ${this.config.proxyHost}:${boundPort} -> forwarding to ${this.config.targetHost}:${this.config.targetPort}`,
          );
        }
        resolve();
      });
    });
  }

  public async stop(): Promise<void> {
    if (!this.isRunning || !this.server) return;

    this.isRunning = false;

    for (const conn of this.activeConnections.values()) {
      conn.destroy();
    }
    this.activeConnections.clear();

    return new Promise((resolve) => {
      this.server?.close(() => {
        this.server = null;
        resolve();
      });
    });
  }

  public onTrace(callback: QueryTraceCallback): this {
    this.on("trace", callback);
    return this;
  }

  public getTraces(): QueryTrace[] {
    return [...this.traces];
  }

  public clearTraces(): void {
    this.traces = [];
  }

  public getSessions(): ConnectionSession[] {
    return [...this.sessions];
  }

  public getPort(): number {
    const address = this.server?.address();
    if (typeof address === "object" && address) {
      return address.port;
    }
    return this.config.proxyPort;
  }
}
