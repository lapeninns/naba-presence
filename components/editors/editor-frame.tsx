import { CapabilityBanner } from "@/components/editors/capability-banner"
import { StatusPill } from "@/components/ui/status-pill"
import type { StatusTone } from "@/lib/ui/status-tone"

/**
 * The shared skeleton for every editor section: heading, what it changes,
 * a status pill, one capability banner, the fields, then the footer.
 *
 * Each editor used to invent its own arrangement — some led with a badge, some
 * buried the read-only reason under the form, one had no heading at all — so
 * moving between Hours and Photos meant relearning the page.
 *
 * The footer is pinned: it sticks to the bottom of the nearest scrolling
 * pane (the location workspace's content column) and bleeds to the pane's
 * edges so the toolbar material runs the full width, the way a sheet's
 * button bar does. Content scrolls beneath it.
 */
function EditorFrame({
  title,
  description,
  tone,
  statusLabel,
  gateReason,
  gateTitle,
  actions,
  children,
  footer,
}: {
  title: string
  description?: React.ReactNode
  /** Status tone for the pill beside the heading. */
  tone?: StatusTone
  statusLabel?: string
  /** When set, the editor is blocked or read-only and says why. */
  gateReason?: string | null
  gateTitle?: string
  /** Controls belonging to the whole section (Activity, external links). */
  actions?: React.ReactNode
  children: React.ReactNode
  /** Usually an `<EditorFooter />`. */
  footer?: React.ReactNode
}) {
  return (
    <section data-slot="editor-frame" className="flex flex-col gap-5">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="text-section font-semibold text-ink">{title}</h2>
            {statusLabel ? (
              <StatusPill tone={tone ?? "neutral"}>{statusLabel}</StatusPill>
            ) : null}
          </div>
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

      {gateReason ? (
        <CapabilityBanner
          tone="read_only"
          title={gateTitle ?? "You can look, but not change this"}
          description={gateReason}
        />
      ) : null}

      {children}

      {footer ? (
        <div
          data-slot="editor-frame-footer"
          // Negative margins mirror PageFrame's gutters and the workspace
          // pane's bottom padding so the material reaches the pane's edges;
          // the matching padding keeps the controls on the content grid.
          className="sticky bottom-0 z-10 -mx-5 mt-auto -mb-6 px-5 md:-mx-(--np-page-pad-x) md:-mb-(--np-page-pad-y) md:px-(--np-page-pad-x)"
        >
          {footer}
        </div>
      ) : null}
    </section>
  )
}

export { EditorFrame }
