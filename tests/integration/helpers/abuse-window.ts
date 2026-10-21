import type postgres from "postgres"

type Sql = ReturnType<typeof postgres>

/**
 * The fixed window take_abuse_budget (0085) counts the current hit in,
 * from the database clock it uses.
 */
async function windowIndex(admin: Sql, windowSeconds: number) {
  const [row] = await admin<{ index: string }[]>`
    select floor(
      extract(epoch from clock_timestamp()) / ${windowSeconds}
    )::text as index
  `
  return row.index
}

/**
 * Runs `scenario` so that every hit it makes lands in one window. Windows are
 * aligned to multiples of their length, so a scenario that straddles an edge
 * sees its count reset half way. Instead of sleeping past an edge it might
 * reach, this checks afterwards: when the window changed during the run, the
 * outcome (pass or fail) proves nothing and the scenario runs once more. A
 * scenario takes seconds and windows are minutes long, so the second run
 * cannot straddle another edge; a scenario must use fresh keys on each call.
 */
export async function inOneAbuseWindow(
  admin: Sql,
  windowSeconds: number,
  scenario: () => Promise<void>
): Promise<void> {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const before = await windowIndex(admin, windowSeconds)
    let failure: unknown = null
    try {
      await scenario()
    } catch (error) {
      failure = error
    }
    if ((await windowIndex(admin, windowSeconds)) === before) {
      if (failure) throw failure
      return
    }
    console.warn(
      `[abuse-window] attempt ${attempt} crossed a ${windowSeconds} s window edge; running it again`
    )
  }
  throw new Error(`crossed a ${windowSeconds} s window edge twice in a row`)
}
