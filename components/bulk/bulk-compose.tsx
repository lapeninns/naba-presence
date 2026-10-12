"use client"

import { useMutation, useQuery } from "@tanstack/react-query"
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useState } from "react"

import { PageHeader } from "@/components/app-shell/page-frame"
import { Button, buttonVariants } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
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
import {
  fetchReadyAssets,
  photoFileProblem,
  uploadPhotoAsset,
} from "@/lib/api/assets"
import { previewBulkChange } from "@/lib/api/bulk-listings"
import { fetchFoodMenus } from "@/lib/api/location-menu"
import { bulkPreviewRequestSchema } from "@/lib/contracts/bulk-listings"
import {
  BULK_MAX_CHANGES,
  BULK_MAX_ITEMS,
  BULK_MAX_TARGETS,
  bulkOperationInputSchema,
  type BulkOperation,
  type BulkOperationInput,
} from "@/lib/domain/bulk-merge"
import {
  BULK_MAX_NEW_PHOTOS_PER_LOCATION,
  BULK_PHOTO_CATEGORIES,
  type BulkPhotoCategory,
} from "@/lib/domain/bulk-photos"
import { GOOGLE_PLACE_ACTION_TYPES } from "@/lib/domain/google-contract"
import { GOOGLE_LODGING_BOOLEAN_PATHS } from "@/lib/domain/google-lodging"
import { actionTypeLabel } from "@/lib/editors/booking-presentation"
import { queryKeys } from "@/lib/queries/keys"
import { requestOptions } from "@/lib/queries/request-options"
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
  { value: "business_info", label: "Business information" },
  { value: "categories", label: "Categories" },
  { value: "lodging", label: "Lodging" },
  { value: "food_menus", label: "Menus" },
  { value: "post_draft", label: "Post draft" },
  { value: "photos", label: "Photos" },
]
const OPERATION_NAME = new Map(OPERATIONS.map((o) => [o.value, o.label]))
const PHOTO_CATEGORY_LABEL: Record<BulkPhotoCategory, string> = {
  LOGO: "Logo",
  EXTERIOR: "Exterior",
  INTERIOR: "Interior",
  PRODUCT: "Product",
  AT_WORK: "At work",
  FOOD_AND_DRINK: "Food and drink",
  MENU: "Menu",
  COMMON_AREA: "Common area",
  ROOMS: "Rooms",
  TEAMS: "Team",
  ADDITIONAL: "Additional",
}
/** A short line naming one change of the batch's list. */
function changeSummary(item: BulkOperationInput): string {
  const name = OPERATION_NAME.get(item.operation) ?? item.operation
  switch (item.operation) {
    case "regular_hours":
      return `${name}: ${item.days.map((day) => DAYS[day.dayOfWeek]).join(", ")}`
    case "special_hours":
      return `${name}: ${item.dates.map((date) => date.date).join(", ")}`
    case "more_hours":
      return `${name}: ${item.hoursTypeId}`
    case "attributes":
      return `${name}: ${item.changes.length} ${item.changes.length === 1 ? "attribute" : "attributes"}`
    case "place_action":
      return `${name}: ${item.action === "delete" ? "remove" : "add or update"} ${actionTypeLabel(item.placeActionType)}`
    case "photos":
      return `${name}: ${PHOTO_CATEGORY_LABEL[item.category]}`
    default:
      return name
  }
}
type FieldEdit = { mode: "keep" | "set" | "clear"; value: string }
type LodgingRow = { path: string; value: "true" | "false" | "clear" }
/** Labels typed as a comma-separated list. */
const labelList = (text: string) =>
  text
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
const categoryList = (text: string) =>
  text
    .split(/[\s,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) =>
      entry.startsWith("categories/") ? entry : `categories/gcid:${entry}`
    )
/** `{ a: { b: value } }` for the path `a.b`. */
function nest(target: Record<string, unknown>, path: string, value: unknown) {
  const parts = path.split(".")
  let node = target
  for (const part of parts.slice(0, -1)) {
    node[part] = (node[part] as Record<string, unknown> | undefined) ?? {}
    node = node[part] as Record<string, unknown>
  }
  node[parts[parts.length - 1]] = value
  return target
}
type SpecialRow = {
  date: string
  action: "open" | "closed" | "clear"
  opensAt: string
  closesAt: string
}
type DayRow = {
  /** Regular hours only: whether this weekday changes (the others are left as each listing has them). */
  selected?: boolean
  isClosed: boolean
  opensAt: string
  closesAt: string
}

