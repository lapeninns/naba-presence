"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import Link from "next/link"
import { useEffect, useId, useRef, useState } from "react"

import { AdminsTable } from "@/components/locations/admins-table"
import { DangerZoneDialog } from "@/components/locations/danger-zone-dialog"
import { GateNote } from "@/components/locations/publish-gate"
import { SectionPanel } from "@/components/locations/section-panel"
import { TabError, TabLoading } from "@/components/locations/tab-states"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Empty } from "@/components/ui/empty"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useToastManager } from "@/components/ui/toast"
import {
  DANGER_ZONE_OPERATIONS,
  runAdministrationOperation,
  type AdministrationOperation,
  type AdministrationState,
} from "@/lib/api/location-administration"
import { describeActionError } from "@/lib/locations/action-errors"
import { adminRoleLabel, verificationMethodLabel, verificationStateLabel } from "@/lib/locations/console-labels"
import { createAdminSchema, transferLocationSchema, updateAdminSchema } from "@/lib/locations/forms/administration"
import { editDisabledReason, resourceDisabledReason, type LocationCapabilities } from "@/lib/locations/gating"
import { queryKeys } from "@/lib/queries/keys"
import { useLocationCapabilities } from "@/lib/queries/use-location-capabilities"
import { useAdministration } from "@/lib/queries/use-location-administration"
import { useLocationDirectory } from "@/lib/queries/use-locations"
import { useSessionRole } from "@/lib/queries/use-session"

// A defensive wrapper for the three destructive Google operations wired
// below (remove admin / transfer / delete location). Checking membership in
// the T1 client's own DANGER_ZONE_OPERATIONS set - rather than trusting the
// call site - means a future edit that accidentally routes a non-destructive
// operation through the typed-name confirmation path fails loudly instead of
// silently skipping the UI-side gate.
function runDangerZoneOperation(
  locationId: string,
  operation: AdministrationOperation,
  payload: Record<string, unknown>
) {
  if (!DANGER_ZONE_OPERATIONS.has(operation)) {
    throw new Error(`${operation} is not a danger-zone operation`)
  }
  return runAdministrationOperation(locationId, { operation, payload })
}

// --- raw Google leaf -> typed accessor helpers -----------------------------
// Every sub-resource here is an opaque Google passthrough object (D8) — read
// known leaves defensively, never assume a shape, never render the raw
// record itself (spec §8, no JSON textarea/escape hatch).
type RawRecord = Record<string, unknown>

function asRecord(value: unknown): RawRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as RawRecord) : {}
}
function asArray(value: unknown): RawRecord[] {
  return Array.isArray(value) ? value.map(asRecord) : []
}
function asString(value: unknown): string {
  return typeof value === "string" ? value : ""
}

type AdminRow = { name?: string; admin?: string; role?: string; pendingInvitation?: boolean }

function toAdminRow(record: RawRecord): AdminRow {
  return {
    name: typeof record.name === "string" ? record.name : undefined,
    admin: typeof record.admin === "string" ? record.admin : undefined,
    role: typeof record.role === "string" ? record.role : undefined,
    pendingInvitation: typeof record.pendingInvitation === "boolean" ? record.pendingInvitation : undefined,
  }
}

type ToastFn = (title: string, type: "success" | "error") => void

export function AdministrationTab({
  locationId,
  locationName,
}: {
  locationId: string
  locationName?: string
}) {
  const queryClient = useQueryClient()
  const toasts = useToastManager()
  const capsQuery = useLocationCapabilities(locationId)
  const caps = capsQuery.data
  // D4: the GET is owner/admin-only server-side — gate the query itself on
  // canEditCanonical so a non-owner/admin never fires the 403 request. `caps`
  // is undefined while the capabilities query is still pending, which keeps
  // `enabled` false (not a false positive) until we actually know the role.
  const administrationQuery = useAdministration(locationId, { enabled: caps?.canEditCanonical === true })

  // Task 6's danger zone needs the location's display name for its typed-name
  // confirmation. The workspace layout already fetches this same directory
  // query, so this reuses that cache in production rather than firing a
  // second network round trip; a caller-supplied `locationName` (used by
  // tests) always wins.
  const role = useSessionRole()
  const directoryQuery = useLocationDirectory(role)
  const resolvedLocationName =
    locationName ?? directoryQuery.data?.find((entry) => entry.id === locationId)?.name ?? ""

  if (capsQuery.isPending) return <TabLoading />
  if (caps?.canEditCanonical !== true) {
    return <Empty title="This section is available to owners and admins" />
  }
  if (administrationQuery.isPending) return <TabLoading />
  if (administrationQuery.isError) {
    return <TabError error={administrationQuery.error} onRetry={() => administrationQuery.refetch()} />
  }

  return (
    <AdministrationTabLoaded
      locationId={locationId}
      locationName={resolvedLocationName}
      state={administrationQuery.data}
      caps={caps}
      invalidate={() => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.locationAdministration(locationId) })
      }}
      toast={(title, type) => toasts.add({ title, type })}
    />
  )
}

