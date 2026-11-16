"use client";

import { DataTable, type Column, type Filter } from "@/components/data-table";
import { useConfirm } from "@/components/dialog";
import { GridCell, GridSelect } from "@/components/grid";
import { Button, cx, Input } from "@/components/ui";
import { STANDING_LABEL, STANDINGS, type Standing } from "@/domain/beerStanding";
import { BEER_COLORS } from "@/domain/kegs";
import { abvText, DIET_TAGS, formatBoardPours, priceText, type BoardPour, type SquareCheck } from "@/domain/taps";
import { ArrowUpRight, ImageUp, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";
import { addBeer, setBeerField } from "../actions";
import { BeerDot } from "../bits";
import { removeBeerLabel, setBeerBoardField, uploadBeerLabel } from "../taps/actions";

export interface BeerBoardRow {
  id: string;
  name: string;
  style: string | null;
  color: string;
  abv: number | null;
  ibu: number | null;
  description: string | null;
  diet: string | null;
  boardPours: string | null;
  pours: BoardPour[];
  priceSource: "typed" | "square" | "recipes" | "none";
  square: SquareCheck | null;
  squarePours: { variation: string; price: number | null; oz: number }[];
  comingSoon: "auto" | "yes" | "no";
  labelUrl: string | null;
  active: boolean;
  standing: Standing;
  house: boolean;
  taps: number[];
  fullKegs: number;
}

const COLORS = BEER_COLORS.map((c) => ({ value: c.id, label: c.label }));
const STANDING_OPTIONS = STANDINGS.map((s) => ({ value: s, label: STANDING_LABEL[s] }));

/** The arrow beside a beer's name that opens its own page. */
function OpenBeer({ row }: { row: BeerBoardRow }) {
  return <Link href={`/kegs/beers/${row.id}`} aria-label={`Open ${row.name}`} title="Open this beer's page" className="grid size-10 shrink-0 place-items-center rounded-lg text-muted transition-colors duration-120 hover:bg-surface-2 hover:text-ink sm:size-8"><ArrowUpRight className="size-4" /></Link>;
}
const DIET = [{ value: "", label: "—" }, ...DIET_TAGS.map((d) => ({ value: d, label: d }))];
const SOON = [{ value: "auto", label: "When a keg is ready" }, { value: "yes", label: "Always" }, { value: "no", label: "Never" }];
const SOURCE: Record<BeerBoardRow["priceSource"], string> = { typed: "typed here", square: "from Square", recipes: "from draft beer pours", none: "" };

const toneText = (t: SquareCheck["tone"]) => (t === "bad" ? "text-bad" : t === "warn" ? "text-warn" : "text-muted");

/** Shrink to at most 320 px on the long side, as WebP (JPEG where WebP isn't supported). */
async function shrink(file: File): Promise<File> {
  const bmp = await createImageBitmap(file);
  const s = Math.min(1, 320 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(bmp.width * s));
  c.height = Math.max(1, Math.round(bmp.height * s));
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/webp", 0.85));
  const out = blob && blob.type === "image/webp" ? blob : await new Promise<Blob | null>((r) => c.toBlob(r, "image/jpeg", 0.85));
  if (!out) throw new Error("Couldn't read that image.");
  return new File([out], out.type === "image/webp" ? "label.webp" : "label.jpg", { type: out.type });
}

function LabelCell({ row }: { row: BeerBoardRow }) {
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const confirm = useConfirm();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const pick = (f: File | undefined) => {
    if (!f) return;
    setError(null);
    start(async () => {
      try {
        const small = await shrink(f);
        const fd = new FormData();
        fd.set("beerId", row.id);
        fd.set("file", small);
        const r = await uploadBeerLabel(fd);
        if (r.error) setError(r.error);
        else router.refresh();
      } catch {
        setError("Couldn't read that image.");
      }
      if (input.current) input.current.value = "";
    });
  };
  const remove = async () => {
    // Ask first, then save in a transition (never await the dialog inside one).
    if (!(await confirm({ title: `Remove the label for ${row.name}?`, body: "The board shows the tap number in the beer's color instead.", confirmLabel: "Remove", danger: true }))) return;
    start(async () => { await removeBeerLabel(row.id); router.refresh(); });
  };
  return (
    <div className="flex items-center gap-1.5 px-1">
      {row.labelUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={row.labelUrl} alt="" className="size-8 shrink-0 rounded-md object-cover ring-1 ring-border" />
      ) : (
        <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-md text-[0.65rem] text-muted ring-1 ring-border ring-inset">none</span>
      )}
      <Button size="sm" variant="ghost" className="size-10 p-0 sm:size-8" aria-label={`${row.labelUrl ? "Replace" : "Upload"} label image for ${row.name}`} disabled={pending} onClick={() => input.current?.click()}><ImageUp className="size-4" /></Button>
      {row.labelUrl && <Button size="sm" variant="ghost" className="size-10 p-0 text-muted hover:text-bad sm:size-8" aria-label={`Remove label image for ${row.name}`} disabled={pending} onClick={remove}><Trash2 className="size-4" /></Button>}
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => pick(e.target.files?.[0])} />
      {error && <span className="text-xs text-bad">{error}</span>}
    </div>
  );
}

