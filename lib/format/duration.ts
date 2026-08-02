export function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return "—"
  const totalMinutes = Math.round(seconds / 60) // round FIRST: no "1h 60m"
  if (totalMinutes < 60) return `${totalMinutes}m`
  const totalHours = Math.floor(totalMinutes / 60)
  if (totalHours < 24) return `${totalHours}h ${totalMinutes % 60}m`
  return `${Math.floor(totalHours / 24)}d ${totalHours % 24}h`
}
