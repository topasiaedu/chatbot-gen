import os from "os";

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogContext = Record<string, string | number | boolean | null | undefined>;

function format(level: LogLevel, message: string, context?: LogContext, error?: Error): string {
  const payload: Record<string, unknown> = {
    level,
    message,
    time: new Date().toISOString(),
    hostname: os.hostname(),
    ...context,
  };
  if (error) {
    payload.error_name = error.name;
    payload.error_message = error.message;
    if (process.env.NODE_ENV !== "production" && error.stack) {
      payload.error_stack = error.stack;
    }
  }
  return JSON.stringify(payload);
}

export const logger = {
  debug: (message: string, context?: LogContext): void => {
    // eslint-disable-next-line no-console
    console.log(format("debug", message, context));
  },
  info: (message: string, context?: LogContext): void => {
    // eslint-disable-next-line no-console
    console.log(format("info", message, context));
  },
  warn: (message: string, context?: LogContext): void => {
    // eslint-disable-next-line no-console
    console.warn(format("warn", message, context));
  },
  error: (message: string, context?: LogContext, error?: Error): void => {
    // eslint-disable-next-line no-console
    console.error(format("error", message, context, error));
  },
};

export default logger;


