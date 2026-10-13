import { CircleAlert } from "lucide-react"
import Link from "next/link"
import type * as React from "react"

/**
 * The pieces the error and not-found boundaries share, kept deliberately
 * light: no `cn`/tailwind-merge, no Base UI, no components/ui tree. Every
 * route segment gets its own boundary chunk, so whatever a boundary imports
 * is copied into each of them; these are plain class strings and markup
 * drawn with the same tokens as the primitives they stand in for.
 */

type BoundaryButtonVariant = "primary" | "outline" | "ghost"
type BoundaryButtonSize = "default" | "lg"

// buttonVariants (components/ui/button.tsx) resolved for the variants the
// boundaries use, without the class-merging machinery.
const BUTTON_BASE =
  "relative inline-flex shrink-0 items-center justify-center gap-2 rounded-(--np-radius-control) border leading-none font-semibold whitespace-nowrap no-underline focus-halo transition-[background-color,border-color,color,box-shadow,transform] duration-(--np-duration-fast) ease-spring-snappy select-none focus-visible:outline-none active:not-disabled:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-busy:cursor-progress [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0"

const BUTTON_VARIANT: Record<BoundaryButtonVariant, string> = {
  primary:
    "border-transparent bg-primary text-primary-foreground hover:not-disabled:bg-accent-hover",
  outline: "border-line-strong bg-surface text-ink hover:not-disabled:bg-fill",
  ghost:
    "border-transparent bg-transparent text-ink hover:not-disabled:bg-fill",
}

const BUTTON_SIZE: Record<BoundaryButtonSize, string> = {
  default: "h-(--np-control-h) px-3.5 text-ui",
  lg: "h-11 px-5 text-body",
}

/** The button look for a native `<button>` or an `<a>` in a boundary. */
function boundaryButtonClass(
  variant: BoundaryButtonVariant = "primary",
  size: BoundaryButtonSize = "default",
  extra?: string
) {
  return [BUTTON_BASE, BUTTON_VARIANT[variant], BUTTON_SIZE[size], extra]
    .filter(Boolean)
    .join(" ")
}

/** The mono, upper-case context line above a boundary's title. */
const BOUNDARY_EYEBROW_CLASS =
  "font-mono text-caption font-medium tracking-[0.06em] text-ink-muted uppercase"

/** The serif page title every boundary leads with. */
const BOUNDARY_TITLE_CLASS =
  "font-display text-page-title font-semibold text-balance text-ink outline-none"

/**
 * PageFrame's widths and gutters (page-frame.tsx) as a plain div carrying
 * the same `data-slot`, for the boundaries that replace a whole page.
 */
function BoundaryFrame({
  width = "default",
  className,
  children,
}: {
  width?: "default" | "wide" | "workspace"
  className?: string
  children: React.ReactNode
}) {
  return (
    <div
      data-slot="page-frame"
      data-width={width}
      className={[
        "@container mx-auto flex w-full flex-col gap-(--np-gap-section) px-5 pt-6 outline-none md:px-(--np-page-pad-x) md:pt-(--np-page-pad-y)",
        width === "default" && "max-w-(--np-page-default-width) pb-12",
        width === "wide" && "max-w-(--np-page-max-width) pb-12",
        width === "workspace" && "min-h-0 max-w-none flex-1 pb-6",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </div>
  )
}

/** Inline mono code, wrapping anywhere so a long path never overflows. */
function BoundaryCode({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded-sm border border-line bg-surface-alt px-1.5 py-px font-mono text-caption [overflow-wrap:anywhere] text-ink">
      {children}
    </code>
  )
}

/**
 * A route's error, inside a page that keeps working around it: the danger
 * alert (role="alert", as the Alert primitive announces it), Try again, and
 * one way out. The light twin of RouteErrorState in query-states.tsx.
 */
function BoundaryErrorState({
  title,
  description,
  onReset,
  homeHref = "/inbox",
  homeLabel = "Go to Inbox",
}: {
  title: string
  description: React.ReactNode
  onReset: () => void
  homeHref?: string
  homeLabel?: string
}) {
  return (
    <div className="mx-auto flex min-h-[60svh] w-full max-w-md flex-col items-center justify-center gap-4 px-5 py-6 text-center">
      <BoundaryAlert title={title}>{description}</BoundaryAlert>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          onClick={() => onReset()}
          className={boundaryButtonClass("primary")}
        >
          Try again
        </button>
        <Link href={homeHref} className={boundaryButtonClass("outline")}>
          {homeLabel}
        </Link>
      </div>
    </div>
  )
}

/** The destructive Alert's drawing: a danger tint, a title and its words. */
function BoundaryAlert({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div
      data-slot="alert"
      role="alert"
      className="grid w-full grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 rounded-(--np-radius-card) bg-danger-tint px-3.5 py-3 text-left text-ui text-ink"
    >
      <CircleAlert
        className="row-span-2 mt-0.5 size-4 text-danger-ink"
        strokeWidth={1.75}
        aria-hidden
      />
      <div data-slot="alert-title" className="text-body font-semibold text-ink">
        {title}
      </div>
      <div
        data-slot="alert-description"
        className="col-start-2 min-w-0 text-pretty"
      >
        {children}
      </div>
    </div>
  )
}

export {
  BOUNDARY_EYEBROW_CLASS,
  BOUNDARY_TITLE_CLASS,
  BoundaryAlert,
  BoundaryCode,
  BoundaryErrorState,
  BoundaryFrame,
  boundaryButtonClass,
}
