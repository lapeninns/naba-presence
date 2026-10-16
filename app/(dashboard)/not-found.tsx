"use client"

import { BoundaryFrame } from "@/components/app-shell/boundary"
import { NotFoundContent } from "@/components/app-shell/not-found-content"

/**
 * Inside the shell, not the bare root 404: someone who follows a stale link to
 * a deleted client should still have their navigation. The page itself is
 * NotFoundContent.
 *
 * A client file on purpose (see a4dcc39f): Next merges every route group's
 * client manifest into one `app` group, so as a server file the `next/link`
 * and lucide imports of `boundary.tsx` took this entry's chunks with them,
 * and every page outside the dashboard (/sign-in, /terms, /invite, …) loaded
 * the dashboard 404's ~30 KB of JS.
 */
export default function DashboardNotFound() {
  return (
    <BoundaryFrame>
      <NotFoundContent />
    </BoundaryFrame>
  )
}
