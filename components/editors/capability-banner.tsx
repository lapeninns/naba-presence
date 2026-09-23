import { Info, Lock, Pause, TriangleAlert, type LucideIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export type CapabilityTone = "blocked" | "read_only" | "info" | "warning"

/**
 * Reference `.alert` drawings: `read_only` is the sunken panel with a
 * hairline and a lock, `blocked` (publishing paused, disconnected) sits on
 * the danger tint, `warning` (Google holds a different copy) on the warning
 * tint, `info` on the info tint. The words stay ink; only the glyph takes the
 * status colour, so every pair is one the contrast gate measures.
 */
const TONE: Record<
  CapabilityTone,
  { className: string; glyph: string; Icon: LucideIcon }
> = {
  blocked: {
    className: "border-transparent bg-danger-tint",
    glyph: "text-danger-ink",
    Icon: Pause,
  },
  read_only: {
    className: "border-line bg-surface-alt",
    glyph: "text-ink-secondary",
    Icon: Lock,
  },
  warning: {
    className: "border-transparent bg-warning-tint",
    glyph: "text-warning-ink",
    Icon: TriangleAlert,
  },
  info: {
    className: "border-transparent bg-info-tint",
    glyph: "text-info-ink",
    Icon: Info,
  },
}

/**
 * Why this editor can't do what it looks like it can do.
 *
 * A disabled control with no explanation is the single most common complaint
 * about these screens: members opened Hours, found everything greyed out, and
 * had nothing to go on. The banner states the reason once at the top, so the
 * fields below don't each have to.
 *
 * `code` shows the machine reason (e.g. `publishing_paused`) as a small mono
 * chip after the sentence, for support conversations; the sentence is always
 * the primary signal.
 */
function CapabilityBanner({
  tone = "read_only",
  title,
  description,
  code,
  action,
  className,
}: {
  tone?: CapabilityTone
  title: string
  description?: React.ReactNode
  code?: string | null
  action?: { label: string; href?: string; onClick?: () => void }
  className?: string
}) {
  const { className: toneClass, glyph, Icon } = TONE[tone]
  return (
    <div
      data-slot="capability-banner"
      data-tone={tone}
      role={tone === "blocked" || tone === "warning" ? "status" : undefined}
      className={cn(
        "grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-2 rounded-(--np-radius-card) border px-3.5 py-3 text-ui text-ink",
        toneClass,
        className
      )}
    >
      <Icon
        className={cn("mt-0.5 size-4 shrink-0", glyph)}
        strokeWidth={1.75}
        aria-hidden
      />
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="font-semibold text-ink">{title}</p>
        {description || code ? (
          <p className="text-ink-secondary">
            {description}
            {code ? (
              <>
                {" "}
                <code className="inline-block max-w-full rounded-(--np-radius-tag) border border-line bg-surface px-1.5 font-mono text-caption break-all text-ink-secondary">
                  {code}
                </code>
              </>
            ) : null}
          </p>
        ) : null}
      </div>
      {action ? (
        <div className="col-start-2">
          <Button
            size="sm"
            variant="secondary"
            render={action.href ? <a href={action.href} /> : undefined}
            onClick={action.onClick}
          >
            {action.label}
          </Button>
        </div>
      ) : null}
    </div>
  )
}

export { CapabilityBanner }
