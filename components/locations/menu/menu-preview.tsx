import { Empty } from "@/components/ui/empty"
import { currencySymbol, readLabel, readPrice, type EditorMenu } from "@/lib/locations/forms/menu-editor"

/** A draft preview, not a promise about Google's final layout or extra options. */
export function MenuPreview({ menu }: { menu: EditorMenu }) {
  const label = readLabel(menu.data)
  return (
    <section aria-label="Menu preview" className="mx-auto flex w-full max-w-3xl flex-col gap-8 rounded-(--np-radius-card) bg-surface p-(--np-card-pad) sm:p-8">
      <header className="flex flex-col gap-2 border-b border-line-subtle pb-6">
        <h3 className="break-words text-page-title font-semibold text-ink">{label.displayName || "Untitled menu"}</h3>
        {label.description ? <p className="text-body whitespace-pre-line text-ink-muted">{label.description}</p> : null}
        <p className="text-caption text-ink-muted">Draft preview only. Google may display the menu differently. Additional options and translations are preserved, but not shown here.</p>
      </header>
      {menu.sections.length ? menu.sections.map((section) => {
        const sectionLabel = readLabel(section.data)
        return (
          <section key={section.id} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <h4 className="break-words text-section font-semibold text-ink">{sectionLabel.displayName || "Untitled section"}</h4>
              {sectionLabel.description ? <p className="text-body whitespace-pre-line text-ink-muted">{sectionLabel.description}</p> : null}
            </div>
            <ul className="flex flex-col gap-5">
              {section.items.map((item) => {
                const itemLabel = readLabel(item.data)
                const price = readPrice(item.data)
                return (
                  <li key={item.id} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-1">
                    <p className="break-words text-body font-medium text-ink">{itemLabel.displayName || "Untitled item"}</p>
                    {price ? <p className="break-all text-body text-ink tabular-nums">{currencySymbol(item.currencyCode)}{price} <span className="text-caption text-ink-muted">{item.currencyCode}</span></p> : <span />}
                    {itemLabel.description ? <p className="col-span-2 text-body whitespace-pre-line text-ink-muted">{itemLabel.description}</p> : null}
                  </li>
                )
              })}
            </ul>
            {!section.items.length ? <p className="text-body text-ink-muted">No items in this section.</p> : null}
          </section>
        )
      }) : <Empty title="Your preview is empty" description="Switch to Edit menu and add your first section." />}
    </section>
  )
}
