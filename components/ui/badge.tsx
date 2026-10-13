import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"

import { COUNT_TEXT_CLASS } from "@/components/ui/count-text"
import { TONE_CLASSES } from "@/lib/ui/status-tone"
import { cn } from "@/lib/utils"

const tone = (name: keyof typeof TONE_CLASSES) =>
  cn(TONE_CLASSES[name].tint, TONE_CLASSES[name].text)

/**
 * A small, non-interactive label: a count, a category, a role. METADATA,
 * not state: "Owner", "You", "3 new". If the word would change when
 * something happens ("Verified", "Paused"), use `StatusPill`; if it can be
 * pressed or removed, use a `Chip`. The full rule is in status-pill.tsx.
 *
 * Reference `.badge`: 20px tall, the tag radius, caption semibold (never
 * below the 12px floor), on the hover-fill grey with the strong secondary
 * ink. `role` is the role badge ("Owner"): sentence case, medium weight,
 * never mono uppercase (D8). The status-coloured
 * variants (`success`, `warning`, `info`, `destructive`) read the five tones
 * from lib/ui/status-tone.ts, so a badge and a pill in the same state are
 * the same colour. `shape="pill"` keeps a capsule for callers that asked for
 * one.
 */
const badgeVariants = cva(
  "group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden px-1.5 text-caption leading-none font-semibold whitespace-nowrap tabular-nums focus-halo transition-colors duration-(--np-duration-fast) ease-spring-snappy focus-visible:outline-none [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a&]:hover:bg-accent-hover",
        tinted: "bg-accent-tint text-accent-ink",
        secondary: "bg-fill text-ink-secondary [a&]:hover:bg-fill-secondary",
        destructive: tone("at-risk"),
        outline:
          "bg-transparent text-ink-secondary inset-ring inset-ring-line [a&]:hover:bg-fill",
        ghost: "text-ink-muted [a&]:hover:bg-fill [a&]:hover:text-ink",
        link: "text-accent-ink underline-offset-4 hover:underline",
        success: tone("healthy"),
        warning: tone("attention"),
        info: tone("pending"),
        role: "bg-fill font-medium text-ink-secondary",
      },
      shape: {
        pill: "rounded-(--np-radius-pill)",
        tag: "rounded-(--np-radius-tag)",
      },
      // A badge that is only a number ("3 new" is a label; "3" is a count)
      // draws it in the shared count figure, like a chip or tab count.
      count: {
        true: COUNT_TEXT_CLASS,
        false: "",
      },
    },
    defaultVariants: {
      variant: "default",
      shape: "tag",
      count: false,
    },
  }
)

function Badge({
  className,
  variant = "default",
  shape = "tag",
  count = false,
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant, shape, count }), className),
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
