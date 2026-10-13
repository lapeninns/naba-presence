"use client"

import { ChevronRightIcon } from "lucide-react"
import Link from "next/link"
import * as React from "react"

import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"

/**
 * Settings rows in Notion Mail's styling (D6: settings stay routes; only
 * the row look is adopted).
 *
 * `SettingsGroup`: a sentence-case label in `text-ui` medium muted ink,
 * 24px above the group, with an optional section-level text action ("Turn
 * all on") on its right as a real button. On a phone the rows sit straight
 * on the page (no card, no dividers); `card` draws a bordered card at the
 * desk only.
 *
 * `SettingsRow`: `--np-settings-row-h` tall (56px touch, 44px desk); a
 * leading 28px `fill-secondary` circle holding an 18px, 1.5-stroke icon; a
 * `text-body` label over an optional `text-caption` description; and one
 * trailing element. It is a link (`href`), a button (`onClick`), a switch
 * row (`checked` + `onCheckedChange`), or static (a `value` or a trailing
 * `action` button of its own).
 *
 * `SettingsDestructiveAction`: the last thing on the page, a centred
 * danger-ink text button. It only reports the press. For removing an
 * account, a location or a client, the caller MUST open `TypedConfirmation`
 * (components/ui/typed-confirmation.tsx) with the consequences listed; a
 * plain two-button alert is not enough, and this button never removes
 * anything itself.
 */

