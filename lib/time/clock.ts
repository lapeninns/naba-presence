/**
 * The shared clock every relative time and time threshold reads
 * (`RelativeTime`, `useNow`). One interval for the whole
 * page, running only while something is mounted, so "4 min ago" keeps
 * ageing on a screen left open.
 */
const TICK_MS = 15_000
const listeners = new Set<() => void>()
let timer: ReturnType<typeof setInterval> | undefined
let clock = 0

export function subscribeClock(listener: () => void) {
  listeners.add(listener)
  timer ??= setInterval(() => {
    for (const notify of listeners) notify()
  }, TICK_MS)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && timer !== undefined) {
      clearInterval(timer)
      timer = undefined
    }
  }
}

/**
 * The clock as React reads it. React asks for a snapshot more than once per
 * render and needs the same answer each time, so a reading is held, but it
 * is never behind the real clock: once the wall clock passes the held
 * reading, the next read takes a new one, up to `HOLD_MS` ahead. An age is
 * therefore never shown younger than it is. (Holding a reading for a second
 * in either direction let an earlier render's reading predate a timestamp
 * taken a moment later, and "16 minutes ago" read "15".)
 */
const HOLD_MS = 250

export function readClock(): number {
  const now = Date.now()
  if (now > clock || clock - now > HOLD_MS) clock = now + HOLD_MS
  return clock
}
