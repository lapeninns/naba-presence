import "server-only"

import { redactForLog } from "@/lib/domain/redaction"

type LogContext = {
  requestId?: string
  organisationId?: string
  userId?: string
  operation?: string
  durationMs?: number
  [key: string]: unknown
}

function emit(
  level: "info" | "warn" | "error",
  event: string,
  context: LogContext = {}
) {
  const record = redactForLog({
    timestamp: new Date().toISOString(),
    level,
    event,
    service: "nabapresence",
    ...context,
  })
  const line = JSON.stringify(record)
  if (level === "error") console.error(line)
  else if (level === "warn") console.warn(line)
  else console.info(line)
}

export const log = {
  info: (event: string, context?: LogContext) => emit("info", event, context),
  warn: (event: string, context?: LogContext) => emit("warn", event, context),
  error: (event: string, context?: LogContext) => emit("error", event, context),
}
