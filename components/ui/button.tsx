import { Button as ButtonPrimitive } from "@base-ui/react/button"
import type { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"
import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * The operator's-desk button set (reference np.css `.btn`).
 *
 *   `default`        primary: the accent solid. Once per surface.
 *   `secondary`      white with the 3:1 control edge; the workhorse.
 *   `outline`        the same drawing as secondary (kept for old callers).
 *   `ghost`          no chrome until hover.
 *   `tinted`         accent ink on the accent tint, for a prominent secondary.
 *   `danger`         the filled red, for the consequence a dialog confirms.
 *   `danger-outline` red ink on white with a red edge ("Discard edits").
 *   `destructive`    kept for existing callers; drawn as `danger-outline`.
 *   `on-dark`        the light button on the charcoal action bar.
 *   `ghost-dark`     the quiet button on the charcoal action bar.
 *   `link`           inline text action.
 *
 * Every hover colour is a token. Focus is the `focus-halo` utility.
 *
 * Sizes read the control tokens, which are touch-first (globals.css): the
 * default is `--np-control-h` (44px on touch, 36px under `desk`), `sm` is
 * `--np-control-h-sm` (36/30). Nothing is patched per pointer any more. `sm`
 * and `icon-sm` add an invisible hit area that reaches 44px on touch (an
 * `::after` overhang, dropped under `desk`), so a small secondary still meets
 * the touch floor without drawing bigger. `xs`/`icon-xs` are 24px everywhere
 * — the WCAG 2.5.8 floor — for dense meta actions only; never a primary.
 * Every `icon*` size is square at every density.
 */
const buttonCva = cva(
  "group/button relative inline-flex shrink-0 items-center justify-center rounded-(--np-radius-control) border border-transparent text-ui leading-none font-semibold whitespace-nowrap no-underline focus-halo transition-[background-color,border-color,color,box-shadow,transform] duration-(--np-duration-fast) ease-spring-snappy select-none focus-visible:outline-none active:not-disabled:not-data-disabled:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-busy:cursor-progress aria-invalid:text-danger-ink data-disabled:cursor-not-allowed data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg]:[stroke-width:1.75] [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground hover:not-data-disabled:bg-accent-hover aria-expanded:bg-accent-hover",
        tinted:
          "bg-accent-tint text-accent-ink hover:not-data-disabled:bg-(--np-accent-tint-strong) aria-expanded:bg-(--np-accent-tint-strong)",
        secondary:
          "border-line-strong bg-surface text-ink hover:not-data-disabled:bg-fill aria-expanded:bg-fill",
        outline:
          "border-line-strong bg-surface text-ink hover:not-data-disabled:bg-fill aria-expanded:bg-fill",
        ghost:
          "bg-transparent text-ink hover:not-data-disabled:bg-fill aria-expanded:bg-fill",
        danger:
          "bg-danger-solid text-(--np-ink-on-accent) hover:not-data-disabled:bg-danger-ink dark:text-(--np-danger-on-solid)",
        "danger-outline":
          "border-danger-ink bg-surface text-danger-ink hover:not-data-disabled:bg-danger-tint",
        destructive:
          "border-danger-ink bg-surface text-danger-ink hover:not-data-disabled:bg-danger-tint",
        "on-dark":
          "bg-ink-on-charcoal text-charcoal hover:not-data-disabled:bg-ink-muted-on-charcoal",
        "ghost-dark":
          "border-ink-muted-on-charcoal bg-transparent text-ink-on-charcoal hover:not-data-disabled:bg-ink-on-charcoal/10",
        link: "h-auto! border-0 px-0! font-medium text-accent-ink underline decoration-1 underline-offset-3 hover:decoration-2 active:translate-y-0",
      },
      size: {
        // The default height follows the density token so a compact table
        // shrinks its buttons with it (the token is 44px on coarse pointers).
        default: "h-(--np-control-h) gap-2 px-3.5",
        xs: "h-6 gap-1 px-2 text-caption [&_svg:not([class*='size-'])]:size-3.5",
        sm: "h-(--np-control-h-sm) gap-1.5 px-2.5 text-ui after:absolute after:inset-x-0 after:inset-y-[calc((100%-var(--np-touch))/2)] after:content-[''] desk:after:hidden",
        lg: "h-11 gap-2 px-5 text-body",
        icon: "size-(--np-control-h)",
        "icon-xs": "size-6 [&_svg:not([class*='size-'])]:size-3.5",
        "icon-sm":
          "size-(--np-control-h-sm) after:absolute after:inset-[calc((100%-var(--np-touch))/2)] after:content-[''] desk:after:hidden",
        "icon-lg": "size-11",
      },
      // A capsule, for the rare prominent call to action.
      pill: {
        true: "rounded-(--np-radius-pill)",
        false: "",
      },
      block: {
        true: "w-full",
        false: "",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
      pill: false,
      block: false,
    },
  }
)

