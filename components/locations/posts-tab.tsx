"use client"

import { useQuery } from "@tanstack/react-query"
import { FilterIcon, Megaphone } from "lucide-react"
import { useLayoutEffect, useMemo, useRef, useState } from "react"

import { EditorFrame } from "@/components/editors/editor-frame"
import { SupportDetails } from "@/components/editors/support-details"
import { GoogleFreshness } from "@/components/editors/google-freshness"
import { LocationTab } from "@/components/locations/location-tab"
import { PostCard } from "@/components/locations/posts/post-card"
import { LegacyPostSchedules } from "@/components/locations/posts/legacy-post-schedules"
import { PostComposerSheet } from "@/components/locations/posts/post-composer-sheet"
import { PostSchedules } from "@/components/locations/posts/post-schedules"
import { scheduleWhen } from "@/components/locations/posts/schedule-dates"
import { PostsActionBar } from "@/components/locations/posts-action-bar"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { FilterChip, FilterChipStrip } from "@/components/ui/chip"
import { Empty } from "@/components/ui/empty"
import type { LifecycleStage } from "@/components/ui/lifecycle"
import { LoadMore } from "@/components/ui/load-more"
import type { Post } from "@/lib/api/location-posts"
import {
  describeErrorCode,
  GENERIC_ERROR_COPY,
} from "@/lib/errors/action-errors"
import { fetchPostSchedules } from "@/lib/api/publication-schedules"
import type { PublicationSchedule } from "@/lib/contracts/publication-schedules"
import type { PostCounts } from "@/lib/contracts/location-posts"
import { localPostOutcome } from "@/lib/domain/post-outcome"
import { describeOutcome } from "@/lib/editors/outcome"
import {
  composeDisabledReason,
  contentEditDisabledReason,
} from "@/lib/locations/gating"
import {
  formatPostTimestamp,
  matchesPostFilter,
  POST_FILTERS,
  POST_TOPIC_LABEL,
  postActionLabel,
  postContentTimestamp,
  postEventTitle,
  postImageUrl,
  postSchedule,
  postStatus,
  type PostFilter,
} from "@/lib/locations/post-display"
import {
  DEFAULT_TIMEZONE,
  postRecurrence,
} from "@/lib/locations/post-recurrence"
import {
  liveOnceSchedule,
  scheduleBadge,
} from "@/lib/locations/schedule-display"
import { queryKeys } from "@/lib/queries/keys"
import { requestOptions } from "@/lib/queries/request-options"
import type { ListPaging } from "@/lib/queries/paged-list"
import { usePosts, useRefreshPosts } from "@/lib/queries/use-location-posts"

const HEADLINE_MAX = 70

/**
 * The row's title and body. Events and offers carry a title of their own.
 * An update has none, so its first line leads (several updates must not all
 * read "Update") and the type moves to the tag. The body then holds only
 * what the title leaves out, so no words are said twice.
 */
function headline(post: Post): { title: string; body: string } {
  const eventTitle = postEventTitle(post)
  if (eventTitle) return { title: eventTitle, body: post.summary }
  const text = post.summary.trim()
  const [firstLine = "", ...rest] = text.split(/\r?\n/)
  const first = firstLine.trim()
  if (!first) return { title: POST_TOPIC_LABEL[post.topicType], body: "" }
  if (first.length > HEADLINE_MAX)
    return { title: `${first.slice(0, HEADLINE_MAX).trimEnd()}…`, body: text }
  return { title: first, body: rest.join("\n").trim() }
}

