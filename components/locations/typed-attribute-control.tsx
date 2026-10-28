"use client"

import { useId, useState, type ReactNode } from "react"
import { googleAttributeWriteSchema } from "@/lib/domain/google-attributes"

import { ChangedMark } from "@/components/locations/profile/section-card"
import { Button } from "@/components/ui/button"
import { Fieldset, FieldsetLegend } from "@/components/ui/fieldset"
import { Input } from "@/components/ui/input"
import {
  SegmentedControl,
  SegmentedControlItem,
} from "@/components/ui/segmented-control"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { StatusPill } from "@/components/ui/status-pill"
import { TriState } from "@/components/ui/tri-state"
import type {
  AttributeMetadata,
  GoogleAttribute,
} from "@/lib/api/location-business-information"
import { attributeControlKind } from "@/lib/locations/console-labels"
import { enumOptionsFor } from "@/lib/locations/google-values"

/**
 * One typed Google attribute as a row (reference `.attr-row`): the label at
 * the leading edge, the control at the trailing edge, wrapping under each
 * other on a narrow row. Only the well-understood value types get an editor;
 * anything else is read-only with the pressure-valve note, never a JSON
 * escape hatch.
 *
 * A BOOL attribute, and each option of a REPEATED_ENUM one, is a Yes / No /
 * Not set segmented choice. "Not set" is a real third state on Google — the
 * attribute simply isn't there — so it is shown as an answer, and choosing
 * it (when `onClear` is given) takes the value back off Google.
 *
 * `layout`: `stack` (default) is the original drawing. `row` is the settings
 * row look — the label in body text (with an optional muted `description`)
 * at the leading edge, the control at the trailing edge on one line at
 * least a settings row tall (`--np-settings-row-h`: 56px touch, 44px desk),
 * wrapping under the label when the row is narrow (CSS only:
 * flex-wrap plus the controls' own `sm:` widths). Ids, labels and every
 * value path are the same in both layouts.
 */
type Answer = boolean | null

/**
 * The id the profile's validation summary links to for one attribute: the
 * URL field itself, or the row holding the choice (the summary then moves
 * focus to its first control).
 */
export function attributeFieldId(name: string): string {
  return `attribute-${name.replace(/[^A-Za-z0-9_-]/g, "-")}`
}

/** The answer an attribute value holds: `null` is "Not set". */
function answerOf(value: unknown): Answer {
  return value === true ? true : value === false ? false : null
}

