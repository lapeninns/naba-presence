"use client"

import * as React from "react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { OverlayCancel } from "@/components/ui/overlay"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"

/** A dialog or sheet with a ✕: the confirm is the footer's one primary. */
function ConfirmWithClose() {
  return (
    <Dialog>
      <DialogTrigger render={<Button variant="secondary" />}>
        Dialog with a ✕
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename this listing</DialogTitle>
          <DialogDescription>
            The name inside NabaPresence only. Google keeps its own.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <Field>
            <FieldLabel>Name</FieldLabel>
            <Input defaultValue="The Bell" />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button>Save name</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** The one case that keeps a Cancel: an overlay that has no ✕. */
function ConfirmWithoutClose() {
  return (
    <Dialog>
      <DialogTrigger render={<Button variant="secondary" />}>
        Dialog with no ✕
      </DialogTrigger>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Send this reply</DialogTitle>
          <DialogDescription>
            It goes to Google straight away and shows under the business name.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <OverlayCancel />
          <Button>Send reply</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ConfirmSheet() {
  return (
    <Sheet>
      <SheetTrigger render={<Button variant="secondary" />}>Sheet</SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Filters</SheetTitle>
          <SheetDescription>
            Slides from the right; from the bottom on a phone, with a grabber.
          </SheetDescription>
        </SheetHeader>
        <SheetBody>
          <Field>
            <FieldLabel>Reviewer name</FieldLabel>
            <Input />
          </Field>
        </SheetBody>
        <SheetFooter>
          <Button>Show results</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

function MenuSheet() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="secondary" />}>
        Menu
      </DropdownMenuTrigger>
      <DropdownMenuContent title="Reply actions">
        <DropdownMenuItem>Copy reply</DropdownMenuItem>
        <DropdownMenuItem>Mark as reviewed</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function SelectSheet() {
  return (
    <Select defaultValue="immediately">
      <SelectTrigger aria-label="Email: New review" className="w-52">
        <SelectValue />
      </SelectTrigger>
      <SelectContent title="Email: New review">
        <SelectItem value="immediately">Immediately</SelectItem>
        <SelectItem value="daily">Daily summary</SelectItem>
        <SelectItem value="off">Off</SelectItem>
      </SelectContent>
    </Select>
  )
}

/**
 * One overlay anatomy (P03): every dialog, sheet, menu sheet and select
 * sheet has a left-aligned title, a ✕ opposite it and, on a phone, a grabber.
 * The confirm is the footer's one primary. There is no Cancel beside the ✕;
 * `OverlayCancel` draws one only for an overlay with no ✕.
 */
export function UxP03Demo() {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-ui text-ink-muted">
        One recipe: a left title, a ✕, the confirm as the footer primary and no
        Cancel beside the ✕. On a phone every sheet, including the menu and
        select sheets, carries a grabber, and a select sheet always says which
        field its options belong to.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <ConfirmWithClose />
        <ConfirmWithoutClose />
        <ConfirmSheet />
        <MenuSheet />
        <SelectSheet />
      </div>
    </div>
  )
}