function lifecycle(post: Post): LifecycleStage[] {
  const status = post.status
  // Google's verdict, whether the post was settled `published` or `failed`
  // (the status badge reads the same outcome).
  const rejected = localPostOutcome(post) === "rejected"
  const sentState =
    status === "failed" || status === "ambiguous" || rejected
      ? "failed"
      : status === "publishing"
        ? "current"
        : status === "published"
          ? "done"
          : "todo"
  return [
    { id: "drafted", label: "Drafted", state: "done" },
    {
      id: "approved",
      label: "Approved",
      state:
        status === "awaiting_approval"
          ? "current"
          : status === "draft"
            ? "todo"
            : "done",
      meta:
        status === "awaiting_approval"
          ? "Waiting for an approver"
          : status === "draft"
            ? "If your policy asks"
            : undefined,
    },
    {
      id: "sent",
      label: "Sent to Google",
      state: sentState,
      meta:
        sentState === "failed"
          ? rejected
            ? "Rejected"
            : status === "failed"
              ? "Not accepted"
              : "Not confirmed"
          : undefined,
    },
    {
      id: "live",
      label: describeOutcome("confirmed_applied").label,
      // Done only on the outcome that may say live: Google reports the post
      // LIVE (lib/domain/post-outcome.ts).
      state: localPostOutcome(post) === "confirmed_applied" ? "done" : "todo",
    },
  ]
}

function problem(post: Post): React.ReactNode {
  if (localPostOutcome(post) === "rejected")
    return (
      <>
        Google rejected this post, so customers can’t see it.
        <SupportDetails items={[post.lastErrorCode]} className="mt-1" />
      </>
    )
  if (post.status === "failed") {
    // The code is for support, not the reader: the sentence says what
    // happened and what to do next, the code stays one click away.
    const known = post.lastErrorCode
      ? describeErrorCode(post.lastErrorCode)
      : GENERIC_ERROR_COPY
    return (
      <>
        {known === GENERIC_ERROR_COPY
          ? "Google didn’t accept this post, so nothing is live. Edit it or publish it again."
          : known}
        <SupportDetails items={[post.lastErrorCode]} className="mt-1" />
      </>
    )
  }
  if (post.status === "ambiguous")
    return "We couldn’t confirm whether Google has this post. Check Google before publishing again, so it isn’t posted twice."
  return null
}

/**
 * Whether a one-time schedule could publish this post: a draft (or one
 * waiting for approval, or whose publish failed) Google does not hold. The
 * server's rule is publishableSource (lib/server/publication-schedules.ts).
 */
function schedulable(post: Post) {
  return (
    post.googlePostName === null &&
    ["draft", "awaiting_approval", "failed"].includes(post.status)
  )
}

/**
 * When a one-time schedule runs, in the schedules list's own words ("Tue 20
 * Oct, 09:00 BST", schedule-dates.ts), so one schedule has one description.
 * Only one-time schedules reach a post's row, so the "Once" is dropped.
 */
function scheduleWhenOnce(schedule: PublicationSchedule) {
  return scheduleWhen(
    schedule.rule,
    schedule.timezone,
    schedule.offsetMinutes
  ).replace(/ · Once$/, "")
}

/**
 * "Scheduled for Tue 20 Oct, 09:00 BST", then the schedule's state unless it
 * is simply on its way ("· Awaiting approval", "· Paused").
 */
function scheduleSummary(schedule: PublicationSchedule) {
  const badge = scheduleBadge(schedule)
  return `Scheduled for ${scheduleWhenOnce(schedule)}${
    badge.label === "Active" ? "" : ` · ${badge.label}`
  }`
}

/**
 * The views' names on this list. The `published` view also holds posts still
 * being sent, waiting for Google, or rejected by it (lib/server/posts.ts
 * postFilterCondition), so "On Google" would claim more than is true; every
 * post in it has been sent.
 */
function filterLabel(filter: PostFilter) {
  if (filter === "published") return "Sent to Google"
  return POST_FILTERS.find((option) => option.value === filter)?.label ?? ""
}

/** The line shown while a view loads, so the wait is seen and heard. */
const VIEW_LOADING: Record<PostFilter, string> = {
  all: "Loading all posts…",
  draft: "Loading drafts…",
  awaiting: "Loading posts awaiting approval…",
  published: "Loading posts sent to Google…",
  attention: "Loading posts that need attention…",
}

