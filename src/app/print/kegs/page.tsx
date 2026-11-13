import { cx, LinkButton } from "@/components/ui";
import { displayCode, kegSizeInfo, kegUrl, KEG_STATUSES, type KegStatus } from "@/domain/kegs";
import { requireUser } from "@/server/auth";
import { db } from "@/server/db";
import { appUrl } from "@/server/services/notify";
import QRCode from "qrcode";
import { headers } from "next/headers";
import { PrintButton } from "./print-button";

export const metadata = { title: "Keg labels" };

/**
 * Label layouts, in inches. Sheets are US Letter. Measurements follow the
 * common stock; the margins are generous so a slightly off printer still
 * lands each code inside its label.
 */
const LAYOUTS = {
  square: { label: "2″ × 2″ sheet (12 per page, e.g. Avery 22806)", cols: 3, rows: 4, w: 2, h: 2, top: 0.625, left: 0.6875, gapX: 0.3125, gapY: 0.5, page: "letter" },
  address: { label: "1″ × 2⅝″ sheet (30 per page, e.g. Avery 5160)", cols: 3, rows: 10, w: 2.625, h: 1, top: 0.5, left: 0.1875, gapX: 0.125, gapY: 0, page: "letter" },
  single: { label: "One per label (2″ × 2″ label printer)", cols: 1, rows: 1, w: 2, h: 2, top: 0, left: 0, gapX: 0, gapY: 0, page: "2in 2in" },
} as const;
type LayoutId = keyof typeof LAYOUTS;

export default async function KegLabels({ searchParams }: { searchParams: Promise<{ codes?: string; status?: string; all?: string; layout?: string }> }) {
  await requireUser("MANAGER");
  const sp = await searchParams;
  const layoutId: LayoutId = sp.layout && sp.layout in LAYOUTS ? (sp.layout as LayoutId) : "square";
  const L = LAYOUTS[layoutId];
  const codes = (sp.codes ?? "").split(",").map((c) => c.trim().toUpperCase()).filter(Boolean).slice(0, 500);
  const status = KEG_STATUSES.includes(sp.status as KegStatus) ? (sp.status as KegStatus) : undefined;
  const kegs = await db.keg.findMany({
    where: codes.length ? { code: { in: codes } } : { active: true, ...(status ? { status } : {}) },
    select: { code: true, sizeId: true },
    orderBy: { code: "asc" },
    take: 500,
  });
  // The sticker's QR is a link, so a phone's own camera opens the keg too.
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const base = process.env.APP_URL?.trim() || (host ? `${h.get("x-forwarded-proto") ?? "https"}://${host}` : appUrl());
  const labels = await Promise.all(kegs.map(async (k) => ({ ...k, svg: await QRCode.toString(kegUrl(base, k.code), { type: "svg", margin: 2, errorCorrectionLevel: "M", color: { dark: "#000000", light: "#ffffff" } }) })));
  const perPage = L.cols * L.rows;
  const pages: (typeof labels)[] = [];
  for (let i = 0; i < labels.length; i += perPage) pages.push(labels.slice(i, i + perPage));
  const qs = (layout: string) => `?${new URLSearchParams({ ...(codes.length ? { codes: codes.join(",") } : status ? { status } : { all: "1" }), layout }).toString()}`;
  const wide = L.w / L.h > 1.8;
  const qr = wide ? L.h - 0.16 : Math.min(L.w, L.h) - 0.62;

  return (
    <>
      <style>{`
        @page { size: ${L.page}; margin: 0; }
        @media print { .no-print { display: none !important; } body { background: #fff !important; } .sheet { margin: 0 !important; box-shadow: none !important; } }
        .sheet { width: ${L.page === "letter" ? "8.5in" : `${L.w}in`}; height: ${L.page === "letter" ? "11in" : `${L.h}in`}; position: relative; background: #fff; color: #000; break-after: page; overflow: hidden; }
        .sheet:last-child { break-after: auto; }
        .lbl svg { width: 100%; height: 100%; display: block; }
      `}</style>
      <div className="no-print mx-auto max-w-3xl px-4 py-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">Keg labels</h1>
            <p className="text-sm text-muted">{labels.length} label{labels.length === 1 ? "" : "s"} · {pages.length} page{pages.length === 1 ? "" : "s"}. Print at 100% (“Actual size”), no headers or footers.</p>
          </div>
          <div className="flex gap-2">
            <LinkButton href="/kegs/all">Back</LinkButton>
            <PrintButton />
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-1.5">
          {(Object.keys(LAYOUTS) as LayoutId[]).map((id) => (
            <a key={id} href={qs(id)} className={cx("inline-flex h-10 items-center rounded-full border px-3 text-sm", id === layoutId ? "border-ink bg-ink text-bg" : "border-border bg-surface text-ink-2 hover:bg-surface-2")}>{LAYOUTS[id].label}</a>
          ))}
        </div>
        {labels.length === 0 && <p className="mt-6 text-sm text-muted">No kegs to print. Add kegs first.</p>}
      </div>
      <div className="flex flex-col items-center gap-6 pb-10 print:block print:gap-0 print:pb-0">
        {pages.map((pg, pi) => (
          <div key={pi} className="sheet shadow-lg">
            {pg.map((k, i) => {
              const c = i % L.cols, r = Math.floor(i / L.cols);
              return (
                <div key={k.code} className="lbl absolute flex items-center" style={{ left: `${L.left + c * (L.w + L.gapX)}in`, top: `${L.top + r * (L.h + L.gapY)}in`, width: `${L.w}in`, height: `${L.h}in`, flexDirection: wide ? "row" : "column", justifyContent: "center", gap: wide ? "0.1in" : "0.04in", padding: "0.06in" }}>
                  <div style={{ width: `${qr}in`, height: `${qr}in` }} dangerouslySetInnerHTML={{ __html: k.svg }} />
                  <div style={{ textAlign: wide ? "left" : "center", lineHeight: 1.05 }}>
                    <div style={{ font: `700 ${wide ? 17 : 19}pt/1 ui-monospace, Menlo, monospace`, letterSpacing: "0.06em" }}>{displayCode(k.code)}</div>
                    <div style={{ font: "500 7pt/1.2 system-ui, sans-serif", marginTop: "0.03in" }}>SUBVERSIVE · {kegSizeInfo(k.sizeId).short}</div>
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </>
  );
}
