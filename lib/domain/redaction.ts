const sensitiveKey =
  /(authorization|cookie|secret|token|password|credential|api[-_]?key)/i
const bearerPattern = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi
const jwtPattern = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g
// `scheme://user:password@host`: the credentials between `//` and `@`, which
// cannot contain `/`, `?` or `#` (those end the authority).
const userinfoPattern = /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/?#@"'<>]+@/gi
// `?name=value` / `&name=value` anywhere in a string: a request URL, a path
// with a query or a provider redirect quoted in an error message.
const queryParamPattern = /([?&;])([^=&#?;\s"'<>]+)=([^&#;\s"'<>]*)/g
// Query parameter names that carry credentials: everything `sensitiveKey`
// covers (access_token, client_secret, api_key, …) plus OAuth codes, bare
// keys and URL signatures.
const sensitiveParam =
  /(authorization|cookie|secret|token|password|passwd|credential|api[-_]?key|^key$|^code$|^sig$|signature|^auth$)/i

/** Strips credentials from every URL-shaped substring of `value`. */
export function redactUrls(value: string): string {
  return value
    .replace(userinfoPattern, "$1[REDACTED]@")
    .replace(queryParamPattern, (match, separator: string, name: string) =>
      sensitiveParam.test(decodeParamName(name))
        ? `${separator}${name}=[REDACTED]`
        : match
    )
}

function decodeParamName(name: string): string {
  try {
    return decodeURIComponent(name)
  } catch {
    return name
  }
}

export function redactForLog(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[TRUNCATED]"
  if (typeof value === "string") {
    return redactUrls(value)
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
