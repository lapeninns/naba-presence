"use client"

import { CalendarCheck, ExternalLink, Link2, Pencil, Plus, Trash2 } from "lucide-react"
import { useEffect, useState } from "react"

import { LiveDataError } from "@/components/naba-presence/shared"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Skeleton } from "@/components/ui/skeleton"
import {
  createPlaceActionLink,
  deletePlaceActionLink,
  loadPlaceActions,
  updatePlaceActionLink,
  type PlaceActionInput,
  type PlaceActionState,
  type PlaceActionType,
} from "@/lib/naba-presence-api"

const TYPE_LABELS: Record<PlaceActionType, string> = {
  APPOINTMENT: "Appointment",
  ONLINE_APPOINTMENT: "Online appointment",
  DINING_RESERVATION: "Dining reservation",
  FOOD_ORDERING: "Food ordering",
  FOOD_DELIVERY: "Food delivery",
  FOOD_TAKEOUT: "Food takeout",
  SHOP_ONLINE: "Shop online",
}

type Editor = PlaceActionInput & {
  linkId: string | null
  expectedGoogleHash: string | null
}

const emptyEditor: Editor = {
  linkId: null,
  expectedGoogleHash: null,
  uri: "",
  placeActionType: "DINING_RESERVATION",
  isPreferred: false,
}