function AdministrationTabLoaded({
  locationId,
  locationName,
  state,
  caps,
  invalidate,
  toast,
}: {
  locationId: string
  locationName: string
  state: AdministrationState
  caps: LocationCapabilities
  invalidate: () => void
  toast: ToastFn
}) {
  const editReason = editDisabledReason(caps)
  const publishReason =
    editReason ??
    resourceDisabledReason(caps, "administration", state.writesEnabled)
  const disabled = Boolean(editReason)

  return (
    <div className="flex flex-col gap-8">
      <GateNote reason={editReason} />

      <section className="flex flex-col gap-3">
        <h2 className="text-title font-semibold">Voice of merchant</h2>
        <SectionPanel title="Voice of merchant" result={state.voice}>
          {(data) => <VoiceOfMerchantSummary data={asRecord(data)} />}
        </SectionPanel>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-title font-semibold">Suggested updates</h2>
        <SectionPanel title="Suggested updates" result={state.googleUpdated}>
          {(data) => (
            <GoogleUpdateSummary
              locationId={locationId}
              data={asRecord(data)}
              disabled={disabled}
              publishReason={publishReason}
              invalidate={invalidate}
              toast={toast}
            />
          )}
        </SectionPanel>
      </section>

      <section className="flex max-w-lg flex-col gap-6">
        <h2 className="text-title font-semibold">Verification</h2>
        <div className="flex flex-col gap-2">
          <h3 className="text-ui font-semibold text-muted-foreground">Verification history</h3>
          <SectionPanel title="Verification history" result={state.verifications}>
            {(data) => (
              <VerificationHistory
                locationId={locationId}
                data={asRecord(data)}
                disabled={disabled}
                publishReason={publishReason}
                invalidate={invalidate}
                toast={toast}
              />
            )}
          </SectionPanel>
        </div>
        <div className="flex flex-col gap-2">
          <h3 className="text-ui font-semibold text-muted-foreground">Start a new verification</h3>
          <SectionPanel title="Verification options" result={state.verificationOptions}>
            {(data) => (
              <StartVerification
                locationId={locationId}
                data={asRecord(data)}
                disabled={disabled}
                publishReason={publishReason}
                invalidate={invalidate}
                toast={toast}
              />
            )}
          </SectionPanel>
        </div>
      </section>

      <section className="flex flex-col gap-6">
        <h2 className="text-title font-semibold">Administrators</h2>
        <div className="flex flex-col gap-2">
          <h3 className="text-ui font-semibold text-muted-foreground">Location admins</h3>
          <SectionPanel title="Location admins" result={state.locationAdmins}>
            {(data) => (
              <AdminsTable
                admins={asArray(asRecord(data).admins).map(toAdminRow)}
                invitations={[]}
                renderActions={(admin) => (
                  <AdminRowActions
                    locationId={locationId}
                    locationName={locationName}
                    admin={admin}
                    disabled={disabled}
                    publishReason={publishReason}
                    invalidate={invalidate}
                    toast={toast}
                  />
                )}
              />
            )}
          </SectionPanel>
        </div>
        <div className="flex flex-col gap-2">
          <h3 className="text-ui font-semibold text-muted-foreground">Account admins</h3>
          <SectionPanel title="Account admins" result={state.accountAdmins}>
            {(data) => (
              <AdminsTable
                admins={asArray(asRecord(data).admins).map(toAdminRow)}
                invitations={[]}
                renderActions={(admin) => (
                  <AdminRowActions
                    locationId={locationId}
                    locationName={locationName}
                    admin={admin}
                    disabled={disabled}
                    publishReason={publishReason}
                    invalidate={invalidate}
                    toast={toast}
                  />
                )}
              />
            )}
          </SectionPanel>
        </div>
        <div className="flex flex-col gap-2">
          <h3 className="text-ui font-semibold text-muted-foreground">Invitations</h3>
          <SectionPanel title="Invitations" result={state.invitations}>
            {(data) => (
              <InvitationsList
                locationId={locationId}
                invitations={asArray(asRecord(data).invitations)}
                disabled={disabled}
                publishReason={publishReason}
                invalidate={invalidate}
                toast={toast}
              />
            )}
          </SectionPanel>
        </div>
        <div className="flex flex-col gap-2">
          <h3 className="text-ui font-semibold text-muted-foreground">Add an administrator</h3>
          <CreateAdminDialog
            locationId={locationId}
            disabled={disabled}
            publishReason={publishReason}
            invalidate={invalidate}
            toast={toast}
          />
        </div>
      </section>

      <DangerZone
        locationId={locationId}
        locationName={locationName}
        disabled={disabled}
        publishReason={publishReason}
        invalidate={invalidate}
        toast={toast}
      />
    </div>
  )
}

