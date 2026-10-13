"use client"

import { useEffect, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useRouter, useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { SettingsFacts } from "@/components/settings/settings-section"
import {
  Field,
  FieldDescription,
  FieldLabel,
  FormError,
} from "@/components/ui/field"
import { QueryError, QueryPending } from "@/components/ui/query-states"
import { Textarea } from "@/components/ui/textarea"
import {
  createOnboardingReview,
  fetchOnboardingReview,
  approveOnboardingReview,
  submitOnboardingCreation,
} from "@/lib/api/google-onboarding"
import type { GoogleOnboardingDraft } from "@/lib/contracts/google-onboarding"
import { describeActionError } from "@/lib/errors/action-errors"
import { categoryLabel, openStatusLabel } from "@/lib/locations/console-labels"
import { googleOpeningDateSchema } from "@/lib/domain/business-information"
import { googleServiceItemsSchema } from "@/lib/domain/google-services"
import { onboardingServiceReviewRows } from "@/lib/locations/onboarding-service-review"
import { googleRelationshipSchema } from "@/lib/domain/google-relationships"
import { onboardingRelationshipReviewRows } from "@/lib/locations/onboarding-relationships"
import { ApiClientError } from "@/lib/api/client"
import { ShareSetupLink } from "./share-setup-link"
import { googleOnboardingMoreHoursSchema, googleOnboardingRegularHoursSchema, googleOnboardingSpecialHoursSchema, googleHoursPeriodLabel, googleSpecialHoursPeriodLabel } from "@/lib/domain/google-onboarding-hours"

function detailRows(
  value: unknown,
  path = ""
): Array<{ label: string; value: string }> {
  if (value === undefined || value === null) return []
  if (path === "more Hours") {
    const hours = googleOnboardingMoreHoursSchema.safeParse(value)
    if (hours.success) return hours.data.flatMap((schedule, scheduleIndex) => schedule.periods.map((period, index) => ({ label: `Service hours ${scheduleIndex + 1} / period ${index + 1}`, value: `${schedule.hoursTypeId}: ${googleHoursPeriodLabel(period)}` })))
  }
  if (path === "regular Hours") {
    const hours = googleOnboardingRegularHoursSchema.safeParse(value)
    if (hours.success) return hours.data.periods.map((period, index) => ({ label: `Regular hours ${index + 1}`, value: googleHoursPeriodLabel(period) }))
  }
  if (path === "special Hours") {
    const hours = googleOnboardingSpecialHoursSchema.safeParse(value)
    if (hours.success) return hours.data.specialHourPeriods.map((period, index) => ({ label: `Special hours ${index + 1}`, value: googleSpecialHoursPeriodLabel(period) }))
  }
  if (path === "relationship Data") {
    const relationship = googleRelationshipSchema.safeParse(value)
    if (relationship.success) return onboardingRelationshipReviewRows(relationship.data)
  }
  if (path === "service Items") {
    const services = googleServiceItemsSchema.safeParse(value)
    if (services.success) return services.data.length ? onboardingServiceReviewRows(services.data) : [{ label: "Services", value: "None" }]
  }
  if (path === "open Info / opening Date") {
    const date = googleOpeningDateSchema.safeParse(value)
    if (date.success)
      return [
        {
          label: "Opening date",
          value: `${String(date.data.year).padStart(4, "0")}-${String(date.data.month).padStart(2, "0")}${date.data.day ? `-${String(date.data.day).padStart(2, "0")}` : " (day not supplied)"}`,
        },
      ]
  }
  if (Array.isArray(value) && value.length === 0)
    return [{ label: path, value: "None" }]
  if (typeof value === "object" && Object.keys(value).length === 0)
    return [{ label: path, value: "Not supplied" }]
  if (Array.isArray(value))
    return value.flatMap((item, index) =>
      detailRows(item, `${path} ${index + 1}`)
    )
  if (typeof value === "object")
    return Object.entries(value).flatMap(([key, item]) =>
      detailRows(
        item,
        `${path}${path ? " / " : ""}${key.replace(/([a-z])([A-Z])/g, "$1 $2")}`
      )
    )
  const text = String(value)
  const label =
    path === "open Info / status"
      ? "Opening state"
      : path === "profile / description"
        ? "Business description"
        : path === "store Code"
          ? "Store code"
          : path === "ad Words Location Extensions / ad Phone"
            ? "Google Ads phone"
            : /^labels \d+$/.test(path)
              ? path.replace("labels", "Private label")
              : path
  return [
    {
      label,
      value:
        path === "open Info / status"
          ? openStatusLabel(text)
          : text.startsWith("categories/")
            ? categoryLabel({ name: text })
            : text === "CUSTOMER_LOCATION_ONLY"
              ? "At customer locations only"
              : text === "CUSTOMER_AND_BUSINESS_LOCATION"
                ? "At business and customer locations"
                : text,
    },
  ]
}

export function OnboardingReview({
  draft,
  onBusyChange,
  onDirtyChange,
  onCreated,
  disabled = false,
}: {
  draft: GoogleOnboardingDraft
  onBusyChange: (busy: boolean) => void
  onDirtyChange: (dirty: boolean) => void
  onCreated: () => void
  disabled?: boolean
}) {
  const params = useSearchParams()
  const router = useRouter()
  const client = useQueryClient()
  const reviewId = params.get("onboardingReview")
  const [reason, setReason] = useState("")
  const [acknowledged, setAcknowledged] = useState<string[]>([])
  const [confirmCreate, setConfirmCreate] = useState(false)
  const reviewKey = [
    "onboarding-review",
    draft.accountId,
    draft.id,
    draft.revision,
    draft.matchResult?.checkedAt,
    reviewId,
  ]
  const review = useQuery({
    queryKey: reviewKey,
    queryFn: ({ signal }) =>
      fetchOnboardingReview(draft.accountId, draft.id, reviewId ?? "", {
        signal,
      }),
    enabled: Boolean(reviewId),
    retry: false,
    refetchOnWindowFocus: false,
  })
  const openReview = (id: string | null) => {
    const next = new URLSearchParams(params.toString())
    if (id) next.set("onboardingReview", id)
    else next.delete("onboardingReview")
    router.replace(`/setup?${next}`, { scroll: false })
  }
  const validate = useMutation({
    mutationFn: () =>
      createOnboardingReview(draft.accountId, draft.id, {
        expectedRevision: draft.revision,
        expectedMatchCheckedAt: draft.matchResult?.checkedAt ?? "",
        decision: {
          action: "create_new",
          acknowledgedMatchNames: acknowledged,
          reason: reason.trim(),
        },
      }),
    retry: false,
    onSuccess: (saved) => {
      client.setQueryData(
        [
          "onboarding-review",
          draft.accountId,
          draft.id,
          draft.revision,
          draft.matchResult?.checkedAt,
          saved.id,
        ],
        saved
      )
      openReview(saved.id)
    },
  })
  const approve = useMutation({
    mutationFn: () => {
      const value = review.data
      if (!value) throw new Error("Restore the review before approving.")
      return approveOnboardingReview(
        draft.accountId,
        draft.id,
        value.id,
        value.reviewHash
      )
    },
    retry: false,
    onSuccess: (saved) => client.setQueryData(reviewKey, saved),
  })
  const submit = useMutation({
    mutationFn: () => {
      const value = review.data
      if (!value) throw new Error("Restore the review before submitting.")
      return submitOnboardingCreation(
        draft.accountId,
        draft.id,
        value.id,
        value.reviewHash
      )
    },
    retry: false,
    onSuccess: onCreated,
    onError: onCreated,
  })
  const busy =
    disabled ||
    validate.isPending ||
    approve.isPending ||
    submit.isPending ||
    (Boolean(reviewId) && review.isFetching)
  useEffect(() => {
    onBusyChange(busy)
    return () => onBusyChange(false)
  }, [busy, onBusyChange])
  const decisionDirty = !reviewId && Boolean(reason || acknowledged.length)
  useEffect(() => {
    onDirtyChange(decisionDirty)
    return () => onDirtyChange(false)
  }, [decisionDirty, onDirtyChange])
  if (!draft.matchResult) return null
  return (
    <section
      aria-labelledby="creation-review-heading"
      className="flex min-w-0 flex-col gap-4 border-t border-line-subtle pt-5"
    >
      <div className="space-y-1">
        <h4 id="creation-review-heading" className="text-title font-semibold">
          Create a separate listing
        </h4>
        <p className="text-body text-pretty text-ink-muted">
          First check accessible listings and ownership options above. Continue
          only if a separate public listing is appropriate.
        </p>
      </div>
      {!reviewId ? (
        <>
          <fieldset disabled={busy} className="flex flex-col gap-3">
            {draft.matchResult.matches.map((match) => (
              <Checkbox
                key={match.name}
                label={`I reviewed the potential match: ${match.location.title || match.name}`}
                checked={acknowledged.includes(match.name)}
                onCheckedChange={(checked) =>
                  setAcknowledged((names) =>
                    checked
                      ? [...names, match.name]
                      : names.filter((name) => name !== match.name)
                  )
                }
              />
            ))}
            <Field>
              <FieldLabel>Why is a separate listing needed?</FieldLabel>
              <Textarea
                value={reason}
                maxLength={1000}
                rows={3}
                onChange={(event) => setReason(event.target.value)}
              />
              <FieldDescription>
                This explanation and every acknowledged match become part of the
                creation review.
              </FieldDescription>
            </Field>
          </fieldset>
          <Button
            className="self-stretch sm:self-start"
            pending={validate.isPending}
            pendingLabel="Validating with Google…"
            disabled={
              busy ||
              !reason.trim() ||
              acknowledged.length !== draft.matchResult.matches.length ||
              !draft.payload.title ||
              !draft.payload.languageCode
            }
            onClick={() => validate.mutate()}
          >
            Validate and review creation
          </Button>
          {decisionDirty && (
            <Button
              variant="ghost"
              className="self-start"
              disabled={busy}
              onClick={() => {
                setReason("")
                setAcknowledged([])
              }}
            >
              Discard creation decision
            </Button>
          )}
          {validate.isError && (
            <FormError>
              {validate.error instanceof ApiClientError &&
              validate.error.status === 422
                ? "The proposed business details could not be validated. Check the saved business details and service areas, then try validation again."
                : describeActionError(validate.error)}
            </FormError>
          )}
        </>
      ) : review.isPending ? (
        <QueryPending label="Restoring creation review…" />
      ) : review.isError ? (
        <div className="flex flex-col gap-2">
          <QueryError
            title="The creation review didn’t load"
            description={describeActionError(review.error)}
            onRetry={() => void review.refetch()}
            retryLabel="Retry restoring review"
          />
          <Button
            variant="ghost"
            className="self-start"
            onClick={() => openReview(null)}
          >
            Start a fresh review
          </Button>
        </div>
      ) : (
        review.data && (
          <>
            <div className="space-y-1">
              <p className="text-body">
                Google validation completed. Approval and submission are
                separate actions.
              </p>
              <p className="text-caption text-ink-muted">
                Account: {review.data.accountName}. Review expires{" "}
                {new Date(review.data.approvalExpiresAt).toLocaleString(
                  "en-GB"
                )}
                .
              </p>
            </div>
            <SettingsFacts
              className="border-y border-line-subtle"
              facts={detailRows(review.data.payload).map(
                (row) =>
                  [
                    <span key="label" className="capitalize">
                      {row.label}
                    </span>,
                    <span key="value" className="whitespace-pre-wrap">
                      {row.value}
                    </span>,
                  ] as const
              )}
            />
            <p className="text-body break-words whitespace-pre-wrap">
              <strong className="font-semibold">Reason:</strong> {review.data.decision.reason}
            </p>
            <p className="text-caption text-ink-muted tabular-nums">
              {review.data.decision.acknowledgedMatchNames.length} potential
              matches acknowledged in this exact review.
            </p>
            {!review.data.approvedBy ? (
              <>
                <p className="text-body">
                  {review.data.requiresSecondApprover
                    ? "A different authorised owner or admin must approve this review. Share this setup link with them."
                    : "Approve these exact details before submitting creation."}
                </p>
                {review.data.requiresSecondApprover ? (
                  <ShareSetupLink
                    title="Approve a new Google listing"
                    text="Please review and approve this new Google listing in NabaPresence."
                  />
                ) : null}
                <Button
                  className="self-stretch sm:self-start"
                  pending={approve.isPending}
                  pendingLabel="Approving…"
                  disabled={!review.data.canApprove || busy}
                  onClick={() => approve.mutate()}
                >
                  Approve creation details
                </Button>
              </>
            ) : (
              <>
                <p role="status" className="text-body">
                  These creation details are approved.
                </p>
                <Checkbox
                  label="I am ready to create this public Google listing with the reviewed details."
                  checked={confirmCreate}
                  disabled={busy}
                  onCheckedChange={setConfirmCreate}
                />
                <Button
                  className="self-stretch sm:self-start"
                  pending={submit.isPending}
                  pendingLabel="Submitting creation…"
                  disabled={!confirmCreate || busy}
                  onClick={() => submit.mutate()}
                >
                  Create approved Google listing
                </Button>
              </>
            )}
            {(approve.isError || submit.isError) && (
              <FormError>
                {describeActionError(approve.error ?? submit.error)} Refresh the
                review and outcome before retrying.
              </FormError>
            )}
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => void review.refetch()}
              >
                Refresh creation review
              </Button>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => openReview(null)}
              >
                Start a fresh review
              </Button>
            </div>
          </>
        )
      )}
    </section>
  )
}
