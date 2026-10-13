"use client"

import {
  BoundaryErrorState,
  BoundaryFrame,
} from "@/components/app-shell/boundary"

// The Clients pages own their <main> through PageFrame, so the boundary that
// replaces one supplies the landmark too. Covers the index, a client's hub
// and its settings: the way out is the client list, which is where an
// operator goes next, rather than the inbox. Light helpers only
// (components/app-shell/boundary.tsx): this file is its own chunk.
export default function ClientsError({
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <BoundaryFrame width="wide">
      <BoundaryErrorState
        title="This client page hit an error"
        description="Your clients, listings and reviews are unaffected, and the rest of NabaPresence is still working. Try again, or go back to all clients."
        onReset={reset}
        homeHref="/clients"
        homeLabel="All clients"
      />
    </BoundaryFrame>
  )
}