export function LocationBookingView({ locationId }: { locationId: string }) {
  const [data, setData] = useState<PlaceActionState | null>(null)
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading")
  const [reloadKey, setReloadKey] = useState(0)
  const [editor, setEditor] = useState<Editor>(emptyEditor)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<PlaceActionState["links"][number] | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void loadPlaceActions(locationId)
      .then(({ placeActions }) => {
        if (!active) return
        setData(placeActions)
        setStatus("ready")
      })
      .catch(() => {
        if (active) setStatus("error")
      })
    return () => {
      active = false
    }
  }, [locationId, reloadKey])

  function reload(success?: string) {
    setMessage(success ?? null)
    setReloadKey((value) => value + 1)
  }

  async function save() {
    setSaving(true)
    setMessage(null)
    try {
      if (editor.linkId && editor.expectedGoogleHash) {
        await updatePlaceActionLink(locationId, editor.linkId, {
          uri: editor.uri,
          placeActionType: editor.placeActionType,
          isPreferred: editor.isPreferred,
          expectedGoogleHash: editor.expectedGoogleHash,
        })
        reload("Place Action updated and verified on Google.")
      } else {
        await createPlaceActionLink(locationId, {
          uri: editor.uri,
          placeActionType: editor.placeActionType,
          isPreferred: editor.isPreferred,
        })
        reload("Place Action created and verified on Google.")
      }
      setEditor(emptyEditor)
      setConfirmOpen(false)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The Place Action could not be saved.")
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    if (!deleteTarget) return
    setSaving(true)
    setMessage(null)
    try {
      await deletePlaceActionLink(
        locationId,
        deleteTarget.id,
        deleteTarget.googleHash
      )
      setDeleteTarget(null)
      reload("Place Action deleted and reconciled with Google.")
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The Place Action could not be deleted.")
    } finally {
      setSaving(false)
    }
  }

  if (status === "error") {
    return <LiveDataError onRetry={() => setReloadKey((value) => value + 1)} />
  }
  if (status === "loading" || !data) {
    return <Skeleton className="h-96 w-full" />
  }

  const canWrite = data.canPublish && data.writesEnabled
  const validUri = (() => {
    try {
      return ["http:", "https:"].includes(new URL(editor.uri).protocol)
    } catch {
      return false
    }
  })()

  return (
    <section className="flex flex-col gap-(--nr-gap-section)" aria-label="Place Actions">
      {!data.writesEnabled ? (
        <Alert>
          <Link2 />
          <AlertTitle>Place Action writes are paused</AlertTitle>
          <AlertDescription>
            Live links are still reconciled. Creating, editing, and deleting remain fail closed until GBP_PLACE_ACTIONS_ENABLED and publishing are enabled.
          </AlertDescription>
        </Alert>
      ) : null}
      {message ? (
        <Alert variant={message.includes("Google.") ? "default" : "destructive"}>
          <CalendarCheck />
          <AlertTitle>{message.includes("Google.") ? "Google confirmed" : "Action required"}</AlertTitle>
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{editor.linkId ? "Edit Place Action" : "Add Place Action"}</CardTitle>
          <CardDescription>
            Manage reservation, appointment, ordering, delivery, takeout, and shopping links shown on Google.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="place-action-uri">Destination URL</FieldLabel>
              <Input
                id="place-action-uri"
                type="url"
                placeholder="https://booking.example.com/venue"
                value={editor.uri}
                disabled={!canWrite}
                onChange={(event) =>
                  setEditor((current) => ({ ...current, uri: event.target.value }))
                }
              />
              <FieldDescription>Use the final customer-facing URL, including https://.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="place-action-type">Action type</FieldLabel>
              <NativeSelect
                id="place-action-type"
                value={editor.placeActionType}
                disabled={!canWrite}
                onValueChange={(value) =>
                  setEditor((current) => ({
                    ...current,
                    placeActionType: value as PlaceActionType,
                  }))
                }
              >
                {data.supportedTypes.map((type) => (
                  <NativeSelectOption key={type} value={type}>
                    {TYPE_LABELS[type]}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            <Field orientation="horizontal">
              <Checkbox
                id="place-action-preferred"
                checked={editor.isPreferred}
                disabled={!canWrite}
                onCheckedChange={(checked) =>
                  setEditor((current) => ({ ...current, isPreferred: checked }))
                }
              />
              <FieldLabel htmlFor="place-action-preferred">
                Preferred link for this action type
              </FieldLabel>
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={!canWrite || !validUri}
                onClick={() => setConfirmOpen(true)}
              >
                {editor.linkId ? <Pencil /> : <Plus />}
                Review {editor.linkId ? "update" : "creation"}
              </Button>
              {editor.linkId ? (
                <Button variant="outline" onClick={() => setEditor(emptyEditor)}>
                  Cancel edit
                </Button>
              ) : null}
            </div>
          </FieldGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Live Google links</CardTitle>
          <CardDescription>
            Merchant links are editable; aggregator links remain visible but read-only.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {data.links.length ? (
            data.links.map((link) => (
              <div key={link.id} className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{TYPE_LABELS[link.placeActionType]}</span>
                    {link.isPreferred ? <Badge>Preferred</Badge> : null}
                    <Badge variant="outline">{link.providerType === "MERCHANT" ? "Merchant" : "Aggregator"}</Badge>
                  </div>
                  <a className="flex items-center gap-1 break-all text-sm text-primary underline-offset-4 hover:underline" href={link.uri} target="_blank" rel="noreferrer">
                    {link.uri}
                    <ExternalLink className="size-3.5 shrink-0" />
                  </a>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!canWrite || !link.isEditable}
                    onClick={() =>
                      setEditor({
                        linkId: link.id,
                        expectedGoogleHash: link.googleHash,
                        uri: link.uri,
                        placeActionType: link.placeActionType,
                        isPreferred: link.isPreferred,
                      })
                    }
                  >
                    <Pencil /> Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={!canWrite || !link.isEditable}
                    onClick={() => setDeleteTarget(link)}
                  >
                    <Trash2 /> Delete
                  </Button>
                </div>
              </div>
            ))
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Google returned no Place Action links for this location.
            </p>
          )}
        </CardContent>
      </Card>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editor.linkId ? "Publish link update?" : "Create Google link?"}</DialogTitle>
            <DialogDescription>
              Google will show {editor.uri} as a {TYPE_LABELS[editor.placeActionType].toLowerCase()} action. A readback will verify the exact values.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter showCloseButton>
            <Button disabled={saving} onClick={() => void save()}>
              {saving ? "Publishing…" : "Confirm and publish"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this Google link?</DialogTitle>
            <DialogDescription>
              This removes the customer action from Google. NabaPresence will confirm the link is absent before recording success.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter showCloseButton>
            <Button variant="destructive" disabled={saving} onClick={() => void remove()}>
              {saving ? "Deleting…" : "Confirm deletion"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
