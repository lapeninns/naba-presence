import { render } from "@testing-library/react"
import {
  useState,
  type Dispatch,
  type ReactElement,
  type SetStateAction,
} from "react"

import type { BusinessInformationDraft } from "@/lib/locations/google-values"

export const emptyDraft: BusinessInformationDraft = {
  title: "The Old Crown",
  description: "",
  primaryPhone: "",
  websiteUri: "",
  openStatus: "OPEN",
  storeCode: "",
  labels: [],
  primaryCategory: null,
  additionalCategories: [],
  addressLines: [],
  locality: "",
  postalCode: "",
  regionCode: "GB",
}

/**
 * Holds the editable draft the profile page holds and passes a profile section
 * its `draft` and `setDraft`. `latest()` is the draft the page would publish
 * from: what the section left in state after the last interaction.
 */
export function renderWithDraft(
  initial: BusinessInformationDraft,
  section: (
    draft: BusinessInformationDraft,
    setDraft: Dispatch<SetStateAction<BusinessInformationDraft>>
  ) => ReactElement
) {
  let latest = initial
  function Host() {
    const [draft, setDraft] = useState(initial)
    latest = draft
    return section(draft, setDraft)
  }
  const rendered = render(<Host />)
  return { ...rendered, latest: () => latest }
}
