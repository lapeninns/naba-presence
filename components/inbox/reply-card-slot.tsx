"use client"

import { createContext, useContext, type ReactNode } from "react"

const ReplyCardSlotContext = createContext<ReactNode>(null)

function ReplyCardSlotProvider({
  value,
  children,
}: {
  value: ReactNode
  children: ReactNode
}) {
  return (
    <ReplyCardSlotContext.Provider value={value}>
      {children}
    </ReplyCardSlotContext.Provider>
  )
}

function useReplyCardSlot(): ReactNode {
  return useContext(ReplyCardSlotContext)
}

export { ReplyCardSlotProvider, useReplyCardSlot }
