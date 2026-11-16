import type { AnnouncementTone } from "@/domain/websiteAnnouncements";
import { cx } from "@/components/ui";
import { X } from "lucide-react";

/**
 * Roughly how the website draws a line in its band under the header
 * (website src/components/layout/Announcements.tsx): closure is ink on
 * orange, event ink on yellow, plain is the page's own colours.
 */
export const TONE_STYLE: Record<AnnouncementTone, { bg: string; fg: string; border?: string }> = {
  closure: { bg: "#e3600c", fg: "#151412" },
  event: { bg: "#ffce3a", fg: "#151412" },
  info: { bg: "var(--surface)", fg: "var(--ink)", border: "var(--border)" },
};

export function BandLine({ text, tone, linkLabel, external }: { text: string; tone: AnnouncementTone; linkLabel?: string | null; external?: boolean }) {
  const s = TONE_STYLE[tone];
  return (
    <div className="flex items-start gap-2 px-3 py-2.5 text-[0.9rem] leading-snug" style={{ background: s.bg, color: s.fg, borderBottom: s.border ? `1px solid ${s.border}` : undefined }}>
      <p className="min-w-0 flex-1 break-words">
        {text || <span className="opacity-60">Your line shows here</span>}
        {linkLabel ? (
          <>
            {" "}
            <span className={cx("font-semibold underline underline-offset-2")}>{linkLabel}{external ? " ↗" : ""}</span>
          </>
        ) : null}
      </p>
      <X aria-hidden className="mt-0.5 size-4 shrink-0 opacity-70" />
    </div>
  );
}

/** A phone-width frame with the site's header bar above the band. */
export function PhoneBand({ lines, label = "On a phone" }: { lines: { key: string; text: string; tone: AnnouncementTone; linkLabel?: string | null; external?: boolean }[]; label?: string }) {
  return (
    <figure className="w-full max-w-[390px]">
      <div className="overflow-hidden rounded-xl ring-1 ring-border">
        <div className="flex h-11 items-center justify-between bg-[#151412] px-3 text-[0.8rem] font-semibold tracking-wide text-white" aria-hidden>
          <span>SUBVERSIVE</span>
          <span className="text-white/70">Menu</span>
        </div>
        {lines.length ? lines.map((l) => <BandLine key={l.key} text={l.text} tone={l.tone} linkLabel={l.linkLabel} external={l.external} />) : <p className="bg-surface px-3 py-3 text-sm text-muted">Nothing in the band today.</p>}
        <div className="h-10 bg-surface-2" aria-hidden />
      </div>
      <figcaption className="mt-1.5 text-xs text-muted">{label}</figcaption>
    </figure>
  );
}
