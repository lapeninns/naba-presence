import { readFileSync } from "node:fs"
import { join } from "node:path"

import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import * as privacyModule from "@/app/(legal)/privacy/page"
import PrivacyPage from "@/app/(legal)/privacy/page"
import * as termsModule from "@/app/(legal)/terms/page"
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
    expect(
      screen.getByText("https://www.googleapis.com/auth/business.manage")
    ).toBeInTheDocument()
    expect(
      screen.getByText(/at most 30 days after we last received it/)
    ).toBeInTheDocument()
    expect(screen.getByText(/Seven days later we delete/)).toBeInTheDocument()
    expect(screen.getByText(/encrypted with AES-256-GCM/)).toBeInTheDocument()
    // The 30-day purge clears the reviewer's photo link with the name
    // (lib/server/retention/purge.ts); the page must not promise to keep it.
    expect(
      screen.getByText(
        /reviewer profile photo links, review photos and the raw data/
      )
    ).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(
      /keep[^.]*profile photo link/i
    )
    expect(
      screen.getByText(/are never deleted while the allowance period/)
    ).toBeInTheDocument()
    expect(
      screen.getAllByText(new RegExp(escape(LEGAL_OPERATOR.privacyEmail)))
        .length
    ).toBeGreaterThan(0)
  })

  it("renders the terms with the operator named", () => {
    render(<TermsPage />)
    expect(
      screen.getByRole("heading", { level: 1, name: "Terms of service" })
    ).toBeInTheDocument()
    expect(
      screen.getByText(new RegExp(escape(LEGAL_OPERATOR.legalName)))
    ).toBeInTheDocument()
    expect(
      screen.getByRole("link", { name: "Privacy policy" })
    ).toHaveAttribute("href", "/privacy")
  })

  it("leaves out an empty registered address without stray punctuation", () => {
    const { container: privacy } = render(<PrivacyPage />)
    const { container: terms } = render(<TermsPage />)
    for (const page of [privacy, terms]) {
      const text = page.textContent ?? ""
      if (LEGAL_OPERATOR.registeredAddress === "") {
        expect(text).toContain(`operated by ${LEGAL_OPERATOR.legalName} `)
        expect(text).not.toMatch(/\(\s*\)|,\s*\(/)
      }
      expect(text).not.toMatch(/\[[A-Z ]+\]/)
    }
  })
})

describe("legal pages on a phone", () => {
  it("stay force-static", () => {
    expect(privacyModule.dynamic).toBe("force-static")
    expect(termsModule.dynamic).toBe("force-static")
  })

  it.each([
    ["Privacy policy", PrivacyPage],
    ["Terms of service", TermsPage],
  ])("%s has one main, one h1 and a skip link to the main", (title, Page) => {
    const { container } = render(<Page />)
    expect(container.querySelectorAll("main")).toHaveLength(1)
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1)
    expect(
      screen.getByRole("heading", { level: 1, name: title })
    ).toBeInTheDocument()
    const skip = screen.getByRole("link", { name: "Skip to content" })
    expect(skip).toHaveAttribute("href", "#main")
    expect(container.querySelector("main")).toHaveAttribute("id", "main")
    // The skip link comes before everything else a keyboard reaches.
    expect(container.querySelector("a")).toBe(skip)
  })

  it("lets an unbreakable scope URL wrap instead of overflowing at 320px", () => {
    render(<PrivacyPage />)
    const scope = screen.getByText(
      "https://www.googleapis.com/auth/business.manage"
    )
    expect(scope.tagName).toBe("CODE")
    // jsdom does no layout, so pin the rule that does the wrapping: the
    // article breaks long words and `code` may break anywhere (WCAG 1.4.10).
    const article = scope.closest("article")!
    expect(article.className).toMatch(/\bwrap-break-word\b/)
    expect(article.className).toMatch(/\[&_code\]:wrap-anywhere/)
  })

  it("gives the footer links a 44px touch target and marks the current page", () => {
    render(<TermsPage />)
    const nav = screen.getByRole("navigation", { name: "Legal" })
    expect(nav.closest("main")).toBeNull()
    for (const link of Array.from(nav.querySelectorAll("a"))) {
      expect(link.className).toContain("pointer-coarse:min-h-(--np-touch)")
    }
    const links = Array.from(nav.querySelectorAll("a"))
    expect(
      links.find((a) => a.textContent === "Terms of service")
    ).toHaveAttribute("aria-current", "page")
    expect(
      links.find((a) => a.textContent === "Privacy policy")
    ).not.toHaveAttribute("aria-current")
  })
})