function AddBeerRow() {
  const router = useRouter();
  const [v, setV] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form className="flex flex-wrap items-start gap-2 px-4 py-3" onSubmit={(e) => { e.preventDefault(); if (!v.trim()) return; start(async () => { const r = await addBeer(v); if ("error" in r) setErr(r.error); else { setV(""); setErr(null); router.refresh(); } }); }}>
      <div className="min-w-0 flex-1 sm:max-w-xs">
        <Input value={v} onChange={(e) => setV(e.target.value)} placeholder="e.g. Golden Lager" aria-label="New beer name" />
        {err && <p className="mt-1 text-xs text-bad">{err}</p>}
      </div>
      <Button type="submit" variant="primary" disabled={pending || !v.trim()}><Plus className="size-4" /> Add beer</Button>
    </form>
  );
}

export function BeersBoardTable({ rows }: { rows: BeerBoardRow[] }) {
  const columns = useMemo<Column<BeerBoardRow>[]>(() => [
    { id: "name", header: "Beer", edit: true, width: 190, hideable: false, sort: (b) => b.name, csv: (b) => b.name, cell: (b) => <div className="flex items-center gap-2 pl-1"><BeerDot color={b.color} /><GridCell grid="bb" col="name" value={b.name} ariaLabel={`Name of ${b.name}`} onSave={(v) => setBeerField(b.id, "name", v)} className="min-w-28 flex-1 font-medium" /><OpenBeer row={b} /></div> },
    { id: "tap", header: "On", align: "right", width: 64, firstDir: "asc", sort: (b) => b.taps[0] ?? 999, csv: (b) => b.taps.join(" "), cell: (b) => <span className="num text-sm">{b.taps.length ? b.taps.map((t) => `#${t}`).join(" ") : <span className="text-muted">—</span>}</span> },
    { id: "style", header: "Style", edit: true, width: 150, sort: (b) => b.style, csv: (b) => b.style, cell: (b) => <GridCell grid="bb" col="style" value={b.style} placeholder="e.g. Hazy IPA" ariaLabel={`Style of ${b.name}`} onSave={(v) => setBeerField(b.id, "style", v)} /> },
    { id: "abv", header: "ABV", align: "right", edit: true, width: 84, firstDir: "desc", sort: (b) => b.abv, csv: (b) => b.abv, cell: (b) => <GridCell grid="bb" col="abv" type="number" suffix="%" value={b.abv} placeholder="—" ariaLabel={`ABV of ${b.name}`} onSave={(v) => setBeerBoardField(b.id, "abv", v)} /> },
    { id: "ibu", header: "IBU", align: "right", edit: true, width: 72, firstDir: "desc", sort: (b) => b.ibu, csv: (b) => b.ibu, cell: (b) => <GridCell grid="bb" col="ibu" type="number" value={b.ibu} placeholder="—" ariaLabel={`IBU of ${b.name}`} onSave={(v) => setBeerBoardField(b.id, "ibu", v)} /> },
    { id: "desc", header: "Short description", edit: true, width: 230, sort: (b) => b.description, csv: (b) => b.description, cell: (b) => <GridCell grid="bb" col="desc" value={b.description} placeholder="One line for the board" ariaLabel={`Description of ${b.name}`} onSave={(v) => setBeerBoardField(b.id, "description", v)} /> },
    {
      id: "prices", header: "Prices on the board", help: "taps.prices", edit: true, width: 270, sort: (b) => b.pours[0]?.price ?? null, csv: (b) => formatBoardPours(b.pours),
      cell: (b) => (
        <div>
          <GridCell grid="bb" col="prices" value={b.boardPours} placeholder={b.pours.length && b.priceSource !== "typed" ? formatBoardPours(b.pours) : "16 oz $8, 10 oz $6"} ariaLabel={`Board prices for ${b.name}`} onSave={(v) => setBeerBoardField(b.id, "boardPours", v)} />
          {b.priceSource !== "none" && <div className="px-2 text-[0.7rem] text-muted">{SOURCE[b.priceSource]}</div>}
        </div>
      ),
    },
    { id: "square", header: "Square", help: "taps.square", width: 200, sort: (b) => b.square?.tone ?? "", csv: (b) => b.square?.text, cell: (b) => (b.square ? <span className={cx("text-xs", toneText(b.square.tone))}>{b.square.text}</span> : null) },
    { id: "color", header: "Color", edit: true, width: 140, sort: (b) => b.color, csv: (b) => b.color, cell: (b) => <GridSelect value={b.color} options={COLORS} ariaLabel={`Board color for ${b.name}`} onSave={(v) => setBeerField(b.id, "color", v)} /> },
    { id: "label", header: "Label", width: 120, cell: (b) => <LabelCell row={b} />, csv: (b) => (b.labelUrl ? "yes" : "") },
    { id: "diet", header: "Tag", edit: true, width: 150, sort: (b) => b.diet, csv: (b) => b.diet, defaultHidden: true, cell: (b) => <GridSelect value={b.diet ?? ""} options={DIET} ariaLabel={`Dietary tag for ${b.name}`} onSave={(v) => setBeerBoardField(b.id, "diet", v)} /> },
    { id: "soon", header: "Coming soon", help: "taps.comingSoon", edit: true, width: 170, sort: (b) => b.comingSoon, csv: (b) => b.comingSoon, cell: (b) => <GridSelect value={b.comingSoon} options={SOON} ariaLabel={`Coming soon for ${b.name}`} onSave={(v) => setBeerBoardField(b.id, "comingSoon", v)} /> },
    { id: "full", header: "Full kegs", align: "right", width: 80, defaultHidden: true, firstDir: "desc", sort: (b) => b.fullKegs, csv: (b) => b.fullKegs, cell: (b) => <span className="num text-sm">{b.fullKegs}</span> },
    { id: "active", header: "Standing", help: "kegs.standing", edit: true, width: 140, sort: (b) => ["core", "rotation", "retired"].indexOf(b.standing), csv: (b) => STANDING_LABEL[b.standing], cell: (b) => <GridSelect value={b.standing} options={STANDING_OPTIONS} ariaLabel={`Standing of ${b.name}`} onSave={(v) => setBeerField(b.id, "standing", v)} /> },
  ], []);

  const filters = useMemo<Filter<BeerBoardRow>[]>(() => [
    { id: "status", label: "Status", kind: "facet", single: true, display: "segmented", allLabel: "All", values: (b) => (b.active ? "active" : "retired"), options: [{ value: "active", label: "Active" }, { value: "retired", label: "Retired" }] },
    { id: "ontap", label: "On tap", kind: "toggle", test: (b) => b.taps.length > 0 },
    { id: "missing", label: "Missing details", kind: "toggle", tone: "warn", test: (b) => b.active && (!b.style || b.abv == null || !b.pours.length) },
    { id: "square", label: "Square issues", kind: "toggle", tone: "bad", test: (b) => b.square?.tone === "bad" || b.square?.tone === "warn" },
  ], []);

  return (
    <DataTable
      id="kegs-beers"
      rows={rows}
      rowKey={(b) => b.id}
      columns={columns}
      noun={["beer", "beers"]}
      searchText={(b) => `${b.name} ${b.style ?? ""} ${b.description ?? ""} ${b.diet ?? ""}`}
      searchPlaceholder="Search beers"
      filters={filters}
      defaultView={{ filters: { status: ["active"] } }}
      rowClassName={(b) => (b.active ? undefined : "opacity-60")}
      csvName="beers"
      urlSearch={false}
      help="taps.beers"
      footer={<AddBeerRow />}
      summary={(vis) => [
        { value: vis.length, label: vis.length === 1 ? "beer" : "beers" },
        { value: vis.filter((b) => b.taps.length).length, label: "on tap", filter: { id: "ontap" } },
        ...(vis.some((b) => b.active && (!b.style || b.abv == null || !b.pours.length)) ? [{ value: vis.filter((b) => b.active && (!b.style || b.abv == null || !b.pours.length)).length, label: "missing details", tone: "warn" as const, filter: { id: "missing" } }] : []),
      ]}
      card={(b) => ({
        title: <span className="inline-flex items-center gap-2"><BeerDot color={b.color} />{b.name}</span>,
        subtitle: [b.taps.length ? `Tap ${b.taps.join(", ")}` : null, b.style].filter(Boolean).join(" · ") || "No style yet",
        value: abvText(b.abv) ?? undefined,
        sub: b.square && b.square.tone !== "good" ? <span className={toneText(b.square.tone)}>{b.square.tone === "bad" ? "Square price differs" : b.square.text}</span> : b.pours.length ? `${b.pours[b.pours.length - 1].label} ${priceText(b.pours[b.pours.length - 1].price)}` : "No prices",
      })}
      drawerTitle={(b) => b.name}
      drawer={(b) => <BeerDrawer b={b} />}
    />
  );
}

