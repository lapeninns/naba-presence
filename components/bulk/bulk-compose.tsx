"use client"

import { useMutation, useQueries, useQuery } from "@tanstack/react-query"
import {
  ArrowDown,
  ArrowUp,
  Camera,
  ChevronDown,
  ImagePlus,
  Plus,
  Trash2,
} from "lucide-react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useRef, useState } from "react"

import { PageHeader } from "@/components/app-shell/page-frame"
import { ActionBar } from "@/components/ui/action-bar"
import { Button, buttonVariants } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  FormError,
  FormErrorScope,
} from "@/components/ui/field"
import {
  Fieldset,
  FieldsetDescription,
  FieldsetLegend,
} from "@/components/ui/fieldset"
import { Input, inputHints } from "@/components/ui/input"
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
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { TimeField, isValidTime } from "@/components/ui/time-field"
import { ApiClientError } from "@/lib/api/client"
import {
  fetchReadyAssets,
  photoFileProblem,
  uploadPhotoAsset,
} from "@/lib/api/assets"
import { previewBulkChange } from "@/lib/api/bulk-listings"
import { fetchHours } from "@/lib/api/location-hours"
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
import { ASSET_PHOTO_CONTENT_TYPES } from "@/lib/domain/media-sniff"
import { actionTypeLabel } from "@/lib/editors/booking-presentation"
import { queryKeys } from "@/lib/queries/keys"
import { requestOptions } from "@/lib/queries/request-options"
import { useLocationDirectory } from "@/lib/queries/use-locations"
import { useSessionRole } from "@/lib/queries/use-session"
import { cn } from "@/lib/utils"
import { cardClassName } from "@/components/ui/card"

const DAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
]
/** Weekdays as the hours editor lists them: Monday first. */
const WEEK = [1, 2, 3, 4, 5, 6, 0] as const
const OPERATIONS: Array<{
  value: BulkOperation
  label: string
  description: string
}> = [
  {
    value: "special_hours",
    label: "Special hours",
    description: "Open, closed or removed on the dates you name.",
  },
  {
    value: "regular_hours",
    label: "Opening hours",
    description: "The weekly hours, for the weekdays you tick.",
  },
  {
    value: "more_hours",
    label: "Service hours",
    description: "One service schedule, such as delivery or takeaway.",
  },
  {
    value: "attributes",
    label: "Attributes",
    description: "Yes or no attributes, such as Wi-Fi or outdoor seating.",
  },
  {
    value: "place_action",
    label: "Action link",
    description: "A booking, ordering or other action link.",
  },
  {
    value: "business_info",
    label: "Business information",
    description: "Website, description, labels and open status.",
  },
  {
    value: "categories",
    label: "Categories",
    description: "The primary category and additional categories.",
  },
  {
    value: "lodging",
    label: "Lodging",
    description: "Lodging details Google keeps for hotels and inns.",
  },
  {
    value: "food_menus",
    label: "Menus",
    description: "Copy one selected listing’s menus to the others.",
  },
  {
    value: "post_draft",
    label: "Post draft",
    description: "A draft post on each listing. Nothing is published.",
  },
  {
    value: "photos",
    label: "Photos",
    description: "Add one photo to each listing.",
  },
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

const STORAGE_MISSING = "Photo storage isn’t set up for this workspace yet."
const TIME_FORMAT = "Use a 24-hour time such as 09:30."
/** The Select value that switches the service-hours picker to typed entry. */
const OTHER_HOURS_TYPE = "__other__"

/**
 * The bulk contract has no `24:00`: a period that closes at or before it
 * opens closes on the next day (lib/domain/bulk-merge.ts `googlePeriod`).
 * So "closes 24:00" is sent as "closes 00:00", which is the same moment —
 * midnight at the end of the opening day — written the way the contract can
 * carry it.
 */
const contractClose = (closesAt: string) =>
  closesAt === "24:00" ? "00:00" : closesAt

type TimeIssues = { opens?: string; closes?: string }

/**
 * What is wrong with one weekly period, in words for the field it belongs
 * to. Opening times never take 24:00; closing times may (midnight).
 */
function weeklyIssues(day: DayRow): TimeIssues {
  const issues: TimeIssues = {}
  if (!isValidTime(day.opensAt, { allow24: false })) issues.opens = TIME_FORMAT
  if (!isValidTime(day.closesAt))
    issues.closes = "Use a 24-hour time such as 17:30, or 24:00 for midnight."
  if (issues.opens || issues.closes) return issues
  if (contractClose(day.closesAt) === day.opensAt)
    issues.closes =
      day.opensAt === "00:00"
        ? "Open all day can’t be sent in a bulk change. Set it on each listing’s hours."
        : "Opening and closing times must differ."
  return issues
}

/**
 * A special date's period ends on that date (the contract gives it no end
 * date), so it cannot run past midnight and cannot close at 24:00.
 */
function specialIssues(row: SpecialRow): TimeIssues {
  const issues: TimeIssues = {}
  if (!isValidTime(row.opensAt, { allow24: false })) issues.opens = TIME_FORMAT
  if (!isValidTime(row.closesAt, { allow24: false }))
    issues.closes = TIME_FORMAT
  if (issues.opens || issues.closes) return issues
  if (row.closesAt <= row.opensAt)
    issues.closes =
      "Close after it opens. A special date can’t run past midnight in a bulk change; set late closing on each listing."
  return issues
}

/** The closing day, said out loud, as the single hours editor shows it. */
function closingNote(dayOfWeek: number, day: DayRow): string | null {
  if (
    !isValidTime(day.opensAt, { allow24: false }) ||
    !isValidTime(day.closesAt)
  )
    return null
  if (
    day.closesAt === "24:00" ||
    (day.closesAt === "00:00" && day.opensAt !== "00:00")
  )
    return `Closes at midnight, end of ${DAYS[dayOfWeek]}.`
  if (day.closesAt < day.opensAt)
    return `Closes ${DAYS[(dayOfWeek + 1) % 7]} at ${day.closesAt} (overnight).`
  return null
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
  const [typedHoursType, setTypedHoursType] = useState(false)
  // Service-hour types Google offers, from any selected listing's hours
  // this session has already read. Read from the cache only: opening the
  // picker never sends one request per selected listing to Google.
  const cachedHours = useQueries({
    queries: ids.map((id) => ({
      queryKey: queryKeys.locationHours(id),
      queryFn: (ctx: Parameters<typeof requestOptions>[0]) =>
        fetchHours(id, requestOptions(ctx)),
      enabled: false,
    })),
  })
  const hoursTypes = [
    ...new Map(
      cachedHours
        .flatMap((query) => query.data?.supportedHoursTypes ?? [])
        .map((type) => [type.hoursTypeId, type])
    ).values(),
  ].sort((a, b) => a.displayName.localeCompare(b.displayName))
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
  /** Uploads are refused for the workspace (503 `asset_storage_unavailable`). */
  const storageMissing =
    assets.error instanceof ApiClientError &&
    assets.error.code === "asset_storage_unavailable"
  const [upload, setUpload] = useState<{
    text: string
    failed: boolean
  } | null>(null)
  const uploading = useMutation({
    mutationFn: (file: File) => uploadPhotoAsset(file),
    onSuccess: (asset) => {
      setUpload({
        text: `${asset.fileName} is uploaded and checked.`,
        failed: false,
      })
      setPhoto((current) => ({ ...current, assetId: asset.id }))
      void assets.refetch()
    },
    onError: (error) =>
      setUpload({
        text:
          error instanceof ApiClientError
            ? error.code === "asset_storage_unavailable"
              ? STORAGE_MISSING
              : error.message
            : "The photo couldn’t be uploaded. Try again.",
        failed: true,
      }),
  })
  const cameraInput = useRef<HTMLInputElement>(null)
  const libraryInput = useRef<HTMLInputElement>(null)
  const takeFile = (input: HTMLInputElement) => {
    const file = input.files?.[0]
    input.value = ""
    if (!file) return
    const refused = photoFileProblem(file)
    if (refused) return setUpload({ text: refused, failed: true })
    setUpload({ text: "Uploading and checking the photo…", failed: false })
    uploading.mutate(file)
  }
  /** The batch's ordered change list; each change applies to every selected listing. */
  const [changes, setChanges] = useState<BulkOperationInput[]>([])
  const [failure, setFailure] = useState<string | null>(null)

  const weekly = operation === "regular_hours" ? days : serviceDays
  const weeklyProblems = weekly.map((day) =>
    (operation === "regular_hours" ? day.selected : true) && !day.isClosed
      ? weeklyIssues(day)
      : {}
  )
  const specialProblems = special.map((row) =>
    row.action === "open" ? specialIssues(row) : {}
  )
  const timesWrong =
    operation === "special_hours"
      ? specialProblems.some((issues) => issues.opens || issues.closes)
      : operation === "regular_hours" || operation === "more_hours"
        ? weeklyProblems.some((issues) => issues.opens || issues.closes)
        : false
  const primaryProblem =
    categoryList(categories.primary).length > 1
      ? "Name one primary category."
      : null

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
                        : [
                            {
                              opensAt: day.opensAt,
                              closesAt: contractClose(day.closesAt),
                            },
                          ],
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
                        closesAt: contractClose(day.closesAt),
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
        : timesWrong
          ? "Check the times marked above."
          : operation === "photos" && !photo.assetId
            ? "Upload a photo or choose one already uploaded."
            : operation === "categories" && primaryProblem
              ? "Check the primary category above."
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
  // A valid change in the editor that the list does not hold is not
  // previewed once the list has changes; say so instead of dropping it.
  const unadded =
    changes.length > 0 &&
    parsed.success &&
    !problem &&
    !changes.some(
      (item) => JSON.stringify(item) === JSON.stringify(parsed.data)
    )
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

  const operationInfo = OPERATIONS.find((option) => option.value === operation)
  const updateDay = (index: number, patch: Partial<DayRow>) =>
    (operation === "regular_hours" ? setDays : setServiceDays)((rows) =>
      rows.map((row, i) => (i === index ? { ...row, ...patch } : row))
    )
  const updateSpecial = (index: number, patch: Partial<SpecialRow>) =>
    setSpecial((rows) =>
      rows.map((row, i) => (i === index ? { ...row, ...patch } : row))
    )
  const pickingHoursType = hoursTypes.length > 0 && !typedHoursType

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
      <TargetList ids={ids} names={names} />
      <FormErrorScope>
        <section aria-labelledby="bulk-change" className={GROUP_CLASS}>
          <h2 id="bulk-change" className={GROUP_LABEL_CLASS}>
            Change
          </h2>
          <div
            className={cardClassName({
              className: "flex min-w-0 flex-col gap-4 p-4",
            })}
          >
            {/* Eleven kinds of change: a pop-up list (an action sheet on a
              phone), not a track that hides most of them behind a scroll. */}
            <Field className="max-w-md">
              <FieldLabel>What to change</FieldLabel>
              <Select
                value={operation}
                onValueChange={(value) =>
                  value && setOperation(value as BulkOperation)
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue>
                    {(value: string | null) =>
                      OPERATION_NAME.get(value as BulkOperation) ?? ""
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent title="What to change">
                  {OPERATIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {operationInfo ? (
                <FieldDescription>{operationInfo.description}</FieldDescription>
              ) : null}
            </Field>
            {operation === "special_hours" ? (
              <Fieldset>
                <FieldsetLegend variant="muted">
                  Only these dates change on each listing; its other special
                  dates stay as they are.
                </FieldsetLegend>
                {special.map((row, index) => {
                  const issues = specialProblems[index]
                  return (
                    <Fieldset
                      key={index}
                      className="@container/date rounded-(--np-radius-control) border border-line p-3"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <FieldsetLegend variant="label">
                          Date {index + 1}
                        </FieldsetLegend>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          disabled={special.length === 1}
                          onClick={() =>
                            setSpecial(special.filter((_, i) => i !== index))
                          }
                          aria-label={`Remove date ${index + 1}`}
                        >
                          <Trash2 aria-hidden />
                        </Button>
                      </div>
                      <div className="grid gap-3 @md/date:grid-cols-2">
                        <Field>
                          <FieldLabel>Date</FieldLabel>
                          <Input
                            type="date"
                            enterKeyHint="next"
                            value={row.date}
                            onChange={(e) =>
                              updateSpecial(index, { date: e.target.value })
                            }
                          />
                        </Field>
                        <Field>
                          <FieldLabel>Set to</FieldLabel>
                          <Select
                            value={row.action}
                            onValueChange={(value) =>
                              value &&
                              updateSpecial(index, {
                                action: value as SpecialRow["action"],
                              })
                            }
                          >
                            <SelectTrigger
                              className="w-full"
                              aria-label={`Set to, date ${index + 1}`}
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
                            <SelectContent title={`Set to, date ${index + 1}`}>
                              <SelectItem value="closed">Closed</SelectItem>
                              <SelectItem value="open">Open</SelectItem>
                              <SelectItem value="clear">
                                Remove this date
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        </Field>
                      </div>
                      {row.action === "open" ? (
                        <div className="flex flex-wrap gap-3">
                          <Field>
                            <FieldLabel>Opens</FieldLabel>
                            <TimeField
                              allowEndOfDay={false}
                              aria-label={`Opens, date ${index + 1}`}
                              value={row.opensAt}
                              onValueChange={(next) =>
                                updateSpecial(index, { opensAt: next })
                              }
                            />
                            <FieldError>{issues.opens}</FieldError>
                          </Field>
                          <Field className="min-w-0 flex-1">
                            <FieldLabel>Closes</FieldLabel>
                            <TimeField
                              allowEndOfDay={false}
                              aria-label={`Closes, date ${index + 1}`}
                              value={row.closesAt}
                              onValueChange={(next) =>
                                updateSpecial(index, { closesAt: next })
                              }
                            />
                            <FieldError>{issues.closes}</FieldError>
                          </Field>
                        </div>
                      ) : null}
                    </Fieldset>
                  )
                })}
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
              </Fieldset>
            ) : operation === "regular_hours" || operation === "more_hours" ? (
              <Fieldset>
                <FieldsetLegend variant="muted">
                  {operation === "regular_hours"
                    ? "Only the ticked weekdays change; each listing keeps its other days. Tick all seven to replace the whole week. Special and service hours are untouched."
                    : "Replaces one service-hours type on each listing that Google offers it for. Other types stay as they are."}
                </FieldsetLegend>
                {operation === "more_hours" ? (
                  <Field className="max-w-md">
                    <FieldLabel>Service</FieldLabel>
                    {pickingHoursType ? (
                      <Select
                        value={
                          hoursTypes.some(
                            (type) => type.hoursTypeId === hoursTypeId
                          )
                            ? hoursTypeId
                            : null
                        }
                        onValueChange={(value) => {
                          if (!value) return
                          if (value === OTHER_HOURS_TYPE) {
                            setTypedHoursType(true)
                            setHoursTypeId("")
                          } else setHoursTypeId(value)
                        }}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue>
                            {(value: string | null) =>
                              hoursTypes.find(
                                (type) => type.hoursTypeId === value
                              )?.displayName ?? "Choose a service"
                            }
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent title="Service">
                          {hoursTypes.map((type) => (
                            <SelectItem
                              key={type.hoursTypeId}
                              value={type.hoursTypeId}
                            >
                              {type.displayName}
                            </SelectItem>
                          ))}
                          <SelectItem value={OTHER_HOURS_TYPE}>
                            Another service (type its Google ID)
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        {...inputHints.identifier}
                        autoCapitalize="characters"
                        enterKeyHint="next"
                        value={hoursTypeId}
                        placeholder="For example DELIVERY"
                        onChange={(e) => setHoursTypeId(e.target.value)}
                      />
                    )}
                    <FieldDescription>
                      {pickingHoursType
                        ? "Services Google offers on the selected listings opened here. A listing Google doesn’t offer it for is skipped."
                        : "Google’s ID for the service, such as DELIVERY, TAKEOUT or HAPPY_HOURS. A listing Google doesn’t offer it for is skipped."}
                    </FieldDescription>
                  </Field>
                ) : null}
                <div className="@container/week flex min-w-0 flex-col divide-y divide-line rounded-(--np-radius-control) border border-line">
                  {WEEK.map((dayOfWeek) => {
                    const day = weekly[dayOfWeek]
                    const issues = weeklyProblems[dayOfWeek]
                    const regular = operation === "regular_hours"
                    const changing = regular ? day.selected === true : true
                    const note = closingNote(dayOfWeek, day)
                    return (
                      <div
                        key={DAYS[dayOfWeek]}
                        role="group"
                        aria-label={DAYS[dayOfWeek]}
                        className="flex min-w-0 flex-col gap-2 px-3 py-2 @xl/week:flex-row @xl/week:items-start @xl/week:gap-4"
                      >
                        {/* Day and open switch share one line at every
                          width; the times sit under them on a phone and
                          beside them once the list has the room. */}
                        <div className="flex min-w-0 items-center justify-between gap-3 @xl/week:w-72 @xl/week:shrink-0">
                          {regular ? (
                            <Checkbox
                              label={DAYS[dayOfWeek]}
                              labelClassName="min-w-0 flex-1"
                              checked={day.selected === true}
                              onCheckedChange={(checked) =>
                                updateDay(dayOfWeek, {
                                  selected: checked === true,
                                })
                              }
                            />
                          ) : (
                            <span className="min-w-0 flex-1 text-body text-ink">
                              {DAYS[dayOfWeek]}
                            </span>
                          )}
                          <Switch
                            label={
                              <>
                                {regular ? "Open" : "Offered"}{" "}
                                <span className="sr-only">
                                  on {DAYS[dayOfWeek]}
                                </span>
                              </>
                            }
                            labelClassName="gap-3 text-ui"
                            disabled={!changing}
                            checked={!day.isClosed}
                            onCheckedChange={(checked) =>
                              updateDay(dayOfWeek, { isClosed: !checked })
                            }
                          />
                        </div>
                        {!changing ? (
                          <p className="text-caption text-ink-muted @xl/week:self-center">
                            Left as each listing has it.
                          </p>
                        ) : day.isClosed ? (
                          <p className="text-caption text-ink-muted @xl/week:self-center">
                            {regular ? "Closed all day." : "Not offered."}
                          </p>
                        ) : (
                          <div className="flex min-w-0 flex-wrap gap-x-3 gap-y-2">
                            <Field>
                              <FieldLabel>Opens</FieldLabel>
                              <TimeField
                                allowEndOfDay={false}
                                aria-label={`${DAYS[dayOfWeek]} opens`}
                                value={day.opensAt}
                                onValueChange={(next) =>
                                  updateDay(dayOfWeek, { opensAt: next })
                                }
                              />
                              <FieldError>{issues.opens}</FieldError>
                            </Field>
                            <Field className="min-w-0 flex-1">
                              <FieldLabel>Closes</FieldLabel>
                              <TimeField
                                aria-label={`${DAYS[dayOfWeek]} closes`}
                                value={day.closesAt}
                                onValueChange={(next) =>
                                  updateDay(dayOfWeek, { closesAt: next })
                                }
                              />
                              {issues.closes ? (
                                <FieldError>{issues.closes}</FieldError>
                              ) : note ? (
                                <FieldDescription>{note}</FieldDescription>
                              ) : null}
                            </Field>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
                <FieldsetDescription className="mt-0">
                  A closing time at or before the opening time closes the next
                  day. 24:00 closes at midnight.
                </FieldsetDescription>
              </Fieldset>
            ) : operation === "attributes" ? (
              <Fieldset>
                <FieldsetLegend variant="muted">
                  Only these attributes change. Listings whose category does not
                  offer one are skipped.
                </FieldsetLegend>
                {attributes.map((row, index) => (
                  <div
                    key={index}
                    className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto] sm:items-start"
                  >
                    <Field>
                      <FieldLabel>Google attribute</FieldLabel>
                      <Input
                        {...inputHints.identifier}
                        enterKeyHint="next"
                        aria-label={`Google attribute ${index + 1}`}
                        value={row.name}
                        onChange={(e) =>
                          setAttributes(
                            attributes.map((r, i) =>
                              i === index ? { ...r, name: e.target.value } : r
                            )
                          )
                        }
                      />
                    </Field>
                    <Field>
                      <FieldLabel>Value</FieldLabel>
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
                            {(v: string | null) =>
                              v === "true" ? "Yes" : "No"
                            }
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent title="Value">
                          <SelectItem value="true">Yes</SelectItem>
                          <SelectItem value="false">No</SelectItem>
                        </SelectContent>
                      </Select>
                    </Field>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="self-end sm:mt-7"
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
              </Fieldset>
            ) : operation === "business_info" ? (
              <Fieldset>
                <FieldsetLegend variant="muted">
                  Only the fields you change are sent; everything else on each
                  listing stays as it is. Names, addresses and phone numbers are
                  changed per listing.
                </FieldsetLegend>
                {(
                  [
                    ["Website", website, setWebsite],
                    ["Description", description, setDescription],
                    ["Labels", labels, setLabels],
                  ] as const
                ).map(([label, edit, setEdit]) => (
                  <div key={label} className="grid gap-3 sm:grid-cols-2">
                    <Field>
                      <FieldLabel>{label}</FieldLabel>
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
                        <SelectContent title={label}>
                          <SelectItem value="keep">Leave as is</SelectItem>
                          <SelectItem value="set">Set to</SelectItem>
                          <SelectItem value="clear">Remove</SelectItem>
                        </SelectContent>
                      </Select>
                    </Field>
                    {edit.mode === "set" ? (
                      <Field>
                        <FieldLabel>New {label.toLowerCase()}</FieldLabel>
                        {label === "Description" ? (
                          <Textarea
                            autoSize
                            minRows={3}
                            value={edit.value}
                            onChange={(e) =>
                              setEdit({ ...edit, value: e.target.value })
                            }
                          />
                        ) : label === "Website" ? (
                          <Input
                            {...inputHints.url}
                            enterKeyHint="next"
                            placeholder="https://…"
                            value={edit.value}
                            onChange={(e) =>
                              setEdit({ ...edit, value: e.target.value })
                            }
                          />
                        ) : (
                          <Input
                            autoComplete="off"
                            enterKeyHint="next"
                            value={edit.value}
                            onChange={(e) =>
                              setEdit({ ...edit, value: e.target.value })
                            }
                          />
                        )}
                        {label === "Labels" ? (
                          <FieldDescription>
                            Separate labels with commas, up to 10.
                          </FieldDescription>
                        ) : null}
                      </Field>
                    ) : null}
                  </div>
                ))}
                <Field className="max-w-md">
                  <FieldLabel>Open status</FieldLabel>
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
                    <SelectContent title="Open status">
                      <SelectItem value="keep">Leave as is</SelectItem>
                      <SelectItem value="OPEN">Open</SelectItem>
                      <SelectItem value="CLOSED_TEMPORARILY">
                        Temporarily closed
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              </Fieldset>
            ) : operation === "categories" ? (
              <Fieldset>
                <FieldsetLegend variant="muted">
                  Google category IDs, such as gcid:pub. Additional categories
                  you don’t name stay as each listing has them. Listings whose
                  country doesn’t offer a category are skipped.
                </FieldsetLegend>
                {(
                  [
                    ["primary", "New primary category", "gcid:pub"],
                    [
                      "add",
                      "Add additional categories",
                      "gcid:bar, gcid:restaurant",
                    ],
                    [
                      "remove",
                      "Remove additional categories",
                      "gcid:bar, gcid:restaurant",
                    ],
                  ] as const
                ).map(([key, label, example]) => (
                  <Field
                    key={key}
                    className="max-w-120"
                    error={
                      key === "primary"
                        ? (primaryProblem ?? undefined)
                        : undefined
                    }
                  >
                    <FieldLabel optional={key === "primary"}>
                      {label}
                    </FieldLabel>
                    <Input
                      {...inputHints.identifier}
                      enterKeyHint="next"
                      value={categories[key]}
                      placeholder={example}
                      onChange={(e) =>
                        setCategories({ ...categories, [key]: e.target.value })
                      }
                    />
                    {key === "primary" ? null : (
                      <FieldDescription>
                        Separate IDs with commas.
                      </FieldDescription>
                    )}
                    <FieldError />
                  </Field>
                ))}
              </Fieldset>
            ) : operation === "lodging" ? (
              <Fieldset>
                <FieldsetLegend variant="muted">
                  Only these lodging details change. Listings Google keeps no
                  lodging details for are skipped.
                </FieldsetLegend>
                <datalist id="bulk-lodging-paths">
                  {GOOGLE_LODGING_BOOLEAN_PATHS.map((path) => (
                    <option key={path} value={path} />
                  ))}
                </datalist>
                {lodging.map((row, index) => (
                  <div
                    key={index}
                    className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto] sm:items-start"
                  >
                    <Field>
                      <FieldLabel>Lodging field</FieldLabel>
                      <Input
                        {...inputHints.identifier}
                        enterKeyHint="next"
                        list="bulk-lodging-paths"
                        aria-label={`Lodging field ${index + 1}`}
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
                    </Field>
                    <Field>
                      <FieldLabel>Value</FieldLabel>
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
                        <SelectContent
                          title={`Value for lodging field ${index + 1}`}
                        >
                          <SelectItem value="true">Yes</SelectItem>
                          <SelectItem value="false">No</SelectItem>
                          <SelectItem value="clear">Not set</SelectItem>
                        </SelectContent>
                      </Select>
                    </Field>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="self-end sm:mt-7"
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
              </Fieldset>
            ) : operation === "food_menus" ? (
              <Fieldset>
                <FieldsetLegend variant="muted">
                  Replaces every other listing’s menus with the menus Google
                  shows for one listing. The preview lists every menu entry each
                  listing loses before anything can be approved.
                </FieldsetLegend>
                <Field className="max-w-md">
                  <FieldLabel>Copy the menus of</FieldLabel>
                  <Select
                    value={menuSource}
                    onValueChange={(value) => setMenuSource(value ?? "")}
                  >
                    <SelectTrigger
                      className="w-full"
                      aria-label="Listing whose menus to copy"
                    >
                      <SelectValue>
                        {(v: string | null) =>
                          v ? (names.get(v) ?? "Listing") : "Choose a listing"
                        }
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent title="Copy the menus of">
                      {ids.map((id) => (
                        <SelectItem key={id} value={id}>
                          {names.get(id) ?? "Listing"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {sourceMenus.data ? (
                    <FieldDescription>
                      {`${sourceMenus.data.googleCounts.menus} menus, ${sourceMenus.data.googleCounts.sections} sections, ${sourceMenus.data.googleCounts.items} items.`}
                    </FieldDescription>
                  ) : null}
                </Field>
              </Fieldset>
            ) : operation === "post_draft" ? (
              <Fieldset>
                <FieldsetLegend variant="muted">
                  Creates a separate draft on each listing. Nothing is
                  published: each draft is published from that listing’s posts,
                  with its own approval when two-person approval is on.
                </FieldsetLegend>
                <Field>
                  <FieldLabel>Post text</FieldLabel>
                  <Textarea
                    autoSize
                    minRows={4}
                    maxLength={1500}
                    enterKeyHint="enter"
                    value={post.summary}
                    onChange={(e) =>
                      setPost({ ...post, summary: e.target.value })
                    }
                  />
                  <FieldDescription>
                    {`${post.summary.length} of 1,500 characters.`}
                  </FieldDescription>
                </Field>
              </Fieldset>
            ) : operation === "photos" ? (
              <Fieldset>
                <FieldsetLegend variant="muted">
                  Adds one photo to each listing as a new photo. Photos are
                  stored privately; a listing that already shows the photo is
                  skipped. Up to {BULK_MAX_NEW_PHOTOS_PER_LOCATION} new photos
                  per batch.
                </FieldsetLegend>
                <Fieldset disabled={uploading.isPending || storageMissing}>
                  <FieldsetLegend>Upload a photo</FieldsetLegend>
                  <FieldsetDescription>
                    JPEG or PNG, 10 KB to 5 MB, at least 250 × 250 pixels.
                    Checked when uploaded.
                  </FieldsetDescription>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="secondary"
                      disabled={uploading.isPending || storageMissing}
                      onClick={() => cameraInput.current?.click()}
                    >
                      <Camera aria-hidden /> Take photo
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={uploading.isPending || storageMissing}
                      onClick={() => libraryInput.current?.click()}
                    >
                      <ImagePlus aria-hidden /> Choose from library
                    </Button>
                  </div>
                  {/* The buttons are the controls; these inputs only open the
                    camera or the photo library. */}
                  <input
                    ref={cameraInput}
                    type="file"
                    accept={ASSET_PHOTO_CONTENT_TYPES.join(",")}
                    capture="environment"
                    hidden
                    aria-label="Take photo"
                    disabled={uploading.isPending || storageMissing}
                    onChange={(e) => takeFile(e.currentTarget)}
                  />
                  <input
                    ref={libraryInput}
                    type="file"
                    accept={ASSET_PHOTO_CONTENT_TYPES.join(",")}
                    hidden
                    aria-label="Choose from library"
                    disabled={uploading.isPending || storageMissing}
                    onChange={(e) => takeFile(e.currentTarget)}
                  />
                  {upload?.failed ? (
                    <FormError announce="polite">{upload.text}</FormError>
                  ) : upload || storageMissing ? (
                    <p role="status" className="text-ui text-ink-secondary">
                      {upload?.text ?? STORAGE_MISSING}
                    </p>
                  ) : null}
                </Fieldset>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field>
                    <FieldLabel>Photo</FieldLabel>
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
                            (storageMissing
                              ? STORAGE_MISSING
                              : assets.isError
                                ? "Uploads couldn’t be read"
                                : "Choose an uploaded photo")
                          }
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent title="Uploaded photo to add">
                        {(assets.data ?? []).map((asset) => (
                          <SelectItem key={asset.id} value={asset.id}>
                            {`${asset.fileName} (${asset.width ?? "?"} × ${asset.height ?? "?"})`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field>
                    <FieldLabel>Category</FieldLabel>
                    <Select
                      value={photo.category}
                      onValueChange={(value) =>
                        value &&
                        setPhoto({
                          ...photo,
                          category: value as BulkPhotoCategory,
                        })
                      }
                    >
                      <SelectTrigger
                        className="w-full"
                        aria-label="Photo category"
                      >
                        <SelectValue>
                          {(v: string | null) =>
                            v
                              ? PHOTO_CATEGORY_LABEL[v as BulkPhotoCategory]
                              : ""
                          }
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent title="Photo category">
                        {BULK_PHOTO_CATEGORIES.map((category) => (
                          <SelectItem key={category} value={category}>
                            {PHOTO_CATEGORY_LABEL[category]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                </div>
                <Field>
                  <FieldLabel optional>Description</FieldLabel>
                  <Textarea
                    autoSize
                    minRows={2}
                    maxLength={1500}
                    value={photo.description}
                    onChange={(e) =>
                      setPhoto({ ...photo, description: e.target.value })
                    }
                  />
                </Field>
              </Fieldset>
            ) : (
              <Fieldset>
                <FieldsetLegend variant="muted">
                  Adds or updates the link on each listing, or removes the exact
                  matching link. Links a booking provider owns are never
                  changed.
                </FieldsetLegend>
                <SegmentedControl
                  semantics="radio"
                  value={link.action}
                  onValueChange={(value) =>
                    setLink({ ...link, action: value as "upsert" | "delete" })
                  }
                  aria-label="Link change"
                >
                  <SegmentedControlItem value="upsert">
                    Add or update
                  </SegmentedControlItem>
                  <SegmentedControlItem value="delete">
                    Remove
                  </SegmentedControlItem>
                </SegmentedControl>
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
                  <Field>
                    <FieldLabel>Type</FieldLabel>
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
                      <SelectContent title="Type">
                        {GOOGLE_PLACE_ACTION_TYPES.map((type) => (
                          <SelectItem key={type} value={type}>
                            {actionTypeLabel(type)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field>
                    <FieldLabel>Link</FieldLabel>
                    <Input
                      {...inputHints.url}
                      enterKeyHint="done"
                      value={link.uri}
                      placeholder="https://…"
                      onChange={(e) =>
                        setLink({ ...link, uri: e.target.value })
                      }
                    />
                  </Field>
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
              </Fieldset>
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
          </div>
        </section>
      </FormErrorScope>
      <section aria-labelledby="bulk-batch" className={GROUP_CLASS}>
        <h2 id="bulk-batch" className={GROUP_LABEL_CLASS}>
          Changes in this batch
        </h2>
        <div
          className={cardClassName({
            className: "flex min-w-0 flex-col gap-3 p-4",
          })}
        >
          {changes.length ? (
            <ol
              aria-label="Changes in this batch, in the order they are sent"
              className="flex flex-col divide-y divide-line"
            >
              {changes.map((item, index) => (
                <li
                  key={index}
                  className="flex min-h-(--np-touch) flex-wrap items-center justify-between gap-x-2 gap-y-1 py-1 text-ui text-ink"
                >
                  <span className="min-w-0 flex-1 break-words">
                    {index + 1}. {changeSummary(item)}
                  </span>
                  <span className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      disabled={index === 0}
                      aria-label={`Move change ${index + 1} up`}
                      onClick={() => move(index, index - 1)}
                    >
                      <ArrowUp aria-hidden />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      disabled={index === changes.length - 1}
                      aria-label={`Move change ${index + 1} down`}
                      onClick={() => move(index, index + 1)}
                    >
                      <ArrowDown aria-hidden />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
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
          <p className="text-caption text-ink-muted tabular-nums">
            {`${ids.length} ${ids.length === 1 ? "listing" : "listings"} × ${batch.length} ${batch.length === 1 ? "change" : "changes"} = ${ids.length * batch.length} of at most ${BULK_MAX_ITEMS}. At most ${BULK_MAX_TARGETS} listings.`}
          </p>
          {unadded ? (
            <p role="status" className="text-ui text-ink-secondary">
              The change being edited above is not in this batch, so it is not
              previewed. Add it to the batch to include it.
            </p>
          ) : null}
          {batchProblem ? (
            <p role="status" className="text-ui text-danger-ink">
              {batchProblem}
            </p>
          ) : null}
          <FormError>{failure}</FormError>
        </div>
      </section>
      {/* Preparing a preview reads Google but writes nothing, so this is
          the light bar, not the charcoal one: docked to the bottom edge on
          a phone (the tab bar steps aside), sticky below the form on a
          desk. */}
      <ActionBar
        tone="surface"
        dock
        offset="bottom-3"
        label="Preview the bulk change"
        status={
          <span className="min-w-0 tabular-nums">
            {preview.isPending
              ? "Preparing the preview…"
              : batchProblem
                ? "Fix the batch above to preview it"
                : batch.length
                  ? `${ids.length * batch.length} listing ${ids.length * batch.length === 1 ? "change" : "changes"} to preview`
                  : "Nothing to preview yet"}
          </span>
        }
        primary={
          <Button
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
              : changes.length === 1
                ? "Preview the 1 change in the list"
                : "Preview this change"}
          </Button>
        }
      />
    </>
  )
}

/**
 * A compose group: a sentence-case label (D8) above its card, the way a
 * mail composer labels its recipients and its fields.
 */
const GROUP_CLASS = "flex min-w-0 flex-col gap-2"
const GROUP_LABEL_CLASS = "px-1 text-caption font-medium text-ink-muted"

/**
 * The listings this batch covers, behind a count: up to 50 names are a
 * screenful on a phone, so they open on request (and start open when there
 * are only a few).
 */
function TargetList({
  ids,
  names,
}: {
  ids: string[]
  names: Map<string, string>
}) {
  const count = `${ids.length} ${ids.length === 1 ? "listing" : "listings"}`
  return (
    <section aria-labelledby="bulk-targets" className={GROUP_CLASS}>
      <h2 id="bulk-targets" className={GROUP_LABEL_CLASS}>
        Selected listings
      </h2>
      {ids.length === 0 ? (
        <p
          className={cardClassName({
            className: "px-4 py-3 text-ui text-ink-secondary",
          })}
        >
          None
        </p>
      ) : (
        <details
          open={ids.length <= 3}
          className={cardClassName({ className: "group" })}
        >
          <summary
            className={cn(
              "flex min-h-(--np-touch) cursor-pointer list-none items-center justify-between gap-3 rounded-(--np-radius-card) px-4 text-ui font-semibold text-ink focus-halo",
              "[&::-webkit-details-marker]:hidden"
            )}
          >
            <span className="tabular-nums">{count}</span>
            <ChevronDown
              aria-hidden
              strokeWidth={1.75}
              className="size-4 shrink-0 text-ink-muted transition-transform duration-(--np-duration-fast) group-open:rotate-180"
            />
          </summary>
          <ul className="flex flex-col divide-y divide-line border-t border-line px-4">
            {ids.map((id) => (
              <li key={id} className="py-2 text-ui break-words text-ink">
                {names.get(id) ?? "Listing"}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}
