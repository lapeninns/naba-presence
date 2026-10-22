// What to print when `node scripts/ci/postgres.mjs stop` fails. postgres.mjs
// then keeps its state, since it cannot be sure the cluster is gone, and
// nothing retries the stop; the release gate and the test harness print this
// report with a command that repeats it from any checkout.

/** @param {string} value */
const shellQuote = (value) => `'${value.replaceAll("'", `'\\''`)}'`

/** Which daemon the stop talked to; a retry against another one finds nothing. */
const DOCKER_ENV = ["DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_CONFIG"]

/**
 * @param {{ status: number | null, signal?: string | null, stderr?: string | null, error?: Error }} stopped
 *   spawnSync's result for the stop
 * @param {{ pgDir: string, shard: string, script: string, env?: Record<string, string | undefined> }} cluster
 *   the stop's NABA_PG_DIR and SHARD, the absolute path of postgres.mjs, and
 *   the environment the stop ran with
 * @returns {string | null} null when the stop succeeded
 */
export function stopFailureReport(stopped, { pgDir, shard, script, env = {} }) {
  if (stopped.status === 0 && !stopped.error) return null
  const reason =
    stopped.stderr?.trim() ||
    stopped.error?.message ||
    (stopped.signal ? `killed by ${stopped.signal}` : `exit ${stopped.status}`)
  const docker = DOCKER_ENV.filter((name) => env[name])
    .map((name) => `${name}=${shellQuote(env[name] ?? "")} `)
    .join("")
  return (
    `PostgreSQL cleanup failed for ${shard}: ${reason}\n` +
    `  retry: ${docker}NABA_PG_DIR=${shellQuote(pgDir)} ` +
    `SHARD=${shellQuote(shard)} node ${shellQuote(script)} stop\n`
  )
}
