"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useState, useSyncExternalStore } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Empty } from "@/components/ui/empty"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
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

export function PrivacyRequestsCard({ canManage }: { canManage: boolean }) {
  const query = usePrivacyRequests()
  const client = useQueryClient()
  const toast = useToastManager()
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
    <section className="flex flex-col gap-4">
      <h2 className="text-title">Privacy requests</h2>
      <form className="flex flex-wrap items-end gap-3" onSubmit={onSubmit}>
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
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
        <Button type="submit" disabled={create.isPending}>
          {create.isPending ? "Logging…" : "Log request"}
        </Button>
      </form>

      {query.isPending ? (
        <Skeleton className="h-24 w-full" />
      ) : query.isError ? (
        <Empty
          title="We couldn’t load privacy requests"
          description={describeActionError(query.error)}
        />
      ) : rows.length === 0 ? (
        <Empty
          title="No privacy requests"
          description="Logged data-subject requests appear here."
        />
      ) : (
        <>
          <p className="text-caption text-muted-foreground">
            {openCount} open, {overdueCount} past the {RESPONSE_WINDOW_DAYS}-day
            response window.
          </p>
          <Table className="min-w-[820px]">
            <TableHeader>
              <TableRow>
                <TableHead>Subject</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Deadline</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ row, sla }) => (
                <TableRow key={row.id}>
                  <TableCell className="font-medium">
                    {row.subjectReference}
                  </TableCell>
                  <TableCell>{requestTypeLabel(row.requestType)}</TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        row.status === "completed"
                          ? "success"
                          : row.status === "rejected"
                            ? "outline"
                            : "secondary"
                      }
                    >
                      {requestStatusLabel(row.status)}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {!sla ? (
                      <span className="text-caption text-muted-foreground">
                        —
                      </span>
                    ) : sla.overdue ? (
                      <Badge variant="destructive">{slaLabel(sla)}</Badge>
                    ) : (
                      <span className="text-caption text-muted-foreground">
                        {slaLabel(sla)}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    {OPEN_STATUSES.has(row.status) ? (
                      canManage ? (
                        <span className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={resolve.isPending}
                            onClick={() => resolve.mutate(row.id)}
                          >
                            Fulfil
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={reject.isPending}
                            onClick={() => reject.mutate(row.id)}
                          >
                            Reject
                          </Button>
                        </span>
                      ) : (
                        <span className="text-caption text-muted-foreground">
                          Awaiting an owner
                        </span>
                      )
                    ) : (
                      <span className="text-caption text-muted-foreground">
                        Resolved
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </>
      )}
    </section>
  )
}
