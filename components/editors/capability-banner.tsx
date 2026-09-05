import { Info, Lock, TriangleAlert } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export type CapabilityTone = "blocked" | "read_only" | "info"

/**
 * Tint plus ink per tone, no border: the tinted surface is the boundary, and
 * every ink/tint pair here is one the contrast gate measures.
 */
const TONE = {
  blocked: {
    className: "bg-danger-tint text-danger-ink",
    Icon: TriangleAlert,
  },
  read_only: {
    className: "bg-surface-sunken text-ink",
    Icon: Lock,
  },
  info: {
    className: "bg-info-tint text-info-ink",
    Icon: Info,
  },
} as const

/**
 * Why this editor can't do what it looks like it can do.
 *
 * A disabled control with no explanation is the single most common complaint
 * about these screens: members opened Hours, found everything greyed out, and
 * had nothing to go on. The banner states the reason once at the top, so the
 * fields below don't each have to.
 */
function CapabilityBanner({
  tone = "read_only",
  title,
  description,
  action,
}: {
  tone?: CapabilityTone
  title: string
  description?: React.ReactNode
  action?: { label: string; href?: string; onClick?: () => void }
}) {
  const { className, Icon } = TONE[tone]
  return (
    <div
      data-slot="capability-banner"
      data-tone={tone}
      className={cn(
        "flex flex-wrap items-start gap-3 rounded-(--np-radius-card) px-4 py-3",
        className
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} aria-hidden />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="text-body font-semibold">{title}</p>
        {description ? (
          <p
            className={cn(
              "text-ui",
              tone === "read_only" ? "text-ink-muted" : undefined
            )}
          >
            {description}
          </p>
        ) : null}
      </div>
      {action ? (
        <Button
          size="sm"
          variant="outline"
          render={action.href ? <a href={action.href} /> : undefined}
          onClick={action.onClick}
        >
          {action.label}
        </Button>
      ) : null}
    </div>
  )
}

export { CapabilityBanner }
