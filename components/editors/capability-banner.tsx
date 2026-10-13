import { Info, Lock, Pause, TriangleAlert, type LucideIcon } from "lucide-react"

import { SupportDetails } from "@/components/editors/support-details"
import {
  Alert,
  AlertActions,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert"
import { Button } from "@/components/ui/button"

export type CapabilityTone = "blocked" | "read_only" | "info" | "warning"

/**
 * Each tone as an Alert: `read_only` is the sunken default panel with a
 * lock, `blocked` (publishing paused, disconnected) the danger tint with a
 * pause, `warning` (Google holds a different copy) and `info` their own
 * tints. The words stay ink; only the glyph takes the status colour.
 */
const TONE: Record<
  CapabilityTone,
  {
    variant: "default" | "destructive" | "warning" | "info"
    Icon: LucideIcon
  }
> = {
  blocked: { variant: "destructive", Icon: Pause },
  read_only: { variant: "default", Icon: Lock },
  warning: { variant: "warning", Icon: TriangleAlert },
  info: { variant: "info", Icon: Info },
}

/**
 * Why this editor can't do what it looks like it can do.
 *
 * A disabled control with no explanation is the single most common complaint
 * about these screens: members opened Hours, found everything greyed out, and
 * had nothing to go on. The banner states the reason once at the top, so the
 * fields below don't each have to.
 *
 * `code` is the machine reason (e.g. `publishing_paused`), folded behind
 * "Details for support" under the sentence; the sentence is always the
 * primary signal.
 *
 * Drawn by the shared `Alert`; this keeps only the editors' vocabulary of
 * tones and the support details.
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
  const { variant, Icon } = TONE[tone]
  return (
    <Alert
      variant={variant}
      icon={<Icon strokeWidth={1.75} aria-hidden />}
      // A state the editor is in, announced politely: never an interruption.
      role={tone === "blocked" || tone === "warning" ? "status" : "note"}
      data-slot="capability-banner"
      data-tone={tone}
      className={className}
    >
      <AlertTitle className="text-ui">{title}</AlertTitle>
      {description || code ? (
        <AlertDescription className="text-ink-secondary">
          {description}
          <SupportDetails items={[code]} />
        </AlertDescription>
      ) : null}
      {action ? (
        <AlertActions>
          <Button
            size="sm"
            variant="secondary"
            render={action.href ? <a href={action.href} /> : undefined}
            onClick={action.onClick}
          >
            {action.label}
          </Button>
        </AlertActions>
      ) : null}
    </Alert>
  )
}

export { CapabilityBanner }
