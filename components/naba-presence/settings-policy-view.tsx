"use client"

import { Sparkles } from "lucide-react"
import { useState } from "react"

import { SettingsNav } from "@/components/naba-presence/settings/settings-nav"
import { useOrganisationSettings } from "@/components/naba-presence/settings/use-organisation-settings"
import {
  LiveDataError,
  PageFrame,
  PageHeader,
  readControlValue,
} from "@/components/naba-presence/shared"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
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
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
  FieldTitle,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { toast } from "@/components/ui/toast"
import type { OrganisationSettings } from "@/lib/naba-presence-api"

export function SettingsPolicyView() {
  const { settings, setSettings, status, save, isSaving, reload } =
    useOrganisationSettings()
  const [message, setMessage] = useState("")

  function updateSettings(patch: Partial<OrganisationSettings>) {
    setSettings((current) => (current ? { ...current, ...patch } : current))
  }

  function persistSettings() {
    setMessage("")
    void save()
      .then(() => {
        toast.add({
          type: "success",
          title: "Policy settings saved and added to the audit trail.",
        })
      })
      .catch((error: unknown) => {
        setMessage(error instanceof Error ? error.message : "Save failed.")
      })
  }

  const approvalRequired = settings?.approvalRequired ?? true
  const requireTwoPersonApproval = Boolean(settings?.requireTwoPersonApproval)
  const directPublishConsent = Boolean(settings?.directPublishConsent)

  return (
    <PageFrame>
      <PageHeader
        title="Reply policy"
        description="Human approval, verification and retention controls."
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
              <CardTitle>Publishing safeguards</CardTitle>
              <CardDescription>
                Defaults apply to every linked location unless overridden.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <FieldGroup>
                <Field orientation="horizontal">
                  <FieldContent>
                    <FieldTitle>Require human approval</FieldTitle>
                    <FieldDescription>
                      AI drafts cannot publish until an authorised person
                      approves them.
                    </FieldDescription>
                  </FieldContent>
                  <Switch
                    checked={approvalRequired}
                    onCheckedChange={(checked) => {
                      setSettings((current) => {
                        if (!current) return current
                        return {
                          ...current,
                          approvalRequired: checked,
                          ...(checked
                            ? { directPublishConsent: false }
                            : { requireTwoPersonApproval: false }),
                        }
                      })
                    }}
                    aria-label="Require human approval"
                  />
                </Field>
                <FieldSeparator />
                {approvalRequired ? (
                  <>
                    <Field orientation="horizontal">
                      <FieldContent>
                        <FieldTitle>Require two people</FieldTitle>
                        <FieldDescription>
                          The person requesting publication cannot approve their
                          own reply, including owners and admins.
                        </FieldDescription>
                      </FieldContent>
                      <Switch
                        checked={requireTwoPersonApproval}
                        onCheckedChange={(checked) =>
                          updateSettings({
                            requireTwoPersonApproval: checked,
                          })
                        }
                        aria-label="Require two-person approval"
                      />
                    </Field>
                    <FieldSeparator />
                  </>
                ) : null}
                {!approvalRequired ? (
                  <>
                    <Field orientation="horizontal">
                      <FieldContent>
                        <FieldTitle>
                          Owner consent for direct publishing
                        </FieldTitle>
                        <FieldDescription>
                          I authorise NabaPresence to publish verified replies
                          on this organisation’s behalf without a separate
                          approval step. Every action remains attributable and
                          location-scoped.
                        </FieldDescription>
                      </FieldContent>
                      <Switch
                        checked={directPublishConsent}
                        onCheckedChange={(checked) =>
                          updateSettings({ directPublishConsent: checked })
                        }
                        aria-label="Consent to direct publishing"
                      />
                    </Field>
                    <FieldSeparator />
                  </>
                ) : null}
                <Field orientation="horizontal">
                  <FieldContent>
                    <FieldTitle>Block drafts that fail verification</FieldTitle>
                    <FieldDescription>
                      Always enforced by the publishing API when claims,
                      personal data or tone checks fail.
                    </FieldDescription>
                  </FieldContent>
                  <Switch
                    checked
                    disabled
                    aria-label="Block drafts that fail verification"
                  />
                </Field>
              </FieldGroup>
            </CardContent>
            <CardFooter>
              <Button
                onClick={persistSettings}
                disabled={
                  isSaving || (!approvalRequired && !directPublishConsent)
                }
              >
                Save policy
              </Button>
            </CardFooter>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Language and timezone</CardTitle>
              <CardDescription>
                Dates and fallback drafts use these organisation defaults.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="default-language">
                    Default language
                  </FieldLabel>
                  <NativeSelect
                    id="default-language"
                    value={settings.defaultLanguageCode}
                    onValueChange={(defaultLanguageCode) =>
                      updateSettings({ defaultLanguageCode })
                    }
                  >
                    <NativeSelectOption value="en">English</NativeSelectOption>
                    <NativeSelectOption value="fr">French</NativeSelectOption>
                    <NativeSelectOption value="de">German</NativeSelectOption>
                    <NativeSelectOption value="es">Spanish</NativeSelectOption>
                    <NativeSelectOption value="it">Italian</NativeSelectOption>
                  </NativeSelect>
                </Field>
                <Field>
                  <FieldLabel htmlFor="default-timezone">
                    IANA timezone
                  </FieldLabel>
                  <Input
                    id="default-timezone"
                    value={settings.defaultTimezone}
                    onChange={(event) =>
                      updateSettings({
                        defaultTimezone: readControlValue(event),
                      })
                    }
                    placeholder="Europe/London"
                  />
                  <FieldDescription>
                    For example Europe/London or America/New_York.
                  </FieldDescription>
                </Field>
              </FieldGroup>
            </CardContent>
            <CardFooter>
              <Button onClick={persistSettings} disabled={isSaving}>
                Save locale
              </Button>
            </CardFooter>
          </Card>

          {message ? (
            <p className="text-xs text-destructive" role="status">
              {message}
            </p>
          ) : null}

          <Alert>
            <Sparkles />
            <AlertTitle>
              {approvalRequired
                ? "Human-supervised by default"
                : "Direct publishing enabled with owner consent"}
            </AlertTitle>
            <AlertDescription>
              {approvalRequired
                ? "Direct publishing remains disabled. Every response is attributable to an authorised user and retained in the audit trail."
                : "Only authorised roles and location grants may publish. Every response still records the actor, verification result and Google outcome."}
            </AlertDescription>
          </Alert>
        </>
      )}
    </PageFrame>
  )
}
