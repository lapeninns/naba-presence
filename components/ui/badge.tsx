import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * A small, non-interactive label: a count, a category, a state word.
 *
 * Two shapes: `pill` (a capsule, the default) and `tag` (the tag radius, for
 * a badge that sits flush in a table cell or a field). Backgrounds come from
 * the fill ladder and the status tints, so a badge never needs a border; the
 * `outline` variant is white with a hairline edge for a white-on-white
 * surface. Height is the 22px pill metric.
 *
 * Every ink/tint pair here is measured (lib/design/contrast-pairs.ts), which
 * is why the status variants can carry their own ink instead of falling back
 * to plain foreground the way the old ones did.
 */
const badgeVariants = cva(
  "group/badge inline-flex h-(--np-pill-h) w-fit shrink-0 items-center justify-center gap-1 overflow-hidden px-2 text-caption font-medium whitespace-nowrap tabular-nums focus-halo transition duration-(--np-duration-fast) ease-spring-snappy focus-visible:outline-none has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        // Darken rather than the stock `bg-primary/80` lightening, which drops
        // white-on-primary to 3.27:1 when the badge is a link. See button.tsx.
        default:
          "bg-primary text-primary-foreground [a&]:hover:bg-[var(--np-accent-hover)]",
        tinted:
          "bg-accent-tint text-accent-ink [a&]:hover:bg-[var(--np-accent-tint-strong)]",
        secondary: "bg-fill text-ink [a&]:hover:bg-fill-secondary",
        destructive: "bg-danger-tint text-danger-ink",
        outline:
          "bg-surface text-ink hairline focus-visible:[box-shadow:var(--np-focus-halo),var(--np-shadow-hairline)] [a&]:hover:bg-fill-tertiary",
        ghost: "text-ink-muted [a&]:hover:bg-fill-tertiary [a&]:hover:text-ink",
        link: "text-accent-ink underline-offset-4 hover:underline",
        success: "bg-success-tint text-success-ink",
        warning: "bg-warning-tint text-warning-ink",
        info: "bg-info-tint text-info-ink",
      },
      shape: {
        pill: "rounded-(--np-radius-pill)",
        tag: "rounded-(--np-radius-tag)",
      },
    },
    defaultVariants: {
      variant: "default",
      shape: "pill",
    },
  }
)

function Badge({
  className,
  variant = "default",
  shape = "pill",
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant, shape }), className),
      },
      props
    ),
    render,
    state: {
      slot: "badge",
      variant,
      shape,
    },
  })
}

export { Badge, badgeVariants }
