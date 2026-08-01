"use client"

import { useQuery } from "@tanstack/react-query"

import { fetchPosts } from "@/lib/api/location-posts"
import { queryKeys } from "./keys"

export function usePosts(id: string) {
  return useQuery({ queryKey: queryKeys.locationPosts(id), queryFn: () => fetchPosts(id), staleTime: 30_000 })
}
