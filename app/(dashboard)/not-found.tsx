"use client"

import { BoundaryFrame } from "@/components/app-shell/boundary"
import { NotFoundContent } from "@/components/app-shell/not-found-content"

/**
 * Inside the shell, not the bare root 404: someone who follows a stale link to
 * a deleted client should still have their navigation. The page itself is
 * NotFoundContent.
 *
 * A client file on purpose (see a4dcc39f): Next drops route-group segments
 * when it merges client manifests, so this entry and the root 404 share the
 * `app` group and the last record per module wins. As a server file, its
 * `next/link` record (from `boundary.tsx`) carried this entry's chunks, and
 * every page outside the dashboard (/sign-in, /terms, /invite, …) loaded the
 * dashboard 404's ~30 KB of JS.
 */
export default function DashboardNotFound() {
  return (
    <BoundaryFrame>
      <NotFoundContent />
    </BoundaryFrame>
  )
}
