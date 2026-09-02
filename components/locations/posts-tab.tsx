"use client"

import { LocationTab } from "@/components/locations/location-tab"
import { PostComposer } from "@/components/locations/post-composer"
import { PostsActionBar } from "@/components/locations/posts-action-bar"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import type { Post } from "@/lib/api/location-posts"
import { composeDisabledReason } from "@/lib/locations/gating"
import { usePosts } from "@/lib/queries/use-location-posts"

const STATUS: Record<Post["status"], { label: string; variant: "secondary" | "info" | "warning" | "destructive" | "success" }> = {
  draft: { label: "Draft", variant: "secondary" },
  awaiting_approval: { label: "Awaiting approval", variant: "info" },
  publishing: { label: "Publishing", variant: "info" },
  published: { label: "Published", variant: "success" },
  failed: { label: "Failed", variant: "destructive" },
  ambiguous: { label: "Needs checking", variant: "warning" },
}

export function PostsTab({ locationId }: { locationId: string }) {
  return (
    <LocationTab locationId={locationId} useResource={usePosts} resource="posts">
      {({ data: state, caps }) => (
        <div className="flex flex-col gap-6">
          {state.reconciliationError ? (
            <Alert variant="warning">
              <AlertTitle>Some Google posts may be out of date</AlertTitle>
              <AlertDescription>We couldn’t reach Google to refresh this list just now. Your drafts are safe.</AlertDescription>
            </Alert>
          ) : null}

          <PostComposer locationId={locationId} disabledReason={composeDisabledReason(state.writesEnabled)} />

          <section className="flex flex-col gap-3">
            <h2 className="text-title font-semibold">Posts</h2>
            {state.posts.length === 0 ? (
              <p className="text-ui text-muted-foreground">No posts yet.</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {state.posts.map((post) => (
                  <li key={post.id} className="flex flex-col gap-2 rounded-(--nr-radius-card) border border-border p-4">
                    <div className="flex items-center justify-between gap-3">
                      <Badge variant={STATUS[post.status].variant}>{STATUS[post.status].label}</Badge>
                      <span className="text-caption text-muted-foreground">{post.topicType === "STANDARD" ? "Update" : post.topicType === "EVENT" ? "Event" : "Offer"}</span>
                    </div>
                    <p className="text-ui" lang={post.languageCode} dir="auto">
                      {post.summary || "—"}
                    </p>
                    <PostsActionBar locationId={locationId} post={post} caps={caps} writesEnabled={state.writesEnabled} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </LocationTab>
  )
}