// --- Voice of merchant -----------------------------------------------------
function VoiceOfMerchantSummary({ data }: { data: RawRecord }) {
  const verified = data.hasVoiceOfMerchant === true
  return (
    <div className="flex items-center gap-2">
      <Badge variant={verified ? "success" : "outline"}>{verified ? "Verified" : "Not verified"}</Badge>
      <span className="text-caption text-muted-foreground">
        {verified
          ? "Google confirms you speak for this business."
          : "Google has not confirmed you speak for this business yet."}
      </span>
    </div>
  )
}

// --- Google's suggested update ---------------------------------------------
function GoogleUpdateSummary({
  locationId,
  data,
  disabled,
  publishReason,
  invalidate,
  toast,
}: {
  locationId: string
  data: RawRecord
  disabled: boolean
  publishReason: string | null
  invalidate: () => void
  toast: ToastFn
}) {
  const location = asRecord(data.location)
  const rawPaths = asRecord(data.diffMask).paths
  const paths = Array.isArray(rawPaths) ? rawPaths.filter((p): p is string => typeof p === "string") : []

  const accept = useMutation({
    mutationFn: () =>
      runAdministrationOperation(locationId, { operation: "accept_google_update", payload: { updateMask: paths, location } }),
    onSuccess: () => {
      invalidate()
      toast("Google's suggested update accepted", "success")
    },
    onError: (error) => toast(describeActionError(error), "error"),
  })

  if (paths.length === 0) {
    return <p className="text-caption text-muted-foreground">Google has not suggested any changes.</p>
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-caption text-muted-foreground">
        Google suggests {paths.length} change{paths.length === 1 ? "" : "s"} to this listing that{" "}
        {paths.length === 1 ? "hasn't" : "haven't"} been applied here yet.
      </p>
      <div>
        <Button size="sm" onClick={() => accept.mutate()} disabled={disabled || Boolean(publishReason) || accept.isPending}>
          {accept.isPending ? "Applying…" : "Accept Google's update"}
        </Button>
      </div>
      <GateNote reason={disabled ? null : publishReason} />
    </div>
  )
}

// --- Verification ------------------------------------------------------
function VerificationHistory({
  locationId,
  data,
  disabled,
  publishReason,
  invalidate,
  toast,
}: {
  locationId: string
  data: RawRecord
  disabled: boolean
  publishReason: string | null
  invalidate: () => void
  toast: ToastFn
}) {
  const verifications = asArray(data.verifications)
  if (verifications.length === 0) {
    return <p className="text-caption text-muted-foreground">No verification attempts yet.</p>
  }
  return (
    <ul className="flex flex-col gap-3">
      {verifications.map((verification, index) => (
        <VerificationRow
          key={asString(verification.name) || index}
          locationId={locationId}
          verification={verification}
          disabled={disabled}
          publishReason={publishReason}
          invalidate={invalidate}
          toast={toast}
        />
      ))}
    </ul>
  )
}

