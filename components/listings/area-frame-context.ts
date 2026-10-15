"use client"

import * as React from "react"

/**
 * True inside an area's frame (`AreaFrame`): the listing's loading state
 * then draws the editor's skeleton only, under the header that stays
 * (`app/(dashboard)/listings/[id]/loading.tsx`). Its own module, so the
 * loading boundary does not pull the whole frame into its chunk.
 */
const InAreaFrameContext = React.createContext(false)

function useInAreaFrame(): boolean {
  return React.useContext(InAreaFrameContext)
}

export { InAreaFrameContext, useInAreaFrame }
