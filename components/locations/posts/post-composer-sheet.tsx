"use client"

import { Plus } from "lucide-react"
import { useId, useState } from "react"

import { PostPreview } from "@/components/locations/posts/post-preview"
import { GateNote } from "@/components/locations/publish-gate"
import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { createPost } from "@/lib/api/location-posts"
import { useDirtyGuard } from "@/lib/hooks/use-dirty-guard"
import {
  localPostFormSchema,
  type LocalPostFormValues,
} from "@/lib/locations/forms/local-post"
import { queryKeys } from "@/lib/queries/keys"
import { useResourceMutation } from "@/lib/queries/use-resource-mutation"

const TOPICS = [
  { value: "STANDARD", label: "Update" },
  { value: "EVENT", label: "Event" },
  { value: "OFFER", label: "Offer" },
] as const

/**
 * Writing a post, with the result visible while you write it.
 *
 * The composer used to sit permanently above the list of existing posts, so
 * the page opened on an empty form rather than on the posts the operator came
 * to look at. It now opens on demand and shows a preview beside the fields.
 */
export function PostComposerSheet({
  locationId,
  disabledReason,
}: {
  locationId: string
  disabledReason: string | null
}) {
  const [open, setOpen] = useState(false)
  const [topicType, setTopicType] = useState<"STANDARD" | "EVENT" | "OFFER">(
    "STANDARD"
  )
  const [summary, setSummary] = useState("")
  const [eventTitle, setEventTitle] = useState("")
  const [error, setError] = useState<string | null>(null)
  const typeLabelId = useId()

  const isDirty = summary.trim().length > 0 || eventTitle.trim().length > 0
  useDirtyGuard({
    key: `location-posts-composer-${locationId}`,
    isDirty,
    snapshot: () => JSON.stringify({ topicType, summary, eventTitle }),
  })

  const create = useResourceMutation({
    mutationFn: (input: LocalPostFormValues) => createPost(locationId, input),
    invalidate: [queryKeys.locationPosts(locationId)],
    successToast: "Draft saved",
    errorContext: "post",
    onSuccess: () => {
      setSummary("")
      setEventTitle("")
      setOpen(false)
    },
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
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger render={<Button pill disabled={disabled} />}>
        <Plus aria-hidden strokeWidth={1.75} data-icon="inline-start" />
        New post
      </SheetTrigger>
      <SheetContent side="right" className="flex flex-col gap-0 md:max-w-xl">
        <SheetHeader>
          <SheetTitle>New post</SheetTitle>
          <SheetDescription>
            Saved as a draft. Nothing reaches Google until you publish it from
            the list.
          </SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-(--np-gap-section) overflow-y-auto px-6 pb-6">
          <div className="flex flex-col gap-1.5">
            <span id={typeLabelId} className="text-ui font-medium text-ink">
              Type
            </span>
            <Select
              value={topicType}
              onValueChange={(next) =>
                setTopicType(next as "STANDARD" | "EVENT" | "OFFER")
              }
            >
              <SelectTrigger
                className="w-48"
                aria-label="Post type"
                aria-describedby={typeLabelId}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TOPICS.map((topic) => (
                  <SelectItem key={topic.value} value={topic.value}>
                    {topic.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {topicType !== "STANDARD" ? (
            <Field>
              <FieldLabel>
                {topicType === "OFFER" ? "Offer title" : "Event title"}
              </FieldLabel>
              <Textarea
                value={eventTitle}
                onChange={(event) => setEventTitle(event.target.value)}
                rows={1}
                className="min-h-(--np-field-h)"
                disabled={disabled}
              />
            </Field>
          ) : null}

          <Field>
            <FieldLabel>Summary</FieldLabel>
            <Textarea
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
              rows={5}
              disabled={disabled}
              aria-label="Post summary"
            />
          </Field>

          <PostPreview
            topicType={topicType}
            summary={summary}
            eventTitle={eventTitle}
          />

          {error ? (
            <p role="alert" className="text-ui text-danger-ink">
              {error}
            </p>
          ) : null}
          <GateNote reason={disabledReason} />
        </div>

        <SheetFooter className="flex-row items-center justify-end gap-2 border-t border-line-subtle px-6 py-4">
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={disabled || !isDirty || create.isPending}
          >
            {create.isPending ? "Saving…" : "Save draft"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
