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
 * `SettingsGroup`: a sentence-case label in `text-caption` medium muted ink
 * (D8), 24px above the group, with optional section-level text actions
 * ("Turn all on", "Open profile") on its right as real buttons, an optional
 * `caption` under it and an optional `footer` under the rows (a card's one
 * Save). On a phone the rows sit straight on the page (no card, no
 * dividers); `card` draws a bordered card at the desk only, with the footer
 * inside it. With an `id`, the heading is `${id}-heading` and focusable by
 * script (`tabIndex={-1}`) for section navigation; `headingId` (or its
 * alias `labelId`) sets the heading id outright. `listProps` reach the
 * rows' `<ul>` (`aria-label="Danger zone actions"`). `bodyAs="div"` drops
 * the list for a group that is one form card: no `<ul>`, and its rows (and
 * a `SettingsDestructiveAction asRow`) render as `<div>`s.
 *
 * `SettingsRow`: `--np-settings-row-h` tall (56px touch, 44px desk); a
 * leading 28px `fill-secondary` circle holding an 18px, 1.5-stroke icon; a
 * `text-body` label over an optional `text-caption` description; and one
 * trailing element. It is a link (`href`), a button (`onClick`), a switch
 * row (`checked` + `onCheckedChange`), static (a `value` or a trailing
 * `action` button of its own), or an inline field (`control`: the label
 * and description above the field, nothing wrapping it). Any row can show a
 * `changed` word after its label. A `footnote` is a block under the row,
 * aligned to the text column (a gate reason; pass `footnoteProps={{ role:
 * "note" }}`). Switch, link and button rows are described by it; a field
 * row's control should reference `${controlId}-footnote`, and a static row
 * with an `action` must pass `footnoteProps.id` and wire the action itself.
 *
 * `SettingsDestructiveAction`: the last thing on the page, a centred
 * danger-ink text button. It only reports the press. For removing an
 * account, a location or a client, the caller MUST open `TypedConfirmation`
 * (components/ui/typed-confirmation.tsx) with the consequences listed; a
 * plain two-button alert is not enough, and this button never removes
 * anything itself. `asRow` draws it as one row of a group (an `<li>` in a
 * list group, a `<div>` in a `bodyAs="div"` group) instead of the page's
 * closing button, and it takes a `footnote` like a row.
 */

/** Whether rows sit in the group's `<ul>` (`li`) or a `div` body. */
const SettingsListContext = React.createContext(true)

/** A row's outer element: `<li>` in a list group, else `<div>`. */
function RowItem({
  className,
  children,
  ...data
}: {
  className?: string
  children?: React.ReactNode
  [data: `data-${string}`]: string | undefined
}) {
  const Item = React.useContext(SettingsListContext) ? "li" : "div"
  return (
    <Item {...data} className={className}>
      {children}
    </Item>
  )
}

