/**
 * Structured Logger
 *
 * JSON-formatted logging for CloudWatch Logs integration.
 */

/**
 * Log levels
 */
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  FATAL = 4,
}

/**
 * Log entry
 */
export interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  context?: Record<string, unknown>;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
  duration?: number;
  requestId?: string;
  pipelineId?: string;
  game?: string;
  source?: string;
}

/**
 * Logger configuration
 */
export interface LoggerConfig {
  level: LogLevel;
  json: boolean;
  includeTimestamp: boolean;
  includeContext: boolean;
  requestId?: string;
  pipelineId?: string;
}

const DEFAULT_CONFIG: LoggerConfig = {
  level: LogLevel.INFO,
  json: process.env.LOG_FORMAT === 'json' || process.env.AWS_LAMBDA_FUNCTION_NAME !== undefined,
  includeTimestamp: true,
  includeContext: true,
};

/**
 * Structured logger
 */
export class Logger {
  private config: LoggerConfig;
  private context: Record<string, unknown> = {};

  constructor(config?: Partial<LoggerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Set context that will be included in all log entries
   */
  setContext(context: Record<string, unknown>): void {
    this.context = { ...this.context, ...context };
  }

  /**
   * Clear context
   */
  clearContext(): void {
    this.context = {};
  }

  /**
   * Create a child logger with additional context
   */
  child(context: Record<string, unknown>): Logger {
    const child = new Logger(this.config);
    child.setContext({ ...this.context, ...context });
    return child;
  }

  /**
   * Log at DEBUG level
   */
  debug(message: string, context?: Record<string, unknown>): void {
    this.log(LogLevel.DEBUG, message, context);
  }

  /**
   * Log at INFO level
   */
  info(message: string, context?: Record<string, unknown>): void {
    this.log(LogLevel.INFO, message, context);
  }

  /**
   * Log at WARN level
   */
  warn(message: string, context?: Record<string, unknown>): void {
    this.log(LogLevel.WARN, message, context);
  }

  /**
   * Log at ERROR level
   */
  error(message: string, error?: Error | unknown, context?: Record<string, unknown>): void {
    const errorContext = error instanceof Error
      ? {
          error: {
            name: error.name,
            message: error.message,
            stack: error.stack,
          },
        }
      : error
        ? { error }
        : {};

    this.log(LogLevel.ERROR, message, { ...errorContext, ...context });
  }

  /**
   * Log at FATAL level
   */
  fatal(message: string, error?: Error | unknown, context?: Record<string, unknown>): void {
    const errorContext = error instanceof Error
      ? {
          error: {
            name: error.name,
            message: error.message,
            stack: error.stack,
          },
        }
      : error
        ? { error }
        : {};

    this.log(LogLevel.FATAL, message, { ...errorContext, ...context });
  }

  /**
   * Log with timing
   */
  timed<T>(operation: string, fn: () => T | Promise<T>): T | Promise<T> {
    const start = Date.now();
    const result = fn();

    if (result instanceof Promise) {
      return result.then(
        (value) => {
          this.info(`${operation} completed`, { duration: Date.now() - start });
          return value;
        },
        (error) => {
          this.error(`${operation} failed`, error, { duration: Date.now() - start });
          throw error;
        }
      );
    }

    this.info(`${operation} completed`, { duration: Date.now() - start });
    return result;
  }

  /**
   * Create timer for manual timing
   */
  startTimer(): () => number {
    const start = Date.now();
    return () => Date.now() - start;
  }

  /**
   * Internal log method
   */
  private log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    if (level < this.config.level) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: LogLevel[level],
      message,
    };

    if (this.config.requestId) {
      entry.requestId = this.config.requestId;
    }

    if (this.config.pipelineId) {
      entry.pipelineId = this.config.pipelineId;
    }

    if (this.config.includeContext && (Object.keys(this.context).length > 0 || context)) {
      entry.context = { ...this.context, ...context };
    }

    if (this.config.json) {
      this.outputJson(level, entry);
    } else {
      this.outputText(level, entry);
    }
  }

  /**
   * Output as JSON
   */
  private outputJson(level: LogLevel, entry: LogEntry): void {
    const output = JSON.stringify(entry);

    switch (level) {
      case LogLevel.DEBUG:
        console.debug(output);
        break;
      case LogLevel.INFO:
        console.info(output);
        break;
      case LogLevel.WARN:
        console.warn(output);
        break;
      case LogLevel.ERROR:
      case LogLevel.FATAL:
        console.error(output);
        break;
    }
  }

  /**
   * Output as formatted text
   */
  private outputText(level: LogLevel, entry: LogEntry): void {
    const parts: string[] = [];

    if (this.config.includeTimestamp) {
      parts.push(`[${entry.timestamp}]`);
    }

    parts.push(`[${entry.level}]`);
    parts.push(entry.message);

    if (entry.context && Object.keys(entry.context).length > 0) {
      parts.push(JSON.stringify(entry.context));
    }

    const output = parts.join(' ');

    switch (level) {
      case LogLevel.DEBUG:
        console.debug(output);
        break;
      case LogLevel.INFO:
        console.info(output);
        break;
      case LogLevel.WARN:
        console.warn(output);
        break;
      case LogLevel.ERROR:
      case LogLevel.FATAL:
        console.error(output);
        break;
    }
  }
}

/**
 * Create logger instance
 */
export function createLogger(config?: Partial<LoggerConfig>): Logger {
  return new Logger(config);
}

/**
 * Default logger instance
 */
export const logger = new Logger();

/**
 * Create logger for Lambda context
 */
export function createLambdaLogger(requestId: string, pipelineId?: string): Logger {
  return new Logger({
    json: true,
    requestId,
    pipelineId,
  });
}
