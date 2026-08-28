import pc from "picocolors";

export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

export interface LoggerOptions {
  level?: LogLevel;
  prefix?: string;
}

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4,
};

export class Logger {
  private level: LogLevel;
  private prefix: string;

  constructor(options: LoggerOptions = {}) {
    this.level = options.level ?? "info";
    this.prefix = options.prefix ?? "QueryGuard";
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  private shouldLog(targetLevel: LogLevel): boolean {
    return LEVEL_PRIORITY[targetLevel] >= LEVEL_PRIORITY[this.level];
  }

  debug(...args: unknown[]): void {
    if (this.shouldLog("debug")) {
      console.debug(pc.gray(`[${this.prefix}:DEBUG]`), ...args);
    }
  }

  info(...args: unknown[]): void {
    if (this.shouldLog("info")) {
      console.info(pc.cyan(`[${this.prefix}]`), ...args);
    }
  }

  warn(...args: unknown[]): void {
    if (this.shouldLog("warn")) {
      console.warn(pc.yellow(`[${this.prefix}:WARN]`), ...args);
    }
  }

  error(...args: unknown[]): void {
    if (this.shouldLog("error")) {
      console.error(pc.red(`[${this.prefix}:ERROR]`), ...args);
    }
  }

  success(...args: unknown[]): void {
    if (this.shouldLog("info")) {
      console.log(pc.green(`[${this.prefix}]`), ...args);
    }
  }
}

export const logger = new Logger();
