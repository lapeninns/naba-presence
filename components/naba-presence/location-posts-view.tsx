"use client"

import {
  AlertTriangle,
  CalendarClock,
  Check,
  ExternalLink,
  FileEdit,
  Plus,
  Send,
  Trash2,
  X,
} from "lucide-react"
import { useEffect, useState } from "react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { EmptyData, LiveDataError, PageHeader } from "@/components/naba-presence/shared"
import {
  decideLocalPost,
  loadLocalPosts,
  type LocalPost,
  type LocalPostInput,
  publishLocalPost,
  removeLocalPost,
  saveLocalPost,
} from "@/lib/naba-presence-api"

type FormState = {
  topicType: LocalPost["topicType"]
  summary: string
  actionType: string
  actionUrl: string
  eventTitle: string
  eventStart: string
  eventEnd: string
  couponCode: string
  redeemUrl: string
  terms: string
  mediaUrl: string
  scheduledTime: string
}

const emptyForm: FormState = {
  topicType: "STANDARD",
  summary: "",
  actionType: "LEARN_MORE",
  actionUrl: "",
  eventTitle: "",
  eventStart: "",
  eventEnd: "",
  couponCode: "",
  redeemUrl: "",
  terms: "",
  mediaUrl: "",
  scheduledTime: "",
}

function googleDateTime(value: string) {
  const [date, time] = value.split("T")
  const [year, month, day] = date.split("-").map(Number)
  const [hours, minutes] = time.split(":").map(Number)
  return {
    date: { year, month, day },
    time: { hours, minutes, seconds: 0, nanos: 0 },
  }
}

function payload(form: FormState): LocalPostInput {
  const hasEvent = form.topicType !== "STANDARD"
  const start = hasEvent && form.eventStart ? googleDateTime(form.eventStart) : null
  const end = hasEvent && form.eventEnd ? googleDateTime(form.eventEnd) : null
  return {
    topicType: form.topicType,
    languageCode: "en-GB",
    summary: form.summary,
    callToAction: form.topicType !== "OFFER" && form.actionType
      ? { actionType: form.actionType, ...(form.actionUrl ? { url: form.actionUrl } : {}) }
      : undefined,
    event: hasEvent && start && end
      ? {
          title: form.eventTitle,
          schedule: {
            startDate: start.date,
            startTime: start.time,
            endDate: end.date,
            endTime: end.time,
          },
        }
      : undefined,
    offer: form.topicType === "OFFER"
      ? {
          ...(form.couponCode ? { couponCode: form.couponCode } : {}),
          ...(form.redeemUrl ? { redeemOnlineUrl: form.redeemUrl } : {}),
          ...(form.terms ? { termsConditions: form.terms } : {}),
        }
      : undefined,
    media: form.mediaUrl ? [{ sourceUrl: form.mediaUrl }] : [],
    scheduledTime: form.scheduledTime
      ? new Date(form.scheduledTime).toISOString()
      : undefined,
  }
}

function formFromPost(post: LocalPost): FormState {
  const schedule = post.event?.schedule as Record<string, Record<string, number>> | undefined
  const toInput = (date?: Record<string, number>, time?: Record<string, number>) =>
    date && time
      ? `${date.year}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}T${String(time.hours).padStart(2, "0")}:${String(time.minutes).padStart(2, "0")}`
      : ""
  return {
    topicType: post.topicType,
    summary: post.summary,
    actionType: post.callToAction?.actionType ?? "LEARN_MORE",
    actionUrl: post.callToAction?.url ?? "",
    eventTitle: typeof post.event?.title === "string" ? post.event.title : "",
    eventStart: toInput(schedule?.startDate, schedule?.startTime),
    eventEnd: toInput(schedule?.endDate, schedule?.endTime),
    couponCode: typeof post.offer?.couponCode === "string" ? post.offer.couponCode : "",
    redeemUrl: typeof post.offer?.redeemOnlineUrl === "string" ? post.offer.redeemOnlineUrl : "",
    terms: typeof post.offer?.termsConditions === "string" ? post.offer.termsConditions : "",
    mediaUrl: post.media[0]?.sourceUrl ?? "",
    scheduledTime: post.scheduledTime ? post.scheduledTime.slice(0, 16) : "",
  }
}

