export function isRetryableGoogleStatus(status: number) {
  return status === 429 || status === 408 || status >= 500
}

export type MutationFault =
  { kind: "http"; status: number } | { kind: "network" } | { kind: "timeout" }

export function classifyMutationFailure(
  fault: MutationFault
): "ambiguous" | "retryable" | "failed" {
  if (fault.kind !== "http") return "ambiguous"
  if (fault.status === 429) return "retryable"
  if (fault.status === 408 || fault.status >= 500) {
    return "ambiguous"
  }
  return "failed"
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
