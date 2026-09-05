"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { FileText } from "lucide-react"
import { useId, useState, useSyncExternalStore } from "react"

import { Button } from "@/components/ui/button"
import { Empty } from "@/components/ui/empty"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { GroupedList, GroupedListItem } from "@/components/ui/grouped-list"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { StatusPill } from "@/components/ui/status-pill"
import { Textarea } from "@/components/ui/textarea"
import { useToastManager } from "@/components/ui/toast"
import { queryKeys } from "@/lib/queries/keys"
import { usePrivacyRequests } from "@/lib/queries/use-privacy-requests"
import {
  createPrivacyRequest,
  updatePrivacyRequest,
  type PrivacyRequest,
} from "@/lib/api/privacy"
import { describeActionError } from "@/lib/errors/action-errors"
import {
  REQUEST_TYPE_OPTIONS,
  privacyRequestFormSchema,
  requestStatusLabel,
  requestTypeLabel,
  type PrivacyRequestType,
} from "@/lib/settings/forms/privacy-request"
import type { StatusTone } from "@/lib/ui/status-tone"

const OPEN_STATUSES = new Set(["pending", "in_progress"])

const DAY_MS = 24 * 60 * 60 * 1000

// The statutory response window (GDPR Art. 12(3), one month). The server pins
// the same window into privacy_request.due_at when a request is logged
// (supabase/migrations/0041_privacy_fulfilment.sql); until `dueAt` is on the
// wire contract, the console derives it from `createdAt`, which is.
const RESPONSE_WINDOW_DAYS = 30

type Sla = { overdue: boolean; days: number }

/** Days left, or days past, for a request that is still open. */
function slaFor(row: PrivacyRequest, now: number): Sla | null {
  if (!OPEN_STATUSES.has(row.status)) return null
  const createdAt = new Date(row.createdAt).getTime()
  if (Number.isNaN(createdAt)) return null
  const remainingMs = createdAt + RESPONSE_WINDOW_DAYS * DAY_MS - now
  return remainingMs < 0
    ? { overdue: true, days: Math.ceil(-remainingMs / DAY_MS) }
    : { overdue: false, days: Math.floor(remainingMs / DAY_MS) }
}

function slaLabel(sla: Sla) {
  const days = `${sla.days} ${sla.days === 1 ? "day" : "days"}`
  return sla.overdue ? `Overdue by ${days}` : `Due in ${days}`
}

function statusTone(status: string): StatusTone {
  if (status === "completed") return "healthy"
  if (status === "rejected") return "neutral"
  return "pending"
}

// The wall clock, subscribed to like any other external source: `Date.now()`
// cannot be read during render, and the deadline is clock-derived. Refreshed
// hourly, which is ample for a day-granular display and enough that a console
// left open overnight stops calling a breached request "due in 0 days".
let clockSnapshot = 0

function subscribeToClock(onChange: () => void) {
  clockSnapshot = Date.now()
  const timer = setInterval(
    () => {
      clockSnapshot = Date.now()
      onChange()
    },
    60 * 60 * 1000
  )
  return () => clearInterval(timer)
}

// Seeded on first read, not on subscribe: React reads the snapshot during the
// render that mounts the component and only subscribes afterwards, so a zero
// here would render every open request as "due in 20,000 days" for one frame.
// It stays a cached value, which is what useSyncExternalStore requires.
function readClock() {
  if (clockSnapshot === 0) clockSnapshot = Date.now()
  return clockSnapshot
}

/**
 * Data-subject requests: a form to log one, and the list of every request
 * with its type, status and the statutory deadline. Fulfil and Reject sit on
 * the row for an owner; everyone else sees who the request is waiting on.
 */
