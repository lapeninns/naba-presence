"use client"

import * as React from "react"

import {
  Combobox,
  ComboboxContent,
  ComboboxInput,
  ComboboxItem,
} from "@/components/ui/combobox"
import { codeForText, type CodeOption } from "@/lib/setup/onboarding-codes"

/**
 * A coded value (country, language tag, currency) picked by name.
 *
 * The value in and out is the bare code, so the payload is exactly what an
 * operator used to type into the text field this replaces. The list shows
 * "United Kingdom · GB"; typing filters on the name and the code alike.
 *
 * It can still be typed into like that text field: a whole code typed in
 * ("cy", "gb", "en-GB") is committed on leaving the field, without picking
 * it from the list (see `commitTyped`).
 *
 * Callers pass `options` through `withCurrent` so a saved code outside the
 * list stays selectable and shown, never dropped or rewritten. `typed` lets
 * a list accept a well-formed code that is not in it (a rarer language tag,
 * a user-assigned country), offered as one extra option, so the picker is
 * never stricter than the server schema.
 *
 * Inside a `Field` the input takes the Field's label, description and error
 * like any other text control.
 */
function CodeCombobox({
  value,
  onValueChange,
  options,
  typed,
  label,
  title,
  disabled,
  ...inputProps
}: {
  value: string
  onValueChange: (code: string) => void
  options: readonly CodeOption[]
  /** A code for typed text outside `options`, or null when it is not one. */
  typed?: (text: string) => string | null
  /** A plain name for a code `typed` accepted. Defaults to the code. */
  label?: (code: string) => string
  /** Heading of the phone's action sheet, e.g. "Country". */
  title: string
  disabled?: boolean
} & Omit<
  React.ComponentProps<typeof ComboboxInput>,
  "value" | "defaultValue" | "onChange" | "disabled"
>) {
  // What the person is typing, or null when they are not: the field then
  // shows the chosen code by name. Controlled here rather than left to Base
  // UI so that a commit on blur (below) can read what was typed.
  const [text, setText] = React.useState<string | null>(null)
  const query = text ?? ""
  const extraCode = typed?.(query) ?? null
  const all: readonly CodeOption[] = extraCode
    ? [...options, { code: extraCode, label: label?.(extraCode) ?? extraCode }]
    : options
  const labels = new Map(all.map((option) => [option.code, option.label]))
  const toLabel = (code: string) => {
    const name = labels.get(code)
    return name && name !== code ? `${name} · ${code}` : code
  }
  const needle = query.trim().toLowerCase()
  // The field holds the chosen option's name while closed; opening the list
  // then shows every option rather than filtering down to that one.
  const showAll =
    !needle || (value !== "" && needle === toLabel(value).toLowerCase())
  const items = all
    .map((option) => option.code)
    .filter((code) => showAll || toLabel(code).toLowerCase().includes(needle))

  // A whole code typed in ("cy", "gb", "en-GB") commits when the person
  // leaves the field or the list closes, as the old text field's value did,
  // without having to pick it from the list. Not on every keystroke: "fr"
  // on the way to typing "France" is French, and committing it would set
  // off the category search for a language nobody chose.
  const commitTyped = () => {
    if (text === null) return
    const code = codeForText(text, options, typed)
    if (code && code !== value) onValueChange(code)
  }

  return (
    <Combobox<string>
      items={items}
      filter={null}
      // Long lists, filtered here: always a search field, so the keyboard
      // never flips on and off as the matches drop below eight.
      search="always"
      value={value || null}
      disabled={disabled}
      onValueChange={(code) => {
        if (code) onValueChange(code)
      }}
      inputValue={text ?? (value ? toLabel(value) : "")}
      onInputValueChange={(next, details) => {
        // Only typing edits the text (emptying the field reports as
        // "input-clear"). A pick or leaving the field goes back to showing
        // the chosen value by name.
        if (details.reason !== "input-change" && details.reason !== "input-clear") {
          setText(null)
          return
        }
        setText(next)
      }}
      onOpenChange={(open, details) => {
        if (open) return
        // Escape is "never mind"; a pick commits through onValueChange.
        if (details.reason !== "escape-key" && details.reason !== "item-press")
          commitTyped()
        setText(null)
      }}
      itemToStringLabel={toLabel}
    >
      <ComboboxInput
        {...inputProps}
        onBlur={(event) => {
          commitTyped()
          setText(null)
          inputProps.onBlur?.(event)
        }}
      />
      <ComboboxContent title={title}>
        {items.map((code) => (
          <ComboboxItem key={code} value={code}>
            {code === extraCode ? `Use “${code}”` : toLabel(code)}
          </ComboboxItem>
        ))}
      </ComboboxContent>
    </Combobox>
  )
}

export { CodeCombobox }
