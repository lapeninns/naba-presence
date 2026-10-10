"use client"

import { useMutation } from "@tanstack/react-query"
import { Plus, Trash2 } from "lucide-react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useState } from "react"

import { PageHeader } from "@/components/app-shell/page-frame"
import { Button, buttonVariants } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
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
import { ApiClientError } from "@/lib/api/client"
import { previewBulkChange } from "@/lib/api/bulk-listings"
import {
  BULK_MAX_TARGETS,
  bulkOperationInputSchema,
  type BulkOperation,
} from "@/lib/domain/bulk-merge"
import { GOOGLE_PLACE_ACTION_TYPES } from "@/lib/domain/google-contract"
import { actionTypeLabel } from "@/lib/editors/booking-presentation"
import { useLocationDirectory } from "@/lib/queries/use-locations"
import { useSessionRole } from "@/lib/queries/use-session"

const DAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
]
const OPERATIONS: Array<{ value: BulkOperation; label: string }> = [
  { value: "special_hours", label: "Special hours" },
  { value: "regular_hours", label: "Opening hours" },
  { value: "more_hours", label: "Service hours" },
  { value: "attributes", label: "Attributes" },
  { value: "place_action", label: "Action link" },
]
type SpecialRow = {
  date: string
  action: "open" | "closed" | "clear"
  opensAt: string
  closesAt: string
}
type DayRow = { isClosed: boolean; opensAt: string; closesAt: string }

/**
 * Composes one bulk change for the listings selected on the board. The ids
 * come from the selection and are frozen by the preview; the server reads
 * each listing's current Google value before anything can be approved.
 */
