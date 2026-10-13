import { EllipsisIcon } from "lucide-react"
import Link from "next/link"
import * as React from "react"

import { Button, buttonVariants } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"

/**
 * One secondary action, described as data rather than as a rendered button
 * so the bar can draw it twice: inline beside the primary on a desk, and as
 * a row of the overflow menu on a phone. Give it `onClick` or `href`.
 */
export type ActionBarAction = {
  /** The visible words, which are also the accessible name. */
  label: string
  onClick?: () => void
  href?: string
  /** A leading lucide glyph, for both drawings. */
  icon?: React.ReactNode
  /** A consequence the operator must notice ("Discard edits"). */
  destructive?: boolean
  disabled?: boolean
  /** Why it cannot be used; shown in the menu row and as the description. */
  disabledReason?: string
  /** Work in flight on this action. */
  pending?: boolean
}

/**
 * The bottom action bar (reference `.actionbar`, spec "Action bars"): what
 * is true right now on the left, one primary action on the right, the rest
 * folded away. The one primitive for every bar that holds a task's save or
 * publish — editor footers, the inbox composer, bulk selections, the setup
 * wizard, settings forms.
 *
 * Props
 *   status     what is true right now, in words ("2 changes not on Google ·
 *              Saved here 4 min ago"), and the reason when the primary is
 *              disabled. Wrap secondary words in `<ActionBarMuted>`.
 *              Announced politely when it changes.
 *   primary    the ONE primary button (a `<Button>`). Drawn last, so it sits
 *              under the right thumb.
 *   secondaryActions  `ActionBarAction[]`: inline buttons beside the primary
 *              from `md`; one "More actions" overflow menu on a phone.
 *   actions    free-form buttons, drawn as given at every width (the
 *              original API; prefer `primary` + `secondaryActions`).
 *   tone       "charcoal" (default): the one dark bar per screen, for the
 *              action that reaches Google. "surface": the light bar, for a
 *              local save or a selection — every other bar.
 *   dock       on a phone (below `md`), fix the bar to the bottom edge of
 *              the screen (see "Docking" below). Ignored from `md`, where the
 *              bar is inline or `sticky` as before.
 *   visible    default true. Pass `isDirty` (or "has a selection") so a
 *              clean editor shows no bar at all; it slides in with the
 *              first change.
 *   sticky     pin to the bottom of the scroll container (default true).
 *   offset     distance from the bottom when sticky ("bottom-3").
 *   safeArea   add the phone's bottom safe-area inset to the padding (default
 *              true; turn off when the bar sits inside a card).
 *   label      names the region (default "Actions").
 *
 * Docking. A docked bar is `position: fixed`, not sticky. The phone scrolls
 * the document, and a sticky bar only sticks while its own container is on
 * screen: an editor whose form ends before the page does would see its bar
 * scroll away, and a sticky bar is in flow, so its appearing pushes whatever
 * follows it. A fixed bar always owns the bottom edge and appears without
 * moving anything; an in-flow spacer the bar's height keeps the page's last
 * line reachable above it. The bar renders `data-docked="bottom"`, and the
 * CHROME CONTRACT in globals.css does the rest without shared JS state: the
 * tab bar steps aside, and the document's scroll padding grows so a focused
 * field is never left under the bar. `pb-dock` lifts the bar's contents
 * over the home indicator and, while the iOS keyboard is open, over the
 * keyboard (`--np-keyboard-inset`). Layout is all CSS (`max-md:`), so the
 * server's HTML is right for both widths and nothing flashes on hydration.
 *
 * In the dark theme charcoal is near-white with dark ink — always read the
 * role utilities, never assume the bar is black.
 */
