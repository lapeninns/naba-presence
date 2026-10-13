"use client"

import { useEffect, useRef, type ReactNode } from "react"
import { cn } from "@/lib/utils"
import { ReviewedWriteSteps, type ReviewedWriteStage } from "./steps"

/**
 * How long a closing dialog may take to hand focus back to its trigger. The
 * panel claims focus again after it, unless the person has moved on.
 */
const OVERLAY_SETTLE_MS = 400

/**
 * Moves focus (and so the viewport) to `target` whenever `focusKey` changes to
 * a new value, so a review that opens after a dialog closes, or from a row
 * far below, is where the person is, not off-screen. A closing dialog returns
 * focus to its trigger a moment later; the claim is repeated once after that
 * unless the person has already pressed a key or tapped elsewhere.
 */
export function useClaimFocus(
  target: React.RefObject<HTMLElement | null>,
  focusKey: string | null | undefined
) {
  const claimed = useRef<string | null>(null)
  useEffect(() => {
    if (!focusKey || claimed.current === focusKey) return
    claimed.current = focusKey
    const element = target.current
    if (!element) return
    element.focus()
    let interacted = false
    const stop = () => {
      interacted = true
    }
    window.addEventListener("pointerdown", stop, true)
    window.addEventListener("keydown", stop, true)
    const timer = window.setTimeout(() => {
      window.removeEventListener("pointerdown", stop, true)
      window.removeEventListener("keydown", stop, true)
      if (interacted || !element.isConnected) return
      const active = document.activeElement
      const panel = element.closest("[data-slot=reviewed-write-panel]")
      if (!active || active === document.body || !panel?.contains(active)) element.focus()
    }, OVERLAY_SETTLE_MS)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener("pointerdown", stop, true)
      window.removeEventListener("keydown", stop, true)
    }
  }, [focusKey, target])
}

/**
 * A reviewed write shown in the page: a card headed by what is being
 * changed, with the Review → Approve → Send → Outcome steps under the title.
 * When a review or outcome opens (`focusKey` changes) focus moves to the
 * heading, which scrolls it into view under any sticky chrome.
 *
 * Use it where the review belongs to the page (access, lifecycle,
 * verification); use `ReviewedWriteSheet` where it interrupts an editor.
 * The section is labelled by its heading, so `aria-labelledby={id}` is a
 * stable hook for tests and audits.
 */
export function ReviewedWritePanel({
  id,
  title,
  description,
  stage,
  secondApprover,
  tone = "default",
  headingLevel: Heading = "h2",
  focusKey,
  children,
  className,
}: {
  /** The heading's id; the section is labelled by it. */
  readonly id: string
  readonly title: ReactNode
  readonly description?: ReactNode
  /** Shows the step indicator. Omit for a panel with no saved review yet. */
  readonly stage?: ReviewedWriteStage
  readonly secondApprover?: boolean
  /** `danger` draws the edge in the danger ink, for irreversible requests. */
  readonly tone?: "default" | "danger"
  /** The heading level, for a panel inside a section that has its own h2. */
  readonly headingLevel?: "h2" | "h3"
  /** Focus moves to the heading each time this changes to a new value. */
  readonly focusKey?: string | null
  readonly children: ReactNode
  readonly className?: string
}) {
  const heading = useRef<HTMLHeadingElement>(null)
  useClaimFocus(heading, focusKey)
  return (
    <section
      aria-labelledby={id}
      data-slot="reviewed-write-panel"
      className={cn(
        "flex min-w-0 flex-col gap-4 rounded-(--np-radius-card) border bg-surface p-(--np-card-pad)",
        tone === "danger" ? "border-danger-ink" : "border-line",
        className
      )}
    >
      <header className="flex min-w-0 flex-col gap-2">
        <Heading
          id={id}
          ref={heading}
          tabIndex={-1}
          className="text-title font-semibold text-ink outline-none focus-visible:focus-halo"
        >
          {title}
        </Heading>
        {description ? <p className="text-ui text-ink-secondary">{description}</p> : null}
        {stage ? <ReviewedWriteSteps stage={stage} secondApprover={secondApprover} /> : null}
      </header>
      {children}
    </section>
  )
}