type ButtonVariantOptions = Parameters<typeof buttonCva>[0]

/**
 * The button's classes, already merged. A link or label drawn as a button
 * uses this directly (`<Link className={buttonVariants({ variant:
 * "secondary" })}>`). It merges inside, because the base sets
 * `border-transparent` and a variant then sets its own border colour: read
 * raw, both classes reach the element and the later-in-the-stylesheet one
 * wins, so a secondary link lost its edge (clients-reports-10). Wrapping it
 * in `cn()` as well is harmless.
 */
function buttonVariants(options?: ButtonVariantOptions): string {
  return cn(buttonCva(options))
}

// Icon-only sizes render no visible label, so the type system requires
// aria-label wherever one of these sizes is selected.
type IconSize = "icon" | "icon-sm" | "icon-xs" | "icon-lg"
type AnySize = NonNullable<VariantProps<typeof buttonVariants>["size"]>
type ButtonBaseProps = Omit<React.ComponentProps<"button">, "size"> &
  Omit<VariantProps<typeof buttonVariants>, "size" | "pill" | "block"> & {
    /** Capsule shape. For the page's prominent call to action. */
    pill?: boolean
    /** Full width. */
    block?: boolean
    render?: useRender.RenderProp<ButtonPrimitive.State>
    /**
     * Work is in flight: draws a spinner before the label, sets
     * `aria-busy`, and blocks activation while keeping the button focusable
     * so focus is not thrown to the body mid-action.
     */
    pending?: boolean
    /** The label shown while pending ("Publishing…"). Defaults to children. */
    pendingLabel?: React.ReactNode
    /**
     * Why the button cannot be used right now. Disables it but keeps it
     * focusable, exposes the reason as its accessible description and as a
     * hover title. Show the same words next to the control where space
     * allows; a hover title alone is not enough on touch.
     */
    disabledReason?: string
    focusableWhenDisabled?: boolean
    /**
     * Below this breakpoint the button draws as a square icon button: the
     * label becomes visually hidden (still the accessible name, so the
     * label-in-name rule holds) and the width collapses to the control
     * height. Needs a leading `<svg>` icon among the children. Pure CSS, so
     * the server and the phone agree (prim-09: no more hand-rolled
     * `max-md:sr-only` labels that leave a 37×44 button).
     */
    iconOnlyBelow?: "sm" | "md"
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
      // Deliberate opt-out from the aria-label requirement: the name comes
      // from a visually-hidden text child instead (see
      // components/auth/password-field.tsx).
      accessibleNameFromChildren: true
    })

function ButtonSpinner() {
  return (
    <span
      aria-hidden
      data-slot="button-spinner"
      className="inline-block size-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent motion-reduce:animate-none"
    />
  )
}

/**
 * Each collapse: the button turns square at the default control height and
 * every child that is not an icon becomes visually hidden. Written out so
 * Tailwind sees the classes.
 */
const ICON_ONLY_BELOW = {
  sm: "max-sm:size-(--np-control-h) max-sm:gap-0 max-sm:px-0 max-sm:[&>:not(svg):not([data-slot=button-spinner])]:sr-only",
  md: "max-md:size-(--np-control-h) max-md:gap-0 max-md:px-0 max-md:[&>:not(svg):not([data-slot=button-spinner])]:sr-only",
} as const

