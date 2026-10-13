import Link from "next/link"
import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * The card box itself — radius, hairline, white ground — as a class recipe,
 * for the rare surface that must stay a different element or component (a
 * `label` choice, a `details`, a Base UI part). Everything else uses `Card`.
 * Feature code must not hand-copy `rounded-(--np-radius-card) border
 * border-line bg-surface`: that string is how 143 surfaces drifted from the
 * card.
 *
 * - `surface="sunken"` is the inset well (the canvas-grey ground, no white),
 *   for a group nested inside a card or a read-only block.
 * - `interactive` adds the hover (fine pointers only) and pressed states of a
 *   card that is one target; see `Card`.
 * - `pad` adds `--np-card-pad` on every side (16px touch, 20px desk).
 */
function cardClassName({
  surface = "default",
  interactive = false,
  pad = false,
  className,
}: {
  surface?: "default" | "sunken"
  interactive?: boolean
  pad?: boolean
  className?: string
} = {}) {
  return cn(
    "rounded-(--np-radius-card) border border-line text-ink",
    surface === "sunken" ? "bg-surface-alt" : "bg-surface",
    interactive &&
      cn(
        "cursor-pointer transition-[background-color,border-color,box-shadow] duration-(--np-duration-fast) ease-spring-snappy",
        "hover-fine:hover:border-line-strong hover-fine:hover:shadow-np-raised",
        // Pressed: the whole card dims a step under the finger, the same
        // feedback a list row gives.
        surface === "sunken" ? "active:bg-fill" : "active:bg-surface-alt"
      ),
    pad && "p-(--np-card-pad)",
    className
  )
}

type CardProps = React.ComponentProps<"div"> & {
  size?: "default" | "sm"
  inset?: boolean
  flush?: boolean
  /** `sunken` draws the inset well instead of the white card. */
  surface?: "default" | "sunken"
  /**
   * The card is one target whose link is a `CardLink` inside it (usually in
   * the title). Hover, pressed and focus are drawn on the whole card, and the
   * link's hit area is stretched over it, so a tap anywhere opens it while
   * buttons inside stay their own targets.
   */
  interactive?: boolean
  /**
   * Renders the whole card as a link. For a card with no controls of its own:
   * its entire text becomes the link's name, so keep it short. A card with
   * buttons inside uses `interactive` and a `CardLink` instead (a link may
   * not contain a button).
   */
  href?: string
  /** The element to render when not a link: a list item, an article. */
  as?: "div" | "section" | "article" | "li"
}

/**
 * Reference `.card`: a white surface drawn with a 1px hairline, radius 12,
 * `--np-card-pad` inside (16px on touch, 20px on a desk; `size="sm"` keeps
 * 16px). No shadow, no tint.
 *
 * `inset` makes a card whose direct children are rows: the padding and gap
 * collapse and the rows are divided by hairlines. `flush` removes padding
 * entirely (reference `.card-flush`) for a table, an `Empty` or media inside.
 *
 * Interactive cards (listings-content-18: only the small button was
 * tappable):
 *
 *   <Card href="/listings/1">…</Card>                  whole card is a link
 *   <Card interactive>                                  card with controls
 *     <CardHeader><CardTitle><CardLink href="/listings/1">Old Crown</CardLink>
 *     </CardTitle><CardAction><Button>…</Button></CardAction></CardHeader>
 *   </Card>
 *
 * `CardHeader divided` draws the reference `.card-head` (a bottom rule);
 * `CardFooter bar` draws `.card-foot` (top rule on the sunken surface).
 */
