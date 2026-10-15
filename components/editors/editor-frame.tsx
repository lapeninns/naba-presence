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
 * A read-only editor (see `readView`) shows its values as plain text: the disabled controls
 * lose their box and the muted "unavailable" ink, so a member reads what is
 * set without a field that looks broken. The capability notice above says
 * why nothing can be changed.
 */
const READ_VIEW = [
  "[&_:is(input,textarea,select):disabled]:border-transparent!",
  "[&_:is(input,textarea,select):disabled]:bg-transparent!",
  "[&_:is(input,textarea,select):disabled]:text-ink!",
  "[&_:is(input,textarea,select):disabled]:opacity-100!",
  // An empty value shows nothing rather than a hint to type.
  "[&_:is(input,textarea):disabled]:placeholder:text-transparent!",
  // The input's own wrapper (search fields), never a button, switch or
  // checkbox: those keep their fill so on and off still read.
  "[&_[data-slot=input-search][data-disabled]]:border-transparent!",
  "[&_[data-slot=input-search][data-disabled]]:bg-transparent!",
].join(" ")

/**
 * The shared skeleton for every editor: heading, what it changes, a status
 * pill, one capability notice, a hairline, the fields, then the footer. The
 * head is quiet (no box): a medium-weight title, the description in muted
 * UI text, section actions beside it.
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
 * Inside an area, `titleHidden` also drops the editor's own status pill:
 * the header's pill is the one status on the page (the footer reports to
 * it), so two pills can never disagree.
 *
 * The footer. A clean editor has none. Once there is something to save, a
 * phone (under 48rem) docks the EditorFooter to the bottom edge as one row;
 * the docked ActionBar leaves a spacer its measured height in the flow, so
 * the bar never covers the last field. From 48rem it sits inline at the end
 * of the form, so it can never cover the fields it saves.
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
  readView = false,
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
  /**
   * The person can look but not change (a role limit, never a pause or an
   * unlinked listing): their disabled fields read as plain values instead of
   * a greyed-out form. Opt in from the editor that knows why it is disabled.
   */
  readView?: boolean
  className?: string
}) {
  const ref = useRef<HTMLElement>(null)
  useKeepFocusClear(ref)
  // Inside an area the header carries the title and the one status pill.
  const pill = titleHidden ? null : statusLabel
  const showHead = !titleHidden || Boolean(description || actions)
  return (
    <section
      ref={ref}
      data-slot="editor-frame"
      data-read-only={readView ? "" : undefined}
      // Not a tab stop: a place for focus to land when the footer's button
      // has gone (see EditorFooter), so it never falls back to the body.
      tabIndex={-1}
      className={cn(
        "flex flex-col gap-5 outline-none",
        readView && READ_VIEW,
        className
      )}
    >
      {titleHidden ? <h2 className="sr-only">{title}</h2> : null}
      {showHead || gateReason ? (
        // The head (title, what it changes, section actions) and the gate
        // sit above one hairline; the fields start under it, flat, as a
        // compose sheet's header fields sit over its body. Without a visible
        // head (a listing area) the gate stands alone and draws no rule.
        <div
          data-slot="editor-frame-head"
          className={cn(
            "flex flex-col gap-4",
            showHead && "border-b border-line pb-4"
          )}
        >
          {showHead ? (
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
              <div className="flex min-w-0 flex-col gap-1">
                {!titleHidden ? (
                  <div className="flex flex-wrap items-center gap-2.5">
                    <h2 className="text-section font-medium text-ink">
                      {title}
                    </h2>
                    {pill ? (
                      <StatusPill tone={tone ?? "neutral"}>{pill}</StatusPill>
                    ) : null}
                  </div>
                ) : null}
                {description ? (
                  <p className="max-w-2xl text-ui text-ink-muted">
                    {description}
                  </p>
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
        </div>
      ) : null}

      {children}

      {footer ? (
        <div data-slot="editor-frame-footer" className="mt-auto">
          {footer}
        </div>
      ) : null}
    </section>
  )
}

export { EditorFrame }