function Button({
  className,
  variant = "default",
  size = "default",
  pill = false,
  block = false,
  pending = false,
  pendingLabel,
  disabledReason,
  disabled,
  focusableWhenDisabled,
  iconOnlyBelow,
  children,
  onClick,
  // Type-only marker (see ButtonProps).
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  accessibleNameFromChildren: _accessibleNameFromChildren,
  ...props
}: ButtonProps) {
  const reasonId = React.useId()
  const blocked = Boolean(disabled || pending || disabledReason)
  const describedBy =
    [props["aria-describedby"], disabledReason ? reasonId : null]
      .filter(Boolean)
      .join(" ") || undefined

  // Children are only rebuilt when the button adds something of its own (a
  // spinner, a hidden reason). Otherwise they are left out entirely, so a
  // Button used as another primitive's `render` element — which may be
  // pre-rendered on the server before the trigger clones its label in —
  // carries no `children` key to override the label with.
  const decorated = pending || Boolean(disabledReason) || Boolean(iconOnlyBelow)
  const label = pending && pendingLabel !== undefined ? pendingLabel : children
  const childProps = decorated
    ? {
        children: (
          <>
            {pending ? <ButtonSpinner /> : null}
            {iconOnlyBelow ? wrapLabelText(label) : label}
            {disabledReason ? (
              // `hidden` keeps the reason out of the accessible NAME (hidden
              // content is skipped by name-from-content) while
              // aria-describedby still reads it as the description.
              <span id={reasonId} hidden>
                {disabledReason}
              </span>
            ) : null}
          </>
        ),
      }
    : children === undefined
      ? {}
      : { children }

  // The same rule for the state props: only present when they say something,
  // so a pre-rendered `render` element never overrides a trigger's handlers.
  const stateProps: Record<string, unknown> = {}
  if (blocked) stateProps.disabled = true
  if (disabled !== undefined && !blocked) stateProps.disabled = disabled
  const focusable =
    focusableWhenDisabled ?? (pending || Boolean(disabledReason))
  if (focusable) stateProps.focusableWhenDisabled = true
  if (pending) stateProps["aria-busy"] = true
  if (describedBy) stateProps["aria-describedby"] = describedBy
  if (props.title === undefined && disabledReason)
    stateProps.title = disabledReason
  if (onClick && !blocked) stateProps.onClick = onClick

  return (
    <ButtonPrimitive
      data-slot="button"
      data-variant={variant}
      data-size={size}
      data-pending={pending || undefined}
      className={buttonVariants({
        variant,
        size,
        pill,
        block,
        className: cn(iconOnlyBelow && ICON_ONLY_BELOW[iconOnlyBelow], className),
      })}
      {...props}
      {...childProps}
      {...stateProps}
      type={props.type ?? "button"}
    />
  )
}

/**
 * Bare strings and numbers among a collapsing button's children are wrapped
 * in a span, so the `sr-only` child selector can reach them (CSS cannot
 * select a text node).
 */
function wrapLabelText(children: React.ReactNode) {
  return React.Children.map(children, (child) =>
    typeof child === "string" || typeof child === "number" ? (
      <span data-slot="button-label">{child}</span>
    ) : (
      child
    )
  )
}

/**
 * The visible half of `disabledReason` (prim-18). A title tooltip never
 * shows on touch, so wherever a control can be disabled the same words
 * should also be on screen. Wrap the control: the reason is drawn as a
 * caption beside it (below it when the row has no room) and disappears when
 * `reason` is empty.
 *
 *   <DisabledReason reason={reason}>
 *     <Button disabledReason={reason ?? undefined}>Publish</Button>
 *   </DisabledReason>
 *
 * The caption is `aria-hidden`: the Button already exposes the same words
 * as its accessible description, and reading them twice is noise. Inside an
 * `ActionBar`, put the reason in `status` instead.
 */
function DisabledReason({
  reason,
  children,
  className,
  ...props
}: React.ComponentProps<"div"> & {
  reason?: React.ReactNode
}) {
  return (
    <div
      data-slot="disabled-reason"
      className={cn(
        "inline-flex flex-wrap items-center gap-x-3 gap-y-1",
        className
      )}
      {...props}
    >
      {children}
      {reason ? (
        <span aria-hidden className="text-caption text-ink-muted">
          {reason}
        </span>
      ) : null}
    </div>
  )
}

export { Button, DisabledReason, buttonVariants }
