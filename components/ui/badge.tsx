import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * A small, non-interactive label: a count, a category, a role.
 *
 * Reference `.badge`: 20px tall, the tag radius, 11.5px semibold, on the
 * hover-fill grey with the strong secondary ink. `role` is the mono role
 * badge ("OWNER"). The status variants carry their own measured ink on tint
 * (lib/design/contrast-pairs.ts). `shape="pill"` keeps a capsule for callers
 * that asked for one.
 */
const badgeVariants = cva(
  "group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden px-[7px] text-[11.5px] leading-none font-semibold whitespace-nowrap tabular-nums focus-halo transition-colors duration-(--np-duration-fast) ease-spring-snappy focus-visible:outline-none [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a&]:hover:bg-accent-hover",
        tinted: "bg-accent-tint text-accent-ink",
        secondary: "bg-fill text-ink-secondary [a&]:hover:bg-fill-secondary",
        destructive: "bg-danger-tint text-danger-ink",
        outline:
          "bg-transparent text-ink-secondary shadow-[inset_0_0_0_1px_var(--np-line)] [a&]:hover:bg-fill",
        ghost: "text-ink-muted [a&]:hover:bg-fill [a&]:hover:text-ink",
        link: "text-accent-ink underline-offset-4 hover:underline",
        success: "bg-success-tint text-success-ink",
        warning: "bg-warning-tint text-warning-ink",
        info: "bg-info-tint text-info-ink",
        role: "bg-fill font-mono font-medium tracking-[0.02em] text-ink-secondary uppercase",
      },
      shape: {
        pill: "rounded-(--np-radius-pill)",
        tag: "rounded-(--np-radius-tag)",
      },
    },
    defaultVariants: {
      variant: "default",
      shape: "tag",
    },
  }
)

function Badge({
  className,
  variant = "default",
  shape = "tag",
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
