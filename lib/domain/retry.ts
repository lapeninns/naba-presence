export function isRetryableGoogleStatus(status: number) {
  return status === 429 || status === 408 || status >= 500
}

export function retryDelayMs(
  attempt: number,
  random: () => number = Math.random,
  baseMs = 500,
  capMs = 30_000
) {
  const exponential = Math.min(capMs, baseMs * 2 ** Math.max(0, attempt - 1))
  return Math.round(exponential * (0.5 + random() * 0.5))
}
