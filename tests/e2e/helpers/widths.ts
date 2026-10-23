// The isolated backend specs used to repeat every state journey at 375, 768
// and 1280px. Width changes the layout, not the state machine under test, so
// each journey now runs once, at JOURNEY_WIDTH, and every phone and tablet
// width gets one short layout check per screen instead.
//
// A layout check asserts what width really changes: the screen's own axe scan,
// no horizontal overflow (the capture helpers) and, where a surface is built
// differently, that surface's own markup. The journeys' captures already make
// the axe and overflow assertions at JOURNEY_WIDTH, so it needs no check of
// its own.

/** Wide enough that the desktop dialogs, toolbars and tables are the ones under test. */
export const JOURNEY_WIDTH = 1280
/** The widths that get a layout check of their own. */
export const LAYOUT_WIDTHS = [375, 768] as const
/** The same tall viewport at every width, so only the width varies. */
export const viewportAt = (width: number) => ({ width, height: 1100 })
