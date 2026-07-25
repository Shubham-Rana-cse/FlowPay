// Lightweight structured logger. A thin wrapper around console for now —
// swap the internals for Pino/Winston later without touching call sites.

type LogContext = {
  correlationId?: string;
  route?: string;
  merchantId?: string;
  [key: string]: unknown;
};

function log(level: "info" | "warn" | "error", message: string, context: LogContext = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...context,
  };
  const line = JSON.stringify(entry);

  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  info: (message: string, context?: LogContext) => log("info", message, context),
  warn: (message: string, context?: LogContext) => log("warn", message, context),
  error: (message: string, context?: LogContext) => log("error", message, context),
};