export function TypedAttributeControl({
  metadata,
  attribute,
  disabled,
  onChange,
  onClear,
  changed = false,
  layout = "stack",
  description,
  error,
}: {
  metadata: AttributeMetadata
  attribute: GoogleAttribute | undefined
  disabled: boolean
  onChange: (next: GoogleAttribute) => void
  /** Remove the value, so Google holds no answer for this attribute. */
  onClear?: (name: string) => void
  /** The draft differs from Google for this attribute. */
  changed?: boolean
  /** `row`: the settings-row drawing (see above). Default `stack`. */
  layout?: "stack" | "row"
  /** A muted line under the label. Drawn in the `row` layout only. */
  description?: ReactNode
  /**
   * What Google won't accept about this value, said under the control and
   * tied to it. The profile passes it once Review has been tried.
   */
  error?: string
}) {
  const labelId = useId()
  const [newUri, setNewUri] = useState("")
  const name = metadata.parent
  const label = metadata.displayName ?? name
  const kind = metadata.deprecated ? "readonly" : attributeControlKind(metadata.valueType)
  const enumOptions = enumOptionsFor(metadata)

  const row = layout === "row"
  const descriptionId = useId()
  // The muted line describes the control (aria-describedby); it is never
  // part of the label or legend, so the accessible name stays the label.
  const descriptionRef = row && description ? descriptionId : undefined
  const fieldId = attributeFieldId(name)
  const errorId = `${fieldId}-error`
  // Merged by hand: an explicit aria-describedby on a control would replace
  // any wiring a wrapping Field adds.
  const describedBy =
    [descriptionRef, error ? errorId : null].filter(Boolean).join(" ") ||
    undefined
  const errorLine = error ? (
    <p id={errorId} className="basis-full text-caption text-danger-ink">
      {error}
    </p>
  ) : null
  const descriptionLine = descriptionRef ? (
    <span id={descriptionId} className="text-caption text-ink-muted">
      {description}
    </span>
  ) : null
  const labelLine = (
    <span className="flex min-w-0 flex-wrap items-center gap-2">
      <span
        id={labelId}
        className={row ? "text-body text-ink" : "text-ui font-semibold text-ink"}
      >
        {label}
      </span>
      {changed ? <ChangedMark /> : null}
    </span>
  )
  const labelBlock = row ? (
    <span className="flex min-w-0 grow basis-48 flex-col gap-0.5">
      {labelLine}
      {descriptionLine}
    </span>
  ) : (
    labelLine
  )

  const rowClass = row
    ? "flex min-h-(--np-settings-row-h) w-full flex-wrap items-center justify-between gap-x-4 gap-y-2 py-1"
    : "flex w-full flex-wrap items-center justify-between gap-x-3 gap-y-2"

  if (!metadata.deprecated && metadata.valueType === "REPEATED_ENUM" && enumOptions.length > 0) {
    const selected = attribute?.repeatedEnumValue?.setValues ?? []
    const unselected = attribute?.repeatedEnumValue?.unsetValues ?? []
    return <Fieldset id={fieldId} disabled={disabled} className="w-full" aria-describedby={describedBy}>
      <FieldsetLegend className="mb-2">{labelLine}</FieldsetLegend>
      {descriptionLine}
      {enumOptions.map((option) => {
        const answer: Answer = selected.includes(option.value) ? true : unselected.includes(option.value) ? false : null
        return <div key={option.value} className={rowClass}>
          <span className="min-w-0 text-ui text-ink">{option.label}</span>
          {/* Taking the final answer away removes the attribute (onClear). */}
          <TriState
            aria-label={`${label}: ${option.label}`}
            className="w-full sm:w-auto"
            value={answer}
            disabled={disabled}
            onValueChange={(next) => {
              const setValues = selected.filter((value) => value !== option.value)
              const unsetValues = unselected.filter((value) => value !== option.value)
              if (next === true) setValues.push(option.value)
              if (next === false) unsetValues.push(option.value)
              if (!setValues.length && !unsetValues.length && onClear) onClear(name)
              else onChange({ name, repeatedEnumValue: { setValues, unsetValues } })
            }}
          />
        </div>
      })}
      {(selected.length > 0 || unselected.length > 0) && onClear && !disabled ? <Button type="button" variant="ghost" size="sm" className="self-start" onClick={() => onClear(name)} aria-label={`Clear ${label}`}>Clear all answers</Button> : null}
      {errorLine}
    </Fieldset>
  }

  if (kind === "bool") {
    const answer = answerOf(attribute?.values?.[0])
    return (
      <div id={fieldId} className={rowClass}>
        {labelBlock}
        {onClear ? (
          <TriState
            aria-labelledby={labelId}
            aria-describedby={describedBy}
            className="w-full sm:w-auto"
            value={answer}
            disabled={disabled}
            onValueChange={(next) => {
              if (next === null) onClear(name)
              else onChange({ name, values: [next] })
            }}
          />
        ) : (
          // "Not set" takes the value back off Google, so without `onClear`
          // it is shown but not a choice. TriState has no per-answer
          // disabled state, so this is the same segmented radio track it is
          // built from, with the third segment locked.
          <SegmentedControl
            semantics="radio"
            aria-labelledby={labelId}
            aria-describedby={describedBy}
            className="w-full sm:w-auto"
            value={answer === null ? "unset" : String(answer)}
            disabled={disabled}
            onValueChange={(next) => {
              if (next !== "unset") onChange({ name, values: [next === "true"] })
            }}
          >
            <SegmentedControlItem value="true">Yes</SegmentedControlItem>
            <SegmentedControlItem value="false">No</SegmentedControlItem>
            <SegmentedControlItem
              value="unset"
              disabled
              className="data-checked:data-disabled:opacity-100"
            >
              Not set
            </SegmentedControlItem>
          </SegmentedControl>
        )}
        {errorLine}
      </div>
    )
  }
  if (kind === "enum" && enumOptions.length > 0) {
    const value = attribute?.values?.[0]
    const current = typeof value === "string" ? value : ""
    return (
      <div id={fieldId} className={rowClass}>
        {labelBlock}
        <span className="flex w-full items-center gap-2 sm:w-auto">
        {current && onClear && !disabled ? (
          <Button type="button" variant="ghost" size="sm" aria-label={`Clear ${label}`} onClick={() => onClear(name)}>Clear</Button>
        ) : null}
        <Select
          value={current}
          onValueChange={(value: string | null) => {
            if (value !== null) onChange({ name, values: [value] })
          }}
          disabled={disabled}
        >
          <SelectTrigger aria-label={label} aria-describedby={describedBy} aria-invalid={error ? true : undefined} className="w-full sm:w-70">
            <SelectValue placeholder="Not set" />
          </SelectTrigger>
          <SelectContent title={label}>
            {enumOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        </span>
        {errorLine}
      </div>
    )
  }
  if (kind === "url") {
    if (metadata.repeatable || (attribute?.uriValues?.length ?? 0) > 1) {
      const uris = attribute?.uriValues ?? []
      const canAdd = metadata.repeatable === true && googleAttributeWriteSchema.safeParse({ name, uriValues: [{ uri: newUri }] }).success
      // The summary's link lands on the first link; each link Google can't
      // take is marked and described by the one message under the list.
      const invalidAt = (uri: string) => Boolean(error) && !googleAttributeWriteSchema.safeParse({ name, uriValues: [{ uri }] }).success
      const anyInvalid = uris.some((entry) => invalidAt(entry.uri))
      return <Fieldset disabled={disabled} className="w-full" aria-describedby={anyInvalid ? descriptionRef : describedBy}>
        <FieldsetLegend className="mb-2">{labelLine}</FieldsetLegend>
        {descriptionLine}
        {uris.map((entry, index) => <div key={index} className="flex items-center gap-2">
          <Input id={index === 0 ? fieldId : undefined} type="url" inputMode="url" value={entry.uri} aria-label={`${label} URL ${index + 1}`}
            aria-invalid={invalidAt(entry.uri) ? true : undefined} aria-describedby={invalidAt(entry.uri) ? errorId : undefined}
            disabled={disabled} onChange={(event) => onChange({ name, uriValues: uris.map((item, position) => position === index ? { ...item, uri: event.target.value } : item) })} />
          <Button type="button" variant="ghost" size="sm" disabled={disabled} aria-label={`Remove ${label} URL ${index + 1}`} onClick={() => {
            const remaining = uris.filter((_, position) => position !== index)
            if (!remaining.length && onClear) onClear(name)
            else onChange({ name, uriValues: remaining })
          }}>Remove</Button>
        </div>)}
        {metadata.repeatable ? <div className="flex items-center gap-2">
          <Input type="url" inputMode="url" placeholder="https://…" value={newUri} aria-label={`New ${label} URL`} disabled={disabled} onChange={(event) => setNewUri(event.target.value)} />
          <Button type="button" variant="outline" size="sm" disabled={disabled || !canAdd} onClick={() => {
            onChange({ name, uriValues: [...uris, { uri: newUri }] })
            setNewUri("")
          }}>Add URL</Button>
        </div> : null}
        {errorLine}
      </Fieldset>
    }
    const uri = attribute?.uriValues?.[0]?.uri ?? ""
    return (
      <div className={rowClass}>
        {labelBlock}
        <Input
          id={fieldId}
          type="url"
          value={uri}
          disabled={disabled}
          inputMode="url"
          placeholder="https://…"
          aria-label={label}
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          className="w-full sm:w-70"
          onChange={(event) => {
            if (!event.target.value && onClear) {
              onClear(name)
              return
            }
            onChange({
              name,
              uriValues: event.target.value
                ? [{ ...attribute?.uriValues?.[0], uri: event.target.value }, ...(attribute?.uriValues?.slice(1) ?? [])]
                : [],
            })
          }}
        />
        {errorLine}
      </div>
    )
  }
  return (
    <div className={rowClass}>
      <span className={row ? "flex min-w-0 grow basis-48 flex-col gap-0.5" : "flex min-w-0 flex-col gap-0.5"}>
        <span className={row ? "text-body text-ink" : "text-ui font-semibold text-ink"}>{label}</span>
        {row && description ? <span className="text-caption text-ink-muted">{description}</span> : null}
        <span className="text-caption text-ink-muted">
          {metadata.deprecated ? "Google no longer accepts changes to this attribute." : "Not editable here yet. Change it in Google directly."}
        </span>
      </span>
      <StatusPill tone="outline" plain>
        Read only
      </StatusPill>
    </div>
  )
}
