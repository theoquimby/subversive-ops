"use client";

import { DataTable, DetailRow, type Column, type Filter } from "@/components/data-table";
import { GridCell, GridSelect } from "@/components/grid";
import { HelpTip, HelpZone } from "@/components/help";
import { Badge, Button, Card, cx, DatePicker, LinkButton, Section, Table, Td, Textarea, Th, Tr } from "@/components/ui";
import { beerColor } from "@/domain/kegs";
import type { BoardPour } from "@/domain/taps";
import { BEER_FAMILIES, guessFamily, isDraftBeerCategory, placementOf, type MenuRecipeIn, type MenuWarning, type SectionMetaIn } from "@/domain/websiteMenu";
import { MENU_TAGS, type MenuTag, type WebMenu } from "@/domain/websiteSchema";
import { money, shortDate } from "@/lib/format";
import { ChevronRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { saveMenuNotices, setBeerWebField, setManyOnWebsite, setMenuItemField, setSectionField } from "../actions";

type Row = MenuRecipeIn & { place: "food" | "drinks"; section: string; sectionId: string };

const TAG_LABEL: Record<MenuTag, string> = { vegetarian: "Vegetarian", vegan: "Vegan", "kid-friendly": "Kid-friendly", "dog-friendly": "Dog-friendly" };
const YES_NO = [{ value: "true", label: "Yes" }, { value: "false", label: "No" }];
const PLACES = [{ value: "", label: "Guess" }, { value: "food", label: "Food" }, { value: "drinks", label: "Drinks" }];

const windowText = (from: string | null | undefined, until: string | null | undefined) => (from && until ? `${shortDate(from)} to ${shortDate(until)}` : from ? `From ${shortDate(from)}` : until ? `Until ${shortDate(until)}` : "");

export interface TapView {
  line: number;
  beerId: string | null;
  beer: string;
  style: string | null;
  abv: number | null;
  color: string;
  house: boolean;
  pours: BoardPour[];
}

export function MenuTab(p: {
  recipes: MenuRecipeIn[];
  sections: SectionMetaIn[];
  taps: TapView[];
  tapWeb: { beerId: string; web: { onWebsite: boolean; family: string | null; badge: string | null; hazy: boolean } | null }[];
  notices: string[];
  menu: WebMenu;
  warnings: MenuWarning[];
}) {
  const rows: Row[] = useMemo(() => p.recipes.filter((r) => !isDraftBeerCategory(r.category)).map((r) => ({ ...r, ...placementOf(r) })), [p.recipes]);
  const used = useMemo(() => {
    const m = new Map<string, { id: string; title: string; place: "food" | "drinks"; n: number }>();
    for (const r of rows) if (r.web?.onWebsite && r.active) m.set(r.sectionId, { id: r.sectionId, title: r.section, place: r.place, n: (m.get(r.sectionId)?.n ?? 0) + 1 });
    return [...m.values()];
  }, [rows]);

  return (
    <>
      {p.warnings.length > 0 && (
        <Card className="mb-6 border-warn/40 p-4">
          <div className="text-sm font-medium text-warn">{p.warnings.length} thing{p.warnings.length === 1 ? "" : "s"} to check</div>
          <ul className="mt-2 space-y-1 text-sm">
            {p.warnings.slice(0, 8).map((w) => (
              <li key={w.id}><span className="font-medium">{w.name}</span> <span className="text-muted">: {w.message}</span></li>
            ))}
          </ul>
        </Card>
      )}

      <HelpZone id="website.menu.items" tour="website.menu">
        <Section title="Food and drinks" description="Menu items and add-ons from Menu costs. Turn on the ones guests should see, then give each a web name, a line of description and tags. Prices come from Menu costs.">
          <ItemsTable rows={rows} />
        </Section>
      </HelpZone>

      {used.length > 0 && (
        <HelpZone id="website.menu.sections">
          <Section title="Sections" description="The headings on the website menu, in order. A section is the item's category unless you type another.">
            <div className="grid gap-3 md:grid-cols-2">
              {used.map((s) => <SectionCard key={s.id} s={s} meta={p.sections.find((m) => m.id === s.id)} />)}
            </div>
          </Section>
        </HelpZone>
      )}

      <HelpZone id="website.menu.beer" tour="website.beer">
        <Section
          title="Draft beer"
          description="What's on tap, straight from the tap list. Style, ABV, description and prices come from Kegs → Beers; the website groups beers by family for its filters."
          actions={<LinkButton href="/kegs/beers" variant="ghost" size="sm" className="hidden sm:inline-flex">Beers <ChevronRight className="size-4" /></LinkButton>}
        >
          <BeerTable taps={p.taps} tapWeb={p.tapWeb} />
        </Section>
      </HelpZone>

      <Section title="Notes under the menu" description="One per line, like the allergy note.">
        <NoticesEditor initial={p.notices} />
      </Section>

      <HelpZone id="website.menu.preview">
        <Section title="Preview" description={`How the menu reads on the website (updated ${shortDate(p.menu._meta.updated)}). Seasonal items show only inside their dates.`}>
          <MenuPreview menu={p.menu} />
        </Section>
      </HelpZone>
    </>
  );
}

// ---- Items ----------------------------------------------------------------------------

function TagCell({ row }: { row: Row }) {
  const router = useRouter();
  const [tags, setTags] = useState<string[]>(row.web?.tags ?? []);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const toggle = (t: MenuTag) => {
    const next = tags.includes(t) ? tags.filter((x) => x !== t) : [...tags, t];
    setTags(next);
    start(async () => {
      const r = await setMenuItemField(row.id, "tags", next.join(","));
      if (r.error) {
        setError(r.error);
        setTags(tags);
      } else router.refresh();
    });
  };
  return (
    <div className="flex flex-wrap gap-1 px-1 py-1" aria-busy={pending}>
      {MENU_TAGS.map((t) => (
        <button key={t} type="button" aria-pressed={tags.includes(t)} onClick={() => toggle(t)} className={cx("inline-flex h-8 items-center rounded-md border px-2 text-xs transition-colors sm:h-7", tags.includes(t) ? "border-ink bg-ink text-surface" : "border-border text-muted hover:text-ink")}>
          {TAG_LABEL[t]}
        </button>
      ))}
      {error && <span className="text-xs text-bad">{error}</span>}
    </div>
  );
}

function DateCell({ row, field }: { row: Row; field: "availableFrom" | "availableUntil" }) {
  const router = useRouter();
  const [v, setV] = useState(row.web?.[field] ?? "");
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();
  const save = (next: string) => {
    setV(next);
    start(async () => {
      const r = await setMenuItemField(row.id, field, next);
      if (r.error) setError(r.error);
      else {
        setError(null);
        router.refresh();
      }
    });
  };
  return (
    <div>
      <div className="flex items-center gap-2">
        <DatePicker value={v} onChange={(e) => save(e.target.value)} aria-label={field === "availableFrom" ? "Shows from" : "Shows until"} />
        {v && <Button size="sm" variant="ghost" onClick={() => save("")}>Clear</Button>}
      </div>
      {error && <div className="mt-1 text-xs text-bad">{error}</div>}
    </div>
  );
}

function ItemsTable({ rows }: { rows: Row[] }) {
  const columns = useMemo<Column<Row>[]>(
    () => [
      {
        id: "name",
        header: "Item",
        width: 200,
        hideable: false,
        sort: (r) => r.name,
        csv: (r) => r.name,
        cell: (r) => (
          <div className="min-w-0">
            <div className={cx("font-medium", !r.active && "text-muted line-through")}>{r.name}</div>
            <div className="text-xs text-muted">{r.kind === "MODIFIER" ? "Add-on" : r.category}{r.menuPrice != null ? ` · ${money(r.menuPrice)}` : ""}</div>
          </div>
        ),
      },
      { id: "on", header: "On website", help: "website.menu.on", edit: true, width: 120, sort: (r) => (r.web?.onWebsite ? 1 : 0), csv: (r) => (r.web?.onWebsite ? "yes" : "no"), cell: (r) => <GridSelect value={r.web?.onWebsite ? "true" : "false"} options={YES_NO} ariaLabel={`${r.name} on the website`} onSave={(v) => setMenuItemField(r.id, "onWebsite", v)} /> },
      { id: "webName", header: "Name on the website", edit: true, width: 180, sort: (r) => r.web?.name ?? "", csv: (r) => r.web?.name, cell: (r) => <GridCell grid="web-menu" col="name" value={r.web?.name ?? ""} placeholder={r.name} ariaLabel={`Website name for ${r.name}`} onSave={(v) => setMenuItemField(r.id, "name", v)} /> },
      { id: "description", header: "Description", edit: true, width: 280, sort: (r) => r.web?.description ?? "", csv: (r) => r.web?.description, cell: (r) => <GridCell grid="web-menu" col="description" value={r.web?.description ?? ""} placeholder="One line, as printed on the menu" ariaLabel={`Description of ${r.name}`} onSave={(v) => setMenuItemField(r.id, "description", v)} /> },
      { id: "tags", header: "Tags", width: 330, sort: (r) => (r.web?.tags ?? []).join(","), csv: (r) => (r.web?.tags ?? []).join(" "), cell: (r) => <TagCell row={r} /> },
      { id: "badge", header: "Badge", edit: true, width: 120, sort: (r) => r.web?.badge ?? "", csv: (r) => r.web?.badge, cell: (r) => <GridCell grid="web-menu" col="badge" value={r.web?.badge ?? ""} placeholder="e.g. New" ariaLabel={`Badge for ${r.name}`} onSave={(v) => setMenuItemField(r.id, "badge", v)} /> },
      { id: "section", header: "Section", help: "website.menu.sections", edit: true, width: 170, sort: (r) => r.section, csv: (r) => r.section, cell: (r) => <GridCell grid="web-menu" col="section" value={r.web?.section ?? ""} placeholder={r.category} ariaLabel={`Section for ${r.name}`} onSave={(v) => setMenuItemField(r.id, "section", v)} /> },
      { id: "sort", header: "Order", align: "right", edit: true, width: 80, firstDir: "asc", sort: (r) => r.web?.sort ?? 0, csv: (r) => r.web?.sort, cell: (r) => <GridCell grid="web-menu" col="sort" type="number" value={r.web?.sort ?? 0} ariaLabel={`Order of ${r.name}`} onSave={(v) => setMenuItemField(r.id, "sort", v)} /> },
      { id: "place", header: "Food or drinks", edit: true, width: 130, defaultHidden: true, sort: (r) => r.place, csv: (r) => r.place, cell: (r) => <GridSelect value={r.web?.place ?? ""} options={PLACES} ariaLabel={`Food or drinks for ${r.name}`} onSave={(v) => setMenuItemField(r.id, "place", v)} /> },
      { id: "season", header: "Seasonal", width: 150, defaultHidden: true, sort: (r) => r.web?.availableFrom ?? r.web?.availableUntil ?? "", csv: (r) => windowText(r.web?.availableFrom, r.web?.availableUntil), cell: (r) => <span className="px-2 text-sm text-ink-2">{windowText(r.web?.availableFrom, r.web?.availableUntil) || <span className="text-muted">All year</span>}</span> },
    ],
    [],
  );
  const filters = useMemo<Filter<Row>[]>(
    () => [
      { id: "on", label: "On the website", kind: "toggle", test: (r) => !!r.web?.onWebsite, param: "on" },
      { id: "place", label: "Food or drinks", kind: "facet", single: true, display: "segmented", allLabel: "All", values: (r) => r.place, options: [{ value: "food", label: "Food" }, { value: "drinks", label: "Drinks" }] },
      { id: "kind", label: "Type", kind: "facet", values: (r) => (r.kind === "MODIFIER" ? "addon" : "item"), options: [{ value: "item", label: "Menu items" }, { value: "addon", label: "Add-ons" }] },
      { id: "nodesc", label: "No description", kind: "toggle", tone: "warn", test: (r) => !!r.web?.onWebsite && !r.web.description },
      { id: "active", label: "Status", kind: "facet", single: true, values: (r) => (r.active ? "active" : "archived"), options: [{ value: "active", label: "Active" }, { value: "archived", label: "Archived" }] },
    ],
    [],
  );
  return (
    <DataTable
      id="website-menu"
      rows={rows}
      rowKey={(r) => r.id}
      columns={columns}
      noun={["item", "items"]}
      searchText={(r) => `${r.name} ${r.web?.name ?? ""} ${r.category} ${r.section} ${r.web?.description ?? ""}`}
      searchPlaceholder="Search the menu"
      filters={filters}
      defaultView={{ filters: { active: ["active"] } }}
      csvName="website-menu"
      urlSearch={false}
      help="website.menu.items"
      summary={(vis) => [
        { value: vis.length, label: vis.length === 1 ? "item" : "items" },
        { value: vis.filter((r) => r.web?.onWebsite).length, label: "on the website", filter: { id: "on" } },
        ...(vis.some((r) => r.web?.onWebsite && !r.web.description) ? [{ value: vis.filter((r) => r.web?.onWebsite && !r.web.description).length, label: "without a description", tone: "warn" as const, filter: { id: "nodesc" } }] : []),
      ]}
      bulkActions={(api) => (
        <>
          <button type="button" disabled={api.pending} className="inline-flex h-8 items-center rounded-lg border border-border-strong px-2.5 text-sm font-medium hover:bg-surface-2 disabled:opacity-50" onClick={() => api.run(() => setManyOnWebsite(api.keys, true))}>Put on website</button>
          <button type="button" disabled={api.pending} className="inline-flex h-8 items-center rounded-lg px-2.5 text-sm font-medium hover:bg-surface-2 disabled:opacity-50" onClick={() => api.run(() => setManyOnWebsite(api.keys, false))}>Take off</button>
        </>
      )}
      card={(r) => ({
        title: r.web?.name || r.name,
        subtitle: [r.section, r.web?.description].filter(Boolean).join(" · ") || r.category,
        value: r.web?.onWebsite ? <Badge tone="good">On site</Badge> : <span className="text-xs text-muted">Off</span>,
        sub: r.menuPrice != null ? money(r.menuPrice) : undefined,
      })}
      drawerTitle={(r) => r.name}
      drawer={(r) => <ItemDrawer r={r} />}
      empty={<p className="p-6 text-sm text-muted">No menu items yet. Add recipes on Menu costs.</p>}
    />
  );
}

function ItemDrawer({ r }: { r: Row }) {
  return (
    <div className="divide-y divide-border">
      <DetailRow label="On the website"><GridSelect value={r.web?.onWebsite ? "true" : "false"} options={YES_NO} ariaLabel="On the website" onSave={(v) => setMenuItemField(r.id, "onWebsite", v)} /></DetailRow>
      <DetailRow label="Name on the website"><GridCell grid="web-menu-d" col="name" value={r.web?.name ?? ""} placeholder={r.name} ariaLabel="Name on the website" onSave={(v) => setMenuItemField(r.id, "name", v)} /></DetailRow>
      <DetailRow label="Description"><GridCell grid="web-menu-d" col="description" value={r.web?.description ?? ""} placeholder="One line, as printed on the menu" ariaLabel="Description" onSave={(v) => setMenuItemField(r.id, "description", v)} /></DetailRow>
      <DetailRow label="Extras line"><GridCell grid="web-menu-d" col="modifiers" value={r.web?.modifiers ?? ""} placeholder="e.g. Add bacon +3" ariaLabel="Extras line" onSave={(v) => setMenuItemField(r.id, "modifiers", v)} /></DetailRow>
      <DetailRow label="Tags"><TagCell row={r} /></DetailRow>
      <DetailRow label="Badge"><GridCell grid="web-menu-d" col="badge" value={r.web?.badge ?? ""} placeholder="e.g. New" ariaLabel="Badge" onSave={(v) => setMenuItemField(r.id, "badge", v)} /></DetailRow>
      <DetailRow label="Price"><div className="flex items-center gap-2"><span className="num text-sm">{r.menuPrice != null ? money(r.menuPrice) : "No price"}</span><GridSelect value={r.web?.showPrice === false ? "false" : "true"} options={[{ value: "true", label: "Show it" }, { value: "false", label: "Hide it" }]} ariaLabel="Show the price" onSave={(v) => setMenuItemField(r.id, "showPrice", v)} /></div></DetailRow>
      <DetailRow label="Section"><GridCell grid="web-menu-d" col="section" value={r.web?.section ?? ""} placeholder={r.category} ariaLabel="Section" onSave={(v) => setMenuItemField(r.id, "section", v)} /></DetailRow>
      <DetailRow label="Food or drinks"><GridSelect value={r.web?.place ?? ""} options={PLACES} ariaLabel="Food or drinks" onSave={(v) => setMenuItemField(r.id, "place", v)} /></DetailRow>
      <DetailRow label="Order"><GridCell grid="web-menu-d" col="sort" type="number" value={r.web?.sort ?? 0} ariaLabel="Order in its section" onSave={(v) => setMenuItemField(r.id, "sort", v)} /></DetailRow>
      <DetailRow label={<span className="inline-flex items-center gap-1">Shows from <HelpTip id="website.menu.seasonal" /></span>}><DateCell row={r} field="availableFrom" /></DetailRow>
      <DetailRow label="Shows until"><DateCell row={r} field="availableUntil" /></DetailRow>
    </div>
  );
}

// ---- Sections -----------------------------------------------------------------------

function SectionCard({ s, meta }: { s: { id: string; title: string; place: "food" | "drinks"; n: number }; meta: SectionMetaIn | undefined }) {
  const save = (field: "title" | "intro" | "note" | "modifiers" | "sort") => (v: string) => setSectionField(s.id, s.title, s.place, field, v);
  return (
    <Card className="p-3">
      <div className="flex items-center justify-between gap-2 px-1">
        <span className="text-xs text-muted">{s.place === "food" ? "Food" : "Drinks · Other beverages"} · {s.n} item{s.n === 1 ? "" : "s"}</span>
        <div className="flex w-24 items-center gap-1 text-xs text-muted">Order<GridCell grid="web-sections" col="sort" type="number" value={meta?.sort ?? 0} ariaLabel={`Order of ${s.title}`} onSave={save("sort")} /></div>
      </div>
      <GridCell grid="web-sections" col="title" value={meta?.title ?? s.title} ariaLabel={`Heading for ${s.title}`} onSave={save("title")} className="font-medium" />
      <GridCell grid="web-sections" col="intro" value={meta?.intro ?? ""} placeholder={s.place === "food" ? "Intro line (optional)" : "Note (optional)"} ariaLabel={`Intro for ${s.title}`} onSave={save(s.place === "food" ? "intro" : "note")} />
      {s.place === "food" && <GridCell grid="web-sections" col="modifiers" value={meta?.modifiers ?? ""} placeholder="Extras for the whole section (optional)" ariaLabel={`Extras for ${s.title}`} onSave={save("modifiers")} />}
    </Card>
  );
}

// ---- Beer ---------------------------------------------------------------------------

function BeerTable({ taps, tapWeb }: { taps: TapView[]; tapWeb: { beerId: string; web: { onWebsite: boolean; family: string | null; badge: string | null; hazy: boolean } | null }[] }) {
  if (!taps.length) return <Card className="p-6 text-sm text-muted">Nothing is on tap in Kegs right now, so the website shows no draft list.</Card>;
  const fam = [{ value: "", label: "Guess" }, ...BEER_FAMILIES.map((f) => ({ value: f, label: f }))];
  return (
    <Table>
      <thead>
        <tr>
          <Th className="w-12">Tap</Th>
          <Th>Beer</Th>
          <Th className="hidden md:table-cell">Pours</Th>
          <Th><span className="inline-flex items-center gap-1">Family <HelpTip id="website.menu.family" /></span></Th>
          <Th className="hidden sm:table-cell">Badge</Th>
          <Th className="hidden lg:table-cell">Hazy</Th>
          <Th>On site</Th>
        </tr>
      </thead>
      <tbody>
        {taps.map((t) => {
          const w = tapWeb.find((x) => x.beerId === t.beerId)?.web ?? null;
          const missing = [!t.style && "style", t.abv == null && "ABV", t.pours.filter((x) => x.oz).length < 2 && "two prices"].filter(Boolean);
          const guess = guessFamily(t.style, t.beer);
          return (
            <Tr key={t.line}>
              <Td className="num py-2 text-muted">{t.line}</Td>
              <Td className="py-2">
                <div className="flex items-center gap-2">
                  <span aria-hidden className="size-3 shrink-0 rounded-full ring-1 ring-border" style={{ background: beerColor(t.color).bg }} />
                  <span className="font-medium">{t.beer}</span>
                  {!t.house && <Badge>Guest</Badge>}
                </div>
                <div className="text-xs text-muted">{[t.style, t.abv != null ? `${t.abv}%` : null].filter(Boolean).join(" · ") || "No style yet"}{missing.length > 0 && <span className="text-warn"> · needs {missing.join(", ")}</span>}</div>
              </Td>
              <Td className="hidden text-sm md:table-cell">{t.pours.map((x) => `${x.label} $${x.price}`).join(" · ") || <span className="text-muted">No prices</span>}</Td>
              {t.beerId ? (
                <>
                  <Td className="px-1 py-1"><GridSelect value={w?.family ?? ""} options={fam.map((o) => (o.value === "" ? { value: "", label: guess ? `Guess: ${guess}` : "Guess" } : o))} ariaLabel={`Family for ${t.beer}`} onSave={(v) => setBeerWebField(t.beerId!, "family", v)} /></Td>
                  <Td className="hidden px-1 py-1 sm:table-cell"><GridCell grid="web-beer" col="badge" value={w?.badge ?? ""} placeholder="e.g. Flagship" ariaLabel={`Badge for ${t.beer}`} onSave={(v) => setBeerWebField(t.beerId!, "badge", v)} /></Td>
                  <Td className="hidden px-1 py-1 lg:table-cell"><GridSelect value={w?.hazy ? "true" : "false"} options={YES_NO} ariaLabel={`${t.beer} is hazy`} onSave={(v) => setBeerWebField(t.beerId!, "hazy", v)} /></Td>
                  <Td className="px-1 py-1"><GridSelect value={w?.onWebsite === false ? "false" : "true"} options={YES_NO} ariaLabel={`${t.beer} on the website`} onSave={(v) => setBeerWebField(t.beerId!, "onWebsite", v)} /></Td>
                </>
              ) : (
                <Td colSpan={4} className="text-sm text-muted">No beer set on this keg</Td>
              )}
            </Tr>
          );
        })}
      </tbody>
    </Table>
  );
}

// ---- Notices and preview ------------------------------------------------------------

function NoticesEditor({ initial }: { initial: string[] }) {
  const router = useRouter();
  const [v, setV] = useState(initial.join("\n"));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <Card className="p-4">
      <Textarea value={v} onChange={(e) => { setV(e.target.value); setMsg(null); }} rows={3} aria-label="Notes under the menu" />
      <div className="mt-3 flex items-center gap-3">
        <Button disabled={pending || v === initial.join("\n")} onClick={() => start(async () => { const r = await saveMenuNotices(v); setMsg(r.error ? { ok: false, text: r.error } : { ok: true, text: "Saved." }); if (!r.error) router.refresh(); })}>Save notes</Button>
        {msg && <span className={cx("text-sm", msg.ok ? "text-good" : "text-bad")}>{msg.text}</span>}
      </div>
    </Card>
  );
}

