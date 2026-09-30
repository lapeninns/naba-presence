"use client"

import { CircleAlert } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  LODGING_FIELD_GUIDANCE,
  type LodgingEditorNode,
} from "@/lib/locations/forms/lodging-catalogue"
import {
  lodgingErrorsWithin,
  lodgingRecord,
} from "@/lib/locations/forms/lodging-draft"
import { LodgingScalarControl } from "./lodging-scalar-control"
import { LodgingTimeControl } from "./lodging-time-control"

export const lodgingErrorCountText = (count: number) =>
  `${count} ${count === 1 ? "detail" : "details"} to correct`

/** A visible, text-bearing marker for a collapsed group or collection item that holds invalid details. */
export function LodgingErrorMarker({
  id,
  count,
}: {
  readonly id?: string
  readonly count: number
}) {
  if (!count) return null
  return (
    <Badge id={id} variant="destructive" className="shrink-0 gap-1">
      <CircleAlert aria-hidden className="size-3.5" />
      {lodgingErrorCountText(count)}
    </Badge>
  )
}

export function LodgingFieldControl({
  node,
  value,
  original,
  disabled,
  errors,
  fieldPath,
  added = false,
  onChange,
}: {
  readonly node: LodgingEditorNode
  readonly value: unknown
  readonly original: unknown
  readonly disabled: boolean
  readonly errors: Readonly<Record<string, string>>
  readonly fieldPath?: string
  /** Inside a collection item added in this draft: Google has no recorded values to describe. */
  readonly added?: boolean
  readonly onChange: (value: unknown) => void
}) {
  const path = fieldPath ?? node.path
  if (node.kind === "group") {
    const current = lodgingRecord(value),
      before = lodgingRecord(original)
    return (
      <fieldset className="@container/lodging-fields col-span-full flex min-w-0 flex-col gap-3 border-l border-line pl-3">
        <legend className="mb-2 text-ui font-semibold text-ink">
          {node.label}
        </legend>
        <div className="grid min-w-0 gap-4 @[36rem]/lodging-fields:grid-cols-2">
          {node.children.map((child) => (
            <LodgingFieldControl
              key={child.path}
              node={child}
              fieldPath={`${path}.${child.key}`}
              value={current[child.key]}
              original={before[child.key]}
              disabled={disabled}
              errors={errors}
              added={added}
              onChange={(next) => {
                const record = { ...current }
                if (next === undefined) delete record[child.key]
                else record[child.key] = next
                onChange(record)
              }}
            />
          ))}
        </div>
      </fieldset>
    )
  }
  if (node.kind === "array") {
    const rows: unknown[] = Array.isArray(value) ? value : []
    const before: unknown[] = Array.isArray(original) ? original : []
    const supported = value === undefined || Array.isArray(value)
    const hint = LODGING_FIELD_GUIDANCE[node.path]?.hint
    const error = errors[path]
    return (
      <fieldset className="col-span-full flex min-w-0 flex-col gap-3 border-l border-line pl-3">
        <legend className="mb-2 text-ui font-semibold text-ink">
          {node.label}
        </legend>
        {hint ? <p className="text-caption text-ink-muted">{hint}</p> : null}
        {!supported ? (
          <p className="text-ui text-ink-muted">
            Google supplied an unsupported list value. It is preserved; refresh
            or manage this detail in Google.
          </p>
        ) : error ? null : value === undefined ? (
          <p className="text-ui text-ink-muted">
            {added ? "No items yet." : "Google has not recorded this list."}
          </p>
        ) : rows.length === 0 ? (
          <p className="text-ui text-ink-muted">
            {added ? "No items yet." : "The recorded list is empty."}
          </p>
        ) : null}
        {rows.map((row, index) => {
          const itemPath = `${path}.${index}`,
            itemAdded = added || index >= before.length
          const invalid = lodgingErrorsWithin(errors, itemPath).length
          return (
            <div
              key={index}
              className={`flex min-w-0 flex-col gap-3 rounded-(--np-radius-card) border p-3 ${invalid ? "border-danger-ink" : "border-line"}`}
            >
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <p className="text-ui font-semibold text-ink">
                  {node.label} {index + 1}
                </p>
                <LodgingErrorMarker count={invalid} />
              </div>
              <LodgingFieldControl
                node={node.item}
                fieldPath={itemPath}
                value={row}
                original={before[index]}
                disabled={disabled}
                errors={errors}
                added={itemAdded}
                onChange={(next) =>
                  onChange(
                    rows.map((item, position) =>
                      position === index ? next : item
                    )
                  )
                }
              />
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={disabled}
                onClick={() =>
                  onChange(rows.filter((_item, position) => position !== index))
                }
              >
                Remove {node.label.toLowerCase()} {index + 1}
              </Button>
            </div>
          )
        })}
        {error ? (
          <p
            role="alert"
            tabIndex={-1}
            data-lodging-invalid="true"
            className="text-ui text-danger-ink"
          >
            {error}
          </p>
        ) : null}
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={disabled || !supported}
          onClick={() =>
            onChange([...rows, node.item.kind === "group" ? {} : ""])
          }
        >
          Add {node.label.toLowerCase()} item
        </Button>
        {JSON.stringify(value) !== JSON.stringify(original) ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={disabled}
            onClick={() => onChange(original)}
          >
            Reset {node.label.toLowerCase()}
          </Button>
        ) : null}
      </fieldset>
    )
  }
  if (node.kind === "time")
    return (
      <LodgingTimeControl
        node={node}
        value={value}
        original={original}
        disabled={disabled}
        error={errors[path]}
        added={added}
        onChange={onChange}
      />
    )
  return (
    <LodgingScalarControl
      node={node}
      value={value}
      original={original}
      disabled={disabled}
      error={errors[path]}
      added={added}
      onChange={onChange}
    />
  )
}