function SettingsGroup({
  label,
  action,
  as: Heading = "h2",
  card = false,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<"section">, "children"> & {
  /** Sentence case: "Notifications per venue". */
  label?: React.ReactNode
  /** A section-level text action, e.g. a `SettingsGroupAction`. */
  action?: React.ReactNode
  /** The label's heading level (default h2, under the page's h1). */
  as?: "h2" | "h3"
  /** Draw the rows in a bordered card at the desk (never on a phone). */
  card?: boolean
  children: React.ReactNode
}) {
  const id = React.useId()
  const labelId = label ? `${id}-label` : undefined
  return (
    <section
      data-slot="settings-group"
      aria-labelledby={labelId}
      className={cn("mt-6 flex flex-col first:mt-0", className)}
      {...props}
    >
      {label || action ? (
        <div className="flex min-h-(--np-touch) items-center justify-between gap-3 desk:min-h-8">
          {label ? (
            <Heading
              id={labelId}
              data-slot="settings-group-label"
              className="text-ui font-medium text-ink-muted"
            >
              {label}
            </Heading>
          ) : (
            <span />
          )}
          {action}
        </div>
      ) : null}
      <ul
        data-slot="settings-group-rows"
        className={cn(
          "flex flex-col",
          card &&
            "desk:overflow-hidden desk:rounded-(--np-radius-card) desk:border desk:border-line desk:bg-surface desk:px-1 desk:[&>li>*]:mx-0 desk:[&>li>*]:w-full"
        )}
      >
        {children}
      </ul>
    </section>
  )
}

/** The text action on the right of a group label ("Turn all on"). */
function SettingsGroupAction({
  className,
  type = "button",
  ...props
}: React.ComponentProps<"button">) {
  return (
    <button
      type={type}
      data-slot="settings-group-action"
      className={cn(
        "relative -mr-2 inline-flex min-h-(--np-touch) shrink-0 items-center rounded-(--np-radius-control) px-2 text-ui font-medium text-accent-ink focus-halo hover-fine:hover:bg-fill desk:min-h-8",
        "disabled:cursor-not-allowed disabled:text-ink-muted",
        className
      )}
      {...props}
    />
  )
}

const rowClassName = cn(
  "flex min-h-(--np-settings-row-h) w-full items-center gap-3 rounded-(--np-radius-field) py-2 text-left text-body text-ink",
  "-mx-2 w-[calc(100%+--spacing(4))] px-2"
)

const interactiveRowClassName = cn(
  rowClassName,
  "cursor-pointer focus-halo transition-[background-color] duration-(--np-duration-fast) ease-standard outline-none active:bg-fill hover-fine:hover:bg-fill",
  "disabled:cursor-not-allowed disabled:text-ink-muted aria-disabled:cursor-not-allowed aria-disabled:text-ink-muted"
)

type SettingsRowBase = {
  /** A lucide icon; drawn 18px with a 1.5 stroke in the 28px circle. */
  icon?: React.ReactNode
  label: React.ReactNode
  description?: React.ReactNode
  className?: string
  disabled?: boolean
}

type SettingsRowProps = SettingsRowBase &
  (
    | {
        /** A navigational row: a link with a trailing chevron. */
        href: string
        value?: React.ReactNode
        onClick?: never
        checked?: never
        onCheckedChange?: never
        action?: never
      }
    | {
        /** A row that opens something in place: a button with a chevron. */
        onClick: () => void
        /** The current value shown before the chevron ("System"). */
        value?: React.ReactNode
        href?: never
        checked?: never
        onCheckedChange?: never
        action?: never
      }
    | {
        /** A switch row: the whole row (the words) toggles. */
        checked: boolean
        onCheckedChange: (checked: boolean) => void
        href?: never
        onClick?: never
        value?: never
        action?: never
      }
    | {
        /** A static row: a value, or its own trailing button. */
        value?: React.ReactNode
        action?: React.ReactNode
        href?: never
        onClick?: never
        checked?: never
        onCheckedChange?: never
      }
  )

function SettingsIcon({ children }: { children: React.ReactNode }) {
  return (
    <span
      aria-hidden="true"
      data-slot="settings-row-icon"
      className="flex size-7 shrink-0 items-center justify-center rounded-(--np-radius-pill) bg-fill-secondary text-ink-secondary [&_svg]:size-4.5 [&_svg]:[stroke-width:1.5]"
    >
      {children}
    </span>
  )
}

function SettingsText({
  id,
  label,
  description,
}: {
  id: string
  label: React.ReactNode
  description?: React.ReactNode
}) {
  return (
    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
      <span id={`${id}-label`} className="text-body">
        {label}
      </span>
      {description ? (
        <span id={`${id}-desc`} className="text-caption text-ink-muted">
          {description}
        </span>
      ) : null}
    </span>
  )
}

function Chevron() {
  return (
    <ChevronRightIcon
      aria-hidden="true"
      data-slot="settings-row-chevron"
      className="size-5 shrink-0 text-ink-muted"
    />
  )
}

function Value({ children }: { children: React.ReactNode }) {
  return (
    <span
      data-slot="settings-row-value"
      className="shrink-0 text-ui text-ink-muted"
    >
      {children}
    </span>
  )
}

function SettingsRow(props: SettingsRowProps) {
  const { icon, label, description, className, disabled } = props
  const id = React.useId()
  const leading = icon ? <SettingsIcon>{icon}</SettingsIcon> : null
  const text = <SettingsText id={id} label={label} description={description} />
  const describedBy = description ? `${id}-desc` : undefined

  if (props.checked !== undefined && props.onCheckedChange) {
    // A native <label> wraps the row, so tapping the words toggles; the
    // Switch is named and described by them, and keeps its own 44px box.
    return (
      <li data-slot="settings-row" data-kind="switch">
        <label
          className={cn(
            rowClassName,
            "cursor-pointer select-none has-[[data-disabled]]:cursor-not-allowed has-[[data-disabled]]:text-ink-muted",
            className
          )}
        >
          {leading}
          {text}
          <Switch
            checked={props.checked}
            onCheckedChange={(next) => props.onCheckedChange?.(next)}
            disabled={disabled}
            aria-labelledby={`${id}-label`}
            aria-describedby={describedBy}
          />
        </label>
      </li>
    )
  }

  if (props.href !== undefined) {
    const inner = (
      <>
        {leading}
        {text}
        {props.value ? <Value>{props.value}</Value> : null}
        <Chevron />
      </>
    )
    return (
      <li data-slot="settings-row" data-kind="link">
        {disabled ? (
          <span
            role="link"
            aria-disabled="true"
            aria-labelledby={`${id}-label`}
            aria-describedby={describedBy}
            className={cn(interactiveRowClassName, className)}
          >
            {inner}
          </span>
        ) : (
          <Link
            href={props.href}
            aria-describedby={describedBy}
            className={cn(interactiveRowClassName, className)}
          >
            {inner}
          </Link>
        )}
      </li>
    )
  }

  if (props.onClick) {
    return (
      <li data-slot="settings-row" data-kind="button">
        <button
          type="button"
          onClick={props.onClick}
          disabled={disabled}
          aria-describedby={describedBy}
          className={cn(interactiveRowClassName, className)}
        >
          {leading}
          {text}
          {props.value ? <Value>{props.value}</Value> : null}
          <Chevron />
        </button>
      </li>
    )
  }

  return (
    <li data-slot="settings-row" data-kind="static">
      <div className={cn(rowClassName, className)}>
        {leading}
        {text}
        {props.value ? <Value>{props.value}</Value> : null}
        {props.action}
      </div>
    </li>
  )
}

/**
 * The centred danger-ink text button that ends a settings page
 * ("Disconnect Google account"). It does not confirm anything: for an
 * account, location or client removal, open `TypedConfirmation` from
 * `onClick`.
 */
function SettingsDestructiveAction({
  className,
  type = "button",
  ...props
}: React.ComponentProps<"button">) {
  return (
    <div data-slot="settings-destructive" className="mt-8 flex justify-center">
      <button
        type={type}
        className={cn(
          "inline-flex min-h-(--np-touch) items-center justify-center rounded-(--np-radius-control) px-4 text-body font-medium text-danger-ink focus-halo hover-fine:hover:bg-danger-tint desk:min-h-(--np-control-h)",
          "disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        {...props}
      />
    </div>
  )
}

export {
  SettingsGroup,
  SettingsGroupAction,
  SettingsRow,
  SettingsDestructiveAction,
}
export type { SettingsRowProps }
