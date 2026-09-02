"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { cancelBackfill, fetchBackfillProgress, startBackfill, type BackfillProgress } from "@/lib/api/backfill"
import { queryKeys } from "./keys"
import { requestOptions } from "./request-options"

function anyRunning(progress: { progress: BackfillProgress } | undefined): boolean {
  return (progress?.progress.items ?? []).some(
    (item) => item.status === "running" || item.status === "pending"
  )
}

export function useBackfill() {
  const client = useQueryClient()
  const query = useQuery({
    queryKey: queryKeys.backfill,
    queryFn: (ctx) => fetchBackfillProgress(undefined, requestOptions(ctx)),
    refetchInterval: (q) => (anyRunning(q.state.data) ? 3_000 : false),
  })
  const invalidate = () => client.invalidateQueries({ queryKey: queryKeys.backfill })
  const start = useMutation({
    mutationFn: (input: { externalLocationIds?: string[]; maxPagesPerLocation: number }) => startBackfill(input),
    onSuccess: invalidate,
  })
  const cancel = useMutation({
    mutationFn: (externalLocationIds: string[]) => cancelBackfill(externalLocationIds),
    onSuccess: invalidate,
  })
  return { query, start, cancel }
}