export function PrivacyRequestsCard({ canManage }: { canManage: boolean }) {
  const query = usePrivacyRequests()
  const client = useQueryClient()
  const toast = useToastManager()
  const headingId = useId()
  const [requestType, setRequestType] = useState<PrivacyRequestType>("access")
  const [subjectReference, setSubjectReference] = useState("")
  const [reason, setReason] = useState("")
  const [subjectError, setSubjectError] = useState<string | null>(null)

  const invalidate = () =>
    client.invalidateQueries({ queryKey: queryKeys.privacyRequests })

  const create = useMutation({
    mutationFn: (input: {
      requestType: string
      subjectReference: string
      reason?: string
    }) => createPrivacyRequest(input),
    onSuccess: async () => {
      setSubjectReference("")
      setReason("")
      setSubjectError(null)
      await invalidate()
      toast.add({ title: "Request logged", type: "success" })
    },
    onError: (error) =>
      toast.add({ title: describeActionError(error), type: "error" }),
  })

  const resolve = useMutation({
    mutationFn: (id: string) =>
      updatePrivacyRequest({
        id,
        action: "fulfil",
        resolutionNote: "Fulfilled from the compliance console.",
      }),
    onSuccess: async () => {
      await invalidate()
      toast.add({ title: "Request fulfilled", type: "success" })
    },
    onError: (error) =>
      toast.add({ title: describeActionError(error), type: "error" }),
  })

  const reject = useMutation({
    mutationFn: (id: string) =>
      updatePrivacyRequest({
        id,
        status: "rejected",
        resolutionNote: "Rejected from the compliance console.",
      }),
    onSuccess: async () => {
      await invalidate()
      toast.add({ title: "Request rejected", type: "success" })
    },
    onError: (error) =>
      toast.add({ title: describeActionError(error), type: "error" }),
  })

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    const parsed = privacyRequestFormSchema.safeParse({
      requestType,
      subjectReference,
      reason: reason.trim() ? reason : undefined,
    })
    if (!parsed.success) {
      setSubjectError(
        parsed.error.issues[0]?.message ?? "Enter a subject reference."
      )
      return
    }
    create.mutate(parsed.data)
  }

  // Null until the clock store is subscribed — on the server, and for the
  // hydrating render.
  const now = useSyncExternalStore(subscribeToClock, readClock, () => null)
  // The server returns open requests first, nearest deadline at the top.
  const rows = (query.data?.requests ?? []).map((row: PrivacyRequest) => ({
    row,
    sla: now === null ? null : slaFor(row, now),
  }))
  const openCount = rows.filter(({ row }) =>
    OPEN_STATUSES.has(row.status)
  ).length
  const overdueCount = rows.filter(({ sla }) => sla?.overdue).length

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h2 id={headingId} className="text-title font-semibold text-ink">
        Privacy requests
      </h2>
      <form
        className="flex flex-col gap-3 rounded-(--np-radius-card) bg-surface p-(--np-card-pad)"
        onSubmit={onSubmit}
      >
        <div className="flex flex-wrap items-start gap-3">
          <div className="flex flex-col gap-1.5">
            <span className="text-ui font-medium text-ink" aria-hidden>
              Request type
            </span>
            <Select
              value={requestType}
              onValueChange={(value: string | null) => {
                if (value) setRequestType(value as PrivacyRequestType)
              }}
            >
              <SelectTrigger aria-label="Request type" className="w-40">
                <SelectValue>{requestTypeLabel(requestType)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {REQUEST_TYPE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Field error={subjectError ?? undefined} className="min-w-56 flex-1">
            <FieldLabel>Subject reference</FieldLabel>
            <Input
              value={subjectReference}
              aria-label="Subject reference"
              placeholder="e.g. guest-4821"
              onChange={(event) => setSubjectReference(event.target.value)}
            />
            <FieldError>{subjectError}</FieldError>
          </Field>
          <Field className="min-w-56 flex-1">
            <FieldLabel>Reason (optional)</FieldLabel>
            <Textarea
              value={reason}
              aria-label="Reason"
              rows={1}
              className="min-h-(--np-field-h)"
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
        </div>
        <div className="flex justify-end">
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? "Logging…" : "Log request"}
          </Button>
        </div>
      </form>

      {query.isPending ? (
        <Skeleton className="h-[calc(var(--np-row-h)*2)] w-full rounded-(--np-radius-card)" />
      ) : query.isError ? (
        <Empty
          title="We couldn’t load privacy requests"
          description={describeActionError(query.error)}
        />
      ) : rows.length === 0 ? (
        <Empty
          icon={<FileText />}
          title="No privacy requests"
          description="Logged data-subject requests appear here."
        />
      ) : (
        <GroupedList
          header={`${openCount} open, ${overdueCount} past the ${RESPONSE_WINDOW_DAYS}-day response window.`}
        >
          {rows.map(({ row, sla }) => {
            const open = OPEN_STATUSES.has(row.status)
            return (
              <GroupedListItem
                key={row.id}
                icon={<FileText />}
                label={row.subjectReference}
                description={
                  <>
                    <span>{requestTypeLabel(row.requestType)}</span>
                    {sla && !sla.overdue ? (
                      <span>{` · ${slaLabel(sla)}`}</span>
                    ) : null}
                  </>
                }
                trailing={
                  <>
                    {sla?.overdue ? (
                      <StatusPill tone="at-risk">{slaLabel(sla)}</StatusPill>
                    ) : null}
                    <StatusPill tone={statusTone(row.status)}>
                      {requestStatusLabel(row.status)}
                    </StatusPill>
                    {open ? (
                      canManage ? (
                        <>
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={resolve.isPending}
                            aria-label={`Fulfil request for ${row.subjectReference}`}
                            onClick={() => resolve.mutate(row.id)}
                          >
                            Fulfil
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-danger-ink"
                            disabled={reject.isPending}
                            aria-label={`Reject request for ${row.subjectReference}`}
                            onClick={() => reject.mutate(row.id)}
                          >
                            Reject
                          </Button>
                        </>
                      ) : (
                        <span className="text-caption">Awaiting an owner</span>
                      )
                    ) : null}
                  </>
                }
              />
            )
          })}
        </GroupedList>
      )}
    </section>
  )
}