function verificationBadgeVariant(state: string): "success" | "info" | "destructive" | "outline" {
  if (state === "COMPLETED") return "success"
  if (state === "PENDING") return "info"
  if (state === "FAILED") return "destructive"
  return "outline"
}

function VerificationRow({
  locationId,
  verification,
  disabled,
  publishReason,
  invalidate,
  toast,
}: {
  locationId: string
  verification: RawRecord
  disabled: boolean
  publishReason: string | null
  invalidate: () => void
  toast: ToastFn
}) {
  const method = asString(verification.method) || asString(verification.verificationMethod)
  const state = asString(verification.state)
  const name = asString(verification.name)
  const [pin, setPin] = useState("")
  const pinId = useId()

  const complete = useMutation({
    mutationFn: () => runAdministrationOperation(locationId, { operation: "complete_verification", payload: { name, pin } }),
    onSuccess: () => {
      invalidate()
      setPin("")
      toast("Verification completed", "success")
    },
    onError: (error) => toast(describeActionError(error), "error"),
  })

  return (
    <li className="flex flex-col gap-2 rounded-(--nr-radius-card) border border-border p-3">
      <div className="flex items-center gap-2">
        <span className="text-ui font-medium">{verificationMethodLabel(method)}</span>
        <Badge variant={verificationBadgeVariant(state)}>{verificationStateLabel(state)}</Badge>
      </div>
      {state === "PENDING" && name ? (
        <div className="flex flex-wrap items-end gap-2">
          <Field>
            <FieldLabel htmlFor={pinId}>PIN</FieldLabel>
            <Input id={pinId} value={pin} disabled={disabled} onChange={(e) => setPin(e.target.value)} />
          </Field>
          <Button
            size="sm"
            onClick={() => complete.mutate()}
            disabled={disabled || Boolean(publishReason) || !pin.trim() || complete.isPending}
          >
            {complete.isPending ? "Confirming…" : "Complete verification"}
          </Button>
        </div>
      ) : null}
      <GateNote reason={disabled ? null : publishReason} />
    </li>
  )
}

