"use client"

import { useState, useTransition } from "react"

import { SettingsNav } from "@/components/naba-presence/settings/settings-nav"
import { useOrganisationSettings } from "@/components/naba-presence/settings/use-organisation-settings"
import {
  LiveDataError,
  PageFrame,
  PageHeader,
  readControlValue,
} from "@/components/naba-presence/shared"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from "@/components/ui/item"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Skeleton } from "@/components/ui/skeleton"
import { toast } from "@/components/ui/toast"
import {
  createPrivacyRequest,
  type OrganisationSettings,
} from "@/lib/naba-presence-api"

export function SettingsComplianceView() {
  const { settings, setSettings, status, save, isSaving, reload } =
    useOrganisationSettings()
  const [privacySubject, setPrivacySubject] = useState("")
  const [privacyRequestType, setPrivacyRequestType] = useState<
    "access" | "rectification" | "erasure" | "restriction"
  >("access")
  const [message, setMessage] = useState("")
  const [isPending, startTransition] = useTransition()
  const [confirmPrivacyOpen, setConfirmPrivacyOpen] = useState(false)

  function updateSettings(patch: Partial<OrganisationSettings>) {
    setSettings((current) => (current ? { ...current, ...patch } : current))
  }

  function persistRetention() {
    setMessage("")
    void save()
      .then(() => {
        toast.add({
          type: "success",
          title: "Retention settings saved and added to the audit trail.",
        })
      })
      .catch((error: unknown) => {
        setMessage(error instanceof Error ? error.message : "Save failed.")
      })
  }

  function submitPrivacyRequest() {
    setMessage("")
    startTransition(async () => {
      try {
        await createPrivacyRequest({
          requestType: privacyRequestType,
          subjectReference: privacySubject,
          reason: "Submitted from the organisation compliance workspace.",
        })
        toast.add({
          type: "success",
          title: "Privacy request recorded in the immutable audit trail.",
        })
      } catch (error) {
        setMessage(
          error instanceof Error ? error.message : "Privacy request failed."
        )
      }
    })
  }

  return (
    <PageFrame>
      <PageHeader
        title="Data and compliance"
        description="Retention, data-subject workflows, and attributable audit exports."
      />
      <SettingsNav />

      {status !== "ready" || !settings ? (
        status === "loading" ? (
          <>
            <Skeleton className="h-72 w-full" />
            <Skeleton className="h-64 w-full" />
          </>
        ) : (
          <LiveDataError onRetry={reload} />
        )
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Data retention</CardTitle>
              <CardDescription>
                Separate transient Google content from durable aggregates.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="retention-window">
                    Raw content window
                  </FieldLabel>
                  <NativeSelect
                    id="retention-window"
                    className="w-full"
                    value={String(settings.rawContentRetentionDays)}
                    onValueChange={(value) =>
                      updateSettings({
                        rawContentRetentionDays: Number(value),
                      })
                    }
                  >
                    <NativeSelectOption value="30">
                      30 days (recommended)
                    </NativeSelectOption>
                    <NativeSelectOption value="14">14 days</NativeSelectOption>
                    <NativeSelectOption value="7">7 days</NativeSelectOption>
                  </NativeSelect>
                  <FieldDescription>
                    Verbatim review text and media metadata are purged
                    automatically.
                  </FieldDescription>
                </Field>
              </FieldGroup>
              <Item variant="muted" size="sm">
                <ItemContent>
                  <ItemTitle>Keep derived aggregates</ItemTitle>
                  <ItemDescription>
                    Rating, response-time and volume metrics remain available
                    after raw text is purged.
                  </ItemDescription>
                </ItemContent>
                <ItemActions>
                  <Badge variant="secondary">Enforced</Badge>
                </ItemActions>
              </Item>
            </CardContent>
            <CardFooter className="flex-wrap justify-between gap-3">
              <span className="text-xs text-muted-foreground">
                Purges are recorded by the retention worker.
              </span>
              <div className="flex flex-wrap gap-2">
                <Button onClick={persistRetention} disabled={isSaving}>
                  Save retention
                </Button>
                <Button
                  variant="outline"
                  onClick={() =>
                    window.open(
                      "/api/audit-log?format=csv&page_size=1000&action=retention.purge.completed",
                      "_blank",
                      "noopener,noreferrer"
                    )
                  }
                >
                  Review purge log
                </Button>
              </div>
            </CardFooter>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Compliance tools</CardTitle>
              <CardDescription>
                Track data-subject workflows and export attributable audit
                records.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="privacy-subject">
                    Reviewer name or Google review ID
                  </FieldLabel>
                  <Input
                    id="privacy-subject"
                    value={privacySubject}
                    onChange={(event) =>
                      setPrivacySubject(readControlValue(event))
                    }
                    placeholder="Google review ID or exact reviewer name"
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="privacy-request-type">
                    Request type
                  </FieldLabel>
                  <NativeSelect
                    id="privacy-request-type"
                    value={privacyRequestType}
                    onValueChange={(value) =>
                      setPrivacyRequestType(value as typeof privacyRequestType)
                    }
                  >
                    <NativeSelectOption value="access">
                      Access
                    </NativeSelectOption>
                    <NativeSelectOption value="rectification">
                      Rectification
                    </NativeSelectOption>
                    <NativeSelectOption value="erasure">
                      Erasure
                    </NativeSelectOption>
                    <NativeSelectOption value="restriction">
                      Restriction
                    </NativeSelectOption>
                  </NativeSelect>
                </Field>
              </FieldGroup>
            </CardContent>
            <CardFooter className="flex-wrap gap-2">
              <AlertDialog
                open={confirmPrivacyOpen}
                onOpenChange={setConfirmPrivacyOpen}
              >
                <AlertDialogTrigger
                  render={
                    <Button
                      disabled={isPending || privacySubject.trim().length < 3}
                    />
                  }
                >
                  Create request
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Create privacy request?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This starts a tracked erasure or export workflow for the
                      reviewer above. It’s recorded in the immutable audit trail
                      immediately and cannot be withdrawn once created.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      variant="destructive"
                      onClick={() => {
                        setConfirmPrivacyOpen(false)
                        submitPrivacyRequest()
                      }}
                    >
                      Create request
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
              <Button
                variant="outline"
                disabled={privacySubject.trim().length < 3}
                onClick={() =>
                  window.open(
                    `/api/privacy/export?subject=${encodeURIComponent(privacySubject)}`,
                    "_blank",
                    "noopener,noreferrer"
                  )
                }
              >
                Export retained data
              </Button>
              <Button
                variant="outline"
                onClick={() =>
                  window.open(
                    "/api/audit-log?format=csv&page_size=1000",
                    "_blank",
                    "noopener,noreferrer"
                  )
                }
              >
                Export audit CSV
              </Button>
            </CardFooter>
          </Card>

          {message ? (
            <p className="text-xs text-destructive" role="status">
              {message}
            </p>
          ) : null}
        </>
      )}
    </PageFrame>
  )
}