type AnyItem = WebMenu["food"][number]["items"][number] | WebMenu["drinks"][number]["groups"][number]["items"][number];

function ItemLine({ i }: { i: AnyItem }) {
  const beer = "prices" in i;
  return (
    <li className="py-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2 font-medium">
          {beer && <span aria-hidden className="size-2.5 shrink-0 rounded-full ring-1 ring-border" style={{ background: i.color }} />}
          <span className="min-w-0">{i.name}</span>
          {i.badge && <Badge>{i.badge}</Badge>}
          {i.seasonal && <Badge>Seasonal</Badge>}
        </span>
        <span className="num shrink-0 text-sm">{beer ? `${i.prices.half} / ${i.prices.full}` : "price" in i && i.price != null ? i.price : ""}</span>
      </div>
      {beer && <div className="text-xs text-muted">{i.style} · {i.abv}%</div>}
      {i.description && <div className="text-sm text-muted">{i.description}</div>}
      {i.modifiers && <div className="text-xs text-muted italic">{i.modifiers}</div>}
      {(i.tags?.length || i.availableFrom || i.availableUntil) && (
        <div className="mt-1 flex flex-wrap gap-1">
          {i.tags?.map((t) => <Badge key={t}>{TAG_LABEL[t]}</Badge>)}
          {(i.availableFrom || i.availableUntil) && <span className="text-xs text-muted">{windowText(i.availableFrom, i.availableUntil)}</span>}
        </div>
      )}
    </li>
  );
}