describe("legal page contents", () => {
  // The ids are public URLs: Google reviewers and support link them.
  const PRIVACY_IDS = [
    "google-access",
    "collect",
    "retention",
    "disconnect",
    "sharing",
    "security",
    "rights",
    "children",
    "changes",
  ]
  const TERMS_IDS = [
    "accounts",
    "google",
    "content",
    "acceptable-use",
    "availability",
    "liability",
    "ending",
    "changes",
    "contact",
  ]

  it.each([
    ["Privacy policy", PrivacyPage, PRIVACY_IDS],
    ["Terms of service", TermsPage, TERMS_IDS],
  ])(
    "%s lists every section, in order, as a link to its heading",
    (_title, Page, ids) => {
      const { container } = render(<Page />)
      const nav = screen.getByRole("navigation", { name: "On this page" })
      expect(nav.closest("main")).not.toBeNull()
      const links = Array.from(nav.querySelectorAll("a"))
      const headings = Array.from(
        container.querySelectorAll("article section > h2")
      )
      expect(headings.map((h) => h.id)).toEqual(ids)
      expect(links.map((a) => a.getAttribute("href"))).toEqual(
        headings.map((h) => `#${h.id}`)
      )
      expect(links.map((a) => a.textContent)).toEqual(
        headings.map((h) => h.textContent)
      )
      for (const link of links) {
        expect(link.className).toContain("pointer-coarse:min-h-(--np-touch)")
      }
      // The contents sit before the first section and stay off paper.
      expect(
        nav.compareDocumentPosition(headings[0]) &
          Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy()
      expect(nav.className).toMatch(/\bprint:hidden\b/)
    }
  )

  it.each([
    ["Privacy policy", PrivacyPage],
    ["Terms of service", TermsPage],
  ])("%s keeps the skip link first and one h1", (title, Page) => {
    const { container } = render(<Page />)
    expect(container.querySelector("a")).toBe(
      screen.getByRole("link", { name: "Skip to content" })
    )
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1)
    expect(
      screen.getByRole("heading", { level: 1, name: title })
    ).toBeInTheDocument()
  })

  it.each([
    ["Privacy policy", PrivacyPage],
    ["Terms of service", TermsPage],
  ])("%s links the privacy email with mailto", (_title, Page) => {
    render(<Page />)
    const email = screen.getByRole("link", {
      name: LEGAL_OPERATOR.privacyEmail,
    })
    expect(email).toHaveAttribute(
      "href",
      `mailto:${LEGAL_OPERATOR.privacyEmail}`
    )
    expect(email.closest("section")).not.toBeNull()
  })
})

function escape(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

describe("assertLegalDetailsForProduction", () => {
  const placeholders = { ...LEGAL_OPERATOR, legalName: "[LEGAL ENTITY NAME]" }

  it("fails a production build while any operator detail is a placeholder", async () => {
    const { assertLegalDetailsForProduction, hasLegalPlaceholders } =
      await import("@/lib/legal/operator")
    expect(hasLegalPlaceholders(placeholders)).toBe(true)
    expect(() =>
      assertLegalDetailsForProduction(
        { VERCEL_ENV: "production" },
        placeholders
      )
    ).toThrow(/placeholder operator details/)
    // Previews and local builds render the brackets so the wording can be reviewed.
    expect(() =>
      assertLegalDetailsForProduction({ VERCEL_ENV: "preview" }, placeholders)
    ).not.toThrow()
    expect(() =>
      assertLegalDetailsForProduction({}, placeholders)
    ).not.toThrow()
  })

  it("treats an empty registered address as deliberate, not a placeholder", async () => {
    const { hasLegalPlaceholders } = await import("@/lib/legal/operator")
    expect(
      hasLegalPlaceholders({ ...LEGAL_OPERATOR, registeredAddress: "" })
    ).toBe(false)
  })

  it("lets production publish the committed operator details", async () => {
    const { assertLegalDetailsForProduction, hasLegalPlaceholders } =
      await import("@/lib/legal/operator")
    expect(hasLegalPlaceholders()).toBe(false)
    expect(() =>
      assertLegalDetailsForProduction({ VERCEL_ENV: "production" })
    ).not.toThrow()
  })
})
