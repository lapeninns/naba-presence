import { PostsTab } from "@/components/locations/posts-tab"

export default async function PostsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <PostsTab locationId={id} />
}
