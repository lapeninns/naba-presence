"use client"

import { useRouter } from "next/navigation"
import { startTransition } from "react"

import {
  BoundaryErrorState,
  BoundaryFrame,
  boundaryButtonClass,
} from "@/components/app-shell/boundary"

// The Clients pages own their <main> through PageFrame, so the boundary that
// replaces one supplies the landmark too. Covers the index, a client's hub
// and its settings: the way out is the client list, which is where an
// operator goes next, rather than the inbox.
//
// "All clients" is not a link: Next keeps this boundary up across a
// navigation that stays on /clients (the index broke under `?health=` or
// `?q=`), so the way back drops the address's filters and resets the
// boundary in one go.
//
// Light helpers only (components/app-shell/boundary.tsx): this file is its
// own chunk.
export default function ClientsError({
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const router = useRouter()
  return (
    <BoundaryFrame width="wide">
      <BoundaryErrorState
        title="This client page hit an error"
        description="Nothing was changed. Your clients are safe."
        onReset={reset}
        secondaryAction={
          <button
            type="button"
            className={boundaryButtonClass(
              "ghost",
              "default",
              "pointer-coarse:min-h-11"
            )}
            onClick={() =>
              startTransition(() => {
                router.replace("/clients")
                reset()
              })
            }
          >
            All clients
          </button>
        }
      />
    </BoundaryFrame>
  )
}
