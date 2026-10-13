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
 * Once the policy face has been shown it stays mounted, hidden by CSS below
 * md: a phone turned from landscape (844px, above md) back to portrait, or a
 * window dragged narrow, must not silently drop unsaved policy edits (no
 * navigation happens, so the leave guard never asks). That rare state has
 * the second h1 again; losing input would be worse.
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
  // Adjusting state during render (React's documented pattern for deriving
  // from a changing value): latch once the policy face has been on screen.
  const [policyShown, setPolicyShown] = React.useState(false)
  if (wide === true && !policyShown) setPolicyShown(true)
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
      {wide !== false || policyShown ? (
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
