import * as net from "node:net";
import { logger } from "../utils/logger.js";
import { WireParser } from "./parser.js";
import type { ConnectionSession, ProxyConfig, QueryTraceCallback } from "./types.js";

export interface ProxyConnectionOptions {
  connectionId: number;
  clientSocket: net.Socket;
  config: ProxyConfig;
  onQueryTrace: QueryTraceCallback;
  onClose?: ((connectionId: number) => void) | undefined;
}

export class ProxyConnection {
  public readonly session: ConnectionSession;
  private readonly clientSocket: net.Socket;
  private readonly config: ProxyConfig;
  private readonly onQueryTrace: QueryTraceCallback;
  private readonly onClose?: ((connectionId: number) => void) | undefined;

  private targetSocket: net.Socket | null = null;
  private wireParser: WireParser;
  private isDestroyed = false;
  private sslNegotiated = false;

  constructor(options: ProxyConnectionOptions) {
    this.session = {
      id: options.connectionId,
      clientAddress: `${options.clientSocket.remoteAddress ?? "127.0.0.1"}:${options.clientSocket.remotePort ?? 0}`,
      connectedAt: Date.now(),
      queryCount: 0,
    };

    this.clientSocket = options.clientSocket;
    this.config = options.config;
    this.onQueryTrace = options.onQueryTrace;
    this.onClose = options.onClose;

    this.wireParser = new WireParser({
      connectionId: this.session.id,
      onQueryTrace: (trace) => {
        this.session.queryCount++;
        this.onQueryTrace(trace);
      },
      onLog: (level, msg) => {
        if (this.config.verbose) {
          logger[level](`[Conn #${this.session.id}] ${msg}`);
        }
      },
    });

    this.init();
  }

  private init(): void {
    this.targetSocket = net.createConnection({
      host: this.config.targetHost,
      port: this.config.targetPort,
    });

    this.targetSocket.on("connect", () => {
      if (this.config.verbose) {
        logger.debug(
          `[Conn #${this.session.id}] Connected to PostgreSQL at ${this.config.targetHost}:${this.config.targetPort}`,
        );
      }
    });

    this.clientSocket.on("data", (chunk: Buffer) => {
      if (this.isDestroyed) return;

      if (
        !this.sslNegotiated &&
        (this.config.enableSslFallback ?? true) &&
        WireParser.isSslRequest(chunk)
      ) {
        this.sslNegotiated = true;
        this.clientSocket.write(Buffer.from("N", "ascii"));
        if (this.config.verbose) {
          logger.debug(`[Conn #${this.session.id}] Handled SSLRequest -> replied 'N'`);
        }
        return;
      }

      this.sslNegotiated = true;

      this.wireParser.handleClientData(chunk);

      if (this.targetSocket && !this.targetSocket.destroyed) {
        this.targetSocket.write(chunk);
      }
    });

    this.targetSocket.on("data", (chunk: Buffer) => {
      if (this.isDestroyed) return;

      this.wireParser.handleServerData(chunk);

      if (this.clientSocket && !this.clientSocket.destroyed) {
        this.clientSocket.write(chunk);
      }
    });

    const handleClientClose = () => this.destroy();
    const handleTargetClose = () => this.destroy();

    this.clientSocket.on("error", (err: Error) => {
      if (this.config.verbose) {
        logger.debug(`[Conn #${this.session.id}] Client socket error: ${err.message}`);
      }
      this.destroy();
    });

    this.targetSocket.on("error", (err: Error) => {
      if (this.config.verbose) {
        logger.debug(`[Conn #${this.session.id}] Target DB socket error: ${err.message}`);
      }
      this.destroy();
    });

    this.clientSocket.on("close", handleClientClose);
    this.targetSocket.on("close", handleTargetClose);
  }

  public destroy(): void {
    if (this.isDestroyed) return;
    this.isDestroyed = true;
    this.session.closedAt = Date.now();

    if (this.clientSocket && !this.clientSocket.destroyed) {
      this.clientSocket.destroy();
    }
    if (this.targetSocket && !this.targetSocket.destroyed) {
      this.targetSocket.destroy();
    }

    this.onClose?.(this.session.id);
  }
}