export function LocationPostsView({ locationId }: { locationId: string }) {
  const [posts, setPosts] = useState<LocalPost[]>([])
  const [form, setForm] = useState<FormState>(emptyForm)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading")
  const [working, setWorking] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [writesEnabled, setWritesEnabled] = useState(false)
  const [reconciliationError, setReconciliationError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void loadLocalPosts(locationId)
      .then((result) => {
        if (!active) return
        setPosts(result.posts)
        setWritesEnabled(result.writesEnabled)
        setReconciliationError(result.reconciliationError)
        setStatus("ready")
      })
      .catch(() => active && setStatus("error"))
    return () => { active = false }
  }, [locationId, reloadKey])

  function refresh(note?: string) {
    if (note) setMessage(note)
    setStatus("loading")
    setReloadKey((value) => value + 1)
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setWorking(true)
    setMessage(null)
    try {
      await saveLocalPost(locationId, payload(form), editingId ?? undefined)
      setForm(emptyForm)
      setEditingId(null)
      refresh(editingId ? "Post updated." : "Draft created.")
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The post could not be saved.")
    } finally {
      setWorking(false)
    }
  }

  async function action(task: () => Promise<unknown>, success: string) {
    setWorking(true)
    setMessage(null)
    try {
      await task()
      refresh(success)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The action could not be completed.")
    } finally {
      setWorking(false)
    }
  }

  return (
    <section className="flex flex-col gap-(--nr-gap-section)">
      <PageHeader
        title="Posts"
        description="Draft, approve, schedule, publish, update, and remove Google updates, events, and offers."
      />

      {message ? (
        <Alert>
          <FileEdit />
          <AlertTitle>Posts update</AlertTitle>
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      ) : null}

      {!writesEnabled && status === "ready" ? (
        <Alert>
          <AlertTriangle />
          <AlertTitle>Google Posts publishing is paused</AlertTitle>
          <AlertDescription>Existing local and Google posts remain visible. Draft and provider mutations stay disabled until the Posts and global publish controls are enabled.</AlertDescription>
        </Alert>
      ) : null}

      {reconciliationError ? (
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>Live Google reconciliation failed</AlertTitle>
          <AlertDescription>Stored posts are shown, but Google could not be refreshed ({reconciliationError}).</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{editingId ? "Edit post" : "Create a post"}</CardTitle>
          <CardDescription>Product posts are not offered because Google does not support API creation for them.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit}>
            <fieldset disabled={!writesEnabled || working} className="contents">
            <FieldGroup>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="post-type">Post type</FieldLabel>
                  <NativeSelect id="post-type" value={form.topicType} onValueChange={(value) => setForm({ ...form, topicType: value as FormState["topicType"] })}>
                    <NativeSelectOption value="STANDARD">Update</NativeSelectOption>
                    <NativeSelectOption value="EVENT">Event</NativeSelectOption>
                    <NativeSelectOption value="OFFER">Offer</NativeSelectOption>
                  </NativeSelect>
                </Field>
                <Field>
                  <FieldLabel htmlFor="post-schedule">Publish later</FieldLabel>
                  <Input id="post-schedule" type="datetime-local" value={form.scheduledTime} onChange={(event) => setForm({ ...form, scheduledTime: event.currentTarget.value })} />
                  <FieldDescription>Leave blank to publish immediately after approval.</FieldDescription>
                </Field>
              </div>
              <Field>
                <FieldLabel htmlFor="post-summary">Post text</FieldLabel>
                <Textarea id="post-summary" required maxLength={1500} rows={5} value={form.summary} onChange={(event) => setForm({ ...form, summary: event.currentTarget.value })} />
                <FieldDescription>{form.summary.length}/1500 characters</FieldDescription>
              </Field>
              {form.topicType !== "OFFER" ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="post-action">Call to action</FieldLabel>
                    <NativeSelect id="post-action" value={form.actionType} onValueChange={(value) => setForm({ ...form, actionType: value })}>
                      <NativeSelectOption value="LEARN_MORE">Learn more</NativeSelectOption>
                      <NativeSelectOption value="BOOK">Book</NativeSelectOption>
                      <NativeSelectOption value="ORDER">Order</NativeSelectOption>
                      <NativeSelectOption value="SHOP">Shop</NativeSelectOption>
                      <NativeSelectOption value="SIGN_UP">Sign up</NativeSelectOption>
                      <NativeSelectOption value="CALL">Call</NativeSelectOption>
                    </NativeSelect>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="post-action-url">Action URL</FieldLabel>
                    <Input id="post-action-url" type="url" value={form.actionUrl} disabled={form.actionType === "CALL"} onChange={(event) => setForm({ ...form, actionUrl: event.currentTarget.value })} />
                  </Field>
                </div>
              ) : null}
              {form.topicType !== "STANDARD" ? (
                <div className="grid gap-4 sm:grid-cols-3">
                  <Field>
                    <FieldLabel htmlFor="event-title">Event title</FieldLabel>
                    <Input id="event-title" required value={form.eventTitle} onChange={(event) => setForm({ ...form, eventTitle: event.currentTarget.value })} />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="event-start">Starts</FieldLabel>
                    <Input id="event-start" required type="datetime-local" value={form.eventStart} onChange={(event) => setForm({ ...form, eventStart: event.currentTarget.value })} />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="event-end">Ends</FieldLabel>
                    <Input id="event-end" required type="datetime-local" value={form.eventEnd} onChange={(event) => setForm({ ...form, eventEnd: event.currentTarget.value })} />
                  </Field>
                </div>
              ) : null}
              {form.topicType === "OFFER" ? (
                <div className="grid gap-4 sm:grid-cols-3">
                  <Field><FieldLabel htmlFor="offer-code">Coupon code</FieldLabel><Input id="offer-code" value={form.couponCode} onChange={(event) => setForm({ ...form, couponCode: event.currentTarget.value })} /></Field>
                  <Field><FieldLabel htmlFor="offer-url">Redemption URL</FieldLabel><Input id="offer-url" type="url" value={form.redeemUrl} onChange={(event) => setForm({ ...form, redeemUrl: event.currentTarget.value })} /></Field>
                  <Field><FieldLabel htmlFor="offer-terms">Terms</FieldLabel><Input id="offer-terms" value={form.terms} onChange={(event) => setForm({ ...form, terms: event.currentTarget.value })} /></Field>
                </div>
              ) : null}
              <Field>
                <FieldLabel htmlFor="post-media">Image URL</FieldLabel>
                <Input id="post-media" type="url" value={form.mediaUrl} onChange={(event) => setForm({ ...form, mediaUrl: event.currentTarget.value })} />
                <FieldDescription>Google Local Posts accepts a public source URL.</FieldDescription>
              </Field>
              <div className="flex flex-wrap justify-end gap-2">
                {editingId ? (
                  <Button type="button" variant="outline" onClick={() => { setEditingId(null); setForm(emptyForm) }}>
                    <X data-icon="inline-start" /> Cancel
                  </Button>
                ) : null}
                <Button type="submit" disabled={working}>
                  <Plus data-icon="inline-start" /> {editingId ? "Save changes" : "Save draft"}
                </Button>
              </div>
            </FieldGroup>
            </fieldset>
          </form>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-3">
        {status === "loading" ? Array.from({ length: 2 }, (_, index) => <Skeleton key={index} className="h-36" />) : null}
        {status === "error" ? <LiveDataError onRetry={() => refresh()} /> : null}
        {status === "ready" && !posts.length ? <Card><CardContent><EmptyData message="No Google Posts have been drafted or imported yet." /></CardContent></Card> : null}
        {status === "ready" ? posts.map((post) => (
          <Card key={post.id}>
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle>{post.topicType === "STANDARD" ? "Update" : post.topicType === "EVENT" ? "Event" : "Offer"}</CardTitle>
                  <CardDescription>{new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(post.updatedAt))}</CardDescription>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge variant={post.status === "failed" || post.status === "ambiguous" ? "destructive" : "secondary"}>{post.status.replaceAll("_", " ")}</Badge>
                  {post.scheduledTime ? <Badge variant="outline"><CalendarClock data-icon="inline-start" /> Scheduled</Badge> : null}
                </div>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <p className="whitespace-pre-wrap text-sm">{post.summary || "No post text."}</p>
              {post.lastErrorCode ? <p className="text-sm text-destructive">Google error: {post.lastErrorCode}</p> : null}
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" disabled={working || !writesEnabled} onClick={() => { setEditingId(post.id); setForm(formFromPost(post)); scrollTo({ top: 0, behavior: "smooth" }) }}><FileEdit data-icon="inline-start" /> Edit</Button>
                {post.status === "draft" || post.status === "failed" ? <Button size="sm" disabled={working || !writesEnabled} onClick={() => void action(() => publishLocalPost(locationId, post.id), "Post sent for approval or publication.")}><Send data-icon="inline-start" /> Publish</Button> : null}
                {post.status === "awaiting_approval" ? <><Button size="sm" disabled={working || !writesEnabled} onClick={() => void action(() => decideLocalPost(locationId, post.id, "approve"), "Post approved and published.")}><Check data-icon="inline-start" /> Approve</Button><Button size="sm" variant="outline" disabled={working || !writesEnabled} onClick={() => void action(() => decideLocalPost(locationId, post.id, "reject"), "Post returned to draft.")}><X data-icon="inline-start" /> Reject</Button></> : null}
                {post.googleSearchUrl ? <Button size="sm" variant="outline" render={<a href={post.googleSearchUrl} target="_blank" rel="noreferrer" />}><ExternalLink data-icon="inline-start" /> View on Google</Button> : null}
                <Button size="sm" variant="destructive" disabled={working || !writesEnabled} onClick={() => { if (confirm("Delete this post from NabaPresence and Google?")) void action(() => removeLocalPost(locationId, post.id), "Post deleted.") }}><Trash2 data-icon="inline-start" /> Delete</Button>
              </div>
            </CardContent>
          </Card>
        )) : null}
      </div>
    </section>
  )
}
