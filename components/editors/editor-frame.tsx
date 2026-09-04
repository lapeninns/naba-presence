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
    <section className="flex flex-col gap-5">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="text-section font-medium tracking-tight">{title}</h2>
            {statusLabel ? (
              <StatusPill tone={tone ?? "neutral"}>
                {statusLabel}
              </StatusPill>
            ) : null}
          </div>
          {description ? (
            <p className="max-w-2xl text-ui text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>
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

      {footer}
    </section>
  )
}

export { EditorFrame }