export function PostsTab({ locationId }: { locationId: string }) {
  // The status view is a server filter (each view pages on its own cursor),
  // so it lives above the shell and is part of the resource query.
  const [filter, setFilter] = useState<PostFilter>("all")
  // The view is part of the query key, so the resource hook closes over it.
  // It always calls the same hook, which is all the shell requires.
  function usePostsView(id: string) {
    return usePosts(id, filter)
  }
  return (
    <LocationTab
      locationId={locationId}
      loadingLabel="posts"
      useResource={usePostsView}
      resource="posts"
    >
      {({ data: state, caps }) => (
        <PostsList
          locationId={locationId}
          posts={state.posts}
          counts={state.counts}
          paging={state.paging}
          filter={filter}
          loadedFilter={state.filter}
          onFilterChange={setFilter}
          writesEnabled={state.writesEnabled}
          timezone={state.timezone ?? DEFAULT_TIMEZONE}
          reconciliationError={state.reconciliationError}
          observedAt={state.observedAt}
          caps={caps}
        />
      )}
    </LocationTab>
  )
}

function PostsList({
  locationId,
  posts,
  counts,
  paging,
  filter,
  loadedFilter,
  onFilterChange: setFilter,
  writesEnabled,
  timezone,
  reconciliationError,
  observedAt,
  caps,
}: {
  locationId: string
  /** The loaded pages of the `loadedFilter` view. */
  posts: Post[]
  /** Every view's size and the live count, over all the location's posts. */
  counts: PostCounts
  paging: ListPaging
  filter: PostFilter
  /** The view `posts` belong to; it lags `filter` while a switch loads. */
  loadedFilter: PostFilter
  onFilterChange: (filter: PostFilter) => void
  writesEnabled: boolean
  /** The listing's IANA timezone, for when a repeat ends. */
  timezone: string
  reconciliationError: string | null
  /** When the posts were last reconciled with Google. */
  observedAt: string | undefined
  caps: Parameters<typeof PostsActionBar>[0]["caps"]
}) {
  const refresh = useRefreshPosts(locationId, filter)
  const scheduling = caps?.postScheduling === true
  // The schedules list below reads the same query; here it only says which
  // posts already have a one-time publication on the way.
  const schedules = useQuery({
    queryKey: queryKeys.postSchedules(locationId),
    queryFn: (context) =>
      fetchPostSchedules(locationId, requestOptions(context)),
    enabled: scheduling,
  })
  const scheduledByPost = useMemo(() => {
    const map = new Map<string, PublicationSchedule>()
    for (const schedule of schedules.data ?? [])
      if (schedule.sourcePostId && liveOnceSchedule(schedule))
        map.set(schedule.sourcePostId, schedule)
    return map
  }, [schedules.data])
  const composeReason = composeDisabledReason(writesEnabled)
  const switching = loadedFilter !== filter
  const chips = useRef<HTMLDivElement>(null)
  // The server already filtered and ordered the view; the filter here only
  // hides the previous view's rows while a switch loads.
  const shown = posts
    .filter((post) => matchesPostFilter(post, filter))
    .sort((a, b) => {
      const aTime = postContentTimestamp(a)
      const bTime = postContentTimestamp(b)
      return (
        (bTime ? Date.parse(bTime) : -Infinity) -
          (aTime ? Date.parse(aTime) : -Infinity) || a.id.localeCompare(b.id)
      )
    })

  const editReason = contentEditDisabledReason(caps)

  // Once a post is deleted its row goes: focus moves to the next post's
  // heading (or the one before, at the end), else to the chosen view's chip,
  // else (the last post gone, chips and all) to the frame.
  const removed = useRef<{
    id: string
    neighbourId: string | undefined
    frame: HTMLElement | null
  } | null>(null)
  const removedTarget = (): HTMLElement | null => {
    const pending = removed.current
    if (!pending) return null
    return (
      (pending.neighbourId
        ? document.getElementById(`post-${pending.neighbourId}-title`)
        : null) ??
      chips.current?.querySelector<HTMLElement>('[aria-pressed="true"]') ??
      (pending.frame?.isConnected ? pending.frame : null)
    )
  }
  // The row's delete dialog moves focus there as it closes. A re-read that
  // lands first takes the row and its open dialog with it, and focus falls
  // to the page: once the row has gone, the list puts focus back, unless the
  // person has already moved it somewhere real.
  const settleRemoved = () => {
    const pending = removed.current
    // Asked of the page, not of `shown`: a row's callbacks can outlive it.
    if (!pending || document.getElementById(`post-${pending.id}-title`)) return
    const target = removedTarget()
    removed.current = null
    const active = document.activeElement
    if (active && active !== document.body && active.isConnected) return
    target?.focus()
  }
  const onDeleted = (id: string): HTMLElement | null => {
    const index = shown.findIndex((row) => row.id === id)
    removed.current = {
      id,
      neighbourId: (shown[index + 1] ?? shown[index - 1])?.id,
      frame:
        document
          .getElementById(`post-${id}-title`)
          ?.closest<HTMLElement>('[data-slot="editor-frame"]') ?? null,
    }
    settleRemoved()
    return removedTarget()
  }
  // Every render: the rows are derived, and a stale entry is harmless.
  useLayoutEffect(settleRemoved)

  const composer = (
    <PostComposerSheet
      locationId={locationId}
      disabledReason={composeReason ?? editReason}
      timezone={timezone}
      caps={caps}
      writesEnabled={writesEnabled}
    />
  )

  // Inside the listing area the header above already carries the "Posts"
  // h1, the status and the model note ("Each post is drafted, approved if
  // your policy asks, then published."), so the frame keeps its title for
  // the outline only; the status counts live on the filter chips below.
  return (
    <EditorFrame
      title="Posts"
      titleHidden
      // Every post write 503s while paused, so the banner is also the reason
      // for the disabled Delete (and Publish) on each post below. A role that
      // may only look gets the same banner, which is the reason New post is
      // off.
      gateReason={
        composeReason
          ? `${composeReason} Publishing and deleting posts also wait until it’s back.`
          : editReason
      }
      gateTitle={
        composeReason
          ? "Posts are paused"
          : "You can look, but not change these posts"
      }
      // With no posts the empty state carries the one action; the header
      // button would be a second "New post" on the same screen.
      actions={counts.all === 0 ? undefined : composer}
    >
      <GoogleFreshness
        observedAt={observedAt}
        refreshing={refresh.isPending}
        failed={refresh.isError}
        onRefresh={() => refresh.mutate()}
      />

      {reconciliationError ? (
        <Alert variant="warning">
          <AlertTitle>Some Google posts may be out of date</AlertTitle>
          <AlertDescription>
            We couldn&rsquo;t reach Google to refresh this list just now. Your
            drafts are safe.
          </AlertDescription>
        </Alert>
      ) : null}

      {counts.all === 0 ? (
        <Empty
          placement="inline"
          icon={<Megaphone aria-hidden />}
          titleAs="h3"
          title="No posts yet"
          description={
            // Why it is empty, then the next step, or why there is none.
            composeReason || editReason
              ? "A post is a short update, event or offer that shows on the listing on Google for about a week. The note above says why new posts can’t be written right now."
              : "A post is a short update, event or offer that shows on the listing on Google for about a week. Nothing reaches Google until you publish it."
          }
          action={composer}
        />
      ) : (
        <div className="flex flex-col gap-3">
          <FilterChipStrip
            ref={chips}
            role="group"
            aria-label="Filter posts by status"
          >
            {POST_FILTERS.map((option) => {
              const count = counts[option.value]
              return (
                <FilterChip
                  key={option.value}
                  pressed={filter === option.value}
                  count={count}
                  // A bucket with posts that need attention keeps its
                  // count in the danger ink; the label says what it counts.
                  countTone={
                    option.value === "attention" && count > 0
                      ? "alert"
                      : "default"
                  }
                  onClick={() => setFilter(option.value)}
                >
                  {filterLabel(option.value)}
                </FilterChip>
              )
            })}
          </FilterChipStrip>

          {shown.length === 0 && switching ? null : shown.length === 0 ? (
            <Empty
              placement="inline"
              icon={<FilterIcon aria-hidden />}
              titleAs="h3"
              title="No posts in this view"
              description={`Nothing matches “${filterLabel(filter)}”.`}
              action={
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setFilter("all")}
                >
                  Show all posts
                </Button>
              }
            />
          ) : (
            <ul
              className="flex flex-col divide-y divide-line-subtle rounded-(--np-radius-card) border border-line-subtle bg-surface"
              aria-busy={switching || undefined}
            >
              {shown.map((post) => {
                const status = postStatus(post)
                const changedAt = postContentTimestamp(post)
                const scheduled = scheduling
                  ? scheduledByPost.get(post.id)
                  : undefined
                const meta = changedAt
                  ? `Changed ${formatPostTimestamp(changedAt, timezone)}`
                  : "Date unavailable"
                const details = [
                  scheduled ? scheduleSummary(scheduled) : "",
                  postSchedule(post),
                  postRecurrence(post.event, timezone),
                  postActionLabel(post)
                    ? `${postActionLabel(post)} button`
                    : "",
                ]
                  .filter(Boolean)
                  .join(" · ")
                return (
                  <li key={post.id}>
                    <PostCard
                      id={post.id}
                      title={headline(post).title}
                      topic={POST_TOPIC_LABEL[post.topicType]}
                      summary={headline(post).body}
                      status={status.label}
                      tone={status.tone}
                      meta={meta}
                      details={details || undefined}
                      lang={post.languageCode}
                      thumbnailUrl={postImageUrl(post)}
                      problem={problem(post)}
                      // Not confirmed is unknown, not failed: the note
                      // takes the pill's warning tone.
                      problemTone={post.status === "ambiguous" ? "warn" : "bad"}
                      lifecycle={lifecycle(post)}
                      actions={
                        <PostsActionBar
                          locationId={locationId}
                          post={post}
                          // The menu is named by the post's own words.
                          label={headline(post).title}
                          caps={caps}
                          writesEnabled={writesEnabled}
                          timezone={timezone}
                          onDeleted={() => onDeleted(post.id)}
                          scheduling={
                            scheduling
                              ? {
                                  scheduledFor: scheduled
                                    ? scheduleWhenOnce(scheduled)
                                    : null,
                                  canSchedule:
                                    caps?.canEditCanonical === true &&
                                    schedulable(post) &&
                                    !scheduled,
                                  recurring:
                                    caps?.postSchedulingRecurring === true,
                                }
                              : undefined
                          }
                        />
                      }
                    />
                  </li>
                )
              })}
            </ul>
          )}
          {switching ? (
            // The previous view's rows stay until this one lands; the line
            // says the list is changing, where the count usually sits.
            <p role="status" className="text-caption text-ink-muted">
              {VIEW_LOADING[filter]}
            </p>
          ) : (
            <LoadMore
              shown={posts.length}
              total={counts[filter]}
              noun={["post", "posts"]}
              paging={paging}
            />
          )}
        </div>
      )}
      {scheduling ? (
        <LegacyPostSchedules locationId={locationId} timezone={timezone} />
      ) : null}
      <PostSchedules
        locationId={locationId}
        timezone={timezone}
        enabled={scheduling}
        recurring={caps?.postSchedulingRecurring === true}
      />
    </EditorFrame>
  )
}
