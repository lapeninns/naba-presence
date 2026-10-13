"use client"

import * as React from "react"

import { useHydratedBreakpoint } from "@/lib/hooks/use-media-query"

/**
 * The /settings home's two faces: below md the settings index (its h1 is
 * "Settings"), from md Reply policy (its h1 is "Reply policy").
 *
 * The server and hydration renders draw both, each hidden by CSS at the
 * other width, so the first paint is right on every device and nothing
 * flashes. A face hidden by CSS is still in the document, though, and its h1
 * a second h1 (the mobile audit counts them), so once the client knows its
 * width it drops the hidden face entirely, as the inbox does for its hidden
 * title (InboxViewInner). That also stops a desk's hidden index and a
 * phone's hidden policy form from running their queries. The kept face
 * keeps its CSS class, so it is drawn exactly as before.
 *
 * Crossing md while on the page (a window dragged narrow) mounts the other
 * face fresh: unsaved policy edits don't follow, which is what the leave
 * guard would ask about anyway.
 */
export function SettingsHome({
  index,
  policy,
}: {
  /** The phone's settings index, headed "Settings". */
  index: React.ReactNode
  /** Reply policy, the desk's settings home. */
  policy: React.ReactNode
}) {
  const wide = useHydratedBreakpoint("md")
  return (
    <>
      {wide !== true ? (
        <div
          data-slot="settings-index"
          className="flex flex-col gap-(--np-gap-section) md:hidden"
        >
          {index}
        </div>
      ) : null}
      {wide !== false ? (
        <div
          data-slot="settings-home-policy"
          className="flex flex-col gap-(--np-gap-section) max-md:hidden"
        >
          {policy}
        </div>
      ) : null}
    </>
  )
}
