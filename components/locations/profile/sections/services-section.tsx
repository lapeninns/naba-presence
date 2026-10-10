"use client"

import { useEffect, useImperativeHandle, type Ref } from "react"
import { useQuery } from "@tanstack/react-query"
import { SectionCard } from "../section-card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field, FieldLabel } from "@/components/ui/field"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { DraftNotices } from "@/components/editors/draft-notices"
import { ServiceApprovalSheet } from "./service-approval-sheet"
import { categoryLabel } from "@/lib/locations/console-labels"
import { useServiceReview } from "./use-service-review"
import { useServiceWorkspace } from "./service-workspace"
import { useEditorDraft } from "@/lib/editors/use-editor-draft"
import { queryKeys } from "@/lib/queries/keys"
import { requestOptions } from "@/lib/queries/request-options"
import {
  fetchBusinessInformationReviews,
  fetchServiceMetadata,
} from "@/lib/api/location-business-information"
import type { BusinessInformationState } from "@/lib/contracts/location-business-information"
import {
  googleServiceItemsSchema,
  serviceCategoryId,
  serviceItemsMatch,
  type GoogleServiceItem,
} from "@/lib/domain/google-services"
import {
  buildServiceItems,
  parseServiceDraft,
  setServiceDescription,
  serviceDraftRows,
  servicePriceText,
  type ServiceDraftRow,
} from "@/lib/locations/forms/services"

export type ServiceActions = { review: () => void; discard: () => void }
export type ServiceEditorStatus = { dirty: boolean; blocked: string | null }
type ServiceIntegration = {
  actions: Ref<ServiceActions>
  onStatus: (status: ServiceEditorStatus) => void
  readOnly: boolean
}

export function ServicesSection({
  locationId,
  business,
  actions,
  onStatus,
  readOnly,
}: {
  locationId: string
  business: BusinessInformationState
} & ServiceIntegration) {
  const parsed = googleServiceItemsSchema.safeParse(
    business.location.serviceItems ?? []
  )
  if (!parsed.success)
    return (
      <SectionCard id="section-services" title="Services">
        <p className="text-ui text-ink-muted">
          Google returned service details this editor cannot preserve. Manage
          these services in Google.
        </p>
      </SectionCard>
    )
  return (
    <ServiceEditor
      locationId={locationId}
      business={business}
      initial={parsed.data}
      actions={actions}
      onStatus={onStatus}
      readOnly={readOnly}
    />
  )
}

