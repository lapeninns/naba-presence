"use client"

import * as React from "react"

import { useHydratedBreakpoint } from "@/lib/hooks/use-media-query"
import { cn } from "@/lib/utils"

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
 * phone's hidden policy form from running their queries.
 *
 * Once the policy face has been shown it stays THE face at every width
 * until the person leaves the page: a phone turned from landscape (844px,
 * above md) back to portrait, or a window dragged narrow, keeps Reply policy
 * on screen, so unsaved edits survive (no navigation happens, so the leave
 * guard never asks), its docked save bar stays visible and reachable, and
 * the document still has exactly one face and one h1. Reply policy carries
 * the settings tabs, so every other section stays one tap away; the phone's
 * index is what /settings shows to someone who arrived narrow.
 *
 * Never keep a face mounted but hidden: its h1 would be a second one, and a
 * hidden dirty form's docked bar would still match the chrome contract's
 * `body:has([data-docked=bottom])`, hiding the tab bar with no bar shown.
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
  // null until hydrated: both faces, each hidden by CSS at the other width.
  const face = wide === null ? null : wide || policyShown ? "policy" : "index"
  return (
    <>
      {face !== "policy" ? (
        <div
          data-slot="settings-index"
          className={cn(
            "flex flex-col gap-(--np-gap-section)",
            face === null && "md:hidden"
          )}
        >
          {index}
        </div>
      ) : null}
      {face !== "index" ? (
        // The same element in the same position whatever `face` was, so the
        // form keeps its state across a rotation.
        <div
          data-slot="settings-home-policy"
          className={cn(
            "flex flex-col gap-(--np-gap-section)",
            face === null && "max-md:hidden"
          )}
        >
          {policy}
        </div>
      ) : null}
    </>
  )
}