function Card({
  className,
  size = "default",
  inset = false,
  flush = false,
  surface = "default",
  interactive = false,
  href,
  as: Element = "div",
  ...props
}: CardProps) {
  const classes = cn(
    cardClassName({ surface, interactive: interactive || Boolean(href) }),
    "group/card flex min-w-0 flex-col gap-(--card-spacing) overflow-hidden py-(--card-spacing) text-body [--card-spacing:var(--np-card-pad)] [--card-pt:var(--card-spacing)] data-[flush]:[--card-pt:0px] data-[inset]:[--card-pt:0px] has-[>img:first-child]:pt-0 data-[size=sm]:[--card-spacing:--spacing(4)] data-[inset]:gap-0 data-[inset]:divide-y data-[inset]:divide-line data-[inset]:py-0 data-[flush]:gap-0 data-[flush]:py-0 *:[img:first-child]:rounded-t-(--np-radius-card) *:[img:last-child]:rounded-b-(--np-radius-card)",
    href && "no-underline focus-halo focus-visible:outline-none",
    interactive &&
      cn(
        "relative",
        // Controls inside a stretched-link card sit above the link's hit
        // area, so they stay their own targets.
        "[&_:is(a,button,input,select,textarea,label,[role=button]):not([data-slot=card-link])]:relative [&_:is(a,button,input,select,textarea,label,[role=button]):not([data-slot=card-link])]:z-raised"
      ),
    className
  )
  const data = {
    "data-slot": "card",
    "data-size": size,
    "data-inset": inset || undefined,
    "data-flush": flush || undefined,
    "data-surface": surface === "default" ? undefined : surface,
    "data-interactive": interactive || href ? "" : undefined,
  }
  if (href) {
    return (
      <Link
        href={href}
        {...data}
        className={classes}
        {...(props as Omit<React.ComponentProps<typeof Link>, "href">)}
      />
    )
  }
  return <Element {...data} className={classes} {...(props as object)} />
}

/**
 * The link of an `interactive` card. Its ::after covers the whole card, so
 * the card is one tap target while the accessible name stays the link's own
 * text (the title), not every word on the card. Focus draws on the card's
 * outline, inset, because the card clips its overflow.
 */
function CardLink({
  className,
  ...props
}: React.ComponentProps<typeof Link>) {
  return (
    <Link
      data-slot="card-link"
      className={cn(
        "text-ink no-underline outline-none",
        "after:absolute after:inset-0 after:rounded-(--np-radius-card) after:content-['']",
        "focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-(--np-focus-ring)",
        "hover-fine:hover:underline hover-fine:hover:underline-offset-4",
        className
      )}
      {...props}
    />
  )
}

function CardHeader({
  className,
  divided = false,
  ...props
}: React.ComponentProps<"div"> & {
  /** Reference `.card-head`: 16/20 padding and a hairline beneath. */
  divided?: boolean
}) {
  return (
    <div
      data-slot="card-header"
      data-divided={divided || undefined}
      className={cn(
        "group/card-header @container/card-header grid auto-rows-min items-start gap-0.5 px-(--card-spacing) group-data-[inset]/card:py-(--card-spacing) has-data-[slot=card-action]:grid-cols-[minmax(0,1fr)_auto] has-data-[slot=card-action]:gap-x-3 has-data-[slot=card-description]:grid-rows-[auto_auto] [.border-b]:border-line [.border-b]:pb-(--card-spacing)",
        divided &&
          "-mt-(--card-pt) border-b border-line py-4",
        className
      )}
      {...props}
    />
  )
}

function CardTitle({
  as: Heading = "h3",
  className,
  ...props
}: React.ComponentProps<"h3"> & { as?: "h1" | "h2" | "h3" | "h4" }) {
  return (
    <Heading
      data-slot="card-title"
      className={cn("text-title font-semibold text-balance text-ink", className)}
      {...props}
    />
  )
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn("text-ui text-ink-muted", className)}
      {...props}
    />
  )
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn(
        "col-start-2 row-span-2 row-start-1 self-start justify-self-end",
        className
      )}
      {...props}
    />
  )
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-content"
      className={cn("px-(--card-spacing)", className)}
      {...props}
    />
  )
}

function CardFooter({
  className,
  bar = false,
  ...props
}: React.ComponentProps<"div"> & {
  /** Reference `.card-foot`: a top rule on the sunken surface, 12/20 padding. */
  bar?: boolean
}) {
  return (
    <div
      data-slot="card-footer"
      data-bar={bar || undefined}
      className={cn(
        "flex flex-wrap items-center gap-3 px-(--card-spacing) group-data-[inset]/card:py-(--card-spacing) [.border-t]:border-line [.border-t]:pt-(--card-spacing)",
        bar &&
          "mt-auto -mb-(--card-pt) justify-between border-t border-line bg-surface-alt py-3",
        className
      )}
      {...props}
    />
  )
}

export {
  Card,
  CardLink,
  cardClassName,
  type CardProps,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
}
