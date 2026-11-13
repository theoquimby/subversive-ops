# Help, tours and onboarding

Everything the app explains lives in `src/help/`. Pages opt in with three
small things: a content entry, a `<HelpTip>` / `<HelpZone>`, and `data-tour`
attributes.

## 1. Add a help entry

Content is plain data in `src/help/areas/*.ts`, collected by `content.ts`.

```ts
{
  id: "labor.payroll.export",      // stable: area.section.control — never rename one in use
  area: "labor",                   // a HelpAreaId (add new areas to types.ts + AREAS in content.ts)
  route: "/labor",
  title: "Payroll export",
  body: "1–3 short sentences. Shown in the popover.",
  article: `Optional longer text for /help/<id>.

- bullets, 1. steps, ### headings, **bold**, \`code\`, [links](/route)`,
  related: ["labor.overtime"],     // must exist (a test checks)
  tour: "labor",                   // optional: shows "Show me" on the article
  audience: "all",                 // default "manager"; "all" lets staff read it
  keywords: ["payroll", "adp"],
}
```

Entries for pages still being built are in `areas/upcoming.ts` with
`draft: true` ("Coming soon" in the help center). When your page ships,
correct the wording against the real UI and drop the flag.

Run `npx vitest run src/help` — it checks ids are unique, links resolve and
popover text stays short.

## 2. Put help on the page

```tsx
import { HelpTip, HelpZone } from "@/components/help";

<Th><span className="inline-flex items-center gap-1">Overtime <HelpTip id="labor.overtime" /></span></Th>

<HelpZone id="labor.timecards" tour="labor.timecards">
  <Section title="Timecards">…</Section>
</HelpZone>
```

- `<HelpTip id>` — a quiet "?" (16px, 40px touch target). Hover/focus on
  desktop, tap on touch, Esc closes. Works in server components.
- `<HelpZone id tour? className?>` — a plain `div` until help mode is on
  (press `?`), then it's outlined and explains itself on hover/tap. Clicks
  inside are swallowed in help mode. `tour` also sets `data-tour`. If the
  zone is a grid item, pass the grid classes via `className`.
- Unknown ids render nothing (and warn in dev).

## 3. Tour targets and tours

Add `data-tour="area.thing"` to anything a tour should point at (`Card`,
`LinkButton`, `Button` and plain elements pass it through; `Section`, `Table`,
`Th` and `Field` don't — wrap them in `HelpZone` or a `div`).

Tours live in `src/help/tours.ts`:

```ts
{ route: "/labor", target: "labor.timecards", title: "Timecards", body: "…", helpId: "labor.timecards" },
{ routeFrom: "labor.employee-link", target: "labor.detail", … },   // follow the first matching link
{ selector: 'input[data-grid="tc"][data-col="hours"]', … },        // CSS selector for markup you don't own
{ title: "No target", body: "Centered card" },
{ target: "maybe.missing", ifMissing: "skip", … },                 // skip instead of centering
```

The first *visible* match is used, so a column hidden on phones falls back to
a centered card. Map the page in `tourForPath()` so "Tour this page" finds it.

Start a tour from code with `useTour().start(id)` (or `startTour(id)`), or
link to `?tour=<id>` on any page (`/help?tour=<id>` works even without the
provider). `?help=1` turns help mode on.

## 4. Onboarding

`onboardingState()` from `@/server/services/onboarding` returns
`{ steps, done, total, complete, firstRun, dismissed, href }` for a
"Finish setting up (3 of 8)" card. Progress is stored in Setting
`onboarding.progress`; `dismissSetupCard()` in `app/(app)/welcome/actions.ts`
hides the card.
