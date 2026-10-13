"use client"

import { useQuery } from "@tanstack/react-query"
import { FilterIcon, Megaphone } from "lucide-react"
import { useMemo, useState } from "react"

import { EditorFrame } from "@/components/editors/editor-frame"
import { LocationTab } from "@/components/locations/location-tab"
import { PostCard } from "@/components/locations/posts/post-card"
import { LegacyPostSchedules } from "@/components/locations/posts/legacy-post-schedules"
import { PostComposerSheet } from "@/components/locations/posts/post-composer-sheet"
import { PostSchedules } from "@/components/locations/posts/post-schedules"
import { PostsActionBar } from "@/components/locations/posts-action-bar"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { ChipRow, ToggleChip } from "@/components/ui/chip"
import { Empty } from "@/components/ui/empty"
import type { LifecycleStage } from "@/components/ui/lifecycle"
import { LoadMore } from "@/components/ui/load-more"
import type { Post } from "@/lib/api/location-posts"
import { fetchPostSchedules } from "@/lib/api/publication-schedules"
import type { PublicationSchedule } from "@/lib/contracts/publication-schedules"
import { describeScheduleRule } from "@/lib/domain/publication-schedule"
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
import { usePosts } from "@/lib/queries/use-location-posts"

function headline(post: Post): string {
  // Events and offers carry a title of their own. An update has none, so it
  // is named by its type rather than by repeating its first words above the
  // same words.
  return postEventTitle(post) || POST_TOPIC_LABEL[post.topicType]
}

function lifecycle(post: Post): LifecycleStage[] {
  const status = post.status
  const rejected = status === "published" && post.googleState === "REJECTED"
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
          ? (post.lastErrorCode ?? (rejected ? "Rejected" : "Not confirmed"))
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
  if (post.status === "failed")
    return (
      <>
        Google didn’t accept this post, so nothing is live.{" "}
        {post.lastErrorCode ? (
          <span className="font-mono text-caption text-ink-muted">
            {post.lastErrorCode}
          </span>
        ) : null}
      </>
    )
  if (post.status === "ambiguous")
    return "We couldn’t confirm whether Google has this post. Check Google before publishing again, so it isn’t posted twice."
  if (post.status === "published" && post.googleState === "REJECTED")
    return "Google rejected this post, so customers can’t see it."
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

/** "Scheduled publication awaiting approval: 2026-10-20 at 09:00 (Europe/London, UTC+01:00)". */
function scheduleSummary(schedule: PublicationSchedule) {
  return `Scheduled publication ${scheduleBadge(schedule).label.toLowerCase()}: ${describeScheduleRule(
    schedule.rule,
    schedule.timezone,
    schedule.offsetMinutes
  ).replace(/^Once on /, "")}`
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
  caps: Parameters<typeof PostsActionBar>[0]["caps"]
}) {
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
      actions={
        <PostComposerSheet
          locationId={locationId}
          disabledReason={composeReason ?? editReason}
          timezone={timezone}
        />
      }
    >
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
        <Card flush>
          <Empty
            icon={<Megaphone aria-hidden />}
            titleAs="h3"
            title="No posts yet"
            description="A post is a short update, event or offer that shows on the listing for a week or so. Use New post above to write the first one."
          />
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          <ChipRow role="group" aria-label="Filter posts by status">
            {POST_FILTERS.map((option) => {
              const count = counts[option.value]
              return (
                <ToggleChip
                  key={option.value}
                  pressed={filter === option.value}
                  count={count}
                  countTone={
                    option.value === "attention" && count > 0
                      ? "alert"
                      : "default"
                  }
                  onClick={() => setFilter(option.value)}
                >
                  {option.label}
                </ToggleChip>
              )
            })}
          </ChipRow>

          {shown.length === 0 && !switching ? (
            <Card flush>
              <Empty
                icon={<FilterIcon aria-hidden />}
                titleAs="h3"
                title="No posts in this view"
                description={`Nothing matches “${POST_FILTERS.find((f) => f.value === filter)?.label}”.`}
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
            </Card>
          ) : (
            <ul
              className="flex flex-col gap-3"
              aria-busy={switching || undefined}
            >
              {shown.map((post) => {
                const status = postStatus(post)
                const changedAt = postContentTimestamp(post)
                const scheduled = scheduling
                  ? scheduledByPost.get(post.id)
                  : undefined
                const meta = [
                  scheduled ? scheduleSummary(scheduled) : "",
                  postSchedule(post),
                  postRecurrence(post.event, timezone),
                  postActionLabel(post)
                    ? `${postActionLabel(post)} button`
                    : "",
                  changedAt
                    ? `Changed ${formatPostTimestamp(changedAt, timezone)}`
                    : "Date unavailable",
                ]
                  .filter(Boolean)
                  .join(" · ")
                return (
                  <li key={post.id}>
                    <PostCard
                      id={post.id}
                      title={headline(post)}
                      topic={
                        postEventTitle(post)
                          ? POST_TOPIC_LABEL[post.topicType]
                          : undefined
                      }
                      summary={post.summary}
                      status={status.label}
                      tone={status.tone}
                      meta={meta}
                      lang={post.languageCode}
                      thumbnailUrl={postImageUrl(post)}
                      problem={problem(post)}
                      lifecycle={lifecycle(post)}
                      actions={
                        <PostsActionBar
                          locationId={locationId}
                          post={post}
                          // Updates share the headline "Update", so the
                          // menu is named by the post's own words.
                          label={
                            postEventTitle(post) ||
                            post.summary.slice(0, 60) ||
                            headline(post)
                          }
                          caps={caps}
                          writesEnabled={writesEnabled}
                          timezone={timezone}
                          scheduling={
                            scheduling
                              ? {
                                  scheduledFor: scheduled
                                    ? describeScheduleRule(
                                        scheduled.rule,
                                        scheduled.timezone,
                                        scheduled.offsetMinutes
                                      )
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
          {switching ? null : (
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
