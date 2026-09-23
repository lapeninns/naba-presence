import { cva, type VariantProps } from "class-variance-authority"
import {
  CircleAlert,
  CircleCheck,
  Info,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react"
import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Reference `.alert`: a 12px-radius panel, 12/14 padding, UI-size text in
 * the ink colour. `default` is the sunken surface with a hairline edge; the
 * status variants sit on their tint with no edge, and only the leading glyph
 * takes the status ink, so the words stay at full contrast.
 */
const alertVariants = cva(
  "group/alert relative grid w-full gap-0.5 rounded-(--np-radius-card) border px-3.5 py-3 text-left text-ui text-ink has-data-[slot=alert-action]:pr-18 has-[>svg]:grid-cols-[auto_minmax(0,1fr)] has-[>svg]:gap-x-3 *:[svg]:row-span-3 *:[svg]:mt-0.5 *:[svg:not([class*='size-'])]:size-4 *:[svg]:[stroke-width:1.75]",
  {
    variants: {
      variant: {
        default: "border-line bg-surface-alt *:[svg]:text-ink-secondary",
        destructive: "border-transparent bg-danger-tint *:[svg]:text-danger-ink",
        success: "border-transparent bg-success-tint *:[svg]:text-success-ink",
        warning: "border-transparent bg-warning-tint *:[svg]:text-warning-ink",
        info: "border-transparent bg-info-tint *:[svg]:text-info-ink",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

type AlertVariant = NonNullable<VariantProps<typeof alertVariants>["variant"]>

const DEFAULT_ICONS: Record<AlertVariant, LucideIcon | null> = {
  default: null,
  destructive: CircleAlert,
  success: CircleCheck,
  warning: TriangleAlert,
  info: Info,
}

// Function declarations hoist, so the slot components below are defined by
// the time this runs at module load.
const SLOT_TYPES = new Set<unknown>([
  AlertTitle,
  AlertDescription,
  AlertAction,
  AlertActions,
])

function hasOwnGlyph(children: React.ReactNode) {
  return React.Children.toArray(children).some(
    (child) =>
      React.isValidElement(child) &&
      typeof child.type !== "string" &&
      !SLOT_TYPES.has(child.type)
  )
}

function Alert({
  className,
  variant,
  icon,
  children,
  ...props
}: React.ComponentProps<"div"> &
  VariantProps<typeof alertVariants> & {
    /**
     * The leading glyph. Each status variant has one by default; pass `null`
     * for none, or your own element. A glyph passed as a direct child (any
     * element other than the title, description and action slots) also
     * replaces the default, so existing callers keep their icon.
     */
    icon?: React.ReactNode
  }) {
  // destructive/warning interrupt and should be announced as role="alert";
  // neutral default/success/info are informational, so role="status" (polite)
  // avoids over-announcing them.
  const role =
    variant === "destructive" || variant === "warning" ? "alert" : "status"
  const DefaultIcon = DEFAULT_ICONS[variant ?? "default"]
  const glyph =
    icon !== undefined ? (
      icon
    ) : DefaultIcon && !hasOwnGlyph(children) ? (
      <DefaultIcon strokeWidth={1.75} aria-hidden />
    ) : null
  return (
    <div
      data-slot="alert"
      role={role}
      className={cn(alertVariants({ variant }), className)}
      {...props}
    >
      {glyph}
      {children}
    </div>
  )
}

function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-title"
      className={cn(
        "text-body font-semibold text-ink group-has-[>svg]/alert:col-start-2 [&_a]:underline [&_a]:underline-offset-3",
        className
      )}
      {...props}
    />
  )
}

function AlertDescription({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-description"
      className={cn(
        "min-w-0 text-ui text-pretty text-ink group-has-[>svg]/alert:col-start-2 [&_a]:underline [&_a]:underline-offset-3 [&_p:not(:last-child)]:mb-2",
        className
      )}
      {...props}
    />
  )
}

/** An inline row of actions under the description (reference `.alert-actions`). */
function AlertActions({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-actions"
      className={cn(
        "mt-2 flex flex-wrap gap-2 group-has-[>svg]/alert:col-start-2",
        className
      )}
      {...props}
    />
  )
}

/** A top-right action (dismiss). Prefer `AlertActions` for next steps. */
function AlertAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-action"
      className={cn("absolute top-2 right-2", className)}
      {...props}
    />
  )
}

type BannerTone = "warn" | "bad" | "info"

const BANNER_TONE: Record<BannerTone, string> = {
  warn: "bg-warning-tint [&>svg]:text-warning-ink",
  bad: "bg-danger-tint [&>svg]:text-danger-ink",
  info: "bg-info-tint [&>svg]:text-info-ink",
}

/**
 * The full-width banner under the toolbar (reference `.banner`): a page-wide
 * strip on a status tint, page-gutter padding, glyph + words + optional
 * action, wrapping on a phone. For a condition that affects the whole page
 * (a Google login needs reconnecting). Announced politely by default; pass
 * `role="alert"` for a condition that just appeared and blocks work.
 */
function Banner({
  tone = "warn",
  icon,
  action,
  className,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  tone?: BannerTone
  /** Leading glyph; defaults per tone. Pass `null` for none. */
  icon?: React.ReactNode
  /** A trailing action (a link or small button). */
  action?: React.ReactNode
}) {
  const Default =
    tone === "bad" ? CircleAlert : tone === "info" ? Info : TriangleAlert
  return (
    <div
      data-slot="banner"
      data-tone={tone}
      role={props.role ?? "status"}
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-2 px-(--np-page-pad-x) py-2.5 text-ui text-ink [&>svg]:size-4 [&>svg]:shrink-0",
        BANNER_TONE[tone],
        className
      )}
      {...props}
    >
      {icon === undefined ? <Default strokeWidth={1.75} aria-hidden /> : icon}
      <div className="min-w-0 flex-1 basis-60">{children}</div>
      {action ? <div className="flex shrink-0 gap-2">{action}</div> : null}
    </div>
  )
}

export { Alert, AlertTitle, AlertDescription, AlertAction, AlertActions, Banner }
