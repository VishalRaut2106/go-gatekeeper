export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_SEVERITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const currentLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) || 'info';

export class Logger {
  private context: string;

  constructor(context: string = 'App') {
    this.context = context;
  }

  private shouldLog(level: LogLevel): boolean {
    return LEVEL_SEVERITY[level] >= LEVEL_SEVERITY[currentLevel];
  }

  private formatMessage(level: LogLevel, message: string, meta?: any): string {
    const timestamp = new Date().toISOString();
    if (process.env.NODE_ENV === 'production') {
      return JSON.stringify({
        timestamp,
        level: level.toUpperCase(),
        context: this.context,
        message,
        ...(meta ? { metadata: meta } : {}),
      });
    }

    const colors: Record<LogLevel, string> = {
      debug: '\x1b[90m',
      info: '\x1b[32m',
      warn: '\x1b[33m',
      error: '\x1b[31m',
    };
    const reset = '\x1b[0m';
    const color = colors[level];
    const metaStr = meta ? ` ${JSON.stringify(meta)}` : '';
    return `${timestamp} ${color}[${level.toUpperCase()}]${reset} \x1b[36m[${this.context}]\x1b[0m ${message}${metaStr}`;
  }

  debug(message: string, meta?: any): void {
    if (this.shouldLog('debug')) {
      console.debug(this.formatMessage('debug', message, meta));
    }
  }

  info(message: string, meta?: any): void {
    if (this.shouldLog('info')) {
      console.info(this.formatMessage('info', message, meta));
    }
  }

  warn(message: string, meta?: any): void {
    if (this.shouldLog('warn')) {
      console.warn(this.formatMessage('warn', message, meta));
    }
  }

  error(message: string, meta?: any): void {
    if (this.shouldLog('error')) {
      console.error(this.formatMessage('error', message, meta));
    }
  }
}

export const appLogger = new Logger('Server');