function ServiceEditor({
  locationId,
  business,
  initial,
  actions,
  onStatus,
  readOnly,
}: {
  locationId: string
  business: BusinessInformationState
  initial: GoogleServiceItem[]
} & ServiceIntegration) {
  const draft = useEditorDraft({
    initial: serviceDraftRows(initial),
    revision: business.locationHash,
    key: `services:${locationId}`,
    parseStashed: parseServiceDraft,
  })
  const metadata = useQuery({
    queryKey: [
      ...queryKeys.locationBusinessInformation(locationId),
      "services",
    ],
    queryFn: (ctx) => fetchServiceMetadata(locationId, requestOptions(ctx)),
  })
  const saved = useQuery({
    queryKey: [...queryKeys.locationBusinessInformation(locationId), "reviews"],
    queryFn: (ctx) =>
      fetchBusinessInformationReviews(locationId, requestOptions(ctx)),
    enabled: business.canPublish && !readOnly,
  })
  const built = buildServiceItems(draft.draft)
  const disabled = readOnly || !business.canPublish || !business.writesEnabled
  const workspace = useServiceWorkspace()
  const localWorkflow = useServiceReview(locationId, (change) => {
    if (built.success && serviceItemsMatch(change.payload.serviceItems, built.items)) draft.expectSave()
  })
  const workflow = workspace ?? localWorkflow
  const setConfirmedHandler = workspace?.setConfirmedHandler
  useEffect(() => {
    setConfirmedHandler?.((change) => { if (built.success && serviceItemsMatch(change.payload.serviceItems, built.items)) draft.expectSave() })
    return () => setConfirmedHandler?.(null)
  }, [setConfirmedHandler, built, draft])
  const review = workflow.review
  function preview() {
    if (!disabled && built.success && !draft.incoming) workflow.preview(built.items, business.locationHash)
  }
  const categories = metadata.data?.categories ?? []
  const choices = [
    ...new Map(
      categories.flatMap((category) =>
        category.serviceTypes.map(
          (service) => [service.serviceTypeId, service] as const
        )
      )
    ).values(),
  ]
  const label = (item: GoogleServiceItem) =>
    "freeFormServiceItem" in item
      ? item.freeFormServiceItem.label.displayName
      : (choices.find(
          (choice) =>
            choice.serviceTypeId === item.structuredServiceItem.serviceTypeId
        )?.displayName ?? item.structuredServiceItem.serviceTypeId)
  const describe = (item: GoogleServiceItem | undefined) => {
    if (!item) return "No service"
    const description =
      "freeFormServiceItem" in item
        ? item.freeFormServiceItem.label.description
        : item.structuredServiceItem.description
    const category =
      "freeFormServiceItem" in item
        ? (categories.find(
            (entry) =>
              serviceCategoryId(entry.name) ===
              serviceCategoryId(item.freeFormServiceItem.category)
          )?.displayName ??
          categoryLabel({ name: item.freeFormServiceItem.category }))
        : null
    const language =
      "freeFormServiceItem" in item
        ? item.freeFormServiceItem.label.languageCode
        : null
    return [
      label(item),
      category,
      language,
      description === undefined
        ? "No description"
        : description === ""
          ? "Empty description"
          : description,
      item.price
        ? `${item.price.currencyCode ?? ""} ${servicePriceText(item.price)}`
        : "No price",
    ]
      .filter(Boolean)
      .join(" · ")
  }
  const before = googleServiceItemsSchema.safeParse(
    review?.baseline.serviceItems ?? []
  )
  const after = googleServiceItemsSchema.safeParse(
    review?.payload.serviceItems ?? []
  )
  const reviewRows =
    before.success && after.success
      ? Array.from(
          { length: Math.max(before.data.length, after.data.length) },
          (_, index) => ({
            field: `Service ${index + 1}`,
            before: describe(before.data[index]),
            after: describe(after.data[index]),
          })
        ).filter((row) => row.before !== row.after)
      : []
  function update(
    index: number,
    change: (row: ServiceDraftRow) => ServiceDraftRow
  ) {
    draft.setDraft((rows) =>
      rows.map((row, position) => (position === index ? change(row) : row))
    )
  }
  const pending = workflow.busy
  const blocked = disabled
    ? "Service publishing is unavailable."
    : pending
      ? "Service changes are being processed."
      : workflow.unresolved
        ? "Read the saved service outcome before another change."
      : draft.incoming
        ? "Resolve the newer service data before reviewing."
        : !built.success
          ? built.message
          : null
  useImperativeHandle(actions, () => ({
    review: preview,
    discard: () => { if (!workflow.busy && !workflow.unresolved) draft.discard() },
  }))
  useEffect(() => {
    onStatus({ dirty: draft.isDirty, blocked })
  }, [onStatus, draft.isDirty, blocked])
  useEffect(() => () => onStatus({ dirty: false, blocked: null }), [onStatus])
  return (
    <SectionCard
      id="section-services"
      title="Services"
      description="Describe the services you offer. Review and approve changes before sending them to Google."
      changed={draft.isDirty}
    >
      <DraftNotices drafts={[draft]} noun="these services" />
      {metadata.isPending ? (
        <p role="status" className="text-ui text-ink-muted">
          Loading available services…
        </p>
      ) : null}
      {metadata.error ? (
        <div role="alert">
          <p>{metadata.error.message}</p>
          <Button variant="outline" onClick={() => void metadata.refetch()}>
            Retry service choices
          </Button>
        </div>
      ) : null}
      <fieldset
        disabled={disabled || pending || workflow.unresolved}
        className="flex min-w-0 flex-col gap-4"
      >
        <legend className="sr-only">Service details</legend>
        {draft.draft.length === 0 ? (
          <p className="text-ui text-ink-muted">No services added.</p>
        ) : null}
        {draft.draft.map((row, index) => (
          <div
            key={index}
            className="flex min-w-0 flex-col gap-3 border-b border-line pb-4"
          >
            <div className="flex items-center justify-between gap-3">
              <h4 className="text-body font-semibold">
                {label(row.item) || `Service ${index + 1}`}
              </h4>
              <Button
                variant="ghost"
                onClick={() =>
                  draft.setDraft((rows) =>
                    rows.filter((_, position) => position !== index)
                  )
                }
                aria-label={`Remove service ${index + 1}`}
              >
                Remove
              </Button>
            </div>
            {"freeFormServiceItem" in row.item ? (
              <Field>
                <FieldLabel htmlFor={`service-${index}-name`}>
                  Service name
                </FieldLabel>
                <Input
                  id={`service-${index}-name`}
                  value={row.item.freeFormServiceItem.label.displayName}
                  onChange={(event) =>
                    update(index, (current) =>
                      "freeFormServiceItem" in current.item
                        ? {
                            ...current,
                            item: {
                              ...current.item,
                              freeFormServiceItem: {
                                ...current.item.freeFormServiceItem,
                                label: {
                                  ...current.item.freeFormServiceItem.label,
                                  displayName: event.target.value,
                                },
                              },
                            },
                          }
                        : current
                    )
                  }
                />
              </Field>
            ) : null}
            <Field>
              <FieldLabel htmlFor={`service-${index}-description`}>
                Description
              </FieldLabel>
              <Input
                id={`service-${index}-description`}
                value={
                  "freeFormServiceItem" in row.item
                    ? (row.item.freeFormServiceItem.label.description ?? "")
                    : (row.item.structuredServiceItem.description ?? "")
                }
                onChange={(event) =>
                  update(index, (current) => ({
                    ...current,
                    item: setServiceDescription(
                      current.item,
                      event.target.value
                    ),
                  }))
                }
              />
            </Field>
            <Button
              variant="ghost"
              onClick={() =>
                update(index, (current) => ({
                  ...current,
                  item: setServiceDescription(current.item, undefined),
                }))
              }
            >
              Clear description
            </Button>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor={`service-${index}-price`}>
                  Price
                </FieldLabel>
                <Input
                  id={`service-${index}-price`}
                  inputMode="decimal"
                  value={
                    row.priceEdit.mode === "set"
                      ? row.priceEdit.amount
                      : row.priceEdit.mode === "clear"
                        ? ""
                        : servicePriceText(row.item.price)
                  }
                  onChange={(event) =>
                    update(index, (current) => ({
                      ...current,
                      priceEdit: {
                        mode: "set",
                        amount: event.target.value,
                        currency:
                          current.priceEdit.mode === "set"
                            ? current.priceEdit.currency
                            : (current.item.price?.currencyCode ?? "GBP"),
                      },
                    }))
                  }
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={`service-${index}-currency`}>
                  Currency
                </FieldLabel>
                <Input
                  id={`service-${index}-currency`}
                  maxLength={3}
                  value={
                    row.priceEdit.mode === "set"
                      ? row.priceEdit.currency
                      : (row.item.price?.currencyCode ?? "GBP")
                  }
                  onChange={(event) =>
                    update(index, (current) => ({
                      ...current,
                      priceEdit: {
                        mode: "set",
                        currency: event.target.value,
                        amount:
                          current.priceEdit.mode === "set"
                            ? current.priceEdit.amount
                            : servicePriceText(current.item.price),
                      },
                    }))
                  }
                />
              </Field>
            </div>
            <Button
              variant="ghost"
              onClick={() =>
                update(index, (current) => ({
                  ...current,
                  priceEdit: { mode: "clear" },
                }))
              }
            >
              Clear price
            </Button>
          </div>
        ))}
        <Field>
          <FieldLabel htmlFor="add-structured-service">
            Add a suggested service
          </FieldLabel>
          <Select
            value={null}
            onValueChange={(value) => {
              if (value)
                draft.setDraft((rows) => [
                  ...rows,
                  {
                    item: { structuredServiceItem: { serviceTypeId: value } },
                    priceEdit: { mode: "keep" },
                  },
                ])
            }}
            disabled={!choices.length || draft.draft.length >= 100}
          >
            <SelectTrigger id="add-structured-service">
              <SelectValue placeholder="Choose a service" />
            </SelectTrigger>
            <SelectContent>
              {choices.map((choice) => (
                <SelectItem
                  key={choice.serviceTypeId}
                  value={choice.serviceTypeId}
                >
                  {choice.displayName ?? choice.serviceTypeId}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        {categories.map((category) => (
          <Button
            key={category.name}
            variant="outline"
            disabled={draft.draft.length >= 100}
            onClick={() =>
              draft.setDraft((rows) => [
                ...rows,
                {
                  item: {
                    freeFormServiceItem: {
                      category: serviceCategoryId(category.name),
                      label: {
                        displayName: "",
                        languageCode: metadata.data?.languageCode ?? "en",
                      },
                    },
                  },
                  priceEdit: { mode: "keep" },
                },
              ])
            }
          >
            Add custom service for {category.displayName ?? category.name}
          </Button>
        ))}
      </fieldset>
      {!built.success ? (
        <p role="alert" className="text-ui text-danger-ink">
          {built.message}
        </p>
      ) : null}
      {workflow.error ? <p role="alert">{workflow.error}</p> : null}
      {workflow.unresolved ? <p role="status">Read the saved service outcome before another change.</p> : null}
      <Button
        disabled={
          disabled ||
          pending ||
          workflow.unresolved ||
          !draft.isDirty ||
          !built.success ||
          draft.incoming
        }
        onClick={preview}
      >
        Review service changes
      </Button>
      {saved.error ? (
        <p role="alert">
          Saved reviews could not be loaded. {saved.error.message}
        </p>
      ) : null}
      {(saved.data ?? [])
        .filter(
          (change) =>
            change.updateMask.length === 1 &&
            change.updateMask[0] === "serviceItems"
        )
        .map((change) => (
          <Button
            key={change.id}
            variant="outline"
            disabled={pending || workflow.unresolved && review?.id !== change.id}
            onClick={() => workflow.restore(change)}
          >
            Open saved service review
          </Button>
        ))}
      {review && !workspace ? (
        <ServiceApprovalSheet
          workflow={workflow}
          rows={reviewRows}
          disabled={disabled || !before.success || !after.success}
        />
      ) : null}
    </SectionCard>
  )
}
