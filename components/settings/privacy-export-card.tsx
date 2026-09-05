"use client"

import { useId, useState } from "react"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { exportPrivacyData } from "@/lib/api/privacy"
import { describeActionError } from "@/lib/errors/action-errors"

/**
 * A subject-access export: one reference in, one private file out. Nothing
 * is kept on the server, which is the point.
 */
export function PrivacyExportCard() {
  const headingId = useId()
  const [subject, setSubject] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const onExport = async () => {
    if (subject.trim().length < 3) {
      setError("Enter at least 3 characters.")
      return
    }
    setBusy(true)
    setError(null)
    try {
      await exportPrivacyData(subject.trim())
    } catch (caught) {
      setError(describeActionError(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id={headingId} className="text-title font-semibold text-ink">
          Export a subject’s records
        </h2>
        <p className="text-ui text-ink-muted">
          Downloads a private file of the retained records for a subject
          reference. The file isn’t stored.
        </p>
      </div>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <div className="flex flex-wrap items-end gap-3 rounded-(--np-radius-card) bg-surface p-(--np-card-pad)">
        <Field className="min-w-56 flex-1">
          <FieldLabel>Subject reference</FieldLabel>
          <Input
            value={subject}
            aria-label="Subject reference"
            onChange={(event) => setSubject(event.target.value)}
          />
        </Field>
        <Button
          type="button"
          variant="secondary"
          disabled={busy}
          onClick={onExport}
        >
          {busy ? "Preparing…" : "Download export"}
        </Button>
      </div>
    </section>
  )
}
