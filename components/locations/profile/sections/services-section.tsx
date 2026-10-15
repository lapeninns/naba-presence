"use client"

import { useEffect, useImperativeHandle, type Ref } from "react"
import { useQuery } from "@tanstack/react-query"
import { PlusIcon } from "lucide-react"
import { SectionCard } from "../section-card"
import { Alert, AlertActions, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Fieldset, FieldsetLegend } from "@/components/ui/fieldset"
import { Input } from "@/components/ui/input"
import { ListRow, ListRows } from "@/components/ui/list-row"
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
import { HandoffNote, InlineError } from "./setting-rows"
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
  serviceReviewRows,
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
        <HandoffNote>
          Google returned service details this editor cannot preserve. Manage
          these services in Google.
        </HandoffNote>
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
    scope: { resource: "location-services", resourceId: locationId, schemaVersion: 1 },
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
  // The same rows the saved-work sheet shows (lib/locations/forms/services);
  // null when either side cannot be read, which keeps sending unavailable.
  const reviewRows = serviceReviewRows(review, categories)
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
        <Alert variant="destructive">
          <AlertDescription>{metadata.error.message}</AlertDescription>
          <AlertActions>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void metadata.refetch()}
            >
              Retry service choices
            </Button>
          </AlertActions>
        </Alert>
      ) : null}
      <Fieldset
        disabled={disabled || pending || workflow.unresolved}
        className="gap-4"
      >
        <FieldsetLegend srOnly>Service details</FieldsetLegend>
        {draft.draft.length === 0 ? (
          <p className="text-ui text-ink-muted">No services added.</p>
        ) : null}
        {draft.draft.length > 0 ? (
        <ListRows>
        {draft.draft.map((row, index) => (
          <ListRow
            key={index}
            interactive={false}
            flush
            wrap
            emphasis="neutral"
            titleAs="h4"
            title={label(row.item) || `Service ${index + 1}`}
            // The row's own control, on the title line where it always was
            // (before the fields in reading and tab order).
            meta={
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  draft.setDraft((rows) =>
                    rows.filter((_, position) => position !== index)
                  )
                }
                aria-label={`Remove service ${index + 1}`}
              >
                Remove
              </Button>
            }
            footerLayout="stack"
            footer={
            <div className="flex min-w-0 flex-col gap-3">
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
              size="sm"
              className="-mt-2 self-start"
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
              size="sm"
              className="-mt-2 self-start"
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
            }
          />
        ))}
        </ListRows>
        ) : null}
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
            <SelectContent title="Add a suggested service">
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
        {categories.length > 0 ? (
        <div className="flex flex-wrap gap-2">
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
            <PlusIcon aria-hidden />
            Add custom service for {category.displayName ?? category.name}
          </Button>
        ))}
        </div>
        ) : null}
      </Fieldset>
      {!built.success ? <InlineError>{built.message}</InlineError> : null}
      {workflow.error ? <InlineError>{workflow.error}</InlineError> : null}
      {workflow.unresolved ? (
        <Alert variant="warning">
          <AlertDescription>
            Read the saved service outcome before another change.
          </AlertDescription>
        </Alert>
      ) : null}
      <div className="flex flex-wrap gap-2">
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
      </div>
      {saved.error ? (
        <InlineError>
          Saved reviews could not be loaded. {saved.error.message}
        </InlineError>
      ) : null}
      {review && !workspace ? (
        <ServiceApprovalSheet
          workflow={workflow}
          rows={reviewRows ?? []}
          disabled={disabled || !reviewRows}
        />
      ) : null}
    </SectionCard>
  )
}
