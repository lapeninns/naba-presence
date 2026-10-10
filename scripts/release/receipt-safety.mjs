// Shared by the promotion receipt (promote.mjs) and the local release-gate
// receipt (local-receipt.mjs): neither may carry anything redaction would
// touch.

import { redactForLog } from "../../lib/domain/redaction.ts"

/**
 * Paths (`a.b[2]`) whose value redaction would change: anything shaped like
 * a credential, a bearer token, a JWT or a URL with userinfo or a secret
 * query parameter.
 * @param {unknown} value
 * @param {string} [path]
 * @returns {string[]}
 */
export function secretLikePaths(value, path = "$") {
  if (typeof value === "string") {
    return redactForLog(value) === value ? [] : [path]
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      secretLikePaths(item, `${path}[${index}]`)
    )
  }
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, item]) =>
      secretLikePaths(item, `${path}.${key}`)
    )
  }
  return []
}

/** `20261010T120000Z-<sha12>.json`: sorts by time, names the commit. */
export function timestampedFileName(timestamp, sha) {
  const stamp = timestamp.replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")
  return `${stamp}-${sha.slice(0, 12)}.json`
}
