"use client"

import { useMutation } from "@tanstack/react-query"
import { useState } from "react"

import { GateNote } from "@/components/locations/publish-gate"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { createPost } from "@/lib/api/location-posts"
import { useDirtyGuard } from "@/lib/hooks/use-dirty-guard"
import { describeActionError } from "@/lib/locations/action-errors"
import { localPostFormSchema, type LocalPostFormValues } from "@/lib/locations/forms/local-post"

const TOPICS = [
  { value: "STANDARD", label: "Update" },
  { value: "EVENT", label: "Event" },
  { value: "OFFER", label: "Offer" },
] as const

export function PostComposer({
  locationId,
  disabledReason,
  invalidate,
  toast,
}: {
  locationId: string
  disabledReason: string | null
  invalidate: () => void
  toast: (title: string, type: "success" | "error") => void
}) {
  const [topicType, setTopicType] = useState<"STANDARD" | "EVENT" | "OFFER">("STANDARD")
  const [summary, setSummary] = useState("")
  const [eventTitle, setEventTitle] = useState("")
  const [error, setError] = useState<string | null>(null)

  const isDirty = summary.trim().length > 0 || eventTitle.trim().length > 0
  useDirtyGuard({ key: `location-posts-composer-${locationId}`, isDirty, snapshot: () => JSON.stringify({ topicType, summary, eventTitle }) })

  const create = useMutation({
    mutationFn: (input: LocalPostFormValues) => createPost(locationId, input),
    onSuccess: () => {
      setSummary("")
      setEventTitle("")
      invalidate()
      toast("Draft saved", "success")
    },
    onError: (err) => toast(describeActionError(err), "error"),
  })

  const disabled = Boolean(disabledReason)

  function submit() {
    const candidate: Record<string, unknown> = { topicType, summary, media: [] }
    if (topicType !== "STANDARD") candidate.event = { title: eventTitle }
    if (topicType === "OFFER") candidate.offer = {}
    const parsed = localPostFormSchema.safeParse(candidate)
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Please complete the post.")
      return
    }
    setError(null)
    create.mutate(parsed.data)
  }

  return (
    <section className="flex max-w-xl flex-col gap-3">
      <h2 className="text-title font-semibold">New post</h2>
      <label className="flex flex-col gap-1 text-ui">
        <span className="text-caption text-muted-foreground">Type</span>
        <Select value={topicType} onValueChange={(next) => setTopicType(next as "STANDARD" | "EVENT" | "OFFER")}>
          <SelectTrigger className="w-48" aria-label="Post type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TOPICS.map((t) => (
              <SelectItem key={t.value} value={t.value}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
      {topicType !== "STANDARD" ? (
        <label className="flex flex-col gap-1 text-ui">
          <span className="text-caption text-muted-foreground">Event title</span>
          <Textarea value={eventTitle} onChange={(event) => setEventTitle(event.target.value)} rows={1} disabled={disabled} />
        </label>
      ) : null}
      <label className="flex flex-col gap-1 text-ui">
        <span className="text-caption text-muted-foreground">Summary</span>
        <Textarea value={summary} onChange={(event) => setSummary(event.target.value)} rows={4} disabled={disabled} aria-label="Post summary" />
      </label>
      {error ? <p className="text-caption text-destructive">{error}</p> : null}
      <div className="flex items-center gap-3">
        <Button onClick={submit} disabled={disabled || !isDirty || create.isPending}>
          {create.isPending ? "Saving…" : "Save draft"}
        </Button>
      </div>
      <GateNote reason={disabledReason} />
    </section>
  )
}
