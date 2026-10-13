"use client"

import { CheckIcon, ChevronRightIcon } from "lucide-react"
import * as React from "react"

import { radioClassName } from "@/components/ui/radio-group"
import { cn } from "@/lib/utils"

/**
 * A choice in a sheet or menu (Notion Mail's reminder, schedule and
 * category rows): a `text-body` label over an optional `text-caption`
 * sub-label carrying the resolved value ("Tue 14 Oct, 09:00 · venue
 * time"), an optional 20px leading icon, and one trailing indicator:
 *
 *   check     ✓ on the current choice (single choice, as in a menu)
 *   radio     a ring that fills when selected (single choice)
 *   checkbox  a box that ticks (several at once)
 *   chevron   opens something (a pushed page, a picker)
 *   none      a plain action
 *
 * The whole row is one `<button>`, at least 44px tall on touch, so the
 * label is the hit area and Enter and Space choose it. Its role follows the
 * indicator: `radio`/`checkbox` with `aria-checked` (or the menu forms,
 * `menuitemradio`/`menuitemcheckbox`, with `menu`), and a plain button for
 * `chevron`/`none`. Put single-choice rows in an `OptionRowGroup` so they
 * have their radiogroup, and arrow keys move between them.
 *
 * A destructive row (`tone="destructive"`) uses the danger ink and goes
 * last, after an `OptionSeparator`.
 *
 *   <OptionRowGroup label="Remind me">
 *     <OptionRow indicator="radio" selected={v === "tomorrow"}
 *       label="Tomorrow" description="Wed 15 Oct, 09:00 · venue time"
 *       onClick={() => choose("tomorrow")} />
 *   </OptionRowGroup>
 */

export type OptionIndicator =
  "check" | "radio" | "checkbox" | "chevron" | "none"

/** Whether the rows sit in a sheet (radio/checkbox) or a menu (menuitem*). */
const OptionContext = React.createContext<{ menu: boolean }>({ menu: false })

function roleFor(indicator: OptionIndicator, menu: boolean) {
  if (indicator === "checkbox") return menu ? "menuitemcheckbox" : "checkbox"
  if (indicator === "radio" || indicator === "check") {
    return menu ? "menuitemradio" : "radio"
  }
  return menu ? "menuitem" : undefined
}

export const optionRowClassName = cn(
  "group/option relative flex min-h-(--np-touch) w-full cursor-pointer items-center gap-3 rounded-(--np-radius-field) px-3 py-2 text-left text-body text-ink focus-halo outline-none select-none",
  "transition-[background-color] duration-(--np-duration-fast) ease-standard",
  "active:bg-fill hover-fine:hover:bg-fill",
  "disabled:cursor-not-allowed disabled:text-ink-muted aria-disabled:cursor-not-allowed aria-disabled:text-ink-muted",
  "data-[tone=destructive]:text-danger-ink",
  "[&_svg]:pointer-events-none [&_svg]:shrink-0"
)

export type OptionRowProps = Omit<
  React.ComponentProps<"button">,
  "children" | "role"
> & {
  label: React.ReactNode
  /** The sub-label: the resolved value or a short explanation. */
  description?: React.ReactNode
  /** A 20px leading icon (decorative; the label names the row). */
  icon?: React.ReactNode
  indicator?: OptionIndicator
  /** The row's checked state, for `check`, `radio` and `checkbox`. */
  selected?: boolean
  tone?: "default" | "destructive"
}

function OptionRow({
  label,
  description,
  icon,
  indicator = "none",
  selected = false,
  tone = "default",
  className,
  type = "button",
  ...props
}: OptionRowProps) {
  const { menu } = React.useContext(OptionContext)
  const id = React.useId()
  const role = roleFor(indicator, menu)
  const checkable =
    indicator === "check" || indicator === "radio" || indicator === "checkbox"

  return (
    <button
      type={type}
      data-slot="option-row"
      data-indicator={indicator}
      data-tone={tone}
      data-selected={checkable && selected ? "" : undefined}
      role={role}
      aria-checked={checkable ? selected : undefined}
      aria-labelledby={`${id}-label`}
      aria-describedby={description ? `${id}-desc` : undefined}
      className={cn(optionRowClassName, className)}
      {...props}
    >
      {icon ? (
        <span
          aria-hidden="true"
          data-slot="option-row-icon"
          className="flex size-5 shrink-0 items-center justify-center text-ink-secondary group-data-[tone=destructive]/option:text-danger-ink [&_svg]:size-5 [&_svg]:[stroke-width:1.5]"
        >
          {icon}
        </span>
      ) : null}
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
      <OptionIndicatorMark indicator={indicator} selected={selected} />
    </button>
  )
}

