"use client"

import { FilterIcon, Megaphone } from "lucide-react"
import { useState } from "react"

import { EditorFrame } from "@/components/editors/editor-frame"
import { LocationTab } from "@/components/locations/location-tab"
import { PostCard } from "@/components/locations/posts/post-card"
import { PostComposerSheet } from "@/components/locations/posts/post-composer-sheet"
import { PostsActionBar } from "@/components/locations/posts-action-bar"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { ChipRow, ToggleChip } from "@/components/ui/chip"
import { Empty } from "@/components/ui/empty"
import type { LifecycleStage } from "@/components/ui/lifecycle"
import type { Post } from "@/lib/api/location-posts"
import { composeDisabledReason } from "@/lib/locations/gating"
import {
  formatPostTimestamp,
  matchesPostFilter,
  POST_FILTERS,
  POST_TOPIC_LABEL,
  postActionLabel,
  postEventTitle,
  postImageUrl,
  postNeedsAttention,
  postSchedule,
  postStatus,
  type PostFilter,
} from "@/lib/locations/post-display"
import { postRecurrence } from "@/lib/locations/post-recurrence"
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
      label: "Live on Google",
      state:
        status === "published" && post.googleState === "LIVE" ? "done" : "todo",
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

export function PostsTab({ locationId }: { locationId: string }) {
  return (
    <LocationTab
      locationId={locationId}
      loadingLabel="posts"
      useResource={usePosts}
      resource="posts"
    >
      {({ data: state, caps }) => (
        <PostsList
          locationId={locationId}
          posts={state.posts}
          writesEnabled={state.writesEnabled}
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
  writesEnabled,
  reconciliationError,
  caps,
}: {
  locationId: string
  posts: Post[]
  writesEnabled: boolean
  reconciliationError: string | null
  caps: Parameters<typeof PostsActionBar>[0]["caps"]
}) {
  const [filter, setFilter] = useState<PostFilter>("all")
  const composeReason = composeDisabledReason(writesEnabled)
  const live = posts.filter(
    (post) => post.status === "published" && post.googleState === "LIVE"
  ).length
  const attention = posts.filter(postNeedsAttention).length
  const shown = posts.filter((post) => matchesPostFilter(post, filter))

  const summary =
    attention > 0
      ? { label: `${attention} need attention`, tone: "attention" as const }
      : live > 0
        ? { label: `${live} live on Google`, tone: "healthy" as const }
        : posts.length > 0
          ? { label: "Nothing live", tone: "neutral" as const }
          : undefined

  return (
    <EditorFrame
      title="Posts"
      statusLabel={summary?.label}
      tone={summary?.tone}
      description="Updates, events and offers that appear on the listing. Drafts stay here until you publish them; posts publish when you press Publish, as scheduling isn’t available."
      // Every post write 503s while paused, so the banner is also the reason
      // for the disabled Delete (and Publish) on each post below.
      gateReason={
        composeReason
          ? `${composeReason} Publishing and deleting posts also wait until it’s back.`
          : null
      }
      gateTitle="Posts are paused"
      actions={
        <PostComposerSheet
          locationId={locationId}
          disabledReason={composeReason}
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

      {posts.length === 0 ? (
        <div className="rounded-lg border border-line bg-surface">
          <Empty
            icon={<Megaphone aria-hidden />}
            titleAs="h3"
            title="No posts yet"
            description="A post is a short update, event or offer that shows on the listing for a week or so. Use New post above to write the first one."
          />
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <ChipRow role="group" aria-label="Filter posts by status">
            {POST_FILTERS.map((option) => {
              const count = posts.filter((post) =>
                matchesPostFilter(post, option.value)
              ).length
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

          {shown.length === 0 ? (
            <div className="rounded-lg border border-line bg-surface">
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
            </div>
          ) : (
            <ul className="flex flex-col gap-3">
              {shown.map((post) => {
                const status = postStatus(post)
                const meta = [
                  postSchedule(post),
                  postRecurrence(post.event),
                  postActionLabel(post)
                    ? `${postActionLabel(post)} button`
                    : "",
                  `Changed ${formatPostTimestamp(post.updatedAt)}`,
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
                          caps={caps}
                          writesEnabled={writesEnabled}
                        />
                      }
                    />
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </EditorFrame>
  )
}
