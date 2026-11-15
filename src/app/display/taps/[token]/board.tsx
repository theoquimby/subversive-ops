"use client";

import { abvText, BADGE_LABEL, boardLayout, boardPoursShown, burnInOffset, priceText, type PublicTapList } from "@/domain/taps";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";

/**
 * The TV board. Polls every 60 s and only re-renders when something changed
 * (no reload, no flicker). Drifts a few pixels every 3 minutes against
 * burn-in. Dark, high contrast, sized from the number of rows so 6 taps are
 * huge and 16 still read across the room.
 */

const POLL_MS = 60_000;
const STALE_MS = 5 * 60_000;

const RM = "(prefers-reduced-motion: reduce)";
const subscribeRM = (cb: () => void) => {
  const m = window.matchMedia(RM);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
};

const subscribeResize = (cb: () => void) => {
  window.addEventListener("resize", cb);
  return () => window.removeEventListener("resize", cb);
};

const C = {
  bg: "#0d0c0b",
  ink: "#f6f1e7",
  muted: "#b9b1a3",
  faint: "#3a3631",
  rule: "#25221f",
  warn: "#f4b350",
  good: "#93d6a2",
};

export function TapBoardDisplay({ token, initial, timeZone }: { token: string; initial: PublicTapList; timeZone: string }) {
  const [data, setData] = useState(initial);
  const [gone, setGone] = useState(false);
  const [lastOk, setLastOk] = useState(() => Date.now());
  const [now, setNow] = useState<number | null>(null);
  const key = useRef(JSON.stringify({ t: initial.taps, s: initial.comingSoon, n: initial.name }));
  const reduced = useSyncExternalStore(subscribeRM, () => window.matchMedia(RM).matches, () => false);
  const aspect = useSyncExternalStore(subscribeResize, () => window.innerWidth / Math.max(1, window.innerHeight), () => 16 / 9);

  // Poll for changes.
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const r = await fetch(`/display/taps/${encodeURIComponent(token)}/data`, { cache: "no-store" });
        if (r.status === 404) { if (!stop) setGone(true); return; }
        if (!r.ok) return;
        const d = (await r.json()) as PublicTapList;
        if (stop) return;
        setLastOk(Date.now());
        setGone(false);
        const k = JSON.stringify({ t: d.taps, s: d.comingSoon, n: d.name });
        if (k !== key.current) { key.current = k; setData(d); }
      } catch {
        /* offline: keep showing the last list */
      }
    };
    const id = setInterval(tick, POLL_MS);
    const onVis = () => document.visibilityState === "visible" && tick();
    document.addEventListener("visibilitychange", onVis);
    return () => { stop = true; clearInterval(id); document.removeEventListener("visibilitychange", onVis); };
  }, [token]);

  // Clock and burn-in drift.
  useEffect(() => {
    const t = () => setNow(Date.now());
    t();
    const id = setInterval(t, 20_000);
    return () => clearInterval(id);
  }, []);

  // Hide the mouse pointer on a TV.
  useEffect(() => {
    const prev = document.body.style.cursor;
    document.body.style.cursor = "none";
    document.body.style.background = C.bg;
    return () => { document.body.style.cursor = prev; };
  }, []);

  const n = data.taps.length;
  const layout = useMemo(() => boardLayout(Math.max(n, 6), aspect), [n, aspect]);
  const off = now == null ? { x: 0, y: 0 } : burnInOffset(now);
  const stale = now != null && now - lastOk > STALE_MS;
  const clock = now == null ? "" : new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone }).format(now).toLowerCase().replace(" ", " ");
  const soon = data.comingSoon;
  const showDesc = layout.cols === 1;
  // Two columns: the two biggest pours, so names keep their room.
  const poursFor = (t: PublicTapList["taps"][number]) => boardPoursShown(t.pours, layout.cols === 2 ? 2 : 3);
  const header = 9; // vh
  const footer = soon.length ? 8 : 2;

  const vars = { "--rh": `calc((100vh - ${header + footer + 4}vh) / ${layout.rows})` } as CSSProperties;

  return (
    <div className="fixed inset-0 overflow-hidden select-none" style={{ background: C.bg, color: C.ink, fontFeatureSettings: '"tnum"' }}>
      <div
        className="absolute inset-0 flex flex-col"
        style={{ padding: "2vh 2.6vw", transform: `translate(${off.x}px, ${off.y}px)`, transition: reduced ? "none" : "transform 6s ease-in-out", ...vars }}
      >
        <header className="flex shrink-0 items-end justify-between" style={{ height: `${header}vh`, borderBottom: `2px solid ${C.rule}`, paddingBottom: "1.4vh" }}>
          <div className="flex items-baseline" style={{ gap: "1.6vw" }}>
            <span style={{ fontSize: "5.2vh", fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase", lineHeight: 1 }}>{data.name}</span>
            <span style={{ fontSize: "3.2vh", color: C.muted, fontWeight: 500, lineHeight: 1 }}>On tap</span>
          </div>
          <div className="flex items-center" style={{ gap: "1.2vw", fontSize: "3.2vh", color: C.muted, lineHeight: 1 }}>
            {stale && <span aria-label="Can't reach the app — showing the last list" title="Offline" style={{ width: "1.2vh", height: "1.2vh", borderRadius: 99, background: C.warn, display: "inline-block" }} />}
            <span className="num">{clock}</span>
          </div>
        </header>

        <main className="min-h-0 flex-1" style={{ paddingTop: "1.6vh" }}>
          {gone ? (
            <Center>This board's link was replaced. Open the new link from Kegs → Setup.</Center>
          ) : n === 0 ? (
            <Center>Changing kegs — back in a moment.</Center>
          ) : (
            <ol
              className="grid h-full"
              style={{ gridTemplateColumns: `repeat(${layout.cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${layout.rows}, var(--rh))`, gridAutoFlow: "column", columnGap: "3.2vw", listStyle: "none", margin: 0, padding: 0 }}
            >
              {data.taps.map((t) => (
                <li key={t.tap} className="flex min-w-0 items-center" style={{ gap: "calc(var(--rh) * .22)", borderBottom: `1px solid ${C.rule}` }}>
                  <span
                    className="grid shrink-0 place-items-center overflow-hidden"
                    style={{ width: "calc(var(--rh) * .66)", height: "calc(var(--rh) * .66)", borderRadius: "calc(var(--rh) * .14)", background: t.color, color: t.colorText, fontSize: "calc(var(--rh) * .34)", fontWeight: 800, lineHeight: 1, position: "relative", boxShadow: `inset 0 0 0 2px ${C.faint}` }}
                  >
                    {t.label ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={t.label} alt="" className="absolute inset-0 size-full object-cover" />
                    ) : t.tap}
                    {t.label && <span className="absolute bottom-0 right-0" style={{ background: "rgba(0,0,0,.72)", color: C.ink, fontSize: "calc(var(--rh) * .16)", padding: "0.2em 0.35em", borderTopLeftRadius: "0.4em" }}>{t.tap}</span>}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center" style={{ gap: "calc(var(--rh) * .12)" }}>
                      <span className="truncate" style={{ fontSize: "calc(var(--rh) * .31)", fontWeight: 750, lineHeight: 1.1, letterSpacing: "-0.01em" }}>{t.beer}</span>
                      {t.badge && (
                        <span className="shrink-0" style={{ fontSize: "calc(var(--rh) * .15)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", padding: "0.25em 0.6em", borderRadius: 99, border: `2px solid ${t.badge === "almost" ? C.warn : C.good}`, color: t.badge === "almost" ? C.warn : C.good, lineHeight: 1 }}>
                          {BADGE_LABEL[t.badge]}
                        </span>
                      )}
                    </div>
                    <div className="truncate" style={{ fontSize: "calc(var(--rh) * .18)", color: C.muted, marginTop: "calc(var(--rh) * .04)", lineHeight: 1.2 }}>
                      {[t.style, abvText(t.abv), t.ibu != null ? `${t.ibu} IBU` : null, t.diet].filter(Boolean).join("  ·  ") || " "}
                    </div>
                    {showDesc && t.description && (
                      <div className="truncate" style={{ fontSize: "calc(var(--rh) * .15)", color: C.muted, opacity: 0.85, marginTop: "calc(var(--rh) * .03)", lineHeight: 1.2 }}>{t.description}</div>
                    )}
                  </div>
                  {t.pours.length > 0 && (
                    <div className="flex shrink-0 items-end" style={{ gap: "calc(var(--rh) * .24)" }}>
                      {poursFor(t).map((p) => (
                        <div key={p.label} className="text-right" style={{ lineHeight: 1, minWidth: "calc(var(--rh) * 1.05)" }}>
                          <div style={{ fontSize: "calc(var(--rh) * .14)", color: C.muted, marginBottom: "0.35em", whiteSpace: "nowrap" }}>{p.label}</div>
                          <div style={{ fontSize: "calc(var(--rh) * .29)", fontWeight: 700 }}>{priceText(p.price)}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ol>
          )}
        </main>

        {soon.length > 0 && (
          <footer className="flex shrink-0 items-center overflow-hidden" style={{ height: `${footer}vh`, gap: "2vw", marginTop: "1.2vh", fontSize: "2.9vh", whiteSpace: "nowrap" }}>
            <span style={{ color: C.muted, textTransform: "uppercase", letterSpacing: "0.12em", fontWeight: 700, fontSize: "2.3vh" }}>Coming soon</span>
            {soon.map((s) => (
              <span key={s.beer} className="inline-flex items-center" style={{ gap: "0.5em" }}>
                <span aria-hidden style={{ width: "0.7em", height: "0.7em", borderRadius: 99, background: s.color, display: "inline-block", boxShadow: `0 0 0 1px ${C.faint}` }} />
                <span style={{ fontWeight: 650 }}>{s.beer}</span>
                {s.style && <span style={{ color: C.muted }}>{s.style}</span>}
              </span>
            ))}
          </footer>
        )}
      </div>
    </div>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className="grid h-full place-items-center text-center" style={{ fontSize: "4.4vh", color: C.muted, padding: "0 8vw" }}>{children}</div>;
}
