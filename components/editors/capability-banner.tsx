import { Info, Lock, Pause, TriangleAlert, type LucideIcon } from "lucide-react"

import { SupportDetails } from "@/components/editors/support-details"
import {
  Alert,
  AlertActions,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export type CapabilityTone = "blocked" | "read_only" | "info" | "warning"

/**
 * Each tone as an Alert, read as a calm inline notice rather than a box:
 * `read_only` (a role limit, the common case) is flat, a lock and the
 * sentence with no panel at all; `blocked` (publishing paused,
 * disconnected) keeps the danger tint with a pause, `warning` (Google holds
 * a different copy) and `info` their own tints, because there the tint
 * reinforces a word that needs acting on. The words stay ink; only the
 * glyph takes the status colour.
 */
const TONE: Record<
  CapabilityTone,
  {
    variant: "default" | "destructive" | "warning" | "info"
    Icon: LucideIcon
    className?: string
  }
> = {
  blocked: { variant: "destructive", Icon: Pause },
  read_only: {
    variant: "default",
    Icon: Lock,
    className: "border-transparent bg-transparent px-0 py-0",
  },
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
  const { variant, Icon, className: toneClassName } = TONE[tone]
  return (
    <Alert
      variant={variant}
      icon={<Icon strokeWidth={1.75} aria-hidden />}
      // A state the editor is in, announced politely: never an interruption.
      role={tone === "blocked" || tone === "warning" ? "status" : "note"}
      data-slot="capability-banner"
      data-tone={tone}
      className={cn(toneClassName, className)}
    >
      <AlertTitle className="text-ui font-medium">{title}</AlertTitle>
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