function StartVerification({
  locationId,
  data,
  disabled,
  publishReason,
  invalidate,
  toast,
}: {
  locationId: string
  data: RawRecord
  disabled: boolean
  publishReason: string | null
  invalidate: () => void
  toast: ToastFn
}) {
  const options = asArray(data.options)
  const methods = Array.from(new Set(options.map((o) => asString(o.verificationMethod)).filter(Boolean)))
  const [method, setMethod] = useState(methods[0] ?? "")
  // idiom (b): setState-in-effect -> ref-guard. Only reset the selected
  // method when `data` itself changes identity (a refetch), not on every
  // incidental re-render — `methods` is recomputed fresh from `data` inside
  // the effect so the dependency array only needs the one reactive value.
  const dataRef = useRef(data)
  useEffect(() => {
    if (dataRef.current === data) return
    dataRef.current = data
    const nextOptions = asArray(data.options)
    const nextMethods = Array.from(new Set(nextOptions.map((o) => asString(o.verificationMethod)).filter(Boolean)))
    setMethod(nextMethods[0] ?? "")
  }, [data])

  const start = useMutation({
    mutationFn: () =>
      runAdministrationOperation(locationId, { operation: "start_verification", payload: { method, languageCode: "en" } }),
    onSuccess: () => {
      invalidate()
      toast("Verification started", "success")
    },
    onError: (error) => toast(describeActionError(error), "error"),
  })

  if (methods.length === 0) {
    return <p className="text-caption text-muted-foreground">Google has no verification methods available for this listing right now.</p>
  }

  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="flex flex-col gap-1">
        <span className="text-ui font-medium">Verification method</span>
        <Select value={method} onValueChange={(value: string | null) => value && setMethod(value)} disabled={disabled}>
          <SelectTrigger aria-label="Verification method">
            <SelectValue>{(value: string | null) => (value ? verificationMethodLabel(value) : "")}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {methods.map((m) => (
              <SelectItem key={m} value={m}>
                {verificationMethodLabel(m)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Button onClick={() => start.mutate()} disabled={disabled || Boolean(publishReason) || start.isPending}>
        {start.isPending ? "Starting…" : "Start verification"}
      </Button>
      <GateNote reason={disabled ? null : publishReason} />
    </div>
  )
}

// --- Admins --------------------------------------------------------------
const EDITABLE_ROLES = ["OWNER", "MANAGER"] as const

function AdminRowActions({
  locationId,
  locationName,
  admin,
  disabled,
  publishReason,
  invalidate,
  toast,
}: {
  locationId: string
  locationName: string
  admin: AdminRow
  disabled: boolean
  publishReason: string | null
  invalidate: () => void
  toast: ToastFn
}) {
  return (
    <div className="flex items-center gap-2">
      <UpdateAdminRoleControl
        locationId={locationId}
        admin={admin}
        disabled={disabled}
        publishReason={publishReason}
        invalidate={invalidate}
        toast={toast}
      />
      <RemoveAdminAction
        locationId={locationId}
        locationName={locationName}
        admin={admin}
        disabled={disabled}
        publishReason={publishReason}
        invalidate={invalidate}
        toast={toast}
      />
    </div>
  )
}

function UpdateAdminRoleControl({
  locationId,
  admin,
  disabled,
  publishReason,
  invalidate,
  toast,
}: {
  locationId: string
  admin: AdminRow
  disabled: boolean
  publishReason: string | null
  invalidate: () => void
  toast: ToastFn
}) {
  const name = admin.name
  const currentRole = admin.role
  const initialRole =
    currentRole && (EDITABLE_ROLES as readonly string[]).includes(currentRole) ? currentRole : "MANAGER"
  const [role, setRole] = useState(initialRole)
  // idiom (b): ref-guard, as above.
  const initialRoleRef = useRef(initialRole)
  useEffect(() => {
    if (initialRoleRef.current === initialRole) return
    initialRoleRef.current = initialRole
    setRole(initialRole)
  }, [initialRole])

  const update = useMutation({
    mutationFn: () => {
      const values = updateAdminSchema.parse({ name, role })
      return runAdministrationOperation(locationId, { operation: "update_admin", payload: values })
    },
    onSuccess: () => {
      invalidate()
      toast("Administrator role updated", "success")
    },
    onError: (error) => toast(describeActionError(error), "error"),
  })

  // Google does not allow changing the primary owner's role here, and a row
  // without a resource `name` has no safe PATCH target.
  if (!name || currentRole === "PRIMARY_OWNER") return null

  return (
    <div className="flex items-center gap-2">
      <Select value={role} onValueChange={(value: string | null) => value && setRole(value)} disabled={disabled}>
        <SelectTrigger aria-label={`Role for ${admin.admin ?? name}`}>
          <SelectValue>{(value: string | null) => (value ? adminRoleLabel(value) : "")}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {EDITABLE_ROLES.map((r) => (
            <SelectItem key={r} value={r}>
              {adminRoleLabel(r)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        size="sm"
        variant="outline"
        onClick={() => update.mutate()}
        disabled={disabled || Boolean(publishReason) || role === currentRole || update.isPending}
      >
        {update.isPending ? "Saving…" : "Update role"}
      </Button>
    </div>
  )
}

// This is one of the three destructive Google operations in the danger zone
// (spec §11, D9) - it is deliberately row-level rather than living in the
// danger-zone section below, since "which admin" only makes sense in the
// context of that row. It still goes through the same two-layer gate as
// transfer/delete: the DangerZoneDialog's typed-location-name confirmation,
// AND the exact backend confirmation literal (runDangerZoneOperation ->
// runAdministrationOperation attaches ADMINISTRATION_CONFIRMATIONS.delete_admin).
function RemoveAdminAction({
  locationId,
  locationName,
  admin,
  disabled,
  publishReason,
  invalidate,
  toast,
}: {
  locationId: string
  locationName: string
  admin: AdminRow
  disabled: boolean
  publishReason: string | null
  invalidate: () => void
  toast: ToastFn
}) {
  const name = admin.name
  const currentRole = admin.role
  const [open, setOpen] = useState(false)

  const remove = useMutation({
    mutationFn: () => runDangerZoneOperation(locationId, "delete_admin", { name }),
    onSuccess: () => {
      invalidate()
      toast("Administrator removed", "success")
      setOpen(false)
    },
    onError: (error) => toast(describeActionError(error), "error"),
  })

  // Same guard as UpdateAdminRoleControl: Google will not let the primary
  // owner be removed here, and a row without a resource `name` has no safe
  // DELETE target.
  if (!name || currentRole === "PRIMARY_OWNER") return null

  return (
    <>
      <Button
        size="sm"
        variant="destructive"
        aria-label={`Remove ${admin.admin ?? name}`}
        onClick={() => setOpen(true)}
        disabled={disabled || Boolean(publishReason) || !locationName}
      >
        Remove
      </Button>
      <DangerZoneDialog
        open={open}
        onOpenChange={setOpen}
        title="Remove this administrator?"
        description={`This removes ${admin.admin ?? "this person"}'s access to manage this business on Google.`}
        expectedName={locationName}
        confirmLabel="Remove administrator"
        pending={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </>
  )
}

function InvitationsList({
  locationId,
  invitations,
  disabled,
  publishReason,
  invalidate,
  toast,
}: {
  locationId: string
  invitations: RawRecord[]
  disabled: boolean
  publishReason: string | null
  invalidate: () => void
  toast: ToastFn
}) {
  if (invitations.length === 0) {
    return <p className="text-caption text-muted-foreground">No pending invitations.</p>
  }
  return (
    <ul className="flex flex-col gap-2">
      {invitations.map((invitation, index) => (
        <InvitationRow
          key={asString(invitation.name) || index}
          locationId={locationId}
          invitation={invitation}
          disabled={disabled}
          publishReason={publishReason}
          invalidate={invalidate}
          toast={toast}
        />
      ))}
    </ul>
  )
}

function InvitationRow({
  locationId,
  invitation,
  disabled,
  publishReason,
  invalidate,
  toast,
}: {
  locationId: string
  invitation: RawRecord
  disabled: boolean
  publishReason: string | null
  invalidate: () => void
  toast: ToastFn
}) {
  const name = asString(invitation.name)
  const role = asString(invitation.role)

  const respond = useMutation({
    mutationFn: (operation: "accept_invitation" | "decline_invitation") =>
      runAdministrationOperation(locationId, { operation, payload: { name } }),
    onSuccess: (_data, operation) => {
      invalidate()
      toast(operation === "accept_invitation" ? "Invitation accepted" : "Invitation declined", "success")
    },
    onError: (error) => toast(describeActionError(error), "error"),
  })
  // Both buttons share one mutation, keyed by `operation` — so only the
  // clicked button's label/pending state should change, not both. `variables`
  // holds whichever operation is in flight.
  const pendingOperation = respond.isPending ? respond.variables : null

  return (
    <li className="flex items-center justify-between gap-2 rounded-(--nr-radius-card) border border-border p-3">
      <div className="flex items-center gap-2">
        <span className="text-ui font-medium">{role ? adminRoleLabel(role) : "Invitation"}</span>
        <Badge variant="info">Invited</Badge>
      </div>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => respond.mutate("decline_invitation")}
          disabled={disabled || Boolean(publishReason) || !name || respond.isPending}
        >
          {pendingOperation === "decline_invitation" ? "Declining…" : "Decline"}
        </Button>
        <Button
          size="sm"
          onClick={() => respond.mutate("accept_invitation")}
          disabled={disabled || Boolean(publishReason) || !name || respond.isPending}
        >
          {pendingOperation === "accept_invitation" ? "Accepting…" : "Accept"}
        </Button>
      </div>
    </li>
  )
}

// --- Create admin ------------------------------------------------------
// These are our own UI-level scope values (not a Google enum), but the
// trigger still must not go blank/raw on first paint (spec §7) - factor the
// label here so the SelectValue render-function and the SelectItems below
// can never drift out of sync.
const ADMIN_SCOPE_LABELS: Record<string, string> = {
  location: "This location",
  account: "The whole Google account",
}

function CreateAdminDialog({
  locationId,
  disabled,
  publishReason,
  invalidate,
  toast,
}: {
  locationId: string
  disabled: boolean
  publishReason: string | null
  invalidate: () => void
  toast: ToastFn
}) {
  const [open, setOpen] = useState(false)
  const [scope, setScope] = useState("location")
  const [email, setEmail] = useState("")
  const [role, setRole] = useState("MANAGER")

  const parsed = createAdminSchema.safeParse({ scope, admin: email, role })
  const emailError =
    email.trim().length > 0 && !parsed.success
      ? parsed.error.issues.find((issue) => issue.path[0] === "admin")?.message
      : undefined

  const create = useMutation({
    mutationFn: () => {
      const values = createAdminSchema.parse({ scope, admin: email, role })
      return runAdministrationOperation(locationId, { operation: "create_admin", payload: values })
    },
    onSuccess: () => {
      invalidate()
      toast("Invitation sent", "success")
      setOpen(false)
      setEmail("")
    },
    onError: (error) => toast(describeActionError(error), "error"),
  })

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setEmail("")
      }}
    >
      <DialogTrigger render={<Button disabled={disabled} />}>Add administrator</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add an administrator</DialogTitle>
          <DialogDescription>Invite someone to help manage this business on Google.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <span className="text-ui font-medium">Scope</span>
            <Select value={scope} onValueChange={(value: string | null) => value && setScope(value)}>
              <SelectTrigger aria-label="Scope">
                <SelectValue>{(value: string | null) => (value ? (ADMIN_SCOPE_LABELS[value] ?? value) : "")}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="location">{ADMIN_SCOPE_LABELS.location}</SelectItem>
                <SelectItem value="account">{ADMIN_SCOPE_LABELS.account}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Field error={emailError}>
            <FieldLabel>Email address</FieldLabel>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <FieldError />
          </Field>
          <div className="flex flex-col gap-1">
            <span className="text-ui font-medium">Role</span>
            <Select value={role} onValueChange={(value: string | null) => value && setRole(value)}>
              <SelectTrigger aria-label="Role">
                <SelectValue>{(value: string | null) => (value ? adminRoleLabel(value) : "")}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {EDITABLE_ROLES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {adminRoleLabel(r)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button onClick={() => create.mutate()} disabled={!parsed.success || Boolean(publishReason) || create.isPending}>
            {create.isPending ? "Sending…" : "Send invitation"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// --- Danger zone -----------------------------------------------------------
// The three destructive Google operations (spec §11, D9): remove an
// administrator (row-level, above), transfer this location to another
// Google account, and permanently delete this location from Google. Every
// action here is two-layer gated: the DangerZoneDialog's typed-location-name
// confirmation (UI layer) AND the exact backend confirmation literal sent by
// runDangerZoneOperation (route layer) - see app/api/locations/[id]/administration/route.ts
// CONFIRMATIONS, transcribed into lib/api/location-administration.ts. Deletion
// here is Google's PERMANENT delete (deleteGoogleLocation) - it is never the
// app-side soft unlink (DELETE /api/location-links); the note below points
// people who want that at Connections instead.
function DangerZone({
  locationId,
  locationName,
  disabled,
  publishReason,
  invalidate,
  toast,
}: {
  locationId: string
  locationName: string
  disabled: boolean
  publishReason: string | null
  invalidate: () => void
  toast: ToastFn
}) {
  return (
    <section className="flex flex-col gap-4 rounded-(--nr-radius-card) border border-destructive/30 bg-destructive/5 p-4">
      <div className="flex flex-col gap-1">
        <h3 className="text-ui font-semibold text-destructive">Danger zone</h3>
        <p className="text-caption text-muted-foreground">
          These actions change how this location is managed on Google. Each one cannot be undone from here.
        </p>
      </div>
      <TransferLocationAction
        locationId={locationId}
        locationName={locationName}
        disabled={disabled}
        publishReason={publishReason}
        invalidate={invalidate}
        toast={toast}
      />
      <DeleteLocationAction
        locationId={locationId}
        locationName={locationName}
        disabled={disabled}
        publishReason={publishReason}
        invalidate={invalidate}
        toast={toast}
      />
      <p className="text-caption text-muted-foreground">
        To stop managing a location without deleting it from Google, unlink it under{" "}
        <Link href="/settings/connections" className="underline">
          Connections
        </Link>
        .
      </p>
    </section>
  )
}

function TransferLocationAction({
  locationId,
  locationName,
  disabled,
  publishReason,
  invalidate,
  toast,
}: {
  locationId: string
  locationName: string
  disabled: boolean
  publishReason: string | null
  invalidate: () => void
  toast: ToastFn
}) {
  // Step 1 (a plain Dialog) collects and validates destinationAccount. Step 2
  // (DangerZoneDialog) then requires the typed location name before sending
  // the request - "collect destinationAccount THEN require the typed name"
  // (spec §11). `destinationAccount` is owned by this component (not the
  // step-1 dialog), so it survives that dialog closing and step 2 opening.
  const [collecting, setCollecting] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [destinationAccount, setDestinationAccount] = useState("")

  const parsed = transferLocationSchema.safeParse({ destinationAccount })
  const fieldError =
    destinationAccount.trim().length > 0 && !parsed.success
      ? parsed.error.issues.find((issue) => issue.path[0] === "destinationAccount")?.message
      : undefined

  const transfer = useMutation({
    mutationFn: () => {
      const values = transferLocationSchema.parse({ destinationAccount })
      return runDangerZoneOperation(locationId, "transfer_location", values)
    },
    onSuccess: () => {
      invalidate()
      toast("Location transfer requested", "success")
      setConfirming(false)
      setDestinationAccount("")
    },
    onError: (error) => toast(describeActionError(error), "error"),
  })

  return (
    <div className="flex flex-col gap-2 border-t border-destructive/20 pt-4 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-ui font-medium">Transfer this location</p>
          <p className="text-caption text-muted-foreground">Move this Google location to another Google account.</p>
        </div>
        <Button
          variant="destructive"
          size="sm"
          onClick={() => setCollecting(true)}
          disabled={disabled || Boolean(publishReason) || !locationName}
        >
          Transfer this location
        </Button>
      </div>
      <GateNote reason={disabled ? null : publishReason} />

      <Dialog
        open={collecting}
        onOpenChange={(next) => {
          setCollecting(next)
          if (!next) setDestinationAccount("")
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Transfer this location</DialogTitle>
            <DialogDescription>
              This moves the Google location to another Google account. NabaPresence may lose the ability to manage
              it, and this cannot be undone from here.
            </DialogDescription>
          </DialogHeader>
          <Field error={fieldError}>
            <FieldLabel>Destination Google account</FieldLabel>
            <Input
              value={destinationAccount}
              onChange={(event) => setDestinationAccount(event.target.value)}
              placeholder="accounts/1234567890"
              autoComplete="off"
            />
            <FieldError />
          </Field>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button
              variant="destructive"
              disabled={!parsed.success}
              onClick={() => {
                setCollecting(false)
                setConfirming(true)
              }}
            >
              Continue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DangerZoneDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Transfer this location?"
        description={`This moves the Google location to another Google account (${destinationAccount}). NabaPresence may lose the ability to manage it, and this cannot be undone from here.`}
        expectedName={locationName}
        confirmLabel="Transfer location"
        pending={transfer.isPending}
        onConfirm={() => transfer.mutate()}
      />
    </div>
  )
}

function DeleteLocationAction({
  locationId,
  locationName,
  disabled,
  publishReason,
  invalidate,
  toast,
}: {
  locationId: string
  locationName: string
  disabled: boolean
  publishReason: string | null
  invalidate: () => void
  toast: ToastFn
}) {
  const [open, setOpen] = useState(false)

  const remove = useMutation({
    // Google's PERMANENT delete (deleteGoogleLocation on the server) - not
    // the app-side soft unlink. Empty payload: the route resolves the
    // Google location from the session's own link, so no id needs sending.
    mutationFn: () => runDangerZoneOperation(locationId, "delete_location", {}),
    onSuccess: () => {
      invalidate()
      toast("Location deleted from Google", "success")
      setOpen(false)
    },
    onError: (error) => toast(describeActionError(error), "error"),
  })

  return (
    <div className="flex flex-col gap-2 border-t border-destructive/20 pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-ui font-medium">Delete this location</p>
          <p className="text-caption text-muted-foreground">Permanently remove this listing from Google.</p>
        </div>
        <Button
          variant="destructive"
          size="sm"
          onClick={() => setOpen(true)}
          disabled={disabled || Boolean(publishReason) || !locationName}
        >
          Delete this location
        </Button>
      </div>
      <GateNote reason={disabled ? null : publishReason} />

      <DangerZoneDialog
        open={open}
        onOpenChange={setOpen}
        title="Delete this location from Google?"
        description="This permanently deletes the Google listing. It cannot be undone."
        expectedName={locationName}
        confirmLabel="Delete location"
        pending={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </div>
  )
}