/**
 * Composes one bulk change for the listings selected on the board. The ids
 * come from the selection and are frozen by the preview; the server reads
 * each listing's current Google value before anything can be approved.
 */
export function BulkCompose() {
  const router = useRouter()
  // Never trimmed: a link naming more than 50 listings is refused, so the
  // batch is exactly the selection the person made.
  const ids = [
    ...new Set(
      (useSearchParams().get("ids") ?? "")
        .split(",")
        .filter((id) => /^[0-9a-f-]{36}$/.test(id))
    ),
  ]
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
      selected: true,
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
  const [website, setWebsite] = useState<FieldEdit>({
    mode: "keep",
    value: "",
  })
  const [description, setDescription] = useState<FieldEdit>({
    mode: "keep",
    value: "",
  })
  const [labels, setLabels] = useState<FieldEdit>({ mode: "keep", value: "" })
  const [openStatus, setOpenStatus] = useState<
    "keep" | "OPEN" | "CLOSED_TEMPORARILY"
  >("keep")
  const [categories, setCategories] = useState({
    primary: "",
    add: "",
    remove: "",
  })
  const [lodging, setLodging] = useState<LodgingRow[]>([
    { path: "", value: "true" },
  ])
  /** The selected listing whose menus (as Google shows them) replace the others'. */
  const [menuSource, setMenuSource] = useState("")
  const sourceMenus = useQuery({
    queryKey: queryKeys.locationMenu(menuSource),
    queryFn: (ctx) => fetchFoodMenus(menuSource, requestOptions(ctx)),
    enabled: operation === "food_menus" && Boolean(menuSource),
  })
  const [post, setPost] = useState({
    topicType: "STANDARD" as const,
    summary: "",
  })
  const [photo, setPhoto] = useState({
    assetId: "",
    category: "EXTERIOR" as BulkPhotoCategory,
    description: "",
  })
  const assets = useQuery({
    queryKey: queryKeys.readyAssets,
    queryFn: (ctx) => fetchReadyAssets(requestOptions(ctx)),
    enabled: operation === "photos",
    retry: false,
  })
  const [upload, setUpload] = useState<string | null>(null)
  const uploading = useMutation({
    mutationFn: (file: File) => uploadPhotoAsset(file),
    onSuccess: (asset) => {
      setUpload(`${asset.fileName} is uploaded and checked.`)
      setPhoto((current) => ({ ...current, assetId: asset.id }))
      void assets.refetch()
    },
    onError: (error) =>
      setUpload(
        error instanceof ApiClientError
          ? error.code === "asset_storage_unavailable"
            ? "Photo storage isn’t set up for this workspace yet."
            : error.message
          : "The photo couldn’t be uploaded. Try again."
      ),
  })
  /** The batch's ordered change list; each change applies to every selected listing. */
  const [changes, setChanges] = useState<BulkOperationInput[]>([])
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
            days: days.flatMap((day, dayOfWeek) =>
              day.selected
                ? [
                    {
                      dayOfWeek,
                      isClosed: day.isClosed,
                      periods: day.isClosed
                        ? []
                        : [{ opensAt: day.opensAt, closesAt: day.closesAt }],
                    },
                  ]
                : []
            ),
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
            : operation === "business_info"
              ? {
                  operation,
                  changes: [
                    ...(website.mode === "keep"
                      ? []
                      : [
                          website.mode === "set"
                            ? {
                                field: "websiteUri",
                                action: "set",
                                value: website.value.trim(),
                              }
                            : { field: "websiteUri", action: "clear" },
                        ]),
                    ...(description.mode === "keep"
                      ? []
                      : [
                          description.mode === "set"
                            ? {
                                field: "profile.description",
                                action: "set",
                                value: description.value,
                              }
                            : { field: "profile.description", action: "clear" },
                        ]),
                    ...(labels.mode === "keep"
                      ? []
                      : [
                          labels.mode === "set"
                            ? {
                                field: "labels",
                                action: "set",
                                value: labelList(labels.value),
                              }
                            : { field: "labels", action: "clear" },
                        ]),
                    ...(openStatus === "keep"
                      ? []
                      : [
                          {
                            field: "openInfo.status",
                            action: "set",
                            value: openStatus,
                          },
                        ]),
                  ],
                }
              : operation === "categories"
                ? {
                    operation,
                    ...(categories.primary.trim()
                      ? { primaryCategory: categoryList(categories.primary)[0] }
                      : {}),
                    addAdditional: categoryList(categories.add),
                    removeAdditional: categoryList(categories.remove),
                  }
                : operation === "lodging"
                  ? {
                      operation,
                      updateMask: lodging.map((row) => row.path),
                      clear: lodging
                        .filter((row) => row.value === "clear")
                        .map((row) => row.path),
                      payload: lodging
                        .filter((row) => row.value !== "clear" && row.path)
                        .reduce(
                          (body, row) =>
                            nest(body, row.path, row.value === "true"),
                          {} as Record<string, unknown>
                        ),
                    }
                  : operation === "food_menus"
                    ? {
                        operation,
                        mode: "replace",
                        menus: sourceMenus.data?.googleMenus,
                      }
                    : operation === "post_draft"
                      ? {
                          operation,
                          post: {
                            topicType: post.topicType,
                            summary: post.summary,
                          },
                        }
                      : operation === "photos"
                        ? {
                            operation,
                            assetId: photo.assetId,
                            category: photo.category,
                            ...(photo.description.trim()
                              ? { description: photo.description.trim() }
                              : {}),
                          }
                        : { operation, ...link }
  const parsed = bulkOperationInputSchema.safeParse(raw)
  /** What is wrong with the change being edited, before it can join the list. */
  const problem =
    ids.length === 0
      ? "Select listings on the Listings board first."
      : operation === "regular_hours" && !days.some((day) => day.selected)
        ? "Tick at least one weekday to change."
        : operation === "photos" && !photo.assetId
          ? "Upload a photo or choose one already uploaded."
          : operation === "categories" &&
              categoryList(categories.primary).length > 1
            ? "Name one primary category."
            : operation === "food_menus" && !menuSource
              ? "Choose the listing whose menus to copy."
              : operation === "food_menus" && !sourceMenus.data
                ? sourceMenus.isError
                  ? "That listing’s menus couldn’t be read."
                  : "Reading that listing’s menus…"
                : operation === "post_draft" && !post.summary.trim()
                  ? "Write the post."
                  : parsed.success
                    ? null
                    : (parsed.error.issues[0]?.message ?? "Check the change.")
  // With nothing added yet, the change being edited is the batch; once
  // changes are added, the batch is exactly the list shown.
  const batch = changes.length
    ? changes
    : parsed.success && !problem
      ? [parsed.data]
      : []
  const request = bulkPreviewRequestSchema.safeParse({
    locationIds: ids,
    items: batch,
  })
  const batchProblem =
    ids.length > BULK_MAX_TARGETS
      ? `One bulk change covers at most ${BULK_MAX_TARGETS} listings; this selection has ${ids.length}. Go back and select fewer.`
      : ids.length * batch.length > BULK_MAX_ITEMS
        ? `A batch holds at most ${BULK_MAX_ITEMS} listing changes; ${ids.length} listings × ${batch.length} changes is ${ids.length * batch.length}.`
        : batch.length && !request.success
          ? (request.error.issues[0]?.message ?? "Check the changes.")
          : null
  const canAdd =
    !problem &&
    parsed.success &&
    changes.length < BULK_MAX_CHANGES &&
    ids.length <= BULK_MAX_TARGETS
  const move = (from: number, to: number) =>
    setChanges((list) => {
      const next = [...list]
      const [item] = next.splice(from, 1)
      next.splice(to, 0, item)
      return next
    })
  const preview = useMutation({
    mutationFn: () => previewBulkChange({ locationIds: ids, items: batch }),
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
        description={`Reviewed changes across ${ids.length} selected ${ids.length === 1 ? "listing" : "listings"}. Nothing is sent until the preview is approved and started.`}
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
                ? "Only the ticked weekdays change; each listing keeps its other days. Tick all seven to replace the whole week. Special and service hours are untouched."
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
                    {operation === "regular_hours" ? (
                      <Checkbox
                        label={DAYS[index]}
                        checked={day.selected === true}
                        onCheckedChange={(checked) =>
                          update({ selected: checked === true })
                        }
                      />
                    ) : (
                      <span className="text-ui text-ink">{DAYS[index]}</span>
                    )}
                    <Checkbox
                      label={
                        <>
                          {operation === "regular_hours" ? "Closed" : "None"}{" "}
                          <span className="sr-only">on {DAYS[index]}</span>
                        </>
                      }
                      disabled={operation === "regular_hours" && !day.selected}
                      checked={day.isClosed}
                      onCheckedChange={(checked) =>
                        update({ isClosed: checked === true })
                      }
                    />
                    <Input
                      type="time"
                      aria-label={`${DAYS[index]} opens`}
                      disabled={
                        day.isClosed ||
                        (operation === "regular_hours" && !day.selected)
                      }
                      value={day.opensAt}
                      onChange={(e) => update({ opensAt: e.target.value })}
                    />
                    <Input
                      type="time"
                      aria-label={`${DAYS[index]} closes`}
                      disabled={
                        day.isClosed ||
                        (operation === "regular_hours" && !day.selected)
                      }
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
        ) : operation === "business_info" ? (
          <fieldset className="flex flex-col gap-3">
            <legend className="text-ui text-ink-secondary">
              Only the fields you change are sent; everything else on each
              listing stays as it is. Names, addresses and phone numbers are
              changed per listing.
            </legend>
            {(
              [
                ["Website", website, setWebsite, "url"],
                ["Description", description, setDescription, "text"],
                ["Labels", labels, setLabels, "text"],
              ] as const
            ).map(([label, edit, setEdit, type]) => (
              <div
                key={label}
                className="grid gap-2 sm:grid-cols-[10rem_1fr] sm:items-end"
              >
                <label className="flex flex-col gap-1 text-caption text-ink">
                  {label}
                  <Select
                    value={edit.mode}
                    onValueChange={(value) =>
                      value &&
                      setEdit({ ...edit, mode: value as FieldEdit["mode"] })
                    }
                  >
                    <SelectTrigger
                      className="w-full"
                      aria-label={`${label} change`}
                    >
                      <SelectValue>
                        {(v: string | null) =>
                          v === "set"
                            ? "Set to"
                            : v === "clear"
                              ? "Remove"
                              : "Leave as is"
                        }
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="keep">Leave as is</SelectItem>
                      <SelectItem value="set">Set to</SelectItem>
                      <SelectItem value="clear">Remove</SelectItem>
                    </SelectContent>
                  </Select>
                </label>
                {edit.mode === "set" ? (
                  <Input
                    type={type}
                    aria-label={`New ${label.toLowerCase()}`}
                    placeholder={
                      label === "Labels"
                        ? "Comma-separated, up to 10"
                        : undefined
                    }
                    value={edit.value}
                    onChange={(e) =>
                      setEdit({ ...edit, value: e.target.value })
                    }
                  />
                ) : (
                  <span aria-hidden />
                )}
              </div>
            ))}
            <label className="flex max-w-80 flex-col gap-1 text-caption text-ink">
              Open status
              <Select
                value={openStatus}
                onValueChange={(value) =>
                  value && setOpenStatus(value as typeof openStatus)
                }
              >
                <SelectTrigger
                  className="w-full"
                  aria-label="Open status change"
                >
                  <SelectValue>
                    {(v: string | null) =>
                      v === "OPEN"
                        ? "Open"
                        : v === "CLOSED_TEMPORARILY"
                          ? "Temporarily closed"
                          : "Leave as is"
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="keep">Leave as is</SelectItem>
                  <SelectItem value="OPEN">Open</SelectItem>
                  <SelectItem value="CLOSED_TEMPORARILY">
                    Temporarily closed
                  </SelectItem>
                </SelectContent>
              </Select>
            </label>
          </fieldset>
        ) : operation === "categories" ? (
          <fieldset className="flex flex-col gap-3">
            <legend className="text-ui text-ink-secondary">
              Google category IDs, such as gcid:pub. Additional categories you
              don’t name stay as each listing has them. Listings whose country
              doesn’t offer a category are skipped.
            </legend>
            {(
              [
                ["primary", "New primary category (optional)"],
                ["add", "Add additional categories"],
                ["remove", "Remove additional categories"],
              ] as const
            ).map(([key, label]) => (
              <label
                key={key}
                className="flex max-w-120 flex-col gap-1 text-caption text-ink"
              >
                {label}
                <Input
                  value={categories[key]}
                  placeholder={
                    key === "primary" ? "gcid:pub" : "gcid:bar, gcid:restaurant"
                  }
                  onChange={(e) =>
                    setCategories({ ...categories, [key]: e.target.value })
                  }
                />
              </label>
            ))}
          </fieldset>
        ) : operation === "lodging" ? (
          <fieldset className="flex flex-col gap-2">
            <legend className="text-ui text-ink-secondary">
              Only these lodging details change. Listings Google keeps no
              lodging details for are skipped.
            </legend>
            <datalist id="bulk-lodging-paths">
              {GOOGLE_LODGING_BOOLEAN_PATHS.map((path) => (
                <option key={path} value={path} />
              ))}
            </datalist>
            {lodging.map((row, index) => (
              <div
                key={index}
                className="grid gap-2 sm:grid-cols-[1fr_10rem_auto] sm:items-end"
              >
                <label className="flex flex-col gap-1 text-caption text-ink">
                  Lodging field
                  <Input
                    list="bulk-lodging-paths"
                    value={row.path}
                    placeholder="For example pools.pool"
                    onChange={(e) =>
                      setLodging(
                        lodging.map((r, i) =>
                          i === index
                            ? { ...r, path: e.target.value.trim() }
                            : r
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
                      setLodging(
                        lodging.map((r, i) =>
                          i === index
                            ? { ...r, value: value as LodgingRow["value"] }
                            : r
                        )
                      )
                    }
                  >
                    <SelectTrigger
                      className="w-full"
                      aria-label={`Value for lodging field ${index + 1}`}
                    >
                      <SelectValue>
                        {(v: string | null) =>
                          v === "true"
                            ? "Yes"
                            : v === "false"
                              ? "No"
                              : "Not set"
                        }
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="true">Yes</SelectItem>
                      <SelectItem value="false">No</SelectItem>
                      <SelectItem value="clear">Not set</SelectItem>
                    </SelectContent>
                  </Select>
                </label>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={lodging.length === 1}
                  onClick={() =>
                    setLodging(lodging.filter((_, i) => i !== index))
                  }
                  aria-label={`Remove lodging field ${index + 1}`}
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
                setLodging([...lodging, { path: "", value: "true" }])
              }
            >
              <Plus aria-hidden /> Add a lodging field
            </Button>
          </fieldset>
        ) : operation === "food_menus" ? (
          <fieldset className="flex flex-col gap-3">
            <legend className="text-ui text-ink-secondary">
              Replaces every other listing’s menus with the menus Google shows
              for one listing. The preview lists every menu entry each listing
              loses before anything can be approved.
            </legend>
            <label className="flex flex-col gap-1 text-caption text-ink">
              Copy the menus of
              <Select
                value={menuSource}
                onValueChange={(value) => setMenuSource(value ?? "")}
              >
                <SelectTrigger
                  className="w-full sm:w-80"
                  aria-label="Listing whose menus to copy"
                >
                  <SelectValue>
                    {(v: string | null) =>
                      v ? (names.get(v) ?? "Listing") : "Choose a listing"
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {ids.map((id) => (
                    <SelectItem key={id} value={id}>
                      {names.get(id) ?? "Listing"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            {sourceMenus.data ? (
              <p className="text-ui text-ink-secondary">
                {`${sourceMenus.data.googleCounts.menus} menus, ${sourceMenus.data.googleCounts.sections} sections, ${sourceMenus.data.googleCounts.items} items.`}
              </p>
            ) : null}
          </fieldset>
        ) : operation === "post_draft" ? (
          <fieldset className="flex flex-col gap-3">
            <legend className="text-ui text-ink-secondary">
              Creates a separate draft on each listing. Nothing is published:
              each draft is published from that listing’s posts, with its own
              approval when two-person approval is on.
            </legend>
            <label className="flex flex-col gap-1 text-caption text-ink">
              Post text
              <Textarea
                maxLength={1500}
                value={post.summary}
                onChange={(e) => setPost({ ...post, summary: e.target.value })}
              />
            </label>
          </fieldset>
        ) : operation === "photos" ? (
          <fieldset className="flex flex-col gap-3">
            <legend className="text-ui text-ink-secondary">
              Adds one photo to each listing as a new photo. Photos are checked
              when uploaded (JPEG or PNG, 10 KB to 5 MB, at least 250 × 250) and
              stored privately; a listing that already shows the photo is
              skipped. Up to {BULK_MAX_NEW_PHOTOS_PER_LOCATION} new photos per
              batch.
            </legend>
            <label className="flex flex-col gap-1 text-caption text-ink">
              Upload a photo
              <Input
                type="file"
                accept="image/jpeg,image/png"
                disabled={uploading.isPending}
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  e.target.value = ""
                  if (!file) return
                  const refused = photoFileProblem(file)
                  if (refused) return setUpload(refused)
                  setUpload("Uploading and checking the photo…")
                  uploading.mutate(file)
                }}
              />
            </label>
            {upload ? (
              <p role="status" className="text-ui text-ink-secondary">
                {upload}
              </p>
            ) : null}
            <div className="grid gap-2 sm:grid-cols-[1fr_14rem]">
              <label className="flex flex-col gap-1 text-caption text-ink">
                Photo
                <Select
                  value={photo.assetId}
                  onValueChange={(value) =>
                    setPhoto({ ...photo, assetId: value ?? "" })
                  }
                >
                  <SelectTrigger
                    className="w-full"
                    aria-label="Uploaded photo to add"
                  >
                    <SelectValue>
                      {(v: string | null) =>
                        (assets.data ?? []).find((asset) => asset.id === v)
                          ?.fileName ??
                        (assets.isError
                          ? "Uploads couldn’t be read"
                          : "Choose an uploaded photo")
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {(assets.data ?? []).map((asset) => (
                      <SelectItem key={asset.id} value={asset.id}>
                        {`${asset.fileName} (${asset.width ?? "?"} × ${asset.height ?? "?"})`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <label className="flex flex-col gap-1 text-caption text-ink">
                Category
                <Select
                  value={photo.category}
                  onValueChange={(value) =>
                    value &&
                    setPhoto({ ...photo, category: value as BulkPhotoCategory })
                  }
                >
                  <SelectTrigger className="w-full" aria-label="Photo category">
                    <SelectValue>
                      {(v: string | null) =>
                        v ? PHOTO_CATEGORY_LABEL[v as BulkPhotoCategory] : ""
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {BULK_PHOTO_CATEGORIES.map((category) => (
                      <SelectItem key={category} value={category}>
                        {PHOTO_CATEGORY_LABEL[category]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
            </div>
            <label className="flex flex-col gap-1 text-caption text-ink">
              Description (optional)
              <Textarea
                maxLength={1500}
                value={photo.description}
                onChange={(e) =>
                  setPhoto({ ...photo, description: e.target.value })
                }
              />
            </label>
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
        <Button
          variant="secondary"
          className="self-start"
          disabled={!canAdd}
          onClick={() => {
            if (!parsed.success) return
            setChanges([...changes, parsed.data])
          }}
        >
          <Plus aria-hidden /> Add to the batch
        </Button>
      </section>
      <section
        aria-labelledby="bulk-batch"
        className="flex flex-col gap-3 rounded-(--np-radius-card) border border-line bg-surface p-4"
      >
        <h2 id="bulk-batch" className="text-title font-semibold text-ink">
          Changes in this batch
        </h2>
        {changes.length ? (
          <ol
            aria-label="Changes in this batch, in the order they are sent"
            className="flex flex-col gap-2"
          >
            {changes.map((item, index) => (
              <li
                key={index}
                className="flex flex-wrap items-center justify-between gap-2 text-ui text-ink"
              >
                <span className="min-w-0 break-words">
                  {index + 1}. {changeSummary(item)}
                </span>
                <span className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={index === 0}
                    aria-label={`Move change ${index + 1} up`}
                    onClick={() => move(index, index - 1)}
                  >
                    <ArrowUp aria-hidden />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={index === changes.length - 1}
                    aria-label={`Move change ${index + 1} down`}
                    onClick={() => move(index, index + 1)}
                  >
                    <ArrowDown aria-hidden />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Remove change ${index + 1}`}
                    onClick={() =>
                      setChanges(changes.filter((_, i) => i !== index))
                    }
                  >
                    <Trash2 aria-hidden />
                  </Button>
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-ui text-ink-secondary">
            Nothing added yet: the preview covers the change above on its own.
            Add changes to send several to each listing, in list order.
          </p>
        )}
        <p className="text-caption text-ink-muted">
          {`${ids.length} ${ids.length === 1 ? "listing" : "listings"} × ${batch.length} ${batch.length === 1 ? "change" : "changes"} = ${ids.length * batch.length} of at most ${BULK_MAX_ITEMS}. At most ${BULK_MAX_TARGETS} listings.`}
        </p>
        {batchProblem ? (
          <p role="status" className="text-ui text-danger-ink">
            {batchProblem}
          </p>
        ) : null}
        {failure ? (
          <p role="alert" className="text-ui text-danger-ink">
            {failure}
          </p>
        ) : null}
        <Button
          className="self-start"
          disabled={!batch.length || Boolean(batchProblem)}
          pending={preview.isPending}
          pendingLabel="Reading each listing…"
          onClick={() => {
            setFailure(null)
            preview.mutate()
          }}
        >
          {changes.length > 1
            ? `Preview these ${changes.length} changes`
            : "Preview this change"}
        </Button>
      </section>
    </>
  )
}