function ActionBar({
  status,
  actions,
  primary,
  secondaryActions,
  overflowLabel = "More actions",
  tone = "charcoal",
  dock = false,
  visible = true,
  sticky = true,
  offset = "bottom-0",
  safeArea = true,
  label = "Actions",
  className,
  children,
  ...props
}: Omit<React.ComponentProps<"div">, "children"> & {
  status?: React.ReactNode
  actions?: React.ReactNode
  primary?: React.ReactNode
  secondaryActions?: ActionBarAction[]
  /** Names the phone's overflow menu button (default "More actions"). */
  overflowLabel?: string
  tone?: "charcoal" | "surface"
  dock?: boolean
  visible?: boolean
  sticky?: boolean
  offset?: string
  safeArea?: boolean
  label?: string
  children?: React.ReactNode
}) {
  if (!visible) return null
  const charcoal = tone === "charcoal"
  const secondaries = secondaryActions?.length ? secondaryActions : null
  const hasActions =
    actions !== undefined || primary !== undefined || secondaries !== null
  const bar = (
    <div
      role="region"
      aria-label={label}
      data-slot="action-bar"
      data-bar-tone={tone}
      data-docked={dock ? "bottom" : undefined}
      className={cn(
        "z-chrome flex flex-wrap items-center gap-3 rounded-(--np-radius-card) px-4 py-3 shadow-np-pop",
        charcoal
          ? "on-charcoal [&_:focus-visible]:outline-ink-on-charcoal"
          : "border border-line bg-surface text-ink",
        sticky && cn("sticky", offset),
        safeArea && "pb-[max(--spacing(3),var(--np-safe-bottom))]",
        dock && DOCKED_CLASS,
        className
      )}
      {...props}
    >
      {status !== undefined ? (
        <div
          data-slot="action-bar-status"
          aria-live="polite"
          className={cn(
            "flex min-w-0 grow basis-60 items-center gap-2.5 text-ui [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:[stroke-width:1.75]",
            // On a docked phone bar the status shares one line with the
            // actions: it takes what they leave and wraps within it.
            dock && "max-md:basis-0"
          )}
        >
          {status}
        </div>
      ) : null}
      {children}
      {hasActions ? (
        <div
          data-slot="action-bar-actions"
          className="ml-auto flex flex-wrap items-center justify-end gap-2"
        >
          {actions}
          {secondaries ? (
            <>
              {secondaries.map((action) => (
                <InlineAction
                  key={action.label}
                  action={action}
                  charcoal={charcoal}
                />
              ))}
              <OverflowMenu
                actions={secondaries}
                label={overflowLabel}
                charcoal={charcoal}
              />
            </>
          ) : null}
          {primary}
        </div>
      ) : null}
    </div>
  )
  if (!dock) return bar
  return (
    <>
      {/* Keeps the page's last line reachable above the fixed bar. Phone
          only; from `md` the bar is back in flow. */}
      <div
        aria-hidden
        data-slot="action-bar-spacer"
        className="h-(--np-actionbar-h) md:hidden"
      />
      {bar}
    </>
  )
}

/**
 * The phone drawing of a docked bar: full width on the bottom edge, square
 * corners, a hairline on top, at least the action-bar height above the
 * dock edge, one line (status left, actions right). It slides up on
 * mount (`starting:`), so appearing with the first change reads as the bar
 * arriving rather than the page jumping.
 */
const DOCKED_CLASS = cn(
  "max-md:fixed max-md:inset-x-0 max-md:bottom-0 max-md:z-chrome max-md:m-0 max-md:flex-nowrap max-md:rounded-none max-md:border-x-0 max-md:border-t max-md:border-b-0 max-md:border-line max-md:px-safe",
  "max-md:min-h-[calc(var(--np-actionbar-h)+var(--np-dock-bottom))] max-md:pt-2 max-md:pb-dock",
  "max-md:transition-transform max-md:duration-(--np-duration-sheet) max-md:ease-out max-md:starting:translate-y-full"
)

/** A secondary drawn inline: from `md` only, when the bar has room. */
function InlineAction({
  action,
  charcoal,
}: {
  action: ActionBarAction
  charcoal: boolean
}) {
  const variant = action.destructive
    ? charcoal
      ? "ghost-dark"
      : "danger-outline"
    : charcoal
      ? "ghost-dark"
      : "secondary"
  if (action.href && !action.disabled && !action.disabledReason) {
    return (
      <Link
        href={action.href}
        className={buttonVariants({ variant, className: "max-md:hidden" })}
      >
        {action.icon}
        {action.label}
      </Link>
    )
  }
  return (
    <Button
      variant={variant}
      className="max-md:hidden"
      onClick={action.onClick}
      disabled={action.disabled}
      disabledReason={action.disabledReason}
      pending={action.pending}
    >
      {action.icon}
      {action.label}
    </Button>
  )
}

/**
 * The phone's overflow: one 44px "More actions" button opening the shared
 * action menu (a bottom action sheet on a phone, see dropdown-menu).
 * Hidden from `md`, where the same actions are inline.
 */
function OverflowMenu({
  actions,
  label,
  charcoal,
}: {
  actions: ActionBarAction[]
  label: string
  charcoal: boolean
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant={charcoal ? "ghost-dark" : "secondary"}
            size="icon"
            aria-label={label}
            className="md:hidden"
          />
        }
      >
        <EllipsisIcon aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top">
        {actions.map((action) => (
          <DropdownMenuItem
            key={action.label}
            variant={action.destructive ? "destructive" : "default"}
            disabled={action.disabled || action.pending}
            disabledReason={action.disabledReason}
            onClick={action.onClick}
            render={
              action.href && !action.disabled && !action.disabledReason ? (
                <Link href={action.href} />
              ) : undefined
            }
          >
            {action.icon}
            {action.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * Secondary words in the status slot, in the muted ink of the bar's tone
 * (the on-charcoal muted ink by default, the plain muted ink on a surface
 * bar).
 */
function ActionBarMuted({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      className={cn(
        "text-ink-muted-on-charcoal in-data-[bar-tone=surface]:text-ink-muted",
        className
      )}
      {...props}
    />
  )
}

export { ActionBar, ActionBarMuted }
