import { Info, Lock, TriangleAlert } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export type CapabilityTone = "blocked" | "read_only" | "info"

const TONE = {
  blocked: {
    className: "border-[var(--np-danger-line)] bg-danger-tint text-danger-ink",
    Icon: TriangleAlert,
  },
  read_only: {
    className: "border-line bg-surface-sunken text-ink-muted",
    Icon: Lock,
  },
  info: {
    className: "border-[var(--np-info-line)] bg-info-tint text-info-ink",
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
      className={cn(
        "flex flex-wrap items-start gap-3 rounded-(--np-radius-card) border p-3",
        className
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="text-ui font-medium">{title}</p>
        {description ? <p className="text-ui">{description}</p> : null}
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
