"use client"

import { useQuery } from "@tanstack/react-query"

import { fetchPosts } from "@/lib/api/location-posts"
import { queryKeys } from "./keys"
import { requestOptions } from "./request-options"

export function usePosts(id: string) {
  return useQuery({ queryKey: queryKeys.locationPosts(id), queryFn: (ctx) => fetchPosts(id, requestOptions(ctx)) })
}
