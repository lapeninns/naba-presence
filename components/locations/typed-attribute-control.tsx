"use client"

import { useId, useState } from "react"
import { googleAttributeWriteSchema } from "@/lib/domain/google-attributes"

import { AnswerChoice, type AnswerOption } from "@/components/locations/profile/answer-choice"
import { ChangedMark } from "@/components/locations/profile/section-card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { StatusPill } from "@/components/ui/status-pill"
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
 */
type Answer = "yes" | "no" | "unset"

function answerOptions(unsetLocked: boolean): AnswerOption<Answer>[] {
  return [
    { value: "yes", label: "Yes" },
    { value: "no", label: "No" },
    { value: "unset", label: "Not set", disabled: unsetLocked },
  ]
}

export function TypedAttributeControl({
  metadata,
  attribute,
  disabled,
  onChange,
  onClear,
  changed = false,
}: {
  metadata: AttributeMetadata
  attribute: GoogleAttribute | undefined
  disabled: boolean
  onChange: (next: GoogleAttribute) => void
  /** Remove the value, so Google holds no answer for this attribute. */
  onClear?: (name: string) => void
  /** The draft differs from Google for this attribute. */
  changed?: boolean
}) {
  const labelId = useId()
  const [newUri, setNewUri] = useState("")
  const name = metadata.parent
  const label = metadata.displayName ?? name
  const kind = metadata.deprecated ? "readonly" : attributeControlKind(metadata.valueType)
  const enumOptions = enumOptionsFor(metadata)

  const labelBlock = (
    <span className="flex min-w-0 flex-wrap items-center gap-2">
      <span id={labelId} className="text-ui font-semibold text-ink">
        {label}
      </span>
      {changed ? <ChangedMark /> : null}
    </span>
  )

  const rowClass =
    "flex w-full flex-wrap items-center justify-between gap-x-3 gap-y-2"

  if (!metadata.deprecated && metadata.valueType === "REPEATED_ENUM" && enumOptions.length > 0) {
    const selected = attribute?.repeatedEnumValue?.setValues ?? []
    const unselected = attribute?.repeatedEnumValue?.unsetValues ?? []
    return <fieldset disabled={disabled} className="w-full min-w-0 space-y-3">
      <legend className="mb-2">{labelBlock}</legend>
      {enumOptions.map((option) => {
        const answer: Answer = selected.includes(option.value) ? "yes" : unselected.includes(option.value) ? "no" : "unset"
        return <div key={option.value} className={rowClass}>
          <span className="min-w-0 text-ui text-ink">{option.label}</span>
          <AnswerChoice
            aria-label={`${label}: ${option.label}`}
            value={answer}
            disabled={disabled}
            // Taking the final answer away removes the attribute (onClear).
            options={answerOptions(false)}
            onValueChange={(next) => {
              const setValues = selected.filter((value) => value !== option.value)
              const unsetValues = unselected.filter((value) => value !== option.value)
              if (next === "yes") setValues.push(option.value)
              if (next === "no") unsetValues.push(option.value)
              if (!setValues.length && !unsetValues.length && onClear) onClear(name)
              else onChange({ name, repeatedEnumValue: { setValues, unsetValues } })
            }}
          />
        </div>
      })}
      {(selected.length > 0 || unselected.length > 0) && onClear && !disabled ? <Button type="button" variant="ghost" size="sm" onClick={() => onClear(name)} aria-label={`Clear ${label}`}>Clear all answers</Button> : null}
    </fieldset>
  }

  if (kind === "bool") {
    const value = attribute?.values?.[0]
    const answer: Answer = value === true ? "yes" : value === false ? "no" : "unset"
    return (
      <div className={rowClass}>
        {labelBlock}
        <AnswerChoice
          aria-labelledby={labelId}
          value={answer}
          disabled={disabled}
          // "Not set" takes the value back off Google, so it is only a
          // choice where the caller can clear the attribute.
          options={answerOptions(!onClear)}
          onValueChange={(next) => {
            if (next === "unset") onClear?.(name)
            else onChange({ name, values: [next === "yes"] })
          }}
        />
      </div>
    )
  }
  if (kind === "enum" && enumOptions.length > 0) {
    const value = attribute?.values?.[0]
    const current = typeof value === "string" ? value : ""
    return (
      <div className={rowClass}>
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
          <SelectTrigger aria-label={label} className="w-full sm:w-70">
            <SelectValue placeholder="Not set" />
          </SelectTrigger>
          <SelectContent>
            {enumOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        </span>
      </div>
    )
  }
  if (kind === "url") {
    if (metadata.repeatable || (attribute?.uriValues?.length ?? 0) > 1) {
      const uris = attribute?.uriValues ?? []
      const canAdd = metadata.repeatable === true && googleAttributeWriteSchema.safeParse({ name, uriValues: [{ uri: newUri }] }).success
      return <fieldset disabled={disabled} className="w-full space-y-3">
        <legend className="mb-2">{labelBlock}</legend>
        {uris.map((entry, index) => <div key={index} className="flex items-center gap-2">
          <Input type="url" inputMode="url" value={entry.uri} aria-label={`${label} URL ${index + 1}`} disabled={disabled} onChange={(event) => onChange({ name, uriValues: uris.map((item, position) => position === index ? { ...item, uri: event.target.value } : item) })} />
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
      </fieldset>
    }
    const uri = attribute?.uriValues?.[0]?.uri ?? ""
    return (
      <div className={rowClass}>
        {labelBlock}
        <Input
          type="url"
          value={uri}
          disabled={disabled}
          inputMode="url"
          placeholder="https://…"
          aria-label={label}
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
      </div>
    )
  }
  return (
    <div className={rowClass}>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-ui font-semibold text-ink">{label}</span>
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
