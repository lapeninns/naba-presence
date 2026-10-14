// @vitest-environment node
import { renderToString } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { ThemeProvider } from "@/components/theme-provider"

// FINAL-QA #19: the dark theme must be on <html> before the first paint, not
// after hydration. next-themes does that with an inline script; it has to be
// in the server HTML, ahead of the page, and target the `class` attribute
// that globals.css's `.dark` block and `dark` variant read.
describe("ThemeProvider (FINAL-QA #19)", () => {
  const serverHtml = () =>
    renderToString(
      <ThemeProvider>
        <main>page</main>
      </ThemeProvider>
    )

  it("server-renders the blocking theme script before the page content", () => {
    const html = serverHtml()
    const script = html.indexOf("<script")
    expect(script).toBeGreaterThanOrEqual(0)
    expect(script).toBeLessThan(html.indexOf("<main>"))
  })

  it("sets the theme as a class on <html>, following the system by default", () => {
    const html = serverHtml()
    const script = html.slice(
      html.indexOf("<script"),
      html.indexOf("</script>")
    )
    expect(script).toContain('"class"')
    expect(script).toContain('"system"')
    expect(script).toContain('"light"')
    expect(script).toContain('"dark"')
  })
})
