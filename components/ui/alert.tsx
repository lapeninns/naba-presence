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
 * A tinted status card: the family's tint behind it, its ink on the title
 * and the leading glyph, no border. `default` is a sunken well for a note
 * that carries no status.
 */
const alertVariants = cva(
  "group/alert relative grid w-full gap-0.5 rounded-(--np-radius-card) px-4 py-3 text-left text-body has-data-[slot=alert-action]:pr-18 has-[>svg]:grid-cols-[auto_1fr] has-[>svg]:gap-x-2.5 *:[svg]:row-span-2 *:[svg]:translate-y-0.5 *:[svg]:text-current *:[svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-surface-sunken text-ink",
        destructive: "bg-danger-tint text-danger-ink",
        success: "bg-success-tint text-success-ink",
        warning: "bg-warning-tint text-warning-ink",
        info: "bg-info-tint text-info-ink",
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
const SLOT_TYPES = new Set<unknown>([AlertTitle, AlertDescription, AlertAction])

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
        "text-body font-semibold group-has-[>svg]/alert:col-start-2 [&_a]:underline [&_a]:underline-offset-3",
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
        "text-body text-balance text-ink-muted group-has-[>svg]/alert:col-start-2 md:text-pretty [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-ink [&_p:not(:last-child)]:mb-3",
        className
      )}
      {...props}
    />
  )
}

function AlertAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-action"
      className={cn("absolute top-2 right-2", className)}
      {...props}
    />
  )
}

export { Alert, AlertTitle, AlertDescription, AlertAction }
