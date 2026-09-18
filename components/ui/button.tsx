import { Button as ButtonPrimitive } from "@base-ui/react/button"
import type { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * Apple's four button styles, translated to the web and held to WCAG:
 *
 *   filled   `default`      the one primary action on a surface
 *   tinted   `tinted`       a prominent secondary action, accent on its tint
 *   grey     `secondary`    the workhorse; `outline` is the same grey with a
 *                           hairline edge for when it sits on another grey
 *   plain    `ghost`        toolbar and inline actions, surface only on hover
 *   red      `destructive`  a tinted red, never a filled one
 *
 * Every hover and pressed colour is a literal token, never a colour-mix: the
 * contrast gate refuses a value it cannot resolve, and a hover state whose
 * ratio nobody measures is exactly where AA quietly breaks.
 *
 * Focus is the `focus-halo` utility (a soft accent halo, no offset). The
 * variants that already draw a box-shadow at rest or on hover restate the
 * halo under `focus-visible:` so the two never fight over the property.
 */
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-(--np-radius-control) text-ui font-medium whitespace-nowrap focus-halo transition duration-(--np-duration-fast) ease-spring-snappy select-none focus-visible:outline-none active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 aria-invalid:text-danger-ink [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground hover:bg-[var(--np-accent-hover)] active:bg-[var(--np-accent-active)] aria-expanded:bg-[var(--np-accent-hover)]",
        tinted:
          "bg-accent-tint text-accent-ink hover:bg-[var(--np-accent-tint-strong)] active:bg-[var(--np-accent-tint-strong)] aria-expanded:bg-[var(--np-accent-tint-strong)]",
        secondary:
          "bg-fill text-ink hover:bg-fill-secondary active:bg-fill aria-expanded:bg-fill-secondary",
        outline:
          "bg-fill text-ink hairline hover:bg-fill-secondary focus-visible:[box-shadow:var(--np-focus-halo),var(--np-shadow-hairline)] active:bg-fill aria-expanded:bg-fill-secondary",
        ghost:
          "text-ink hover:bg-fill-tertiary active:bg-fill-secondary aria-expanded:bg-fill-tertiary",
        destructive:
          "bg-danger-tint text-danger-ink hover:[box-shadow:inset_0_0_0_0.5px_var(--np-danger-line)] focus-visible:[box-shadow:var(--np-focus-halo)]",
        link: "text-accent-ink underline-offset-4 hover:underline active:scale-100",
      },
      size: {
        // The default height follows the density token so a compact table or
        // inbox row shrinks its buttons with it. Compact never drops below
        // 28px, clearing the 24px target-size floor.
        default:
          "h-(--np-control-h) gap-1.5 px-3 has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5",
        xs: "h-6 gap-1 px-2 text-caption has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        sm: "h-7 gap-1 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        // `lg` is the deliberately prominent action — the auth screens' full
        // width submit, an invitation's accept. It is the one size a finger
        // is expected to be the primary pointer for, so where the pointer IS
        // coarse it grows to the 44px comfortable target rather than staying
        // at the 36px a mouse is well served by. The narrower sizes keep
        // their height: they live in toolbars and table rows whose whole
        // rhythm is built on the control token.
        lg: "h-9 gap-2 px-4 text-body has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3 pointer-coarse:h-11",
        icon: "size-(--np-control-h)",
        "icon-xs": "size-6 [&_svg:not([class*='size-'])]:size-3.5",
        "icon-sm": "size-7",
        "icon-lg": "size-9 pointer-coarse:size-11",
      },
      // A capsule for prominent calls to action and toolbar buttons. Icon
      // sizes become perfect circles.
      pill: {
        true: "rounded-(--np-radius-pill)",
        false: "",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
      pill: false,
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
  Omit<VariantProps<typeof buttonVariants>, "size" | "pill"> & {
    /** Capsule shape. For the page's prominent call to action and for toolbar buttons. */
    pill?: boolean
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
  pill = false,
  // Type-only marker (see ButtonProps) — destructured solely to keep it out
  // of the {...props} spread below, since it isn't a real DOM attribute.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  accessibleNameFromChildren: _accessibleNameFromChildren,
  ...props
}: ButtonProps) {
  return (
    <ButtonPrimitive
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, pill, className }))}
      {...props}
      type={props.type ?? "button"}
    />
  )
}

export { Button, buttonVariants }
