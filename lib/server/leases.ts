import "server-only"

import { getDatabase } from "@/lib/server/db"

type LeaseKey =
  | "naba:jobs"
  | "naba:reconcile"
  | "naba:retention"
  | "naba:performance"
  | "naba:keywords"
  | "naba:presence-resources"

export async function withAdvisoryLock<T>(
  key: LeaseKey,
  fn: () => Promise<T>
): Promise<T | { skipped: true }> {
  const connection = await getDatabase().reserve()
  let acquired = false
  try {
    const [lock] = await connection<{ acquired: boolean }[]>`
      select pg_try_advisory_lock(hashtext(${key})) as acquired
    `
    acquired = lock.acquired
    if (!acquired) return { skipped: true }
    return await fn()
  } finally {
    try {
      if (acquired) {
        await connection`
          select pg_advisory_unlock(hashtext(${key}))
        `
      }
    } finally {
      connection.release()
    }
  }
}