export function BulkCompose() {
  const router = useRouter()
  const ids = [
    ...new Set(
      (useSearchParams().get("ids") ?? "")
        .split(",")
        .filter((id) => /^[0-9a-f-]{36}$/.test(id))
    ),
  ].slice(0, BULK_MAX_TARGETS)
  const directory = useLocationDirectory(useSessionRole())
  const names = new Map(
    (directory.data ?? []).map((entry) => [entry.id, entry.name])
  )
  const [operation, setOperation] = useState<BulkOperation>("special_hours")
  const [special, setSpecial] = useState<SpecialRow[]>([
    { date: "", action: "closed", opensAt: "10:00", closesAt: "16:00" },
  ])
  const [days, setDays] = useState<DayRow[]>(
    DAYS.map((_, index) => ({
      isClosed: index === 0,
      opensAt: "09:00",
      closesAt: "17:00",
    }))
  )
  const [hoursTypeId, setHoursTypeId] = useState("")
  const [serviceDays, setServiceDays] = useState<Array<DayRow>>(
    DAYS.map(() => ({ isClosed: true, opensAt: "12:00", closesAt: "15:00" }))
  )
  const [attributes, setAttributes] = useState([
    { name: "attributes/", value: "true" },
  ])
  const [link, setLink] = useState({
    action: "upsert" as "upsert" | "delete",
    placeActionType: "DINING_RESERVATION",
    uri: "",
    isPreferred: false,
  })
  const [failure, setFailure] = useState<string | null>(null)

  const raw =
    operation === "special_hours"
      ? {
          operation,
          dates: special.map((row) =>
            row.action === "open"
              ? {
                  action: "open",
                  date: row.date,
                  opensAt: row.opensAt,
                  closesAt: row.closesAt,
                }
              : { action: row.action, date: row.date }
          ),
        }
      : operation === "regular_hours"
        ? {
            operation,
            days: days.map((day, dayOfWeek) => ({
              dayOfWeek,
              isClosed: day.isClosed,
              periods: day.isClosed
                ? []
                : [{ opensAt: day.opensAt, closesAt: day.closesAt }],
            })),
          }
        : operation === "more_hours"
          ? {
              operation,
              hoursTypeId: hoursTypeId.trim(),
              periods: serviceDays.flatMap((day, dayOfWeek) =>
                day.isClosed
                  ? []
                  : [
                      {
                        dayOfWeek,
                        opensAt: day.opensAt,
                        closesAt: day.closesAt,
                      },
                    ]
              ),
            }
          : operation === "attributes"
            ? {
                operation,
                changes: attributes.map((row) => ({
                  name: row.name.trim(),
                  values: [row.value === "true"],
                })),
              }
            : { operation, ...link }
  const parsed = bulkOperationInputSchema.safeParse(raw)
  const problem =
    ids.length === 0
      ? "Select listings on the Listings board first."
      : parsed.success
        ? null
        : (parsed.error.issues[0]?.message ?? "Check the change.")
  const preview = useMutation({
    mutationFn: () =>
      previewBulkChange({
        locationIds: ids,
        input: bulkOperationInputSchema.parse(raw),
      }),
    onSuccess: (op) => router.push(`/listings/bulk/${op.id}`),
    onError: (error) =>
      setFailure(
        error instanceof ApiClientError
          ? error.message
          : "The preview could not be prepared. Try again."
      ),
  })

  return (
    <>
      <PageHeader
        title="Bulk change"
        description={`One reviewed change across ${ids.length} selected ${ids.length === 1 ? "listing" : "listings"}. Nothing is sent until the preview is approved and started.`}
        actions={
          <Link
            href="/listings"
            className={buttonVariants({ variant: "secondary" })}
          >
            Back to listings
          </Link>
        }
      />
      <section aria-labelledby="bulk-targets" className="flex flex-col gap-2">
        <h2 id="bulk-targets" className="text-title font-semibold text-ink">
          Selected listings
        </h2>
        <p className="text-ui break-words text-ink-secondary">
          {ids.map((id) => names.get(id) ?? "Listing").join(", ") || "None"}
        </p>
      </section>
      <section
        aria-labelledby="bulk-change"
        className="flex flex-col gap-4 rounded-(--np-radius-card) border border-line bg-surface p-4"
      >
        <h2 id="bulk-change" className="text-title font-semibold text-ink">
          Change
        </h2>
        <SegmentedControl
          value={operation}
          onValueChange={(value) => setOperation(value as BulkOperation)}
          aria-label="What to change"
          className="max-w-full overflow-x-auto"
        >
          {OPERATIONS.map((option) => (
            <SegmentedControlItem
              key={option.value}
              value={option.value}
              className="flex-none"
            >
              {option.label}
            </SegmentedControlItem>
          ))}
        </SegmentedControl>
        {operation === "special_hours" ? (
          <fieldset className="flex flex-col gap-3">
            <legend className="text-ui text-ink-secondary">
              Only these dates change on each listing; its other special dates
              stay as they are.
            </legend>
            {special.map((row, index) => (
              <div
                key={index}
                className="grid gap-2 sm:grid-cols-[10rem_10rem_1fr_1fr_auto] sm:items-end"
              >
                <label className="flex flex-col gap-1 text-caption text-ink">
                  Date
                  <Input
                    type="date"
                    value={row.date}
                    onChange={(e) =>
                      setSpecial(
                        special.map((r, i) =>
                          i === index ? { ...r, date: e.target.value } : r
                        )
                      )
                    }
                  />
                </label>
                <label className="flex flex-col gap-1 text-caption text-ink">
                  Set to
                  <Select
                    value={row.action}
                    onValueChange={(value) =>
                      setSpecial(
                        special.map((r, i) =>
                          i === index
                            ? { ...r, action: value as SpecialRow["action"] }
                            : r
                        )
                      )
                    }
                  >
                    <SelectTrigger
                      className="w-full"
                      aria-label={`Setting for date ${index + 1}`}
                    >
                      <SelectValue>
                        {(v: string | null) =>
                          v === "open"
                            ? "Open"
                            : v === "clear"
                              ? "Remove this date"
                              : "Closed"
                        }
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="closed">Closed</SelectItem>
                      <SelectItem value="open">Open</SelectItem>
                      <SelectItem value="clear">Remove this date</SelectItem>
                    </SelectContent>
                  </Select>
                </label>
                {row.action === "open" ? (
                  <>
                    <label className="flex flex-col gap-1 text-caption text-ink">
                      Opens
                      <Input
                        type="time"
                        value={row.opensAt}
                        onChange={(e) =>
                          setSpecial(
                            special.map((r, i) =>
                              i === index
                                ? { ...r, opensAt: e.target.value }
                                : r
                            )
                          )
                        }
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-caption text-ink">
                      Closes
                      <Input
                        type="time"
                        value={row.closesAt}
                        onChange={(e) =>
                          setSpecial(
                            special.map((r, i) =>
                              i === index
                                ? { ...r, closesAt: e.target.value }
                                : r
                            )
                          )
                        }
                      />
                    </label>
                  </>
                ) : (
                  <>
                    <span aria-hidden />
                    <span aria-hidden />
                  </>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={special.length === 1}
                  onClick={() =>
                    setSpecial(special.filter((_, i) => i !== index))
                  }
                  aria-label={`Remove date ${index + 1}`}
                >
                  <Trash2 aria-hidden />
                </Button>
              </div>
            ))}
            <Button
              variant="secondary"
              size="sm"
              className="self-start"
              disabled={special.length >= 31}
              onClick={() =>
                setSpecial([
                  ...special,
                  {
                    date: "",
                    action: "closed",
                    opensAt: "10:00",
                    closesAt: "16:00",
                  },
                ])
              }
            >
              <Plus aria-hidden /> Add a date
            </Button>
          </fieldset>
        ) : operation === "regular_hours" || operation === "more_hours" ? (
          <fieldset className="flex flex-col gap-2">
            <legend className="text-ui text-ink-secondary">
              {operation === "regular_hours"
                ? "Replaces each listing’s regular opening hours. Special and service hours are untouched."
                : "Replaces one service-hours type on each listing that Google offers it for. Other types stay as they are. A closing time earlier than the opening time runs past midnight."}
            </legend>
            {operation === "more_hours" ? (
              <label className="flex max-w-80 flex-col gap-1 text-caption text-ink">
                Google hours type ID
                <Input
                  value={hoursTypeId}
                  placeholder="For example DELIVERY"
                  onChange={(e) => setHoursTypeId(e.target.value)}
                />
              </label>
            ) : null}
            {(operation === "regular_hours" ? days : serviceDays).map(
              (day, index) => {
                const update = (patch: Partial<DayRow>) =>
                  (operation === "regular_hours" ? setDays : setServiceDays)(
                    (rows) =>
                      rows.map((r, i) => (i === index ? { ...r, ...patch } : r))
                  )
                return (
                  <div
                    key={DAYS[index]}
                    className="grid grid-cols-[7rem_auto_1fr_1fr] items-center gap-2"
                  >
                    <span className="text-ui text-ink">{DAYS[index]}</span>
                    <Checkbox
                      label={operation === "regular_hours" ? "Closed" : "None"}
                      checked={day.isClosed}
                      onCheckedChange={(checked) =>
                        update({ isClosed: checked === true })
                      }
                    />
                    <Input
                      type="time"
                      aria-label={`${DAYS[index]} opens`}
                      disabled={day.isClosed}
                      value={day.opensAt}
                      onChange={(e) => update({ opensAt: e.target.value })}
                    />
                    <Input
                      type="time"
                      aria-label={`${DAYS[index]} closes`}
                      disabled={day.isClosed}
                      value={day.closesAt}
                      onChange={(e) => update({ closesAt: e.target.value })}
                    />
                  </div>
                )
              }
            )}
          </fieldset>
        ) : operation === "attributes" ? (
          <fieldset className="flex flex-col gap-2">
            <legend className="text-ui text-ink-secondary">
              Only these attributes change. Listings whose category does not
              offer one are skipped.
            </legend>
            {attributes.map((row, index) => (
              <div
                key={index}
                className="grid gap-2 sm:grid-cols-[1fr_10rem_auto] sm:items-end"
              >
                <label className="flex flex-col gap-1 text-caption text-ink">
                  Google attribute
                  <Input
                    value={row.name}
                    onChange={(e) =>
                      setAttributes(
                        attributes.map((r, i) =>
                          i === index ? { ...r, name: e.target.value } : r
                        )
                      )
                    }
                  />
                </label>
                <label className="flex flex-col gap-1 text-caption text-ink">
                  Value
                  <Select
                    value={row.value}
                    onValueChange={(value) =>
                      value &&
                      setAttributes(
                        attributes.map((r, i) =>
                          i === index ? { ...r, value } : r
                        )
                      )
                    }
                  >
                    <SelectTrigger
                      className="w-full"
                      aria-label={`Value for attribute ${index + 1}`}
                    >
                      <SelectValue>
                        {(v: string | null) => (v === "true" ? "Yes" : "No")}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="true">Yes</SelectItem>
                      <SelectItem value="false">No</SelectItem>
                    </SelectContent>
                  </Select>
                </label>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={attributes.length === 1}
                  onClick={() =>
                    setAttributes(attributes.filter((_, i) => i !== index))
                  }
                  aria-label={`Remove attribute ${index + 1}`}
                >
                  <Trash2 aria-hidden />
                </Button>
              </div>
            ))}
            <Button
              variant="secondary"
              size="sm"
              className="self-start"
              onClick={() =>
                setAttributes([
                  ...attributes,
                  { name: "attributes/", value: "true" },
                ])
              }
            >
              <Plus aria-hidden /> Add an attribute
            </Button>
          </fieldset>
        ) : (
          <fieldset className="flex flex-col gap-3">
            <legend className="text-ui text-ink-secondary">
              Adds or updates the link on each listing, or removes the exact
              matching link. Links a booking provider owns are never changed.
            </legend>
            <SegmentedControl
              value={link.action}
              onValueChange={(value) =>
                setLink({ ...link, action: value as "upsert" | "delete" })
              }
              aria-label="Link change"
            >
              <SegmentedControlItem value="upsert">
                Add or update
              </SegmentedControlItem>
              <SegmentedControlItem value="delete">Remove</SegmentedControlItem>
            </SegmentedControl>
            <div className="grid gap-2 sm:grid-cols-[14rem_1fr]">
              <label className="flex flex-col gap-1 text-caption text-ink">
                Type
                <Select
                  value={link.placeActionType}
                  onValueChange={(value) =>
                    value && setLink({ ...link, placeActionType: value })
                  }
                >
                  <SelectTrigger
                    className="w-full"
                    aria-label="Action link type"
                  >
                    <SelectValue>
                      {(v: string | null) => (v ? actionTypeLabel(v) : "")}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {GOOGLE_PLACE_ACTION_TYPES.map((type) => (
                      <SelectItem key={type} value={type}>
                        {actionTypeLabel(type)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <label className="flex flex-col gap-1 text-caption text-ink">
                Link
                <Input
                  type="url"
                  value={link.uri}
                  placeholder="https://…"
                  onChange={(e) => setLink({ ...link, uri: e.target.value })}
                />
              </label>
            </div>
            {link.action === "upsert" ? (
              <Checkbox
                label="Make this the preferred link"
                checked={link.isPreferred}
                onCheckedChange={(checked) =>
                  setLink({ ...link, isPreferred: checked === true })
                }
              />
            ) : null}
          </fieldset>
        )}
        {problem ? (
          <p role="status" className="text-ui text-ink-muted">
            {problem}
          </p>
        ) : null}
        {failure ? (
          <p role="alert" className="text-ui text-danger-ink">
            {failure}
          </p>
        ) : null}
        <Button
          className="self-start"
          disabled={Boolean(problem)}
          pending={preview.isPending}
          pendingLabel="Reading each listing…"
          onClick={() => {
            setFailure(null)
            preview.mutate()
          }}
        >
          Preview this change
        </Button>
      </section>
    </>
  )
}
