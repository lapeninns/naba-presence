export function GateNote({ reason }: { reason: string | null }) {
  if (!reason) return null
  return (
    <p role="note" className="text-caption text-ink-muted">
      {reason}
    </p>
  )
}
