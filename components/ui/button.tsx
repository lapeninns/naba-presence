import { Button as ButtonPrimitive } from "@base-ui/react/button"
import type { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-(--nr-radius-control) border border-transparent bg-clip-padding text-ui font-medium whitespace-nowrap transition-colors duration-(--nr-duration-fast) select-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        // Hover and active are literal tokens, never a color-mix: the
        // contrast gate refuses a value it cannot resolve, and a hover state
        // whose ratio nobody measures is exactly where AA quietly breaks.
        default:
          "bg-primary text-primary-foreground hover:bg-[var(--np-accent-hover)] active:bg-[var(--np-accent-active)]",
        outline:
          "border-border bg-background hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:bg-transparent dark:hover:bg-input/30",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-[var(--np-hover-bg)] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
        ghost:
          "hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50",
        destructive:
          "bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        // The default height follows the density token so a compact table or
        // inbox row shrinks its buttons with it. Compact never drops below
        // 28px, clearing the 24px target-size floor.
        default:
          "h-(--np-control-h) gap-1.5 px-3 has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5",
        xs: "h-6 gap-1 px-2.5 text-xs has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 px-3 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        lg: "h-9 gap-1.5 px-4 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        icon: "size-8",
        "icon-xs": "size-6 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-7",
        "icon-lg": "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

// Icon-only sizes render no visible label, so the type system requires
// aria-label wherever one of these sizes is selected. `icon-lg` (size-9,
// square, same shape as the other icon sizes) is included alongside the
// three the brief's recipe named, closing a gap where it would otherwise
// compile without aria-label — see task-7-report.md, "Fix round 1".
type IconSize = "icon" | "icon-sm" | "icon-xs" | "icon-lg"
type AnySize = NonNullable<VariantProps<typeof buttonVariants>["size"]>
type ButtonBaseProps = Omit<React.ComponentProps<"button">, "size"> &
  Omit<VariantProps<typeof buttonVariants>, "size"> & {
    render?: useRender.RenderProp<ButtonPrimitive.State>
  }
export type ButtonProps =
  | (ButtonBaseProps & {
      size?: Exclude<AnySize, IconSize>
      accessibleNameFromChildren?: undefined
    })
  | (ButtonBaseProps & {
      size: IconSize
      "aria-label": string
      accessibleNameFromChildren?: undefined
    })
  | (ButtonBaseProps & {
      size: IconSize
      "aria-label"?: undefined
      // Deliberate, reviewable opt-out from the aria-label requirement above:
      // the accessible name comes from a visually-hidden text child instead
      // (e.g. `<span className="sr-only">Show password</span>` next to an
      // `aria-hidden` icon). Needed because an `aria-label` attribute is
      // matched directly by some label-locator tooling (e.g. Playwright's
      // getByLabel) regardless of element role, which collides whenever the
      // label text overlaps a nearby form field's own label — see
      // components/auth/password-field.tsx's show/hide-password toggle,
      // which sits next to an input labelled "Password". Every use of this
      // flag still requires a real, non-empty accessible name; it just comes
      // from rendered text instead of an aria-* attribute.
      accessibleNameFromChildren: true
    })

function Button({
  className,
  variant = "default",
  size = "default",
  // Type-only marker (see ButtonProps) — destructured solely to keep it out
  // of the {...props} spread below, since it isn't a real DOM attribute.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  accessibleNameFromChildren: _accessibleNameFromChildren,
  ...props
}: ButtonProps) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
      type={props.type ?? "button"}
    />
  )
}

export { Button, buttonVariants }
