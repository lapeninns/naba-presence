"use client"

import { SearchIcon, XCircleIcon } from "lucide-react"
import * as React from "react"

import {
  fieldChromeClassName,
  fieldControlProps,
  useFieldContext,
} from "@/components/ui/field"
import { cn } from "@/lib/utils"

/**
 * Keyboard and autofill hints for the kinds of value the product asks for.
 * Every native attribute passes straight through Input, so spread one of
 * these and override what differs:
 *
 *   <Input {...inputHints.identifier} placeholder="accounts/…" />
 *   <Input {...inputHints.email} autoComplete="username" />
 *
 * On a phone these decide which keyboard opens and whether iOS capitalises
 * or "corrects" what was typed — a place id or `accounts/123` autocorrected
 * into a word is the most common way a coded value arrives broken. Text is
 * already 16px on touch (`text-body`), so focusing never zooms the page.
 */
export const inputHints = {
  /** Resource names, ids, codes: no capitals, no corrections, no spellcheck. */
  identifier: {
    autoCapitalize: "none",
    autoCorrect: "off",
    autoComplete: "off",
    spellCheck: false,
  },
  email: {
    type: "email",
    inputMode: "email",
    autoCapitalize: "none",
    autoCorrect: "off",
    autoComplete: "email",
    spellCheck: false,
  },
  phone: { type: "tel", inputMode: "tel", autoComplete: "tel" },
  url: {
    type: "url",
    inputMode: "url",
    autoCapitalize: "none",
    autoCorrect: "off",
    autoComplete: "url",
    spellCheck: false,
  },
  /** Whole numbers (a count, a postcode PIN of variable length). */
  integer: { inputMode: "numeric", pattern: "[0-9]*" },
  /** Prices and other decimals: the decimal pad on iOS. */
  decimal: { inputMode: "decimal" },
  /** A code sent by SMS or email; see OtpField for fixed-length codes. */
  oneTimeCode: {
    inputMode: "numeric",
    autoComplete: "one-time-code",
    autoCapitalize: "none",
    autoCorrect: "off",
    spellCheck: false,
  },
  /** A search box: the keyboard's return key says "search". */
  search: { enterKeyHint: "search", autoCorrect: "off", spellCheck: false },
} as const satisfies Record<string, React.ComponentProps<"input">>

export type InputProps = React.ComponentProps<"input"> & {
  /**
   * `search` renders the search field (reference `.input-group`): the same
   * field chrome with a leading magnifier and a clear button once there is
   * text. `type="search"` selects it too, so
   * existing search boxes pick up the look without a prop change.
   */
  variant?: "default" | "search"
  /** Called after the clear button empties the field. */
  onClear?: () => void
  /** Extra classes for the inner `<input>` of the search variant. */
  inputClassName?: string
}

function Input({
  className,
  type,
  variant,
  onClear,
  inputClassName,
  ...props
}: InputProps) {
  const field = useFieldContext()
  const isSearch =
    variant === "search" || (variant === undefined && type === "search")

  if (isSearch) {
    return (
      <SearchInput
        className={className}
        inputClassName={inputClassName}
        onClear={onClear}
        {...fieldControlProps(field)}
        {...props}
      />
    )
  }

  return (
    <input
      type={type ?? "text"}
      data-slot="input"
      className={cn(
        fieldChromeClassName,
        "h-(--np-field-h) w-full px-(--np-field-pad-x) py-(--np-field-pad-y)",
        className
      )}
      {...fieldControlProps(field)}
      {...props}
    />
  )
}

/**
 * The search field. The wrapper is the control — `className` sizes
 * it — and the native `<input>` inside is transparent. The whole wrapper is
 * the tap target: a press on its border, padding or icon focuses the input
 * (the input alone is 2px short of the 44px field). Clearing goes through
 * the native value setter plus an `input` event so a controlled `onChange`
 * sees it exactly like typing, and focus returns to the field. The clear
 * button is drawn at 28px; its hit area is 44px on touch (36px on a desk).
 */
function SearchInput({
  className,
  inputClassName,
  onClear,
  ref,
  value,
  defaultValue,
  onChange,
  disabled,
  ...props
}: Omit<InputProps, "variant" | "type">) {
  const inputRef = React.useRef<HTMLInputElement | null>(null)
  const [uncontrolledHasValue, setUncontrolledHasValue] = React.useState(
    defaultValue !== undefined &&
      defaultValue !== null &&
      String(defaultValue).length > 0
  )
  const isControlled = value !== undefined
  const hasValue = isControlled
    ? value !== null && String(value).length > 0
    : uncontrolledHasValue

  const setRefs = (node: HTMLInputElement | null) => {
    inputRef.current = node
    if (typeof ref === "function") ref(node)
    else if (ref) ref.current = node
  }

  const clear = () => {
    const el = inputRef.current
    if (!el) return
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value"
    )?.set
    setter?.call(el, "")
    el.dispatchEvent(new Event("input", { bubbles: true }))
    setUncontrolledHasValue(false)
    el.focus()
    onClear?.()
  }

  return (
    <div
      data-slot="input-search"
      data-disabled={disabled ? "" : undefined}
      onMouseDown={(event) => {
        // Not on the input itself or the clear button: keep the input's
        // focus (no blur and re-focus) and move it there.
        if ((event.target as Element).closest("input, button")) return
        if (disabled) return
        event.preventDefault()
        inputRef.current?.focus()
      }}
      className={cn(
        "group/search relative flex h-(--np-field-h) w-full min-w-0 items-center gap-2 rounded-(--np-radius-field) border border-line-strong bg-(--np-field-bg) pr-1 pl-[11px] text-body text-ink",
        "transition-[border-color,box-shadow] duration-(--np-duration-fast) ease-spring-snappy hover:border-ink-muted",
        "focus-within:border-primary focus-within:shadow-(--np-field-ring)",
        "has-[[aria-invalid=true]]:border-danger-ink has-[[aria-invalid=true]]:shadow-(--np-field-ring-invalid)",
        "data-disabled:cursor-not-allowed data-disabled:bg-surface-alt data-disabled:text-ink-muted",
        className
      )}
    >
      <SearchIcon
        className="size-4 shrink-0 text-ink-muted"
        strokeWidth={1.75}
        aria-hidden
      />
      <input
        ref={setRefs}
        type="search"
        data-slot="input"
        disabled={disabled}
        value={value}
        defaultValue={defaultValue}
        onChange={(event) => {
          if (!isControlled)
            setUncontrolledHasValue(event.target.value.length > 0)
          onChange?.(event)
        }}
        className={cn(
          "h-full min-w-0 flex-1 bg-transparent text-body text-ink outline-none placeholder:text-ink-muted forced-colors:focus-ring-inset",
          "[&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none",
          "disabled:cursor-not-allowed",
          inputClassName
        )}
        {...props}
      />
      {hasValue && !disabled ? (
        <button
          type="button"
          aria-label="Clear search"
          data-slot="input-search-clear"
          onClick={clear}
          className="relative inline-flex size-7 shrink-0 items-center justify-center rounded-(--np-radius-tag) text-ink-muted focus-halo transition-[color,transform] duration-(--np-duration-fast) ease-spring-snappy after:absolute after:-inset-2 after:content-[''] hover:text-ink active:scale-[0.98] desk:after:-inset-1"
        >
          <XCircleIcon className="size-4" strokeWidth={1.75} aria-hidden />
        </button>
      ) : null}
    </div>
  )
}

export { Input, SearchInput }
