"use client"

import { EditorFrame } from "@/components/editors/editor-frame"
import { LocationTab } from "@/components/locations/location-tab"
import { PostComposerSheet } from "@/components/locations/posts/post-composer-sheet"
import { PostsActionBar } from "@/components/locations/posts-action-bar"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Empty } from "@/components/ui/empty"
import { StatusPill } from "@/components/ui/status-pill"
import type { StatusTone } from "@/lib/ui/status-tone"
import type { Post } from "@/lib/api/location-posts"
import { composeDisabledReason } from "@/lib/locations/gating"
import { usePosts } from "@/lib/queries/use-location-posts"

const STATUS: Record<Post["status"], { label: string; tone: StatusTone }> = {
  draft: { label: "Draft", tone: "neutral" },
  awaiting_approval: { label: "Awaiting approval", tone: "pending" },
  publishing: { label: "Publishing", tone: "pending" },
  published: { label: "Published", tone: "healthy" },
  failed: { label: "Failed", tone: "at-risk" },
  ambiguous: { label: "Needs checking", tone: "attention" },
}

const TOPIC: Record<string, string> = {
  STANDARD: "Update",
  EVENT: "Event",
  OFFER: "Offer",
}

export function PostsTab({ locationId }: { locationId: string }) {
  return (
    <LocationTab
      locationId={locationId}
      useResource={usePosts}
      resource="posts"
    >
      {({ data: state, caps }) => (
        <EditorFrame
          title="Posts"
          description="Updates, events and offers that appear on the listing. Drafts stay here until you publish them."
          gateReason={composeDisabledReason(state.writesEnabled)}
          gateTitle="New posts are paused"
          actions={
            <PostComposerSheet
              locationId={locationId}
              disabledReason={composeDisabledReason(state.writesEnabled)}
            />
          }
        >
          {state.reconciliationError ? (
            <Alert variant="warning">
              <AlertTitle>Some Google posts may be out of date</AlertTitle>
              <AlertDescription>
                We couldn&rsquo;t reach Google to refresh this list just now.
                Your drafts are safe.
              </AlertDescription>
            </Alert>
          ) : null}

          {state.posts.length === 0 ? (
            <Empty
              title="No posts yet"
              description="A post is a short update, event or offer that shows on the listing for a week or so."
            />
          ) : (
            <ul className="flex flex-col gap-3">
              {state.posts.map((post) => (
                <li
                  key={post.id}
                  className="flex flex-col gap-2 rounded-(--np-radius-card) border border-line p-4"
                >
                  <div className="flex items-center justify-between gap-3">
                    <StatusPill tone={STATUS[post.status].tone}>
                      {STATUS[post.status].label}
                    </StatusPill>
                    <span className="text-caption text-ink-muted">
                      {TOPIC[post.topicType] ?? post.topicType}
                    </span>
                  </div>
                  <p className="text-ui" lang={post.languageCode} dir="auto">
                    {post.summary || "—"}
                  </p>
                  <PostsActionBar
                    locationId={locationId}
                    post={post}
                    caps={caps}
                    writesEnabled={state.writesEnabled}
                  />
                </li>
              ))}
            </ul>
          )}
        </EditorFrame>
      )}
    </LocationTab>
  )
}
