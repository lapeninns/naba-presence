import { renderHook } from "@testing-library/react"
import { createElement, type ReactNode } from "react"
import { describe, expect, it } from "vitest"

import {
  EditorStatusProvider,
  editorStatusPill,
  useEditorStatus,
  useReportEditorStatus,
  type EditorStatusReport,
} from "@/components/editors/editor-status"

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(EditorStatusProvider, null, children)

describe("useReportEditorStatus", () => {
  it("carries the empty-on-Google words from the footer to the header pill", () => {
    const report: EditorStatusReport = {
      status: "in_sync",
      isDirty: false,
      localEdits: false,
      savesHere: true,
      emptyOnGoogle: "No hours on Google",
    }
    const { result } = renderHook(
      () => {
        useReportEditorStatus(report)
        return editorStatusPill(useEditorStatus())
      },
      { wrapper }
    )
    expect(result.current).toEqual({
      tone: "attention",
      label: "No hours on Google",
    })
  })
})
