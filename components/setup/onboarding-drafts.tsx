"use client"

import { useEffect, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldError,
  FieldLabel,
  FieldDescription,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  createOnboardingDraft,
  fetchOnboardingDraft,
  fetchOnboardingDrafts,
  saveOnboardingDraft,
  matchOnboardingDraft,
  fetchOnboardingCreation,
  linkOnboardingCreation,
} from "@/lib/api/google-onboarding"
import {
  googleOnboardingPayloadSchema,
  type GoogleOnboardingDraft,
  type GoogleOnboardingCreation,
} from "@/lib/contracts/google-onboarding"
import { describeActionError } from "@/lib/errors/action-errors"
import { useGoogleAccounts } from "@/lib/queries/use-google-accounts"
import { queryKeys } from "@/lib/queries/keys"
import { useLeaveGuard } from "@/lib/editors/use-leave-guard"
import { DiscardDialog } from "@/components/editors/discard-dialog"
import { OnboardingCategories } from "./onboarding-categories"
import { OnboardingReview } from "./onboarding-review"
import { OnboardingServiceArea } from "./onboarding-service-area"
import { OnboardingOpening } from "./onboarding-opening"
import { OnboardingServices } from "./onboarding-services"
import { OnboardingRelationships } from "./onboarding-relationships"
import { OnboardingChain } from "./onboarding-chain"
import { OnboardingHours } from "./onboarding-hours"
import { OnboardingMoreHours } from "./onboarding-more-hours"
import { OnboardingMatchLink } from "./onboarding-match-link"
import { OnboardingMatchLinkStatus } from "./onboarding-match-link-status"
import { fetchOnboardingMatchLink } from "@/lib/api/google-onboarding-match-link"
import { buildServiceItems, serviceDraftRows } from "@/lib/locations/forms/services"
import {
  openingDraftFromPayload,
  openingPayloadFromDraft,
} from "@/lib/locations/onboarding-opening"

