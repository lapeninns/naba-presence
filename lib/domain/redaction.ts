const sensitiveKey =
  /(authorization|cookie|secret|token|password|credential|api[-_]?key)/i
const bearerPattern = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi
const jwtPattern = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g

export function redactForLog(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[TRUNCATED]"
  if (typeof value === "string") {
    return value
      .replace(bearerPattern, "Bearer [REDACTED]")
      .replace(jwtPattern, "[REDACTED_JWT]")
  }
  if (
    value === null ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "undefined"
  ) {
    return value
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactForLog(item, depth + 1))
  }
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactForLog(value.message, depth + 1),
      ...("code" in value
        ? { code: redactForLog((value as { code?: unknown }).code, depth + 1) }
        : {}),
    }
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        sensitiveKey.test(key) ? "[REDACTED]" : redactForLog(item, depth + 1),
      ])
    )
  }
  return String(value)
}
