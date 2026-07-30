"use client"

import { Copy, Sparkles } from "lucide-react"
import { useEffect, useState, useTransition } from "react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
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
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
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
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
  FieldTitle,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemFooter,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { toast } from "@/components/ui/toast"
import {
  createInvitation,
  createPrivacyRequest,
  loadInvitations,
  loadInternalLocations,
  loadMembers,
  loadSettings,
  type Invitation,
  type InternalLocation,
  type OrganisationMember,
  saveLocationAssignments,
  saveSettings,
  updateMember,
} from "@/lib/naba-presence-api"
import {
  LiveDataError,
  PageFrame,
  PageHeader,
  readControlValue,
} from "@/components/naba-presence/shared"

function memberInitialsOf(displayName: string) {
  return displayName
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("")
}

export function SettingsView() {
  const [approvalRequired, setApprovalRequired] = useState(true)
  const [requireTwoPersonApproval, setRequireTwoPersonApproval] =
    useState(false)
  const [retentionDays, setRetentionDays] = useState(30)
  const [defaultLanguage, setDefaultLanguage] = useState("en")
  const [defaultTimezone, setDefaultTimezone] = useState("Europe/London")
  const [directPublishConsent, setDirectPublishConsent] = useState(false)
  const [members, setMembers] = useState<OrganisationMember[]>([])
  const [internalLocations, setInternalLocations] = useState<
    InternalLocation[]
  >([])
  const [invitations, setInvitations] = useState<Invitation[]>([])
  const [newMemberEmail, setNewMemberEmail] = useState("")
  const [newMemberRole, setNewMemberRole] =
    useState<OrganisationMember["role"]>("member")
  const [newMemberCanPublish, setNewMemberCanPublish] = useState(false)
  const [privacySubject, setPrivacySubject] = useState("")
  const [privacyRequestType, setPrivacyRequestType] = useState<
    "access" | "rectification" | "erasure" | "restriction"
  >("access")
  const [message, setMessage] = useState("")
  const [isPending, startTransition] = useTransition()
  const [settingsStatus, setSettingsStatus] = useState<
    "loading" | "ready" | "error"
  >("loading")
  const [teamStatus, setTeamStatus] = useState<"loading" | "ready" | "error">(
    "loading"
  )
  const [reloadKey, setReloadKey] = useState(0)
  const [confirmPrivacyOpen, setConfirmPrivacyOpen] = useState(false)

  useEffect(() => {
    let active = true
    void loadSettings()
      .then(({ settings }) => {
        if (!active) return
        setApprovalRequired(settings.approvalRequired)
        setRequireTwoPersonApproval(
          Boolean(settings.requireTwoPersonApproval)
        )
        setRetentionDays(settings.rawContentRetentionDays)
        setDefaultLanguage(settings.defaultLanguageCode)
        setDefaultTimezone(settings.defaultTimezone)
        setDirectPublishConsent(Boolean(settings.directPublishConsentAt))
        setSettingsStatus("ready")
      })
      .catch(() => {
        if (active) setSettingsStatus("error")
      })
    return () => {
      active = false
    }
  }, [reloadKey])

  useEffect(() => {
    let active = true
    void Promise.all([
      loadMembers(),
      loadInternalLocations(),
      loadInvitations(),
    ])
      .then(([memberResult, locationResult, invitationResult]) => {
        if (!active) return
        setMembers(memberResult.members)
        setInternalLocations(locationResult.locations)
        setInvitations(invitationResult.items)
        setTeamStatus("ready")
      })
      .catch(() => {
        if (active) setTeamStatus("error")
      })
    return () => {
      active = false
    }
  }, [reloadKey])

  function reloadSettings() {
    setSettingsStatus("loading")
    setTeamStatus("loading")
    setReloadKey((value) => value + 1)
  }

  if (settingsStatus !== "ready") {
    return (
      <PageFrame>
        <PageHeader
          title="Reply policy"
          description="Human approval, verification and retention controls."
        />
        {settingsStatus === "loading" ? (
          <>
            <Skeleton className="h-72 w-full" />
            <Skeleton className="h-64 w-full" />
          </>
        ) : (
          <LiveDataError onRetry={reloadSettings} />
        )}
      </PageFrame>
    )
  }

  function persistSettings() {
    setMessage("")
    startTransition(async () => {
      try {
        await saveSettings({
          approvalRequired,
          requireTwoPersonApproval,
          rawContentRetentionDays: retentionDays,
          defaultLanguageCode: defaultLanguage,
          defaultTimezone,
          directPublishConsent,
        })
        toast.add({
          type: "success",
          title: "Policy settings saved and added to the audit trail.",
        })
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Save failed.")
      }
    })
  }

  function inviteMember() {
    setMessage("")
    startTransition(async () => {
      try {
        const { invitation, inviteUrl } = await createInvitation({
          email: newMemberEmail,
          role: newMemberRole,
          canPublish: newMemberCanPublish,
        })
        setInvitations((current) => [
          { ...invitation, inviteUrl },
          ...current,
        ])
        setNewMemberEmail("")
        toast.add({
          type: "success",
          title: "Invitation created. Copy the link to share it securely.",
        })
      } catch (error) {
        setMessage(
          error instanceof Error ? error.message : "Invitation failed."
        )
      }
    })
  }

  function copyInvitation(invitation: Invitation) {
    void navigator.clipboard
      .writeText(invitation.inviteUrl)
      .then(() => {
        toast.add({
          type: "success",
          title: `Invitation link copied for ${invitation.email}.`,
        })
      })
      .catch(() => {
        setMessage("The invitation link could not be copied.")
      })
  }

  function changeMember(
    member: OrganisationMember,
    patch: Pick<OrganisationMember, "role" | "canPublish">
  ) {
    const roleChanged = patch.role !== member.role
    setMessage("")
    startTransition(async () => {
      try {
        await updateMember({ userId: member.userId, ...patch })
        setMembers((current) =>
          current.map((item) =>
            item.userId === member.userId ? { ...item, ...patch } : item
          )
        )
        toast.add({
          type: "success",
          title: roleChanged
            ? "Member role updated."
            : "Member publish access updated.",
        })
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Update failed.")
      }
    })
  }

  function cycleLocationAccess(member: OrganisationMember, locationId: string) {
    const current = member.locations.find(
      (assignment) => assignment.locationId === locationId
    )
    const assignments = current
      ? current.canPublish || member.role === "viewer"
        ? member.locations.filter(
            (assignment) => assignment.locationId !== locationId
          )
        : member.locations.map((assignment) =>
            assignment.locationId === locationId
              ? { ...assignment, canPublish: true }
              : assignment
          )
      : [...member.locations, { locationId, canPublish: false }]
    setMessage("")
    startTransition(async () => {
      try {
        await saveLocationAssignments(member.userId, assignments)
        setMembers((items) =>
          items.map((item) =>
            item.userId === member.userId
              ? { ...item, locations: assignments }
              : item
          )
        )
        toast.add({ type: "success", title: "Location permissions updated." })
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Update failed.")
      }
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
        title="Reply policy"
        description="Human approval, verification and retention controls."
      />

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
                  AI drafts cannot publish until an authorised person approves
                  them.
                </FieldDescription>
              </FieldContent>
              <Switch
                checked={approvalRequired}
                onCheckedChange={(checked) => {
                  setApprovalRequired(checked)
                  if (checked) {
                    setDirectPublishConsent(false)
                  } else {
                    setRequireTwoPersonApproval(false)
                  }
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
                    onCheckedChange={setRequireTwoPersonApproval}
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
                    <FieldTitle>Owner consent for direct publishing</FieldTitle>
                    <FieldDescription>
                      I authorise NabaPresence to publish verified replies on this
                      organisation’s behalf without a separate approval step.
                      Every action remains attributable and location-scoped.
                    </FieldDescription>
                  </FieldContent>
                  <Switch
                    checked={directPublishConsent}
                    onCheckedChange={setDirectPublishConsent}
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
                  Always enforced by the publishing API when claims, personal
                  data or tone checks fail.
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
            disabled={isPending || (!approvalRequired && !directPublishConsent)}
          >
            Save policy
          </Button>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Team access</CardTitle>
          <CardDescription>
            Roles control administration; location assignments restrict review
            visibility and approval. Click a location to cycle View → Publish →
            No access.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {teamStatus === "loading" ? (
            <Skeleton className="h-48 w-full" />
          ) : teamStatus === "error" ? (
            <LiveDataError onRetry={reloadSettings} />
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field>
                  <FieldLabel htmlFor="new-member-email">Email</FieldLabel>
                  <Input
                    id="new-member-email"
                    value={newMemberEmail}
                    onChange={(event) =>
                      setNewMemberEmail(readControlValue(event))
                    }
                    placeholder="name@example.com"
                    type="email"
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="new-member-role">Role</FieldLabel>
                  <NativeSelect
                    id="new-member-role"
                    value={newMemberRole}
                    onValueChange={(value) =>
                      setNewMemberRole(value as OrganisationMember["role"])
                    }
                  >
                    <NativeSelectOption value="owner">Owner</NativeSelectOption>
                    <NativeSelectOption value="admin">Admin</NativeSelectOption>
                    <NativeSelectOption value="member">
                      Member
                    </NativeSelectOption>
                    <NativeSelectOption value="viewer">
                      Viewer
                    </NativeSelectOption>
                  </NativeSelect>
                </Field>
                <Field orientation="horizontal" className="self-end">
                  <FieldContent>
                    <FieldTitle>Publish all locations</FieldTitle>
                    <FieldDescription>
                      Viewers cannot be granted publish access.
                    </FieldDescription>
                  </FieldContent>
                  <Switch
                    checked={newMemberCanPublish}
                    disabled={newMemberRole === "viewer"}
                    onCheckedChange={setNewMemberCanPublish}
                    aria-label="Publish all locations for new invitation"
                  />
                </Field>
              </div>
              <Button
                onClick={inviteMember}
                disabled={isPending || !newMemberEmail}
                className="self-start"
              >
                Create invitation
              </Button>
              <p className="text-sm text-muted-foreground">
                NabaPresence does not send invitation emails. Copy a pending
                link and share it with the invited person.
              </p>
              {invitations.length > 0 ? (
                <div className="space-y-2">
                  <h3 className="font-heading text-sm font-semibold">
                    Pending invitations
                  </h3>
                  <ItemGroup className="gap-2" aria-label="Pending invitations">
                    {invitations.map((invitation) => (
                      <Item
                        key={invitation.id}
                        role="listitem"
                        variant="outline"
                        size="sm"
                      >
                        <ItemContent>
                          <ItemTitle>{invitation.email}</ItemTitle>
                          <ItemDescription>
                            {invitation.role} · expires{" "}
                            {new Intl.DateTimeFormat(undefined, {
                              dateStyle: "medium",
                            }).format(new Date(invitation.expiresAt))}
                          </ItemDescription>
                        </ItemContent>
                        <ItemActions>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => copyInvitation(invitation)}
                            aria-label={`Copy invitation link for ${invitation.email}`}
                          >
                            <Copy aria-hidden />
                            Copy link
                          </Button>
                        </ItemActions>
                      </Item>
                    ))}
                  </ItemGroup>
                </div>
              ) : null}
              <ItemGroup className="gap-2">
                {members.map((member) => {
                  const memberInitials = memberInitialsOf(member.displayName)
                  return (
                    <Item
                      key={member.userId}
                      role="listitem"
                      variant="outline"
                      size="sm"
                    >
                      <ItemMedia>
                        <Avatar size="sm">
                          <AvatarFallback>{memberInitials}</AvatarFallback>
                        </Avatar>
                      </ItemMedia>
                      <ItemContent>
                        <ItemTitle>{member.displayName}</ItemTitle>
                        <ItemDescription>{member.email}</ItemDescription>
                      </ItemContent>
                      <ItemActions>
                        <NativeSelect
                          className="w-32"
                          value={member.role}
                          onValueChange={(value) =>
                            changeMember(member, {
                              role: value as OrganisationMember["role"],
                              canPublish: member.canPublish,
                            })
                          }
                          aria-label={`Role for ${member.displayName}`}
                        >
                          <NativeSelectOption value="owner">
                            Owner
                          </NativeSelectOption>
                          <NativeSelectOption value="admin">
                            Admin
                          </NativeSelectOption>
                          <NativeSelectOption value="member">
                            Member
                          </NativeSelectOption>
                          <NativeSelectOption value="viewer">
                            Viewer
                          </NativeSelectOption>
                        </NativeSelect>
                        <label className="flex items-center gap-2 text-xs">
                          Publish all
                          <Switch
                            checked={member.canPublish}
                            disabled={member.role === "viewer"}
                            onCheckedChange={(canPublish) =>
                              changeMember(member, {
                                role: member.role,
                                canPublish,
                              })
                            }
                            aria-label={`Publish all locations for ${member.displayName}`}
                          />
                        </label>
                      </ItemActions>
                      {member.role === "member" || member.role === "viewer" ? (
                        <ItemFooter className="flex-wrap justify-start">
                          {internalLocations.map((location) => {
                            const assignment = member.locations.find(
                              (item) => item.locationId === location.locationId
                            )
                            return (
                              <Button
                                key={location.locationId}
                                variant={assignment ? "secondary" : "outline"}
                                size="sm"
                                onClick={() =>
                                  cycleLocationAccess(
                                    member,
                                    location.locationId
                                  )
                                }
                              >
                                {location.name}
                                {assignment
                                  ? assignment.canPublish
                                    ? " · Publish"
                                    : " · View"
                                  : " · No access"}
                              </Button>
                            )
                          })}
                        </ItemFooter>
                      ) : null}
                    </Item>
                  )
                })}
              </ItemGroup>
            </>
          )}
        </CardContent>
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
                value={defaultLanguage}
                onValueChange={setDefaultLanguage}
              >
                <NativeSelectOption value="en">English</NativeSelectOption>
                <NativeSelectOption value="fr">French</NativeSelectOption>
                <NativeSelectOption value="de">German</NativeSelectOption>
                <NativeSelectOption value="es">Spanish</NativeSelectOption>
                <NativeSelectOption value="it">Italian</NativeSelectOption>
              </NativeSelect>
            </Field>
            <Field>
              <FieldLabel htmlFor="default-timezone">IANA timezone</FieldLabel>
              <Input
                id="default-timezone"
                value={defaultTimezone}
                onChange={(event) =>
                  setDefaultTimezone(readControlValue(event))
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
          <Button onClick={persistSettings} disabled={isPending}>
            Save locale
          </Button>
        </CardFooter>
      </Card>

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
                value={String(retentionDays)}
                onValueChange={(value) => setRetentionDays(Number(value))}
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
                Rating, response-time and volume metrics remain available after
                raw text is purged.
              </ItemDescription>
            </ItemContent>
            <ItemActions>
              <Badge variant="secondary">Enforced</Badge>
            </ItemActions>
          </Item>
        </CardContent>
        <CardFooter className="justify-between gap-3">
          <span className="text-xs text-muted-foreground">
            Purges are recorded by the retention worker.
          </span>
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
        </CardFooter>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Compliance tools</CardTitle>
          <CardDescription>
            Track data-subject workflows and export attributable audit records.
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
                onChange={(event) => setPrivacySubject(readControlValue(event))}
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
                <NativeSelectOption value="access">Access</NativeSelectOption>
                <NativeSelectOption value="rectification">
                  Rectification
                </NativeSelectOption>
                <NativeSelectOption value="erasure">Erasure</NativeSelectOption>
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
    </PageFrame>
  )
}