export function OnboardingDrafts({
  clientId,
  connectionId,
  onDirtyChange,
}: {
  clientId: string
  connectionId: string | null
  onDirtyChange: (dirty: boolean) => void
}) {
  const params = useSearchParams()
  const router = useRouter()
  const accounts = useGoogleAccounts(connectionId, { clientId })
  const active = (accounts.query.data?.accounts ?? []).filter(
    (account) => account.isActive && account.googleConnectionId === connectionId
  )
  const [selected, setSelected] = useState<string | null>(null)
  const accountId =
    params.get("onboardingAccount") ??
    selected ??
    (active.length === 1 ? active[0].id : "")
  const account = active.find((candidate) => candidate.id === accountId)
  const draftId = params.get("onboardingDraft")
  const open = (id: string | null, target = accountId) => {
    const next = new URLSearchParams(params.toString())
    next.delete("onboardingReview")
    next.delete("onboardingMatchLinkReview")
    if (id) {
      next.set("onboardingAccount", target)
      next.set("onboardingDraft", id)
    } else {
      next.delete("onboardingAccount")
      next.delete("onboardingDraft")
    }
    router.replace(`/setup?${next}`, { scroll: false })
  }
  return (
    <section
      aria-labelledby="onboarding-drafts-heading"
      className="flex min-w-0 flex-col gap-4 border-t border-line pt-6"
    >
      <div className="space-y-1">
        <h3
          id="onboarding-drafts-heading"
          className="text-title font-semibold text-ink"
        >
          Find your business on Google
        </h3>
        <p className="text-ui text-ink-muted">
          If the listing is not in the accessible listings above, save its
          details and check for potential matches. Saving and searching do not
          create a public listing.
        </p>
      </div>
      {!connectionId ? (
        <p className="text-ui text-ink-muted">
          Connect this client to Google before searching.
        </p>
      ) : accounts.query.isError ? (
        <div role="alert">
          <p>{describeActionError(accounts.query.error)}</p>
          <Button
            variant="secondary"
            onClick={() => void accounts.query.refetch()}
          >
            Retry accounts
          </Button>
        </div>
      ) : accounts.query.isPending ? (
        <p role="status">Loading accounts…</p>
      ) : (
        <>
          <Field>
            <FieldLabel>Account for this business</FieldLabel>
            <Select
              value={account?.id ?? null}
              disabled={Boolean(draftId)}
              onValueChange={(value) => {
                setSelected(value)
                open(null)
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Choose an account">
                  {account?.accountName || account?.googleAccountName}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {active.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.accountName || item.googleAccountName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldDescription>
              The draft stays with this account and this client.
            </FieldDescription>
          </Field>
          {active.length === 0 && (
            <p role="status" className="text-ui text-ink-muted">
              Select an active account in the previous setup step.
            </p>
          )}
          {draftId && !account && (
            <div role="alert" className="space-y-2">
              <p>
                This draft’s account is no longer selected or accessible.
                Refresh account discovery before restoring it.
              </p>
              <Button variant="secondary" onClick={() => open(null)}>
                Return to saved drafts
              </Button>
            </div>
          )}
          {account && (
            <DraftWorkspace
              key={`${account.id}:${draftId ?? "list"}`}
              clientId={clientId}
              connectionId={connectionId}
              accountId={account.id}
              draftId={draftId}
              onOpen={open}
              onDirtyChange={onDirtyChange}
            />
          )}
        </>
      )}
    </section>
  )
}

function DraftWorkspace({
  clientId,
  connectionId,
  accountId,
  draftId,
  onOpen,
  onDirtyChange,
}: {
  clientId: string
  connectionId: string
  accountId: string
  draftId: string | null
  onOpen: (id: string | null) => void
  onDirtyChange: (dirty: boolean) => void
}) {
  const params = useSearchParams()
  const listParams = new URLSearchParams(params.toString())
  const router = useRouter()
  listParams.delete("onboardingDraft")
  listParams.delete("onboardingReview")
  listParams.delete("onboardingMatchLinkReview")
  const client = useQueryClient()
  const newId = useRef<string | null>(null)
  const [reloadVersion, setReloadVersion] = useState(0)
  const draftKey = ["google-onboarding-draft", accountId, draftId]
  const list = useQuery({
    queryKey: ["google-onboarding-drafts", accountId, clientId],
    queryFn: ({ signal }) =>
      fetchOnboardingDrafts(accountId, connectionId, clientId, { signal }),
    enabled: !draftId,
  })
  const draft = useQuery({
    queryKey: draftKey,
    queryFn: ({ signal }) =>
      fetchOnboardingDraft(accountId, draftId!, { signal }),
    enabled: Boolean(draftId),
    refetchOnWindowFocus: false,
  })
  const creation = useQuery({
    queryKey: [...draftKey, "creation"],
    queryFn: ({ signal }) =>
      fetchOnboardingCreation(accountId, draftId!, { signal }),
    enabled: Boolean(draftId),
    refetchOnWindowFocus: false,
    retry: false,
  })
  const matchLink = useQuery({
    queryKey: [...draftKey, "match-link"],
    queryFn: ({ signal }) => fetchOnboardingMatchLink({ accountId, draftId: draftId ?? "" }, { signal }),
    enabled: Boolean(draftId), retry: false, refetchOnWindowFocus: false,
  })
  const restoreLinkReview = (id: string) => {
    const next = new URLSearchParams(params.toString())
    next.delete("onboardingReview")
    next.set("onboardingMatchLinkReview", id)
    router.replace(`/setup?${next}`, { scroll: false })
  }
  const refreshMatchLink = () => {
    void matchLink.refetch().then((result) => {
      if (result.data?.state === "linked") {
        void client.invalidateQueries({ queryKey: queryKeys.clientSetup(clientId) })
        void client.invalidateQueries({ queryKey: queryKeys.locations })
      }
    })
  }
  const create = useMutation({
    mutationFn: () => {
      newId.current ??= crypto.randomUUID()
      return createOnboardingDraft(accountId, {
        draftId: newId.current,
        connectionId,
        clientId,
        payload: { languageCode: "en-GB" },
      })
    },
    retry: false,
    onSuccess: (saved) => {
      client.setQueryData(
        ["google-onboarding-draft", accountId, saved.id],
        saved
      )
      onOpen(saved.id)
    },
  })
  if (!draftId)
    return (
      <div className="flex flex-col gap-3">
        <Button
          className="self-start"
          pending={create.isPending}
          pendingLabel="Saving draft…"
          onClick={() => create.mutate()}
        >
          Start a business draft
        </Button>
        {create.isError && (
          <p role="alert" className="text-ui text-danger-ink">
            {describeActionError(create.error)} Retry uses the same draft
            identity.
          </p>
        )}
        <div className="flex items-center justify-between gap-3">
          <h4 className="text-ui font-semibold">Saved business drafts</h4>
          <Button
            variant="ghost"
            size="sm"
            pending={list.isFetching}
            onClick={() => void list.refetch()}
          >
            Refresh drafts
          </Button>
        </div>
        {list.isPending ? (
          <p role="status">Loading saved drafts…</p>
        ) : list.isError ? (
          <p role="alert">{describeActionError(list.error)}</p>
        ) : !list.data.drafts.length ? (
          <p className="text-ui text-ink-muted">
            No saved drafts for this client and account.
          </p>
        ) : (
          <ul className="divide-y divide-line rounded-(--np-radius-card) border border-line">
            {list.data.drafts.map((item) => (
              <li
                key={item.id}
                className="flex flex-wrap items-center justify-between gap-3 p-4"
              >
                <div className="min-w-0">
                  <p className="text-ui font-semibold break-words">
                    {item.payload.title || "Untitled business"}
                  </p>
                  <p className="text-caption text-ink-muted">
                    Saved {new Date(item.updatedAt).toLocaleString("en-GB")}
                  </p>
                </div>
                <Button variant="secondary" onClick={() => onOpen(item.id)}>
                  Restore draft
                  <span className="sr-only">
                    : {item.payload.title || "Untitled business"}
                  </span>
                </Button>
              </li>
            ))}
          </ul>
        )}
        {list.data?.drafts.length === 20 && (
          <p className="text-caption text-ink-muted">
            Showing the 20 most recently updated drafts. Older drafts can still
            be opened from their saved setup links.
          </p>
        )}
      </div>
    )
  return (
    <div className="flex flex-col gap-4">
      <Link
        className="self-start text-ui underline underline-offset-4"
        href={`/setup?${listParams}`}
      >
        Saved drafts
      </Link>
      {draft.isPending ? (
        <p role="status">Restoring business draft…</p>
      ) : draft.isError ? (
        <div role="alert">
          <p>{describeActionError(draft.error)}</p>
          <Button variant="secondary" onClick={() => void draft.refetch()}>
            Retry restoring draft
          </Button>
        </div>
      ) : draft.data.clientId !== clientId ||
        draft.data.connectionId !== connectionId ? (
        <p role="alert">
          This draft belongs to a different setup context. Open it from the
          correct client and connection.
        </p>
      ) : creation.isPending ? (
        <p role="status">Checking creation status…</p>
      ) : creation.isError ? (
        <div role="alert">
          <p>{describeActionError(creation.error)}</p>
          <Button variant="secondary" onClick={() => void creation.refetch()}>
            Retry creation status
          </Button>
        </div>
      ) : creation.data ? (
        <CreationStatus
          key={creation.data.id}
          value={creation.data}
          accountId={accountId}
          draftId={draftId}
          initialName={draft.data.payload.title ?? ""}
          onRefresh={() => void creation.refetch()}
          onLinked={() => {
            void creation.refetch()
            void client.invalidateQueries({
              queryKey: queryKeys.clientSetup(clientId),
            })
            void client.invalidateQueries({ queryKey: queryKeys.locations })
          }}
        />
      ) : matchLink.isPending ? (
        <p role="status">Checking existing listing link status…</p>
      ) : matchLink.isError ? (
        <div role="alert" className="space-y-2">
          <p>{describeActionError(matchLink.error)} Restore link status before editing or starting another operation.</p>
          <Button variant="secondary" onClick={refreshMatchLink}>Retry link status</Button>
        </div>
      ) : matchLink.data && matchLink.data.state !== "failed" ? (
        <OnboardingMatchLinkStatus value={matchLink.data} refreshing={matchLink.isFetching} onRefresh={refreshMatchLink} onReview={restoreLinkReview} />
      ) : (
        <>
        {matchLink.data && <OnboardingMatchLinkStatus value={matchLink.data} refreshing={matchLink.isFetching} onRefresh={refreshMatchLink} onReview={restoreLinkReview} />}
        <DraftDetails
          key={`${draft.data.id}:${draft.data.revision}:${reloadVersion}`}
          draft={draft.data}
          onDirtyChange={onDirtyChange}
          onMatchFinished={refreshMatchLink}
          matchStatusBusy={matchLink.isFetching}
          onReload={() =>
            void draft.refetch().then((result) => {
              if (result.isSuccess) setReloadVersion((value) => value + 1)
            })
          }
          onSaved={(saved) => client.setQueryData(draftKey, saved)}
          onCreated={() =>
            void creation.refetch().then((result) => {
              if (result.data?.linkState === "linked") {
                void client.invalidateQueries({
                  queryKey: queryKeys.clientSetup(clientId),
                })
                void client.invalidateQueries({ queryKey: queryKeys.locations })
              }
            })
          }
        />
        </>
      )}
    </div>
  )
}

function DraftDetails({
  draft,
  onSaved,
  onReload,
  onDirtyChange,
  onCreated,
  onMatchFinished,
  matchStatusBusy,
}: {
  draft: GoogleOnboardingDraft
  onSaved: (draft: GoogleOnboardingDraft) => void
  onReload: () => void
  onDirtyChange: (dirty: boolean) => void
  onCreated: () => void
  onMatchFinished: () => void
  matchStatusBusy: boolean
}) {
  const params = useSearchParams()
  const [reviewBusy, setReviewBusy] = useState(false)
  const [reviewDirty, setReviewDirty] = useState(false)
  const [matchBusy, setMatchBusy] = useState(false)
  const [matchDirty, setMatchDirty] = useState(false)
  const [title, setTitle] = useState(draft.payload.title ?? "")
  const [categories, setCategories] = useState(draft.payload.categories)
  const [relationships, setRelationships] = useState(draft.payload.relationshipData)
  const [relationshipEntryDirty, setRelationshipEntryDirty] = useState(false)
  const [regularHours, setRegularHours] = useState(draft.payload.regularHours)
  const [specialHours, setSpecialHours] = useState(draft.payload.specialHours)
  const [hoursEntryDirty, setHoursEntryDirty] = useState(false)
  const [moreHours, setMoreHours] = useState(draft.payload.moreHours)
  const [moreHoursEntryDirty, setMoreHoursEntryDirty] = useState(false)
  const [serviceRows, setServiceRows] = useState(() => serviceDraftRows(draft.payload.serviceItems ?? []))
  const builtServices = buildServiceItems(serviceRows)
  const [opening, setOpening] = useState(() =>
    openingDraftFromPayload(draft.payload.openInfo)
  )
  const [serviceArea, setServiceArea] = useState(draft.payload.serviceArea)
  const [areaEntryDirty, setAreaEntryDirty] = useState(false)
  const [removeAddress, setRemoveAddress] = useState(false)
  const [website, setWebsite] = useState(draft.payload.websiteUri ?? "")
  const [description, setDescription] = useState(
    draft.payload.profile?.description ?? ""
  )
  const [storeCode, setStoreCode] = useState(draft.payload.storeCode ?? "")
  const [labels, setLabels] = useState((draft.payload.labels ?? []).join("\n"))
  const advertising = draft.payload.adWordsLocationExtensions
  const initialAdPhone =
    advertising && "adPhone" in advertising ? advertising.adPhone : ""
  const [adPhone, setAdPhone] = useState(initialAdPhone)
  const [primaryPhone, setPrimaryPhone] = useState(
    draft.payload.phoneNumbers?.primaryPhone ?? ""
  )
  const [additionalPhones, setAdditionalPhones] = useState(
    (draft.payload.phoneNumbers?.additionalPhones ?? []).join("\n")
  )
  const phoneLines = additionalPhones
    .split("\n")
    .map((phone) => phone.trim())
    .filter(Boolean)
  const phonesEdited =
    primaryPhone !== (draft.payload.phoneNumbers?.primaryPhone ?? "") ||
    additionalPhones !==
      (draft.payload.phoneNumbers?.additionalPhones ?? []).join("\n")
  const [language, setLanguage] = useState(
    draft.payload.languageCode ?? "en-GB"
  )
  const address = draft.payload.storefrontAddress
  const [lines, setLines] = useState(
    address && "addressLines" in address ? address.addressLines.join("\n") : ""
  )
  const [postcode, setPostcode] = useState(
    address && "postalCode" in address ? (address.postalCode ?? "") : ""
  )
  const [country, setCountry] = useState(
    address && "regionCode" in address ? address.regionCode : "GB"
  )
  const [locality, setLocality] = useState(
    address && "locality" in address ? (address.locality ?? "") : ""
  )
  const [administrativeArea, setAdministrativeArea] = useState(
    address && "administrativeArea" in address
      ? (address.administrativeArea ?? "")
      : ""
  )
  const [sublocality, setSublocality] = useState(
    address && "sublocality" in address ? (address.sublocality ?? "") : ""
  )
  const addressEdited =
    lines !==
      (address && "addressLines" in address
        ? address.addressLines.join("\n")
        : "") ||
    postcode !==
      (address && "postalCode" in address ? (address.postalCode ?? "") : "") ||
    country !==
      (address && "regionCode" in address ? address.regionCode : "GB") ||
    locality !==
      (address && "locality" in address ? (address.locality ?? "") : "") ||
    administrativeArea !==
      (address && "administrativeArea" in address
        ? (address.administrativeArea ?? "")
        : "") ||
    sublocality !==
      (address && "sublocality" in address ? (address.sublocality ?? "") : "")
  const payload = {
    ...draft.payload,
    title: title.trim() || undefined,
    languageCode: language.trim(),
    categories,
    relationshipData: relationships,
    regularHours,
    specialHours,
    moreHours,
    serviceItems: builtServices.success ? builtServices.items.length || draft.payload.serviceItems !== undefined ? builtServices.items : undefined : draft.payload.serviceItems,
    serviceArea,
    openInfo: openingPayloadFromDraft(opening, draft.payload.openInfo),
    ...(description !== (draft.payload.profile?.description ?? "")
      ? {
          profile: description.trim()
            ? { ...draft.payload.profile, description: description.trim() }
            : undefined,
        }
      : {}),
    ...(storeCode !== (draft.payload.storeCode ?? "")
      ? { storeCode: storeCode.trim() || undefined }
      : {}),
    ...(labels !== (draft.payload.labels ?? []).join("\n")
      ? {
          labels: labels.trim()
            ? labels
                .split("\n")
                .map((label) => label.trim())
                .filter(Boolean)
            : undefined,
        }
      : {}),
    ...(adPhone !== initialAdPhone
      ? {
          adWordsLocationExtensions: adPhone.trim()
            ? { ...advertising, adPhone: adPhone.trim() }
            : undefined,
        }
      : {}),
    ...(website !== (draft.payload.websiteUri ?? "")
      ? { websiteUri: website.trim() || undefined }
      : {}),
    ...(phonesEdited
      ? {
          phoneNumbers:
            primaryPhone.trim() || phoneLines.length
              ? {
                  primaryPhone: primaryPhone.trim() || undefined,
                  additionalPhones: phoneLines,
                }
              : undefined,
        }
      : {}),
    ...(addressEdited
      ? lines.trim() ||
        postcode.trim() ||
        locality.trim() ||
        administrativeArea.trim() ||
        sublocality.trim()
        ? {
            storefrontAddress: {
              ...address,
              addressLines: lines
                .split("\n")
                .map((line) => line.trim())
                .filter(Boolean),
              ...(postcode !==
              (address && "postalCode" in address
                ? (address.postalCode ?? "")
                : "")
                ? { postalCode: postcode.trim() || undefined }
                : {}),
              regionCode: country.trim().toUpperCase(),
              ...(locality !==
              (address && "locality" in address ? (address.locality ?? "") : "")
                ? { locality: locality.trim() || undefined }
                : {}),
              ...(administrativeArea !==
              (address && "administrativeArea" in address
                ? (address.administrativeArea ?? "")
                : "")
                ? { administrativeArea: administrativeArea.trim() || undefined }
                : {}),
              ...(sublocality !==
              (address && "sublocality" in address
                ? (address.sublocality ?? "")
                : "")
                ? { sublocality: sublocality.trim() || undefined }
                : {}),
            },
          }
        : { storefrontAddress: undefined }
      : {}),
  }
  if (removeAddress) payload.storefrontAddress = undefined
  const serviceContextError =
    serviceArea?.businessType === "CUSTOMER_LOCATION_ONLY"
      ? !serviceArea.regionCode
        ? "Enter the service-area country before reviewing creation."
        : payload.storefrontAddress &&
            Object.keys(payload.storefrontAddress).length
          ? "Remove the storefront address before reviewing a customer-only business."
          : undefined
      : undefined
  const parsedPayload = googleOnboardingPayloadSchema.safeParse(payload)
  const openingIssue = !parsedPayload.success
    ? parsedPayload.error.issues.find((entry) => entry.path[0] === "openInfo")
    : undefined
  const openingError = openingIssue
    ? openingIssue.code === "custom"
      ? openingIssue.message
      : "Enter a valid opening month and year, with an optional day, or clear the opening date."
    : undefined
  const dirty =
    !builtServices.success ||
    !parsedPayload.success ||
    JSON.stringify(parsedPayload.data) !== JSON.stringify(draft.payload)
  const unsaved = dirty || reviewDirty || matchDirty || areaEntryDirty || relationshipEntryDirty || hoursEntryDirty || moreHoursEntryDirty
  const leave = useLeaveGuard({ when: unsaved || matchBusy || reviewBusy || matchStatusBusy })
  useEffect(() => {
    if (!unsaved) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ""
    }
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [unsaved])
  const save = useMutation({
    mutationFn: () => {
      const parsed = googleOnboardingPayloadSchema.safeParse(payload)
      if (!parsed.success)
        throw new Error(
          parsed.error.issues[0]?.message ?? "Check the business details."
        )
      return saveOnboardingDraft(draft.accountId, draft.id, {
        expectedRevision: draft.revision,
        payload: parsed.data,
      })
    },
    retry: false,
    onSuccess: onSaved,
  })
  const search = useMutation({
    mutationFn: () =>
      matchOnboardingDraft(draft.accountId, draft.id, draft.revision),
    retry: false,
    onSuccess: onSaved,
    onError: () => onSaved({ ...draft, matchResult: null }),
  })
  const pending = save.isPending || search.isPending || reviewBusy || matchBusy || matchStatusBusy
  useEffect(() => {
    onDirtyChange(unsaved || pending)
    return () => onDirtyChange(false)
  }, [unsaved, pending, onDirtyChange])
  return (
    <div className="flex flex-col gap-4">
      <div className="space-y-1">
        <h4 className="text-ui font-semibold">Business details</h4>
        <p className="text-caption text-ink-muted">
          This draft is saved to your account. Keep this setup link to return to
          it.
        </p>
      </div>
      <fieldset
        disabled={pending || reviewDirty || matchDirty || Boolean(params.get("onboardingMatchLinkReview"))}
        className="grid min-w-0 gap-4 sm:grid-cols-2"
      >
        <Field>
          <FieldLabel>Business name</FieldLabel>
          <Input
            value={title}
            maxLength={255}
            onChange={(event) => setTitle(event.target.value)}
            autoComplete="organization"
          />
        </Field>
        <Field
          error={
            !parsedPayload.success
              ? parsedPayload.error.issues.find(
                  (entry) => entry.path[0] === "languageCode"
                )?.message
              : undefined
          }
        >
          <FieldLabel>Listing language</FieldLabel>
          <Input
            value={language}
            maxLength={35}
            onChange={(event) => setLanguage(event.target.value)}
          />
          <FieldDescription>
            Language tag, for example en-GB or cy.
          </FieldDescription>
          <FieldError />
        </Field>
        <OnboardingCategories
          draft={draft}
          regionCode={country.trim().toUpperCase()}
          languageCode={language.trim()}
          value={categories}
          onChange={setCategories}
        />
        <Field
          className="sm:col-span-2"
          error={
            !parsedPayload.success
              ? parsedPayload.error.issues.find(
                  (entry) => entry.path[0] === "profile"
                )?.message
              : undefined
          }
        >
          <FieldLabel>Business description</FieldLabel>
          <Textarea
            rows={4}
            value={description}
            maxLength={750}
            onChange={(event) => setDescription(event.target.value)}
          />
          <FieldDescription>
            Describe this business in your own words, up to 750 characters.
            Google requires a description for most categories; lodging
            categories are an exception. Provider validation checks the proposed
            listing before approval.
          </FieldDescription>
          <FieldError />
        </Field>
        <Field>
          <FieldLabel>Store code (optional)</FieldLabel>
          <Input
            value={storeCode}
            maxLength={255}
            onChange={(event) => setStoreCode(event.target.value)}
          />
          <FieldDescription>
            Your identifier for this business. It must be unique within the
            selected Google account.
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel>Google Ads phone (optional)</FieldLabel>
          <Input
            type="tel"
            value={adPhone}
            maxLength={50}
            onChange={(event) => setAdPhone(event.target.value)}
          />
          <FieldDescription>
            The phone used in Google Ads location extensions. This is separate
            from the business contact numbers.
          </FieldDescription>
        </Field>
        <Field
          className="sm:col-span-2"
          error={
            !parsedPayload.success
              ? parsedPayload.error.issues.find(
                  (entry) => entry.path[0] === "labels"
                )?.message
              : undefined
          }
        >
          <FieldLabel>Private listing labels (optional)</FieldLabel>
          <Textarea
            rows={2}
            value={labels}
            onChange={(event) => setLabels(event.target.value)}
          />
          <FieldDescription>
            Up to ten labels, one per line and up to 255 characters each. Labels
            organise your listings and are not shown to customers. Clear these
            optional fields to omit them from the creation proposal.
          </FieldDescription>
          <FieldError />
        </Field>
        <Field
          error={
            !parsedPayload.success
              ? parsedPayload.error.issues.find(
                  (entry) => entry.path[0] === "websiteUri"
                )?.message
              : undefined
          }
        >
          <FieldLabel>Business website (optional)</FieldLabel>
          <Input
            value={website}
            type="url"
            maxLength={2048}
            autoComplete="url"
            onChange={(event) => setWebsite(event.target.value)}
          />
          <FieldDescription>
            Include the full address, such as https://example.com. Clear it to
            omit the website from this creation draft.
          </FieldDescription>
          <FieldError />
        </Field>
        <Field>
          <FieldLabel>Primary business phone (optional)</FieldLabel>
          <Input
            value={primaryPhone}
            type="tel"
            maxLength={50}
            autoComplete="tel"
            onChange={(event) => setPrimaryPhone(event.target.value)}
          />
          <FieldDescription>
            Include the country code where possible, for example +44.
          </FieldDescription>
        </Field>
        <Field
          className="sm:col-span-2"
          error={
            !parsedPayload.success
              ? parsedPayload.error.issues.find(
                  (entry) => entry.path[0] === "phoneNumbers"
                )?.message
              : undefined
          }
        >
          <FieldLabel>Additional business phones (optional)</FieldLabel>
          <Textarea
            rows={2}
            value={additionalPhones}
            onChange={(event) => setAdditionalPhones(event.target.value)}
          />
          <FieldDescription>
            Up to two numbers, one per line. Editing the primary phone preserves
            these numbers. Google validates contact details before approval.
          </FieldDescription>
          <FieldError />
        </Field>
        <OnboardingOpening
          value={opening}
          onChange={setOpening}
          error={openingError}
        />
        <OnboardingServices
          draft={draft}
          rows={serviceRows}
          setRows={setServiceRows}
          contextSaved={JSON.stringify(categories) === JSON.stringify(draft.payload.categories) && language.trim() === draft.payload.languageCode && country.trim().toUpperCase() === (draft.payload.storefrontAddress && "regionCode" in draft.payload.storefrontAddress ? draft.payload.storefrontAddress.regionCode : "GB") && serviceArea?.regionCode === draft.payload.serviceArea?.regionCode}
          error={builtServices.success ? undefined : serviceRows.some((row) => "freeFormServiceItem" in row.item && !row.item.freeFormServiceItem.label.displayName.trim()) ? "Enter a custom service name or remove the incomplete service." : builtServices.message}
        />
        <OnboardingHours regular={regularHours} special={specialHours} onRegularChange={setRegularHours} onSpecialChange={setSpecialHours} onEntryChange={setHoursEntryDirty} />
        <OnboardingMoreHours draft={draft} value={moreHours} onChange={setMoreHours} onEntryChange={setMoreHoursEntryDirty}
          contextSaved={JSON.stringify(categories) === JSON.stringify(draft.payload.categories) && language.trim() === draft.payload.languageCode && country.trim().toUpperCase() === (draft.payload.storefrontAddress && "regionCode" in draft.payload.storefrontAddress ? draft.payload.storefrontAddress.regionCode : "GB") && serviceArea?.regionCode === draft.payload.serviceArea?.regionCode} />
        <OnboardingChain draft={draft} value={relationships} onChange={setRelationships} />
        <OnboardingRelationships value={relationships} onChange={setRelationships} onEntryChange={setRelationshipEntryDirty} />
        <OnboardingServiceArea
          value={serviceArea}
          onChange={setServiceArea}
          onEntryChange={setAreaEntryDirty}
        />
        {serviceArea?.businessType === "CUSTOMER_LOCATION_ONLY" &&
          !removeAddress &&
          payload.storefrontAddress &&
          Object.keys(payload.storefrontAddress).length > 0 && (
            <Button
              type="button"
              variant="secondary"
              className="justify-self-start sm:col-span-2"
              onClick={() => {
                setRemoveAddress(true)
                setLines("")
                setPostcode("")
                setLocality("")
                setAdministrativeArea("")
                setSublocality("")
              }}
            >
              Remove storefront from creation draft
            </Button>
          )}
        <Field className="sm:col-span-2">
          <FieldLabel>Storefront address</FieldLabel>
          <Textarea
            rows={3}
            value={lines}
            onChange={(event) => {
              setRemoveAddress(false)
              setLines(event.target.value)
            }}
            autoComplete="street-address"
          />
          <FieldDescription>
            One line per address line. For a business that only visits
            customers, leave all storefront address fields blank except the
            country code.
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel>Town or city</FieldLabel>
          <Input
            value={locality}
            maxLength={100}
            autoComplete="address-level2"
            onChange={(event) => {
              setRemoveAddress(false)
              setLocality(event.target.value)
            }}
          />
        </Field>
        <Field>
          <FieldLabel>County or region (optional)</FieldLabel>
          <Input
            value={administrativeArea}
            maxLength={100}
            autoComplete="address-level1"
            onChange={(event) => {
              setRemoveAddress(false)
              setAdministrativeArea(event.target.value)
            }}
          />
        </Field>
        <Field className="sm:col-span-2">
          <FieldLabel>District (optional)</FieldLabel>
          <Input
            value={sublocality}
            maxLength={100}
            autoComplete="address-level3"
            onChange={(event) => {
              setRemoveAddress(false)
              setSublocality(event.target.value)
            }}
          />
          <FieldDescription>
            Use a district or neighbourhood where it is part of the address.
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel>Postcode</FieldLabel>
          <Input
            value={postcode}
            maxLength={30}
            onChange={(event) => {
              setRemoveAddress(false)
              setPostcode(event.target.value)
            }}
            autoComplete="postal-code"
          />
        </Field>
        <Field>
          <FieldLabel>Country code</FieldLabel>
          <Input
            value={country}
            maxLength={2}
            onChange={(event) => setCountry(event.target.value)}
            autoComplete="country"
          />
          <FieldDescription>
            Use the two-letter code, such as GB.
          </FieldDescription>
        </Field>
      </fieldset>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          pending={save.isPending}
          pendingLabel="Saving…"
          disabled={
            pending || !dirty || areaEntryDirty || relationshipEntryDirty || hoursEntryDirty || moreHoursEntryDirty || !parsedPayload.success || !builtServices.success
          }
          onClick={() => save.mutate()}
        >
          Save business details
        </Button>
        <Button
          pending={search.isPending}
          pendingLabel="Searching Google…"
          disabled={
            pending ||
            dirty ||
            reviewDirty || matchDirty || Boolean(params.get("onboardingMatchLinkReview")) ||
            areaEntryDirty ||
            relationshipEntryDirty ||
            hoursEntryDirty ||
            moreHoursEntryDirty ||
            !draft.payload.title
          }
          onClick={() => search.mutate()}
        >
          Search for matches
        </Button>
      </div>
      {dirty && (
        <p role="status" className="text-caption text-ink-muted">
          Save your changes before searching. Earlier matches do not cover these
          edits.
        </p>
      )}
      {!parsedPayload.success && (
        <p role="alert" className="text-ui text-danger-ink">
          {parsedPayload.error.issues[0]?.path[0] === "openInfo"
            ? openingError
            : parsedPayload.error.issues[0]?.message}
        </p>
      )}
      {(save.isError || search.isError) && (
        <p role="alert" className="text-ui text-danger-ink">
          {describeActionError(save.error ?? search.error)}
        </p>
      )}
      {save.isError && (
        <Button variant="secondary" className="self-start" onClick={onReload}>
          Discard local edits and reload saved draft
        </Button>
      )}
      {serviceContextError && (
        <p role="alert" className="text-ui text-danger-ink">
          {serviceContextError}
        </p>
      )}
      {!dirty && !areaEntryDirty && !relationshipEntryDirty && !hoursEntryDirty && !moreHoursEntryDirty && draft.matchResult && (
        <div className="flex flex-col gap-3">
          <div className="space-y-1">
            <h4 className="text-ui font-semibold">Potential matches</h4>
            <p className="text-caption text-ink-muted">
              Checked{" "}
              {new Date(draft.matchResult.checkedAt).toLocaleString("en-GB")}.
              Results do not prove ownership or access.
            </p>
          </div>
          {draft.matchResult.matches.length === 0 ? (
            <p role="status" className="text-ui text-ink-muted">
              Google returned no potential matches. This search has not created
              a listing.
            </p>
          ) : (
            <ul className="divide-y divide-line rounded-(--np-radius-card) border border-line">
              {draft.matchResult.matches.map((match) => (
                <li key={match.name} className="space-y-2 p-4">
                  <p className="text-body font-semibold break-words">
                    {match.location.title || "Unnamed business"}
                  </p>
                  <p className="text-ui text-ink-muted">
                    {[
                      ...(match.location.storefrontAddress?.addressLines ?? []),
                      match.location.storefrontAddress?.locality,
                      match.location.storefrontAddress?.postalCode,
                    ]
                      .filter(Boolean)
                      .join(", ")}
                  </p>
                  <p className="font-mono text-caption break-all text-ink-muted">
                    {match.name}
                  </p>
                  {match.requestAdminRightsUri ? (
                    <a
                      href={match.requestAdminRightsUri}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-ui underline underline-offset-4"
                    >
                      Review ownership options in Google
                    </a>
                  ) : (
                    <p className="text-caption text-ink-muted">
                      Check the accessible listings above before deciding
                      whether this is your business.
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
          <Button
            variant="secondary"
            disabled={pending || reviewDirty || matchDirty || Boolean(params.get("onboardingMatchLinkReview"))}
            onClick={() => search.mutate()}
          >
            Refresh matches after changes in Google
          </Button>
        </div>
      )}
      {!dirty &&
        !areaEntryDirty &&
        !relationshipEntryDirty &&
        !hoursEntryDirty &&
        !moreHoursEntryDirty &&
        (draft.matchResult || params.get("onboardingMatchLinkReview")) && (
          <OnboardingMatchLink
            key={`match-link:${draft.revision}:${draft.matchResult?.checkedAt ?? "missing-search"}`}
            draft={draft}
            disabled={reviewDirty || reviewBusy || matchStatusBusy || Boolean(params.get("onboardingReview"))}
            onBusyChange={setMatchBusy}
            onDirtyChange={setMatchDirty}
            onFinished={onMatchFinished}
          />
        )}
      {!dirty && !matchDirty && !matchBusy && !params.get("onboardingMatchLinkReview") &&
        !areaEntryDirty && !relationshipEntryDirty && !hoursEntryDirty && !moreHoursEntryDirty && !serviceContextError &&
        draft.matchResult && (
          <OnboardingReview
            key={`${draft.revision}:${draft.matchResult.checkedAt}`}
            draft={draft}
            disabled={matchStatusBusy}
            onBusyChange={setReviewBusy}
            onDirtyChange={setReviewDirty}
            onCreated={onCreated}
          />
        )}
      <DiscardDialog {...leave} announce={false} />
    </div>
  )
}

function CreationStatus({
  value,
  accountId,
  draftId,
  initialName,
  onRefresh,
  onLinked,
}: {
  value: GoogleOnboardingCreation
  accountId: string
  draftId: string
  initialName: string
  onRefresh: () => void
  onLinked: () => void
}) {
  const [localName, setLocalName] = useState(initialName)
  const link = useMutation({
    mutationFn: () =>
      linkOnboardingCreation(accountId, draftId, localName.trim()),
    retry: false,
    onSuccess: onLinked,
  })
  const execution = {
    pending: "Creation request in progress",
    accepted: "Google accepted the creation request",
    rejected: "Google rejected the creation request",
    unknown: "Google creation outcome is unresolved",
  }[value.executionState]
  return (
    <div className="flex flex-col gap-4" aria-label="Creation outcome">
      <div className="space-y-2" role="status">
        <h4 className="text-title font-semibold">{execution}</h4>
        <p className="text-ui">
          {value.confirmationState === "confirmed"
            ? "An independent Google read confirmed the approved details."
            : "The approved details have not been independently confirmed."}
        </p>
        <p className="text-ui">
          {value.linkState === "linked"
            ? "The listing is linked in NabaPresence. Initial synchronisation was requested."
            : "The listing is not yet linked in NabaPresence."}
        </p>
      </div>
      {value.providerResourceName && (
        <p className="font-mono text-caption break-all">
          {value.providerResourceName}
        </p>
      )}
      {value.errorCode && (
        <p className="text-ui text-ink-muted">
          {value.errorCode === "onboarding_local_name_conflict"
            ? "A local listing already uses this name. Choose a different local name to finish linking."
            : "Refresh the outcome to check for new evidence. A refresh will not repeat Google creation."}
        </p>
      )}
      <Button variant="secondary" className="self-start" onClick={onRefresh}>
        Refresh creation outcome
      </Button>
      {!value.providerResourceName && value.executionState === "unknown" && (
        <p className="text-ui text-ink-muted">
          Check the selected Google account before taking another action. This
          draft cannot be resent automatically because the result is unknown.
        </p>
      )}
      {value.providerResourceName && value.linkState !== "linked" && (
        <>
          <Field>
            <FieldLabel>Local listing name</FieldLabel>
            <Input
              value={localName}
              maxLength={255}
              onChange={(event) => setLocalName(event.target.value)}
            />
            <FieldDescription>
              This only names the listing in NabaPresence. It does not rename it
              on Google.
            </FieldDescription>
            <FieldError />
          </Field>
          <Button
            className="self-start"
            pending={link.isPending}
            pendingLabel="Linking…"
            disabled={!localName.trim()}
            onClick={() => link.mutate()}
          >
            Resume local linking
          </Button>
          {link.isError && (
            <p role="alert">{describeActionError(link.error)}</p>
          )}
        </>
      )}
      {value.locationId && (
        <Link
          href={`/listings/${value.locationId}/verification`}
          className="text-ui underline underline-offset-4"
        >
          Continue to verification
        </Link>
      )}
    </div>
  )
}