function SettingsGroup({
  label,
  action,
  actions,
  caption,
  footer,
  as,
  headingAs,
  headingId,
  labelId: labelIdProp,
  listProps,
  bodyAs = "ul",
  id,
  card = false,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<"section">, "children"> & {
  /** Sentence case: "Notifications per venue". */
  label?: React.ReactNode
  /** A section-level text action, e.g. a `SettingsGroupAction`. */
  action?: React.ReactNode
  /**
   * More group-level actions, drawn after `action` on the label line (e.g.
   * "Open profile"). Real buttons or links; each keeps its own 44px target.
   */
  actions?: React.ReactNode
  /** A muted line under the label (e.g. how the group saves). */
  caption?: React.ReactNode
  /**
   * A footer under the rows (the card's one Save button). Presentation
   * only: the group never saves anything itself. In `card` mode it sits
   * inside the desk card, below a hairline.
   */
  footer?: React.ReactNode
  /** The label's heading level (default h2, under the page's h1). */
  as?: "h2" | "h3"
  /** Same as `as`; wins when both are given. */
  headingAs?: "h2" | "h3"
  /**
   * The heading's id. Defaults to `${id}-heading` when the group has an
   * `id`, so section navigation can focus it; the heading is focusable by
   * script only (`tabIndex={-1}`), never a tab stop.
   */
  headingId?: string
  /** Alias of `headingId`; `headingId` wins when both are given. */
  labelId?: string
  /** Props for the rows' `<ul>` (`aria-label`); ignored with `bodyAs="div"`. */
  listProps?: Omit<React.ComponentProps<"ul">, "children">
  /**
   * `"ul"` (default): the rows are a list. `"div"`: one form card, no list;
   * rows render as `<div>`s.
   */
  bodyAs?: "ul" | "div"
  id?: string
  /** Draw the rows in a bordered card at the desk (never on a phone). */
  card?: boolean
  children: React.ReactNode
}) {
  const autoId = React.useId()
  const Heading = headingAs ?? as ?? "h2"
  const labelId = label
    ? (headingId ?? labelIdProp ?? (id ? `${id}-heading` : `${autoId}-label`))
    : undefined
  const captionId = caption ? `${autoId}-caption` : undefined
  const hasFooter = footer != null && footer !== false
  return (
    <section
      id={id}
      data-slot="settings-group"
      data-card={card || undefined}
      aria-labelledby={labelId}
      aria-describedby={captionId}
      className={cn("mt-6 flex flex-col first:mt-0", className)}
      {...props}
    >
      {label || action || actions ? (
        <div className="flex min-h-(--np-touch) items-center justify-between gap-3 desk:min-h-8">
          {label ? (
            <Heading
              id={labelId}
              tabIndex={-1}
              data-slot="settings-group-label"
              className="scroll-mt-(--np-touch) rounded-(--np-radius-tag) text-caption font-medium text-ink-muted outline-none focus-visible:ring-2 focus-visible:ring-(--np-focus-ring) forced-colors:focus-visible:outline-2"
            >
              {label}
            </Heading>
          ) : (
            <span />
          )}
          {action || actions ? (
            <div
              data-slot="settings-group-actions"
              className="flex shrink-0 items-center gap-1"
            >
              {action}
              {actions}
            </div>
          ) : null}
        </div>
      ) : null}
      {caption ? (
        <p
          id={captionId}
          data-slot="settings-group-caption"
          className="-mt-1 mb-1 text-caption text-ink-muted desk:mt-0"
        >
          {caption}
        </p>
      ) : null}
      <SettingsListContext.Provider value={bodyAs === "ul"}>
        {bodyAs === "div" ? (
          <div
            data-slot="settings-group-rows"
            data-body="div"
            className={cn(
              "flex flex-col",
              card &&
                "desk:overflow-hidden desk:rounded-(--np-radius-card) desk:border desk:border-line desk:bg-surface desk:px-1 desk:[&>div>*]:mx-0 desk:[&>div>*]:w-full",
              card && hasFooter && "desk:rounded-b-none"
            )}
          >
            {children}
          </div>
        ) : (
          <ul
            {...listProps}
            data-slot="settings-group-rows"
            className={cn(
              "flex flex-col",
              card &&
                "desk:overflow-hidden desk:rounded-(--np-radius-card) desk:border desk:border-line desk:bg-surface desk:px-1 desk:[&>li>*]:mx-0 desk:[&>li>*]:w-full",
              card && hasFooter && "desk:rounded-b-none",
              listProps?.className
            )}
          >
            {children}
          </ul>
        )}
      </SettingsListContext.Provider>
      {hasFooter ? (
        <div
          data-slot="settings-group-footer"
          className={cn(
            "flex flex-wrap items-center justify-end gap-2 pt-3",
            card &&
              "desk:-mt-px desk:rounded-b-(--np-radius-card) desk:border desk:border-line desk:bg-surface desk:px-3 desk:pb-3"
          )}
        >
          {footer}
        </div>
      ) : null}
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

/**
 * Interactive rows focus with an INSET ring (`focus-ring-inset`): a desk
 * `card` group clips its rows (`overflow-hidden`), and an outer halo on the
 * first or last row would be cut off there. Forced colours get a CanvasText
 * outline, also inside the row.
 */
const interactiveRowClassName = cn(
  rowClassName,
  "cursor-pointer focus-ring-inset transition-[background-color] duration-(--np-duration-fast) ease-standard outline-none active:bg-fill hover-fine:hover:bg-fill",
  "disabled:cursor-not-allowed disabled:text-ink-muted aria-disabled:cursor-not-allowed aria-disabled:text-ink-muted"
)

type SettingsRowBase = {
  /** A lucide icon; drawn 18px with a 1.5 stroke in the 28px circle. */
  icon?: React.ReactNode
  label: React.ReactNode
  description?: React.ReactNode
  /**
   * A word after the label saying the value differs from what is saved
   * ("Changed"). Words first: never a dot on its own.
   */
  changed?: React.ReactNode
  className?: string
  disabled?: boolean
  /**
   * A block under the row, aligned to the text column: a gate reason, a
   * consequence. The row's control is described by it.
   */
  footnote?: React.ReactNode
  /** Props for the footnote's `<div>` (`role: "note"`). */
  footnoteProps?: Omit<React.ComponentProps<"div">, "children">
}

/** The block under a row (or a destructive row). */
function Footnote({
  id,
  indent,
  footnoteProps,
  children,
}: {
  id: string
  indent: boolean
  footnoteProps?: Omit<React.ComponentProps<"div">, "children">
  children: React.ReactNode
}) {
  return (
    <div
      {...footnoteProps}
      id={id}
      data-slot="settings-row-footnote"
      className={cn(
        "-mt-1 pb-2 text-caption text-ink-muted",
        indent && "ps-10",
        footnoteProps?.className
      )}
    >
      {children}
    </div>
  )
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
        control?: never
        controlId?: never
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
        control?: never
        controlId?: never
      }
    | {
        /** A switch row: the whole row (the words) toggles. */
        checked: boolean
        onCheckedChange: (checked: boolean) => void
        href?: never
        onClick?: never
        value?: never
        action?: never
        control?: never
        controlId?: never
      }
    | {
        /** A static row: a value, or its own trailing button. */
        value?: React.ReactNode
        action?: React.ReactNode
        href?: never
        onClick?: never
        checked?: never
        onCheckedChange?: never
        control?: never
        controlId?: never
      }
    | {
        /**
         * An inline field row: the label and description sit ABOVE the
         * field (an Input, a Select, a TypedAttributeControl), and the row
         * is not a link or a button, so the field keeps its own semantics.
         */
        control: React.ReactNode
        /**
         * The field's id. The label becomes a `<label for>` it, with the id
         * `${controlId}-label`, and the description gets
         * `${controlId}-description` for the field's `aria-describedby`.
         * Omit when the child names itself (a `Field` with its own label).
         */
        controlId?: string
        href?: never
        onClick?: never
        checked?: never
        onCheckedChange?: never
        value?: never
        action?: never
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

/** The "Changed" word after a label. */
function Changed({ id, children }: { id?: string; children: React.ReactNode }) {
  return (
    <span
      id={id}
      data-slot="settings-row-changed"
      className="shrink-0 text-caption font-medium text-accent-ink"
    >
      {children}
    </span>
  )
}

function SettingsText({
  id,
  label,
  description,
  changed,
}: {
  id: string
  label: React.ReactNode
  description?: React.ReactNode
  changed?: React.ReactNode
}) {
  return (
    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
      {changed ? (
        <span className="flex min-w-0 items-baseline gap-2">
          <span id={`${id}-label`} className="min-w-0 text-body">
            {label}
          </span>
          <Changed id={`${id}-changed`}>{changed}</Changed>
        </span>
      ) : (
        <span id={`${id}-label`} className="text-body">
          {label}
        </span>
      )}
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
  const {
    icon,
    label,
    description,
    changed,
    className,
    disabled,
    footnote,
    footnoteProps,
  } = props
  const id = React.useId()
  const hasFootnote = footnote != null && footnote !== false
  const footnoteId =
    footnoteProps?.id ??
    (props.control !== undefined && props.controlId
      ? `${props.controlId}-footnote`
      : `${id}-footnote`)
  const note = hasFootnote ? (
    <Footnote
      id={footnoteId}
      indent={icon != null}
      footnoteProps={footnoteProps}
    >
      {footnote}
    </Footnote>
  ) : null
  const leading = icon ? <SettingsIcon>{icon}</SettingsIcon> : null
  const text = (
    <SettingsText
      id={id}
      label={label}
      description={description}
      changed={changed}
    />
  )
  // The changed word is part of the row's meaning (words first), so it is
  // announced with the description.
  const describedBy =
    [
      description ? `${id}-desc` : null,
      changed ? `${id}-changed` : null,
      hasFootnote ? footnoteId : null,
    ]
      .filter(Boolean)
      .join(" ") || undefined

  if (props.control !== undefined) {
    // Label and description over the field. Not a hit target of its own:
    // the field is the control, and nothing wraps it in a link or button.
    const { controlId } = props
    const labelClassName =
      "min-w-0 text-ui font-medium text-ink group-data-disabled/field:text-ink-muted"
    return (
      <RowItem data-slot="settings-row" data-kind="field">
        <div
          data-disabled={disabled || undefined}
          className={cn(
            "group/field flex min-h-(--np-settings-row-h) w-full min-w-0 flex-col gap-1.5 py-2 text-body text-ink",
            "data-disabled:text-ink-muted",
            className
          )}
        >
          <div className="flex min-w-0 items-start gap-3">
            {leading}
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="flex min-w-0 items-baseline gap-2">
                {controlId ? (
                  <label
                    id={`${controlId}-label`}
                    htmlFor={controlId}
                    className={labelClassName}
                  >
                    {label}
                  </label>
                ) : (
                  <span id={`${id}-label`} className={labelClassName}>
                    {label}
                  </span>
                )}
                {changed ? (
                  <Changed id={`${id}-changed`}>{changed}</Changed>
                ) : null}
              </span>
              {description ? (
                <span
                  id={controlId ? `${controlId}-description` : `${id}-desc`}
                  className="text-caption text-ink-muted"
                >
                  {description}
                </span>
              ) : null}
            </span>
          </div>
          <div
            data-slot="settings-row-control"
            className={cn("min-w-0", leading && "ps-10")}
          >
            {props.control}
          </div>
        </div>
        {note}
      </RowItem>
    )
  }

  if (props.checked !== undefined && props.onCheckedChange) {
    // A native <label> wraps the row, so tapping the words toggles; the
    // Switch is named and described by them, and keeps its own 44px box.
    return (
      <RowItem data-slot="settings-row" data-kind="switch">
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
        {note}
      </RowItem>
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
      <RowItem data-slot="settings-row" data-kind="link">
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
        {note}
      </RowItem>
    )
  }

  if (props.onClick) {
    return (
      <RowItem data-slot="settings-row" data-kind="button">
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
        {note}
      </RowItem>
    )
  }

  return (
    <RowItem data-slot="settings-row" data-kind="static">
      <div className={cn(rowClassName, className)}>
        {leading}
        {text}
        {props.value ? <Value>{props.value}</Value> : null}
        {props.action}
      </div>
      {note}
    </RowItem>
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
  asRow = false,
  footnote,
  footnoteProps,
  ...props
}: React.ComponentProps<"button"> & {
  /**
   * One row of a group (an `<li>` in a list group, a `<div>` in a
   * `bodyAs="div"` group) instead of the page's closing button.
   */
  asRow?: boolean
  /** A block under the button (a gate reason); the button is described by it. */
  footnote?: React.ReactNode
  /** Props for the footnote's `<div>` (`role: "note"`). */
  footnoteProps?: Omit<React.ComponentProps<"div">, "children">
}) {
  const autoId = React.useId()
  const hasFootnote = footnote != null && footnote !== false
  const footnoteId = footnoteProps?.id ?? `${autoId}-footnote`
  const describedBy =
    [props["aria-describedby"], hasFootnote ? footnoteId : null]
      .filter(Boolean)
      .join(" ") || undefined
  const button = (
    <button
      type={type}
      className={cn(
        "inline-flex min-h-(--np-touch) items-center justify-center rounded-(--np-radius-control) px-4 text-body font-medium text-danger-ink focus-halo hover-fine:hover:bg-danger-tint desk:min-h-(--np-control-h)",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
      aria-describedby={describedBy}
    />
  )
  const note = hasFootnote ? (
    <Footnote id={footnoteId} indent={false} footnoteProps={footnoteProps}>
      {footnote}
    </Footnote>
  ) : null
  if (asRow) {
    return (
      <RowItem
        data-slot="settings-destructive"
        data-kind="destructive"
        className="flex min-h-(--np-settings-row-h) flex-col items-center justify-center py-1 text-center"
      >
        {button}
        {note}
      </RowItem>
    )
  }
  return (
    <div
      data-slot="settings-destructive"
      className={cn(
        "mt-8 flex justify-center",
        hasFootnote && "flex-col items-center text-center"
      )}
    >
      {button}
      {note}
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
