import {
  Menubar,
  MenubarCheckboxItem,
  MenubarContent,
  MenubarGroup,
  MenubarItem,
  MenubarLabel,
  MenubarMenu,
  MenubarRadioGroup,
  MenubarRadioItem,
  MenubarSeparator,
  MenubarShortcut,
  MenubarSub,
  MenubarSubContent,
  MenubarSubTrigger,
  MenubarTrigger,
} from "NabaReview"

// The bar is inline; each menu's popup portals to the body and anchors under
// its own trigger. Popups size to the trigger, so give the content an explicit
// `min-w-*`. `MenubarLabel` is Base UI's GroupLabel — it THROWS outside a
// `MenubarGroup`/`MenubarRadioGroup` and takes the whole story down with it.

function ReviewsMenuDef() {
  return (
    <MenubarMenu>
      <MenubarTrigger>Reviews</MenubarTrigger>
      <MenubarContent className="min-w-56">
        <MenubarItem>Reply queue</MenubarItem>
        <MenubarItem>Escalations</MenubarItem>
        <MenubarItem>Drafts</MenubarItem>
      </MenubarContent>
    </MenubarMenu>
  )
}

function ReportsMenuDef() {
  return (
    <MenubarMenu>
      <MenubarTrigger>Reports</MenubarTrigger>
      <MenubarContent className="min-w-56">
        <MenubarItem>Response rate</MenubarItem>
        <MenubarItem>Rating trend</MenubarItem>
      </MenubarContent>
    </MenubarMenu>
  )
}

function LocationsMenuDef() {
  return (
    <MenubarMenu>
      <MenubarTrigger>Locations</MenubarTrigger>
      <MenubarContent className="min-w-56">
        <MenubarItem>Central</MenubarItem>
        <MenubarItem>Riverside</MenubarItem>
        <MenubarItem>Airport</MenubarItem>
      </MenubarContent>
    </MenubarMenu>
  )
}

function HelpMenuDef() {
  return (
    <MenubarMenu>
      <MenubarTrigger>Help</MenubarTrigger>
      <MenubarContent className="min-w-56">
        <MenubarItem>Keyboard shortcuts</MenubarItem>
        <MenubarItem>Contact support</MenubarItem>
      </MenubarContent>
    </MenubarMenu>
  )
}

export function AppChrome() {
  return (
    <div className="flex w-full max-w-md flex-col gap-3">
      <Menubar className="w-fit">
        <ReviewsMenuDef />
        <LocationsMenuDef />
        <ReportsMenuDef />
        <HelpMenuDef />
      </Menubar>
      <p className="text-sm text-muted-foreground">
        Desktop chrome for the NabaReview console. At rest the bar is four
        triggers; the open one takes a muted fill.
      </p>
    </div>
  )
}

export function ReviewsMenu() {
  return (
    <div className="flex w-full max-w-md flex-col gap-3">
      <Menubar className="w-fit">
        <MenubarMenu defaultOpen>
          <MenubarTrigger>Reviews</MenubarTrigger>
          <MenubarContent className="min-w-56">
            <MenubarItem>
              Reply queue
              <MenubarShortcut className="font-mono">⌘1</MenubarShortcut>
            </MenubarItem>
            <MenubarItem>
              Escalations
              <MenubarShortcut className="font-mono">⌘2</MenubarShortcut>
            </MenubarItem>
            <MenubarItem>
              Drafts
              <MenubarShortcut className="font-mono">⌘3</MenubarShortcut>
            </MenubarItem>
            <MenubarSeparator />
            <MenubarItem>
              Sync from Google now
              <MenubarShortcut className="font-mono">⌘S</MenubarShortcut>
            </MenubarItem>
            <MenubarSeparator />
            <MenubarItem variant="destructive">Discard all drafts</MenubarItem>
          </MenubarContent>
        </MenubarMenu>
        <LocationsMenuDef />
        <ReportsMenuDef />
        <HelpMenuDef />
      </Menubar>
    </div>
  )
}

export function ViewOptions() {
  return (
    <div className="flex w-full max-w-md flex-col gap-3">
      <Menubar className="w-fit">
        <ReviewsMenuDef />
        <LocationsMenuDef />
        <MenubarMenu defaultOpen>
          <MenubarTrigger>Reports</MenubarTrigger>
          <MenubarContent className="min-w-56">
            <MenubarRadioGroup value="90d">
              <MenubarLabel>Window</MenubarLabel>
              <MenubarRadioItem value="30d">Last 30 days</MenubarRadioItem>
              <MenubarRadioItem value="90d">Last 90 days</MenubarRadioItem>
              <MenubarRadioItem value="ytd">Year to date</MenubarRadioItem>
            </MenubarRadioGroup>
            <MenubarSeparator />
            <MenubarGroup>
              <MenubarCheckboxItem checked>Compare locations</MenubarCheckboxItem>
              <MenubarCheckboxItem>Include unreplied</MenubarCheckboxItem>
            </MenubarGroup>
          </MenubarContent>
        </MenubarMenu>
        <HelpMenuDef />
      </Menubar>
    </div>
  )
}

export function LocationSubmenu() {
  return (
    <div className="flex w-full max-w-md flex-col gap-3">
      <Menubar className="w-fit">
        <ReviewsMenuDef />
        <MenubarMenu defaultOpen>
          <MenubarTrigger>Locations</MenubarTrigger>
          <MenubarContent className="min-w-56">
            <MenubarItem>All locations</MenubarItem>
            <MenubarSeparator />
            <MenubarSub defaultOpen>
              <MenubarSubTrigger>Central</MenubarSubTrigger>
              <MenubarSubContent className="min-w-48">
                <MenubarItem>Open reply queue</MenubarItem>
                <MenubarItem>Profile settings</MenubarItem>
                <MenubarItem>Disconnect profile</MenubarItem>
              </MenubarSubContent>
            </MenubarSub>
            <MenubarItem>Riverside</MenubarItem>
            <MenubarItem>Airport</MenubarItem>
          </MenubarContent>
        </MenubarMenu>
        <ReportsMenuDef />
        <HelpMenuDef />
      </Menubar>
    </div>
  )
}
