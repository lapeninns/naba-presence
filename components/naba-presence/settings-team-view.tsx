"use client"

import { Copy } from "lucide-react"
import { useEffect, useState, useTransition } from "react"

import { SettingsNav } from "@/components/naba-presence/settings/settings-nav"
import {
  LiveDataError,
  PageFrame,
  PageHeader,
  readControlValue,
} from "@/components/naba-presence/shared"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
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
  type Invitation,
  type InternalLocation,
  loadInternalLocations,
  loadInvitations,
  loadMembers,
  type OrganisationMember,
  saveLocationAssignments,
  updateMember,
} from "@/lib/naba-presence-api"

function memberInitialsOf(displayName: string) {
  return displayName
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("")
}

export function SettingsTeamView() {
  const [members, setMembers] = useState<OrganisationMember[]>([])
  const [internalLocations, setInternalLocations] = useState<
    InternalLocation[]
  >([])
  const [invitations, setInvitations] = useState<Invitation[]>([])
  const [newMemberEmail, setNewMemberEmail] = useState("")
  const [newMemberRole, setNewMemberRole] =
    useState<OrganisationMember["role"]>("member")
  const [newMemberCanPublish, setNewMemberCanPublish] = useState(false)
  const [message, setMessage] = useState("")
  const [isPending, startTransition] = useTransition()
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading")
  const [reloadKey, setReloadKey] = useState(0)

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
        setStatus("ready")
      })
      .catch(() => {
        if (active) setStatus("error")
      })
    return () => {
      active = false
    }
  }, [reloadKey])

  function reload() {
    setStatus("loading")
    setReloadKey((value) => value + 1)
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
        setInvitations((current) => [{ ...invitation, inviteUrl }, ...current])
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

  return (
    <PageFrame>
      <PageHeader
        title="Team access"
        description="Invite people and scope their access by role and location."
      />
      <SettingsNav />

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
          {status === "loading" ? (
            <Skeleton className="h-48 w-full" />
          ) : status === "error" ? (
            <LiveDataError onRetry={reload} />
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

      {message ? (
        <p className="text-xs text-destructive" role="status">
          {message}
        </p>
      ) : null}
    </PageFrame>
  )
}
