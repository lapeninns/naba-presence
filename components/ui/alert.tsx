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

/**
 * How an Alert is announced (prim-19). The audit's complaint was that every
 * warning was an ASSERTIVE live region (`role="alert"`), so a "Heads up"
 * banner present on load could interrupt like a failure. Only a failure
 * interrupts now:
 *
 *   (default)        destructive: `role="alert"` (a failure that just
 *                    happened: a save refused, a load broken). Every other
 *                    variant: `role="status"`, polite. A polite region
 *                    present when the page loads is not read out, so a
 *                    static banner costs nothing, while a result that
 *                    appears after an action (an invitation created, an
 *                    export finished, an import paused) is still announced
 *                    without each call site having to remember `live`.
 *   live             the variant decides, for a change that must interrupt:
 *                    destructive and warning `role="alert"`, the rest
 *                    `role="status"`.
 *   live="polite"    always `role="status"`.
 *   live="assertive" always `role="alert"`.
 *   live={false}     static: no role. For a banner that is page content
 *                    and never changes in place (a destructive banner
 *                    present on load, a reference note).
 *
 * The default deliberately keeps the roles the app shipped with for info,
 * success and the neutral panel, and moves warning from assertive to
 * polite: screen streams and e2e specs that find these banners by role keep
 * working, and nothing that used to be announced goes silent.
 *
 * An explicit `role` still wins. For a page-wide condition use `Banner`
 * (CapabilityBanner-style: "Reviews are not enabled for this listing").
 */
export type AlertLive = boolean | "polite" | "assertive"

function liveRole(
  live: AlertLive | undefined,
  variant: AlertVariant | null | undefined
): "alert" | "status" | undefined {
  if (live === false) return undefined
  if (live === "assertive") return "alert"
  if (live === "polite") return "status"
  if (variant === "destructive") return "alert"
  if (live === true && variant === "warning") return "alert"
  return "status"
}

function Alert({
  className,
  variant,
  icon,
  live,
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
    /**
     * How this alert is announced (see `AlertLive`). Default: `role="alert"`
     * for `destructive`, polite `role="status"` for every other variant;
     * `live={false}` for none.
     */
    live?: AlertLive
  }) {
  const role = liveRole(live, variant)
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

type BannerTone = "warn" | "bad" | "info" | "announcement"

const BANNER_TONE: Record<BannerTone, string> = {
  warn: "bg-warning-tint [&>svg]:text-warning-ink",
  bad: "bg-danger-tint [&>svg]:text-danger-ink",
  info: "bg-info-tint [&>svg]:text-info-ink",
  announcement:
    "bg-banner-bg text-banner-ink [&_a]:underline [&_a]:underline-offset-3 [&>svg]:text-banner-ink",
}

/**
 * The full-width banner under the toolbar (reference `.banner`): a page-wide
 * strip on a status tint, page-gutter padding, glyph + words + optional
 * action, wrapping on a phone. For a condition that affects the whole page
 * (a Google login needs reconnecting). Announced politely by default (a
 * banner usually arrives with data after the page); pass `role="alert"` for
 * a condition that just appeared and blocks work.
 *
 * `tone="announcement"` is the persistent product announcement strip (Notion
 * Mail's "Learn more" banner) on the `--np-banner-*` roles: words in the
 * banner ink, links underlined. It is news, not a state, so it carries no
 * status hue of its own and no glyph by default.
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
    tone === "bad"
      ? CircleAlert
      : tone === "info"
        ? Info
        : tone === "announcement"
          ? null
          : TriangleAlert
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
      {icon === undefined ? (
        Default ? (
          <Default strokeWidth={1.75} aria-hidden />
        ) : null
      ) : (
        icon
      )}
      <div className="min-w-0 flex-1 basis-60">{children}</div>
      {action ? <div className="flex shrink-0 gap-2">{action}</div> : null}
    </div>
  )
}

export { Alert, AlertTitle, AlertDescription, AlertAction, AlertActions, Banner }