/** Phone and side-panel editor: every field, stacked. */
function BeerDrawer({ b }: { b: BeerBoardRow }) {
  const f = (label: string, el: React.ReactNode, hint?: React.ReactNode) => (
    <div className="py-2">
      <div className="mb-0.5 text-[0.8rem] font-medium text-ink-2">{label}</div>
      {el}
      {hint && <div className="mt-0.5 px-2 text-xs text-muted">{hint}</div>}
    </div>
  );
  return (
    <div className="divide-y divide-border">
      {f("Standing", <GridSelect value={b.standing} options={STANDING_OPTIONS} ariaLabel="Standing" onSave={(v) => setBeerField(b.id, "standing", v)} />, <Link href={`/kegs/beers/${b.id}`} className="underline hover:text-ink">Open {b.name}&apos;s page: kegs by size, fills and demand</Link>)}
      {f("Style", <GridCell grid="bbd" col="style" value={b.style} placeholder="e.g. Hazy IPA" ariaLabel="Style" onSave={(v) => setBeerField(b.id, "style", v)} />)}
      <div className="grid grid-cols-2 gap-3">
        {f("ABV", <GridCell grid="bbd" col="abv" type="number" suffix="%" value={b.abv} placeholder="—" ariaLabel="ABV" onSave={(v) => setBeerBoardField(b.id, "abv", v)} />)}
        {f("IBU", <GridCell grid="bbd" col="ibu" type="number" value={b.ibu} placeholder="—" ariaLabel="IBU" onSave={(v) => setBeerBoardField(b.id, "ibu", v)} />)}
      </div>
      {f("Short description", <GridCell grid="bbd" col="desc" value={b.description} placeholder="One line for the board" ariaLabel="Short description" onSave={(v) => setBeerBoardField(b.id, "description", v)} />, "Up to 140 characters. Shown when 8 or fewer taps are on.")}
      {f("Prices on the board", <GridCell grid="bbd" col="prices" value={b.boardPours} placeholder={b.pours.length && b.priceSource !== "typed" ? formatBoardPours(b.pours) : "16 oz $8, 10 oz $6"} ariaLabel="Board prices" onSave={(v) => setBeerBoardField(b.id, "boardPours", v)} />, b.priceSource === "typed" ? "Typed here. Clear it to use Square's prices." : b.priceSource === "none" ? "Nothing linked in Square yet — type them, like “16 oz $8, 10 oz $6”." : `Now ${SOURCE[b.priceSource]}. Type to override.`)}
      {b.square && f("Square", <div className={cx("px-2 text-sm", toneText(b.square.tone))}>{b.square.text}</div>, b.squarePours.length ? b.squarePours.map((p) => `${p.variation}${p.price != null ? ` $${p.price}` : ""}`).join(" · ") : undefined)}
      {f("Board color", <GridSelect value={b.color} options={COLORS} ariaLabel="Board color" onSave={(v) => setBeerField(b.id, "color", v)} />)}
      {f("Label image", <LabelCell row={b} />, "A small square logo works best. It's shrunk to 320 px.")}
      {f("Tag", <GridSelect value={b.diet ?? ""} options={DIET} ariaLabel="Dietary tag" onSave={(v) => setBeerBoardField(b.id, "diet", v)} />)}
      {f("Coming soon", <GridSelect value={b.comingSoon} options={SOON} ariaLabel="Coming soon" onSave={(v) => setBeerBoardField(b.id, "comingSoon", v)} />, `${b.fullKegs} full keg${b.fullKegs === 1 ? "" : "s"} ready.`)}
    </div>
  );
}