/** The trailing mark. Decorative: the role and `aria-checked` carry state. */
function OptionIndicatorMark({
  indicator,
  selected,
}: {
  indicator: OptionIndicator
  selected: boolean
}) {
  if (indicator === "none") return null
  if (indicator === "chevron") {
    return (
      <ChevronRightIcon
        aria-hidden="true"
        data-slot="option-row-chevron"
        className="size-5 text-ink-muted"
      />
    )
  }
  if (indicator === "check") {
    return (
      <span
        aria-hidden="true"
        data-slot="option-row-check"
        className="flex size-5 shrink-0 items-center justify-center text-accent-ink"
      >
        {selected ? <CheckIcon className="size-5" strokeWidth={2} /> : null}
      </span>
    )
  }
  if (indicator === "radio") {
    return (
      <span
        aria-hidden="true"
        data-slot="option-row-radio"
        data-checked={selected ? "" : undefined}
        className={radioClassName}
      />
    )
  }
  return (
    <span
      aria-hidden="true"
      data-slot="option-row-checkbox"
      data-checked={selected ? "" : undefined}
      className={cn(
        "flex size-(--np-selection-box) shrink-0 items-center justify-center rounded-(--np-radius-tag) border-2 border-line-strong bg-(--np-field-bg) text-primary-foreground",
        "data-checked:border-primary data-checked:bg-primary"
      )}
    >
      {selected ? <CheckIcon className="size-3" strokeWidth={3} /> : null}
    </span>
  )
}

const ROW_SELECTOR = '[data-slot="option-row"]:not(:disabled)'

/**
 * A run of option rows. `type="single"` (the default) is a `radiogroup`,
 * `multiple` a plain group; `menu` switches the rows to the menuitem roles
 * for use inside a `role="menu"`. Arrow keys, Home and End move focus
 * between the rows; Enter and Space choose (they are buttons).
 */
function OptionRowGroup({
  label,
  type = "single",
  menu = false,
  className,
  children,
  onKeyDown,
  ...props
}: Omit<React.ComponentProps<"div">, "role"> & {
  /** The group's accessible name, when no visible heading names it. */
  label?: string
  type?: "single" | "multiple"
  menu?: boolean
}) {
  const value = React.useMemo(() => ({ menu }), [menu])
  return (
    <OptionContext.Provider value={value}>
      <div
        data-slot="option-row-group"
        role={menu ? "group" : type === "single" ? "radiogroup" : "group"}
        aria-label={label}
        className={cn("flex flex-col gap-1", className)}
        onKeyDown={(event) => {
          onKeyDown?.(event)
          if (event.defaultPrevented) return
          const keys = ["ArrowDown", "ArrowUp", "Home", "End"]
          if (!keys.includes(event.key)) return
          const rows = Array.from(
            event.currentTarget.querySelectorAll<HTMLElement>(ROW_SELECTOR)
          )
          const at = rows.indexOf(document.activeElement as HTMLElement)
          if (at === -1 || rows.length === 0) return
          event.preventDefault()
          const next =
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? rows.length - 1
                : (at + (event.key === "ArrowDown" ? 1 : -1) + rows.length) %
                  rows.length
          rows[next]?.focus()
        }}
        {...props}
      >
        {children}
      </div>
    </OptionContext.Provider>
  )
}

/** The hairline before a destructive row (or between groups of rows). */
function OptionSeparator({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      role="separator"
      data-slot="option-separator"
      className={cn("mx-3 my-1 h-px shrink-0 bg-line", className)}
      {...props}
    />
  )
}

export { OptionRow, OptionRowGroup, OptionSeparator }
