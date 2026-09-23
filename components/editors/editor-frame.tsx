"use client"

import { useRef } from "react"

import {
  CapabilityBanner,
  type CapabilityTone,
} from "@/components/editors/capability-banner"
import { StatusPill } from "@/components/ui/status-pill"
import { useKeepFocusClear } from "@/lib/editors/use-keep-focus-clear"
import type { StatusTone } from "@/lib/ui/status-tone"
import { cn } from "@/lib/utils"

/**
 * The shared skeleton for every editor: heading, what it changes, a status
 * pill, one capability banner, the fields, then the footer.
 *
 * Inside a listing area the page's own header (AreaFrame) already carries the
 * h1, the description and the status, so an editor there passes
 * `titleHidden`: the title stays in the outline as a visually hidden h2 and
 * the fields start straight under the area header, as the reference does.
 * Screens that stack several frames (People, Verification) keep the visible
 * heading row.
 *
 * Keyboard safety: a field that takes focus under the pinned bar (or under
 * a phone keyboard) is scrolled clear of it — see `useKeepFocusClear`.
 *
 * The footer is pinned: it sticks 12px above the bottom of the nearest
 * scrolling pane, as a floating dark bar. The frame leaves room under the
 * last field so the bar never covers it at the end of the scroll.
 */
function EditorFrame({
  title,
  description,
  tone,
  statusLabel,
  gateReason,
  gateTitle,
  gateTone = "read_only",
  gateCode,
  actions,
  children,
  footer,
  titleHidden = false,
  className,
}: {
  title: string
  description?: React.ReactNode
  /** Status tone for the pill beside the heading. */
  tone?: StatusTone
  statusLabel?: string
  /** When set, the editor is blocked or read-only and says why. */
  gateReason?: string | null
  gateTitle?: string
  /** `read_only` (default) for a role limit, `blocked` for paused publishing. */
  gateTone?: CapabilityTone
  /** The machine reason behind the gate, shown as a small code chip. */
  gateCode?: string | null
  /** Controls belonging to the whole section (Activity, external links). */
  actions?: React.ReactNode
  children: React.ReactNode
  /** Usually an `<EditorFooter />`. */
  footer?: React.ReactNode
  /** Keep the title for assistive tech only (the page header shows it). */
  titleHidden?: boolean
  className?: string
}) {
  const ref = useRef<HTMLElement>(null)
  useKeepFocusClear(ref)
  const showHead =
    !titleHidden || Boolean(statusLabel || description || actions)
  return (
    <section
      ref={ref}
      data-slot="editor-frame"
      className={cn(
        "flex flex-col gap-5",
        className
      )}
    >
      {titleHidden ? <h2 className="sr-only">{title}</h2> : null}
      {showHead ? (
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
          <div className="flex min-w-0 flex-col gap-1">
            {!titleHidden || statusLabel ? (
              <div className="flex flex-wrap items-center gap-2.5">
                {titleHidden ? null : (
                  <h2 className="text-section font-semibold text-ink">
                    {title}
                  </h2>
                )}
                {statusLabel ? (
                  <StatusPill tone={tone ?? "neutral"}>
                    {statusLabel}
                  </StatusPill>
                ) : null}
              </div>
            ) : null}
            {description ? (
              <p className="max-w-2xl text-ui text-ink-muted">{description}</p>
            ) : null}
          </div>
          {actions ? (
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {actions}
            </div>
          ) : null}
        </div>
      ) : null}

      {gateReason ? (
        <CapabilityBanner
          tone={gateTone}
          title={gateTitle ?? "You can look, but not change this"}
          description={gateReason}
          code={gateCode}
        />
      ) : null}

      {children}

      {footer ? (
        <div
          data-slot="editor-frame-footer"
          className="sticky bottom-3 z-20 mt-auto"
        >
          {footer}
        </div>
      ) : null}
    </section>
  )
}

export { EditorFrame }
