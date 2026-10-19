// Pure qualification rules for the local performance lab. A missing metric
// remains unavailable: it must never turn into a zero-duration interaction.
export const METRIC_KEYS = [
  "ttfb",
  "fcp",
  "lcp",
  "cls",
  "tbt",
  "longestTask",
  "load",
  "jsRequests",
  "firstLoadJsRequests",
  "firstLoadJsTransfer",
  "firstLoadJsDecoded",
  "otherJsTransfer",
  "jsTransfer",
  "jsDecoded",
  "requests",
  "transfer",
  "fetchRequests",
  "rscRequests",
  "rscTransfer",
  "cssTransfer",
  "fontTransfer",
  "documentTransfer",
  "apiRequests",
  "fontRequests",
  "imageRequests",
  "redirect",
  "domNodes",
]

export function median(values) {
  const list = values
    .filter((value) => typeof value === "number" && Number.isFinite(value))
    .sort((a, b) => a - b)
  if (!list.length) return null
  const middle = Math.floor(list.length / 2)
  return list.length % 2 ? list[middle] : (list[middle - 1] + list[middle]) / 2
}

export function interactionTiming(events, startedAt, endedAt) {
  const evidence = events.filter(
    (entry) =>
      entry.matchesProbe === true &&
      Number.isFinite(entry.t) &&
      entry.t >= startedAt &&
      entry.t <= endedAt &&
      Number.isFinite(entry.d) &&
      entry.d >= 0 &&
      (entry.id > 0 || entry.first === true)
  )
  const worst = evidence.reduce(
    (longest, entry) => (!longest || entry.d > longest.d ? entry : longest),
    null
  )
  return {
    inp: worst?.d ?? null,
    event: worst?.name ?? null,
    input: Number.isFinite(worst?.input) ? worst.input : null,
    processing: Number.isFinite(worst?.proc) ? worst.proc : null,
    timingSource: worst ? (worst.first ? "first-input" : "event") : null,
    interactionId: worst?.id ?? null,
    timingEvidence: [...evidence].sort((a, b) => b.d - a.d).slice(0, 20),
    timingEntries: evidence.length,
  }
}

const HEALTH_LABELS = [
  ["All", "all"],
  ["Needs attention", "attention"],
  ["To publish", "unpublished"],
  ["Not linked", "not_linked"],
  ["In sync", "healthy"],
]

export function listingHealthForLabel(label) {
  const text = label.replace(/\s+/g, " ").trim()
  const match = HEALTH_LABELS.find(
    ([name]) =>
      text === name ||
      (text.startsWith(name) &&
        /^(?:\s+|,\s*)[\d,.\s]+$/.test(text.slice(name.length)))
  )
  return match ? { label: match[0], value: match[1] } : null
}

export function sameLanding(expected, actual) {
  if (typeof actual !== "string") return false
  try {
    const left = new URL(expected, "http://perf.invalid")
    const right = new URL(actual, "http://perf.invalid")
    left.searchParams.sort()
    right.searchParams.sort()
    return (
      left.origin === right.origin &&
      left.pathname === right.pathname &&
      left.search === right.search
    )
  } catch {
    return false
  }
}

export function sampleProblems(sample) {
  if (sample.error) return [sample.error]
  const problems = []
  if (sample.status !== 200)
    problems.push(`HTTP status ${sample.status ?? "unavailable"}`)
  if (!sameLanding(sample.route, sample.finalUrl))
    problems.push("unexpected landing URL")
  if (!Array.isArray(sample.errors) || sample.errors.length)
    problems.push("page or console errors")
  if (sample.quietWindow?.completed !== true)
    problems.push("quiet window did not complete")
  for (const key of METRIC_KEYS) {
    if (
      typeof sample[key] !== "number" ||
      !Number.isFinite(sample[key]) ||
      sample[key] < 0
    ) {
      problems.push(`unavailable metric ${key}`)
    }
  }
  if (!(sample.firstLoadJsRequests > 0) || !(sample.firstLoadJsTransfer > 0)) {
    problems.push("first-load JavaScript was not observed")
  }
  const probe = sample.probe
  if (probe?.error) problems.push(`interaction probe failed: ${probe.error}`)
  if (!probe?.selector || probe.actionCompleted !== true)
    problems.push("interaction control was not activated")
  if (probe?.outcomeRequired && probe.outcomeVerified !== true)
    problems.push("interaction outcome was not verified")
  if (
    typeof probe?.inp !== "number" ||
    !Number.isFinite(probe.inp) ||
    probe.inp < 0 ||
    !(probe.timingEntries > 0) ||
    !Array.isArray(probe.timingEvidence) ||
    !probe.timingEvidence.length ||
    !["event", "first-input"].includes(probe.timingSource)
  ) {
    problems.push("interaction timing unavailable")
  }
  return problems
}

export function summarizeRoute(template, samples, expectedRuns) {
  const inspected = samples.map((sample) => ({
    sample,
    problems: sampleProblems(sample),
  }))
  const valid = inspected
    .filter(({ problems }) => !problems.length)
    .map(({ sample }) => sample)
  const validationErrors = inspected.flatMap(({ problems }, index) =>
    problems.map((problem) => `run ${index + 1}: ${problem}`)
  )
  if (samples.length !== expectedRuns)
    validationErrors.push(
      `expected ${expectedRuns} runs, received ${samples.length}`
    )
  const row = {
    route: template,
    runs: valid.length,
    expectedRuns,
    valid: !validationErrors.length && valid.length === expectedRuns,
    validationErrors,
    finalUrl: valid[0]?.finalUrl ?? null,
    status: valid[0]?.status ?? null,
    lcpElement: valid.at(-1)?.lcpElement ?? null,
  }
  for (const key of METRIC_KEYS)
    row[key] = median(valid.map((sample) => sample[key]))
  row.inp = median(valid.map((sample) => sample.probe.inp))
  row.probe = valid[0]?.probe.selector ?? null
  row.fetchUrls = valid[0]?.fetchUrls ?? []
  row.errors = [
    ...new Set(samples.flatMap((sample) => sample.errors ?? [])),
  ].slice(0, 5)
  return row
}

// Rechecking saved measurements must retain their run validity, not just
// compare a surviving median while overlooking failed or absent raw samples.
export function measurementProblems(result) {
  if (!Array.isArray(result.summary) || result.summary.length === 0)
    return ["no route summaries"]
  if (!Number.isInteger(result.runs) || result.runs < 1)
    return ["expected run count unavailable"]
  if (!result.samples || typeof result.samples !== "object")
    return ["raw samples unavailable"]
  return result.summary.flatMap((row) => {
    const samples = result.samples[row.route]
    if (!Array.isArray(samples))
      return [`${row.route}: raw samples unavailable`]
    return summarizeRoute(row.route, samples, result.runs).validationErrors.map(
      (problem) => `${row.route}: ${problem}`
    )
  })
}
