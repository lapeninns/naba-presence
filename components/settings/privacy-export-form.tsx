"use client"

import { Download } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  exportPrivacyPage,
  type PrivacyExportResponse,
} from "@/lib/api/privacy"
import { describeActionError } from "@/lib/errors/action-errors"
import { formatNumber } from "@/lib/format"
import {
  assembleSubjectExport,
  exportFilename,
  type SubjectExport,
} from "@/lib/settings/privacy"

type ExportState =
  | { phase: "idle" }
  | { phase: "running"; subject: string; pages: PrivacyExportResponse[] }
  | {
      phase: "failed"
      subject: string
      pages: PrivacyExportResponse[]
      message: string
    }
  | { phase: "done"; result: SubjectExport }

function saveJson(result: SubjectExport) {
  const blob = new Blob([JSON.stringify(result, null, 2)], {
    type: "application/json",
  })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = exportFilename(result.generatedAt)
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

/**
 * Subject export (plan P04-7), owners only: fetches every keyset page of
 * POST /api/privacy/export in turn and joins them into one JSON file. A
 * page that fails leaves the pages already fetched in place, and Resume
 * carries on from the last cursor received instead of starting again; a
 * failed first page has nothing to resume and shows a plain error. The
 * subject is sent in the request body only, and the file name carries none
 * of it.
 */
export function PrivacyExportForm() {
  const [subject, setSubject] = useState("")
  const [subjectError, setSubjectError] = useState<string | null>(null)
  const [state, setState] = useState<ExportState>({ phase: "idle" })
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => () => abortRef.current?.abort(), [])

  const run = async (target: string, fetched: PrivacyExportResponse[]) => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    const pages = [...fetched]
    setState({ phase: "running", subject: target, pages })
    try {
      for (;;) {
        const cursor = pages[pages.length - 1]?.nextCursor ?? undefined
        const page = await exportPrivacyPage(
          { subject: target, ...(cursor ? { cursor } : {}) },
          { signal: controller.signal }
        )
        pages.push(page)
        if (page.nextCursor === null) break
        setState({ phase: "running", subject: target, pages: [...pages] })
      }
      setState({ phase: "done", result: assembleSubjectExport(pages) })
    } catch (error) {
      if (controller.signal.aborted) return
      setState({
        phase: "failed",
        subject: target,
        pages,
        message: describeActionError(error),
      })
    }
  }

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    const target = subject.trim()
    if (target.length < 3) {
      setSubjectError("Enter at least 3 characters.")
      return
    }
    setSubjectError(null)
    void run(target, [])
  }

  const running = state.phase === "running"
  const fetched =
    state.phase === "running" || state.phase === "failed"
      ? state.pages.reduce((sum, page) => sum + page.returned, 0)
      : 0
  const total =
    state.phase === "running" || state.phase === "failed"
      ? state.pages[state.pages.length - 1]?.totalMatched
      : undefined

  return (
    <section aria-labelledby="privacy-export" className="flex flex-col gap-3">
      <div>
        <h2 id="privacy-export" className="text-title font-semibold text-ink">
          Export a subject’s records
        </h2>
        <p className="text-caption text-ink-muted">
          Everything still held about one reviewer, as a JSON file, to answer an
          access request. Every page fetched is recorded in the audit log.
        </p>
      </div>
      <form
        noValidate
        onSubmit={onSubmit}
        className="flex flex-col gap-4 rounded-(--np-radius-card) border border-line bg-surface p-(--np-card-pad)"
      >
        <Field error={subjectError ?? undefined}>
          <FieldLabel>Subject reference</FieldLabel>
          <Input
            autoComplete="off"
            value={subject}
            disabled={running}
            onChange={(event) => {
              setSubject(event.target.value)
              if (subjectError) setSubjectError(null)
            }}
          />
          <FieldDescription>
            The reviewer’s name as shown on Google, or a review id.
          </FieldDescription>
          <FieldError>{subjectError}</FieldError>
        </Field>
        {running ? (
          <p role="status" className="text-ui text-ink-muted">
            Exporting… {formatNumber(fetched)}
            {total !== undefined ? ` of ${formatNumber(total)}` : ""} reviews
          </p>
        ) : null}
        {state.phase === "failed" && state.pages.length === 0 ? (
          // Nothing was fetched, so there is nothing to resume: an unknown
          // subject (`privacy_subject_not_found`) would only fail again.
          <Alert variant="destructive">
            <AlertTitle>The export didn’t start</AlertTitle>
            <AlertDescription>{state.message}</AlertDescription>
          </Alert>
        ) : null}
        {state.phase === "failed" && state.pages.length > 0 ? (
          <Alert variant="destructive">
            <AlertTitle>The export stopped part-way</AlertTitle>
            <AlertDescription className="flex flex-col items-start gap-2.5">
              <span>
                {state.message} {formatNumber(fetched)} reviews were fetched
                before it stopped; resuming carries on from there.
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void run(state.subject, state.pages)}
              >
                Resume export
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}
        {state.phase === "done" ? (
          <Alert variant={state.result.complete ? "success" : "warning"}>
            <AlertTitle>
              {state.result.complete
                ? `Export ready: ${formatNumber(state.result.reviews.length)} ${state.result.reviews.length === 1 ? "review" : "reviews"}`
                : "Export incomplete"}
            </AlertTitle>
            <AlertDescription className="flex flex-col items-start gap-2.5">
              {state.result.complete ? (
                <span>
                  {state.result.pages === 1
                    ? "Fetched in one page."
                    : `Joined from ${state.result.pages} pages.`}
                </span>
              ) : (
                <span>
                  {formatNumber(state.result.addedDuringExport)} matching{" "}
                  {state.result.addedDuringExport === 1
                    ? "review was"
                    : "reviews were"}{" "}
                  stored while this export ran and may be missing. Run it again
                  for a complete set.
                </span>
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => saveJson(state.result)}
              >
                <Download aria-hidden />
                Download JSON
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}
        <div className="flex justify-end">
          <Button type="submit" pending={running} pendingLabel="Exporting…">
            {state.phase === "done" ? "Export again" : "Export records"}
          </Button>
        </div>
      </form>
    </section>
  )
}