function MenuPreview({ menu }: { menu: WebMenu }) {
  if (!menu.drinks.length && !menu.food.length) return <Card className="p-6 text-sm text-muted">Nothing on the website menu yet. Until something is turned on, the website keeps showing its own printed menu.</Card>;
  return (
    <Card className="grid gap-x-8 gap-y-6 p-5 md:grid-cols-2">
      <div className="min-w-0">
        <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">Drinks · {menu._meta.pourSizes.half} / {menu._meta.pourSizes.full}</h3>
        {menu.drinks.map((s) => (
          <div key={s.id} className="mt-4">
            <div className="font-semibold">{s.title}</div>
            {s.groups.map((g) => (
              <div key={g.title} className="mt-2">
                <div className="text-xs font-medium text-ink-2">{g.title}</div>
                <ul className="divide-y divide-border">{g.items.map((i, n) => <ItemLine key={n} i={i} />)}</ul>
              </div>
            ))}
          </div>
        ))}
        {!menu.drinks.length && <p className="mt-2 text-sm text-muted">No drinks yet.</p>}
      </div>
      <div className="min-w-0">
        <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">Food</h3>
        {menu.food.map((s) => (
          <div key={s.id} className="mt-4">
            <div className="font-semibold">{s.title}</div>
            {s.intro && <div className="text-sm text-muted">{s.intro}</div>}
            <ul className="divide-y divide-border">{s.items.map((i, n) => <ItemLine key={n} i={i} />)}</ul>
            {s.modifiers && <div className="text-xs text-muted italic">{s.modifiers}</div>}
          </div>
        ))}
        {!menu.food.length && <p className="mt-2 text-sm text-muted">No food yet.</p>}
        {menu.notices.length > 0 && <div className="mt-6 space-y-1 border-t border-border pt-3 text-xs text-muted">{menu.notices.map((n) => <p key={n}>{n}</p>)}</div>}
      </div>
    </Card>
  );
}
