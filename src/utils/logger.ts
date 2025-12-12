// Logging estruturado
export type LogLevel = 'info' | 'warn' | 'error' | 'debug';

export interface LogContext {
  timestamp: string;
  level: LogLevel;
  message: string;
  metadata?: Record<string, any>;
}

export function log(level: LogLevel, message: string, metadata?: Record<string, any>): void {
  const context: LogContext = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...(metadata && { metadata })
  };
  
  const logMessage = JSON.stringify(context);
  
  switch (level) {
    case 'error':
      console.error(logMessage);
      break;
    case 'warn':
      console.warn(logMessage);
      break;
    case 'debug':
      // Em produção, debug pode ser silenciado
      if (process.env.NODE_ENV !== 'production') {
        console.log(logMessage);
      }
      break;
    default:
      console.log(logMessage);
  }
}

export const logger = {
  info: (message: string, metadata?: Record<string, any>) => log('info', message, metadata),
  warn: (message: string, metadata?: Record<string, any>) => log('warn', message, metadata),
  error: (message: string, metadata?: Record<string, any>) => log('error', message, metadata),
  debug: (message: string, metadata?: Record<string, any>) => log('debug', message, metadata)
};

