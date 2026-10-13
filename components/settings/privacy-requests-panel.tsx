"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { FileLock2, Plus } from "lucide-react"
import { useRef, useState } from "react"

import { SettingsSection } from "@/components/settings/settings-section"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Empty } from "@/components/ui/empty"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { QueryStates, queryStatus } from "@/components/ui/query-states"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { StatusPill } from "@/components/ui/status-pill"
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
import { ApiClientError } from "@/lib/api/client"
import {
  createPrivacyRequest,
  updatePrivacyRequest,
  type PrivacyRequest,
} from "@/lib/api/privacy"
import { describeActionError } from "@/lib/errors/action-errors"
import { queryKeys } from "@/lib/queries/keys"
import { usePrivacyRequests } from "@/lib/queries/use-privacy"
import {
  privacyRequestFormSchema,
  REQUEST_TYPE_OPTIONS,
  requestTypeLabel,
  type PrivacyRequestType,
} from "@/lib/settings/forms/privacy-request"
import type { PrivacyGating } from "@/lib/settings/gating"
import {
  fulfilDescription,
  hasPendingWithdrawal,
  isOpenRequest,
  presentPrivacyRequest,
  sortPrivacyRequests,
} from "@/lib/settings/privacy"
import { formatDay } from "@/lib/settings/roles"

/**
 * Log a data-subject request. Owners and admins may (POST is `["owner",
 * "admin"]`); only an owner resolves it. The statutory due date is set by
 * the database from when it is logged.
 */
function CreateRequestDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const client = useQueryClient()
  const toast = useToastManager()
  const subjectRef = useRef<HTMLInputElement>(null)
  const [requestType, setRequestType] = useState<PrivacyRequestType>("access")
  const [subject, setSubject] = useState("")
  const [reason, setReason] = useState("")
  const [subjectError, setSubjectError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  const reset = () => {
    setRequestType("access")
    setSubject("")
    setReason("")
    setSubjectError(null)
    setFormError(null)
  }

  const create = useMutation({
    mutationFn: createPrivacyRequest,
    onSuccess: async (result) => {
      await client.invalidateQueries({ queryKey: queryKeys.privacyRequests })
      toast.add({
        title: `${requestTypeLabel(result.request.requestType)} request logged`,
        type: "success",
      })
      reset()
      onOpenChange(false)
    },
    onError: (error) => setFormError(describeActionError(error)),
  })

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    setFormError(null)
    const parsed = privacyRequestFormSchema.safeParse({
      requestType,
      subjectReference: subject,
      reason: reason.trim() === "" ? undefined : reason,
    })
    if (!parsed.success) {
      const issue = parsed.error.issues.find(
        (item) => item.path[0] === "subjectReference"
      )
      setSubjectError(issue?.message ?? "Check the subject reference.")
      subjectRef.current?.focus()
      return
    }
    setSubjectError(null)
    create.mutate(parsed.data)
  }

  const dirty =
    requestType !== "access" || subject.trim() !== "" || reason.trim() !== ""

  return (
    <Dialog
      open={open}
      dirty={dirty && !create.isPending}
      onDiscard={reset}
      discardPrompt={{
        title: "Discard this request?",
        description: "The details you entered won’t be logged.",
      }}
      onOpenChange={(next) => {
        if (!next) {
          if (create.isPending) return
          reset()
        }
        onOpenChange(next)
      }}
    >
      <DialogContent className="grid-cols-[minmax(0,1fr)]">
        <DialogHeader>
          <DialogTitle>Log a privacy request</DialogTitle>
          <DialogDescription>
            Record a request from someone whose review data we hold. It is due
            30 days from today.
          </DialogDescription>
        </DialogHeader>
        <form noValidate onSubmit={onSubmit} className="contents">
          <DialogBody>
            <Field>
              <FieldLabel>Request type</FieldLabel>
              <Select
                value={requestType}
                onValueChange={(value) =>
                  setRequestType(value as PrivacyRequestType)
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue>
                    {(value: string | null) => requestTypeLabel(value ?? "")}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {REQUEST_TYPE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field error={subjectError ?? undefined}>
              <FieldLabel>Subject reference</FieldLabel>
              <Input
                ref={subjectRef}
                autoComplete="off"
                spellCheck={false}
                value={subject}
                placeholder="The reviewer’s name as shown on Google, or a review id"
                onChange={(event) => {
                  setSubject(event.target.value)
                  if (subjectError) setSubjectError(null)
                }}
              />
              <FieldError>{subjectError}</FieldError>
            </Field>
            <Field>
              <FieldLabel optional>Notes</FieldLabel>
              <Textarea
                autoSize
                value={reason}
                maxLength={2000}
                onChange={(event) => setReason(event.target.value)}
              />
            </Field>
            {formError ? (
              <Alert variant="destructive">
                <AlertTitle>The request wasn’t logged</AlertTitle>
                <AlertDescription>
                  {formError} Your entries are kept, so you can try again.
                </AlertDescription>
              </Alert>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <DialogClose render={<Button variant="ghost">Cancel</Button>} />
            <Button
              type="submit"
              pending={create.isPending}
              pendingLabel="Logging…"
            >
              Log request
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

type Resolution = { request: PrivacyRequest; mode: "fulfil" | "reject" }

/**
 * Fulfil or reject one open request, with the resolution note the route
 * requires. A legal hold refuses an erasure (409) and keeps the dialog open
 * saying so; a reply Google would not drop (409) is not a failure here: the
 * local erasure committed and the job tick retries the withdrawal, so the
 * dialog closes and the row shows it in progress.
 */
function ResolveDialog({
  target,
  onClose,
}: {
  target: Resolution | null
  onClose: () => void
}) {
  const client = useQueryClient()
  const toast = useToastManager()
  const [note, setNote] = useState("")
  const [noteError, setNoteError] = useState<string | null>(null)
  const [formError, setFormError] = useState<{
    title: string
    message: string
  } | null>(null)

  const close = () => {
    setNote("")
    setNoteError(null)
    setFormError(null)
    onClose()
  }

  const refresh = () =>
    client.invalidateQueries({ queryKey: queryKeys.privacyAll })

  const resolve = useMutation({
    mutationFn: ({
      request,
      mode,
      resolutionNote,
    }: Resolution & { resolutionNote: string }) =>
      updatePrivacyRequest(
        mode === "fulfil"
          ? { id: request.id, action: "fulfil", resolutionNote }
          : { id: request.id, status: "rejected", resolutionNote }
      ),
    onSuccess: async (result, input) => {
      await refresh()
      toast.add({
        title:
          input.mode === "reject"
            ? "Request rejected"
            : result.request.status === "completed"
              ? "Request fulfilled"
              : "Request in progress",
        type: "success",
      })
      close()
    },
    onError: async (error) => {
      if (error instanceof ApiClientError) {
        if (error.code === "privacy_reply_withdraw_failed") {
          await refresh()
          toast.add({
            title: "Erased here; a reply is still live on Google",
            description:
              "The request stays open while the withdrawal is retried automatically.",
            type: "warning",
          })
          close()
          return
        }
        if (error.code === "privacy_legal_hold") {
          setFormError({
            title: "A legal hold blocks this erasure",
            message: `${describeActionError(error)} Release the hold below, or reject the request with a note explaining why.`,
          })
          return
        }
        if (error.code === "privacy_request_resolved") {
          await refresh()
        }
      }
      setFormError({
        title:
          target?.mode === "reject"
            ? "The request wasn’t rejected"
            : "The request wasn’t fulfilled",
        message: describeActionError(error),
      })
    },
  })

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    if (!target) return
    const trimmed = note.trim()
    if (trimmed.length < 3) {
      setNoteError("Write a note of at least 3 characters.")
      return
    }
    setNoteError(null)
    setFormError(null)
    resolve.mutate({ ...target, resolutionNote: trimmed })
  }

  const request = target?.request
  const fulfil = target?.mode === "fulfil"
  return (
    <Dialog
      open={target !== null}
      dirty={note.trim() !== "" && !resolve.isPending}
      onDiscard={close}
      discardPrompt={{
        title: "Discard this note?",
        description: "The request stays open and the note you wrote is lost.",
      }}
      onOpenChange={(open) => {
        if (!open && !resolve.isPending) close()
      }}
    >
      <DialogContent className="grid-cols-[minmax(0,1fr)]">
        <DialogHeader>
          <DialogTitle className="[overflow-wrap:anywhere]">
            {fulfil ? "Fulfil" : "Reject"}{" "}
            {request ? requestTypeLabel(request.requestType).toLowerCase() : ""}{" "}
            request for {request?.subjectReference}
          </DialogTitle>
          <DialogDescription>
            {fulfil
              ? fulfilDescription(request?.requestType ?? "")
              : "Closes the request without acting on it. Say why: the note is kept in the audit log."}
          </DialogDescription>
        </DialogHeader>
        <form noValidate onSubmit={onSubmit} className="contents">
          <DialogBody>
            <Field error={noteError ?? undefined}>
              <FieldLabel>Resolution note</FieldLabel>
              <Textarea
                autoSize
                value={note}
                maxLength={2000}
                onChange={(event) => {
                  setNote(event.target.value)
                  if (noteError) setNoteError(null)
                }}
              />
              <FieldError>{noteError}</FieldError>
            </Field>
            {formError ? (
              <Alert variant="destructive">
                <AlertTitle>{formError.title}</AlertTitle>
                <AlertDescription>{formError.message}</AlertDescription>
              </Alert>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <DialogClose render={<Button variant="ghost">Cancel</Button>} />
            <Button
              type="submit"
              variant={fulfil ? "default" : "danger"}
              pending={resolve.isPending}
              pendingLabel={fulfil ? "Fulfilling…" : "Rejecting…"}
            >
              {fulfil ? "Fulfil request" : "Reject request"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/**
 * The organisation's data-subject requests (plan P04-7): stalled withdrawals
 * first, then open requests by deadline with overdue ones marked, then
 * resolved ones. Owners fulfil and reject; admins see the list and log new
 * requests. An erasure with replies still to withdraw offers no Reject: it
 * was carried out here, and closing it would stop the retry.
 */
export function PrivacyRequestsPanel({ gating }: { gating: PrivacyGating }) {
  const query = usePrivacyRequests()
  const [creating, setCreating] = useState(false)
  const [target, setTarget] = useState<Resolution | null>(null)
  const requests = query.data ? sortPrivacyRequests(query.data.requests) : []

  return (
    <SettingsSection
      id="privacy-requests"
      title="Privacy requests"
      description="Access, correction, erasure and restriction requests about reviewers’ data, each due 30 days after it is logged."
      action={
        gating.canCreateRequests ? (
          <Button
            variant="secondary"
            className="w-full sm:w-auto"
            onClick={() => setCreating(true)}
          >
            <Plus aria-hidden />
            Log a request
          </Button>
        ) : null
      }
    >
      <QueryStates
        status={queryStatus(query, { isEmpty: requests.length === 0 })}
        pendingLabel="Loading privacy requests"
        error={{
          title: "We couldn’t load privacy requests",
          cause: query.error,
        }}
        onRetry={() => void query.refetch()}
        empty={
          <Empty
            icon={<FileLock2 />}
            title="No privacy requests"
            description="Requests you log appear here with their due dates."
          />
        }
      >
        {() => (
          <Table responsive aria-label="Privacy requests">
            <TableHeader>
              <TableRow>
                <TableHead>Request</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Due</TableHead>
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {requests.map((request) => {
                const state = presentPrivacyRequest(request)
                const open = isOpenRequest(request)
                return (
                  <TableRow key={request.id} data-request-id={request.id}>
                    <TableCell label="Request">
                      <span className="flex min-w-0 flex-col">
                        <span className="font-semibold [overflow-wrap:anywhere] text-ink">
                          {request.subjectReference}
                        </span>
                        <span className="text-caption text-ink-muted">
                          {requestTypeLabel(request.requestType)} · logged{" "}
                          {formatDay(request.createdAt)}
                        </span>
                      </span>
                    </TableCell>
                    <TableCell label="Status">
                      <span className="flex min-w-0 flex-col gap-1">
                        <StatusPill tone={state.tone}>{state.label}</StatusPill>
                        {state.detail ? (
                          <span className="text-caption text-ink-muted">
                            {state.detail}
                          </span>
                        ) : null}
                        {!open && request.resolutionNote ? (
                          <span className="text-caption [overflow-wrap:anywhere] text-ink-muted">
                            {request.resolutionNote}
                          </span>
                        ) : null}
                      </span>
                    </TableCell>
                    <TableCell label="Due">
                      {open && request.dueAt ? (
                        formatDay(request.dueAt)
                      ) : request.resolvedAt ? (
                        <span className="text-ink-muted">
                          Closed {formatDay(request.resolvedAt)}
                        </span>
                      ) : (
                        <span className="text-ink-muted">—</span>
                      )}
                    </TableCell>
                    <TableCell actions className="text-right">
                      {open && gating.canManagePrivacy ? (
                        <span className="grid grid-cols-2 gap-2 @3xl/table:inline-flex @3xl/table:justify-end @3xl/table:gap-1.5">
                          <Button
                            variant="secondary"
                            size="sm"
                            aria-label={`Fulfil request for ${request.subjectReference}`}
                            onClick={() =>
                              setTarget({ request, mode: "fulfil" })
                            }
                          >
                            Fulfil
                          </Button>
                          {hasPendingWithdrawal(request) ? null : (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-danger-ink"
                              aria-label={`Reject request for ${request.subjectReference}`}
                              onClick={() =>
                                setTarget({ request, mode: "reject" })
                              }
                            >
                              Reject
                            </Button>
                          )}
                        </span>
                      ) : null}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </QueryStates>
      {gating.canCreateRequests ? (
        <CreateRequestDialog open={creating} onOpenChange={setCreating} />
      ) : null}
      {gating.canManagePrivacy ? (
        <ResolveDialog target={target} onClose={() => setTarget(null)} />
      ) : null}
    </SettingsSection>
  )
}
