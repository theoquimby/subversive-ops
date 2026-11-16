import { LinkButton } from "@/components/ui";
import { BREW_PROFILES, formatFieldValue, hopAdditions, isProfileKey, logRows, STAGE_FIELDS, STAGES } from "@/domain/brewDay";
import { abvStandard, formatGravity } from "@/domain/gravity";
import { qty, shortDate } from "@/lib/format";
import { requireUser } from "@/server/auth";
import { brewSheetData } from "@/server/services/brewDay";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { PrintButton } from "../../kegs/print-button";

export const metadata = { title: "Brew sheet" };

/**
 * One printable page per brew, like Brew Manager's batch sheet: the recipe and
 * its targets, grain, hops and yeast scaled to this brew, the brew-day log so
 * far, and blank lines for the readings still to take.
 */
export default async function BrewSheet({ params }: { params: Promise<{ batchId: string }> }) {
  await requireUser("MANAGER");
  const { batchId } = await params;
  const d = await brewSheetData(batchId);
  if (!d) notFound();
  const { batch: b, recipe: r, log, unit } = d;
  const g = (sg: number | null | undefined) => (sg == null ? "" : formatGravity(sg, unit));
  const size = b.bbl ?? r?.batchBbl ?? null;
  const yeast = r?.lines.filter((l) => l.kind === "yeast") ?? [];
  const og = b.og ?? d.finish.og;
  const abv = og != null && b.fg != null && og > b.fg ? abvStandard(og, b.fg) : null;
  const profile = r?.profile && isProfileKey(r.profile) ? BREW_PROFILES[r.profile].label : r?.profile === "custom" ? "Custom" : null;
  const stages = log ? logRows(log, unit) : null;
  const hops = r ? hopAdditions(r.lines, r.boilMinutes, r.dryHopDay) : [];
  const tankPath = b.tanks.map((t) => t.name).join(" → ");

  const summary: [string, ReactNode][] = (
    [
      ["Brew date", b.brewedOn ? shortDate(b.brewedOn) : b.plannedOn ? `${shortDate(b.plannedOn)} (planned)` : ""],
      ["Tank", tankPath],
      ["Volume", size != null ? `${qty(size, 2)} bbl` : ""],
      ["Style", r?.style ?? ""],
      ["OG", og != null ? `${g(og)}${r?.targetOg ? ` (target ${g(r.targetOg)})` : ""}` : r?.targetOg ? `target ${g(r.targetOg)}` : ""],
      ["FG", b.fg != null ? `${g(b.fg)}${r?.targetFg ? ` (target ${g(r.targetFg)})` : ""}` : r?.targetFg ? `target ${g(r.targetFg)}` : ""],
      ["ABV", abv != null ? `${abv.toFixed(1)}%` : ""],
      ["Yeast", yeast.map((y) => y.name).join(", ")],
      ["Timing", profile ? `${profile}${r?.dryHopDay ? ` · dry hop day ${r.dryHopDay}` : ""}${r?.tapDay ? ` · release day ${r.tapDay}` : ""}` : ""],
    ] as [string, ReactNode][]
  ).filter(([, v]) => v !== "" && v != null);

  const targets: [string, string][] = r
    ? (
        [
          ["Strike", r.strikeF != null ? `${r.strikeF} °F` : ""],
          ["Mash", r.mashF != null ? `${r.mashF} °F${r.mashMinutes ? `, ${r.mashMinutes} min` : ""}` : r.mashMinutes ? `${r.mashMinutes} min` : ""],
          ["MT gravity", g(r.targetMt)],
          ["BK gravity", g(r.targetBk)],
          ["Boil", `${r.boilMinutes} min`],
          ["KO gravity", g(r.targetKo)],
          ["OG", g(r.targetOg)],
          ["FG", g(r.targetFg)],
        ] as [string, string][]
      ).filter(([, v]) => v)
    : [];

  return (
    <>
      <style>{`
        @page { size: letter portrait; margin: 12mm 12mm; }
        @media print { .no-print { display: none !important; } body { background: #fff !important; } .sheet { box-shadow: none !important; margin: 0 !important; padding: 0 !important; width: auto !important; } }
        .sheet { width: 8.5in; min-height: 11in; padding: 0.55in 0.6in; background: #fff; color: #111; font: 10.5px/1.35 system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif; }
        .sheet h1 { font-size: 22px; font-weight: 700; margin: 0 0 2px; }
        .sheet .sub { font-size: 12.5px; color: #555; margin-bottom: 12px; }
        .sheet h2 { font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: .07em; color: #555; margin: 12px 0 4px; border-bottom: 1px solid #ccc; padding-bottom: 3px; break-after: avoid; }
        .sheet table { width: 100%; border-collapse: collapse; }
        .sheet td, .sheet th { padding: 3px 6px; border-bottom: 0.5px solid #e2e2e2; vertical-align: top; text-align: left; }
        .sheet th { font-size: 9px; font-weight: 600; text-transform: uppercase; letter-spacing: .05em; color: #555; border-bottom: 1px solid #bbb; }
        .sheet .k { color: #555; width: 34%; }
        .sheet .r { text-align: right; font-variant-numeric: tabular-nums; }
        .sheet .blank { border-bottom: 0.75px solid #999; min-width: 1.2in; display: inline-block; height: 14px; }
        .sheet .box { display: inline-block; width: 11px; height: 11px; border: 1px solid #555; border-radius: 2px; vertical-align: -2px; text-align: center; line-height: 10px; font-size: 10px; }
        .sheet .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 0 18px; }
        .sheet .note { border: 0.5px solid #bbb; border-radius: 4px; padding: 6px 8px; min-height: 52px; white-space: pre-line; }
        .sheet .foot { margin-top: 14px; font-size: 9px; color: #888; border-top: 0.5px solid #ddd; padding-top: 5px; display: flex; justify-content: space-between; }
        .sheet .avoid { break-inside: avoid; }
      `}</style>
      <div className="no-print mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3 px-4 py-6">
        <div>
          <h1 className="text-xl font-semibold">Brew sheet</h1>
          <p className="text-sm text-muted">One page for the brewhouse clipboard. Print at 100%, no headers or footers.</p>
        </div>
        <div className="flex gap-2">
          <LinkButton href={`/brewery/brew/${b.id}`}>Back</LinkButton>
          <PrintButton />
        </div>
      </div>
      <div className="overflow-x-auto pb-10 print:overflow-visible print:pb-0">
        <div className="sheet mx-auto shadow-lg">
          <h1>{b.name}</h1>
          <div className="sub">{[b.code, r && r.name !== b.name ? r.name : null, r?.style, tankPath || null, b.brewedOn ? shortDate(b.brewedOn) : b.plannedOn ? `planned ${shortDate(b.plannedOn)}` : null].filter(Boolean).join(" · ")}</div>

          <div className="cols">
            <div className="avoid">
              <h2>Batch</h2>
              <table><tbody>{summary.map(([k, v]) => <tr key={k}><td className="k">{k}</td><td className="r">{v}</td></tr>)}</tbody></table>
            </div>
            <div className="avoid">
              <h2>Targets</h2>
              {targets.length ? <table><tbody>{targets.map(([k, v]) => <tr key={k}><td className="k">{k}</td><td className="r">{v}</td></tr>)}</tbody></table> : <p style={{ color: "#888" }}>No recipe targets.</p>}
            </div>
          </div>

          {r && (
            <div className="cols">
              <div className="avoid">
                <h2>Grain{size != null ? `, for ${qty(size, 2)} bbl` : ""}</h2>
                <table><tbody>
                  {r.lines.filter((l) => l.kind === "grain").map((l, i) => <tr key={i}><td>{l.name}</td><td className="r">{qty(l.qty, 1)} {l.unit}</td></tr>)}
                  {r.lines.filter((l) => l.kind === "adjunct" || l.kind === "water" || l.kind === "other").map((l, i) => <tr key={`o${i}`}><td>{l.name}</td><td className="r">{qty(l.qty, 2)} {l.unit}</td></tr>)}
                </tbody></table>
                {yeast.length > 0 && (
                  <>
                    <h2>Yeast</h2>
                    <table><tbody>{yeast.map((l, i) => <tr key={i}><td>{l.name}</td><td className="r">{l.qty > 0 ? `${qty(l.qty, 2)} ${l.unit}` : ""}</td></tr>)}</tbody></table>
                  </>
                )}
              </div>
              <div className="avoid">
                <h2>Hops</h2>
                <table>
                  <thead><tr><th style={{ width: 14 }} /><th>Hop</th><th className="r">Amount</th><th>When</th><th>Time in</th></tr></thead>
                  <tbody>
                    {hops.map((h) => {
                      const at = log?.hops[h.key];
                      return (
                        <tr key={h.key}>
                          <td><span className="box">{at ? "✓" : ""}</span></td>
                          <td>{h.name}</td>
                          <td className="r">{qty(h.qty, 2)} {h.unit}</td>
                          <td>{h.when}</td>
                          <td>{at ? new Date(at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : <span className="blank" style={{ minWidth: "0.6in" }} />}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <h2>Brew day</h2>
          <div className="cols">
            {STAGES.map((s) => {
              const filled = stages?.find((x) => x.stage === s.id);
              return (
                <div key={s.id} className="avoid" style={{ marginBottom: 6 }}>
                  <div style={{ fontWeight: 600, margin: "4px 0 2px" }}>{s.label}</div>
                  <table>
                    <tbody>
                      {STAGE_FIELDS[s.id].map((f) => {
                        const v = log ? formatFieldValue(f.kind, log.values[s.id][f.key], unit) : "";
                        return (
                          <tr key={f.key}>
                            <td className="k">{f.label}</td>
                            <td className="r">{v || <span className="blank" />}</td>
                          </tr>
                        );
                      })}
                      {filled?.notes && <tr><td className="k">Notes</td><td style={{ whiteSpace: "pre-line" }}>{filled.notes}</td></tr>}
                    </tbody>
                  </table>
                </div>
              );
            })}
          </div>

          <div className="avoid">
            <h2>Gravity log</h2>
            <table>
              <thead><tr><th style={{ width: "22%" }}>Date</th><th style={{ width: "20%" }}>Gravity ({unit === "plato" ? "°P" : "SG"})</th><th>Note</th><th style={{ width: "14%" }}>Initials</th></tr></thead>
              <tbody>
                {b.readings.map((x, i) => (
                  <tr key={i}><td>{shortDate(x.on)}</td><td>{g(x.sg)}</td><td>{x.note ?? (x.kind === "og" ? "OG" : x.kind === "fg" ? "FG" : "")}</td><td /></tr>
                ))}
                {Array.from({ length: Math.max(6, 10 - b.readings.length) }).map((_, i) => <tr key={`b${i}`}><td style={{ height: 22 }} /><td /><td /><td /></tr>)}
              </tbody>
            </table>
          </div>

          <div className="avoid">
            <h2>Notes</h2>
            <div className="note">{[b.notes, r?.notes].filter(Boolean).join("\n\n")}</div>
          </div>

          <div className="foot">
            <span>Subversive Malting &amp; Brewing · {b.code}</span>
            <span>Printed {new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
          </div>
        </div>
      </div>
    </>
  );
}
