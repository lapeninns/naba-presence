import { readFileSync } from "node:fs"
import { join } from "node:path"

import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import PrivacyPage from "@/app/(legal)/privacy/page"
import TermsPage from "@/app/(legal)/terms/page"
import { LEGAL_OPERATOR } from "@/lib/legal/operator"

const pageSources = [
  "app/(legal)/privacy/page.tsx",
  "app/(legal)/terms/page.tsx",
  "components/legal/legal-document.tsx",
].map((path) => readFileSync(join(process.cwd(), path), "utf8"))

describe("public legal pages", () => {
  it("never reach the session or the database", () => {
    // Google's consent screen links here; a reviewer with no account, or a
    // deployment whose database is down, must still get the page.
    for (const source of pageSources) {
      expect(source).not.toMatch(/@\/lib\/server\//)
      expect(source).not.toMatch(/getSession|withTenant|getDatabase/)
    }
  })

  it("names the permissions requested and the retention promises", () => {
    render(<PrivacyPage />)
    expect(screen.getByText("https://www.googleapis.com/auth/business.manage")).toBeInTheDocument()
    expect(screen.getByText(/at most 30 days after we last received it/)).toBeInTheDocument()
    expect(screen.getByText(/Seven days later we delete/)).toBeInTheDocument()
    expect(screen.getByText(/encrypted with AES-256-GCM/)).toBeInTheDocument()
    expect(screen.getAllByText(new RegExp(escape(LEGAL_OPERATOR.privacyEmail))).length).toBeGreaterThan(0)
  })

  it("renders the terms with the operator named", () => {
    render(<TermsPage />)
    expect(screen.getByRole("heading", { level: 1, name: "Terms of service" })).toBeInTheDocument()
    expect(screen.getByText(new RegExp(escape(LEGAL_OPERATOR.legalName)))).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Privacy policy" })).toHaveAttribute("href", "/privacy")
  })
})

function escape(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
